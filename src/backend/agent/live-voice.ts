import { randomUUID } from "node:crypto";
import type {
  AgentEvent,
  AgentReasoningEffort,
  AgentSummary,
  CodexLiveVoice,
  ConversationMessageSender,
  VoiceLiveEvent,
  VoiceLiveSession,
  VoiceLiveStart,
} from "@openbot/contracts/ipc";
import { speechTextFromMarkdown } from "@openbot/contracts/speech-text";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Deferred, Effect, Fiber, Schema, Semaphore } from "effect";
import type { AgentClient } from "../agent-client";
import {
  type AppServerNotification,
  type AppServerRequest,
  type DynamicToolResult,
  decodeRecordResponse,
  getRecord,
  getString,
} from "../protocol";
import {
  makeToollessDirectory,
  removeToollessDirectory,
  startToolless,
  stopToolless,
  toollessConfig,
} from "./profile-generation";

/** How long Codex has to answer the WebRTC offer of a live voice session. */
const ANSWER_TIMEOUT_MS = 20_000;
/** The longest reason from Codex in an end message, so the message fits the Team API event. */
const REASON_LIMIT = 1_000;
/** How Codex reports that OpenAI refused the call: `unexpected status 401 Unauthorized: …`. */
const UNAUTHORIZED = /\bstatus 401\b|\b401 Unauthorized\b/;
/**
 * How Codex reports that OpenAI's server has no realtime call for a ChatGPT login:
 * `unexpected status 404 Not Found: …, url: https://chatgpt.com/backend-api/codex/realtime/calls?…`.
 */
const CALL_NOT_FOUND = /\bstatus 404\b[\s\S]*\/realtime\/calls\b/;
/**
 * How Codex reports that OpenAI refused the live voice connection. Codex drops OpenAI's reason.
 * Current Codex: `unexpected status 403 Forbidden: realtime websocket handshake failed`.
 * Older Codex: `failed to connect realtime websocket: HTTP error: 403 Forbidden`.
 */
const FORBIDDEN = /^(?=[\s\S]*\brealtime\b)[\s\S]*(?:\bstatus 403\b|\b403 Forbidden\b)/;
/** The one tool of the relay thread. Codex calls it for each request that the voice model hands off. */
const ASK_TOOL = "ask_agent";
/**
 * The namespace of the relay tool. Each GPT model of the Codex catalog runs in code mode only: the relay
 * model then calls the tool from a script, and it sees the answer only when its script prints it. Often
 * the script does not, so the relay replies with nothing, and the voice says that the agent did not
 * answer. A direct-only namespace gives the tool result to the relay model itself (Codex 0.156.0 and later).
 */
const ASK_NAMESPACE = "openbot";
/**
 * Codex gives the voice at most about 4,000 bytes of a relay reply: about the first 2,000 bytes while
 * the relay writes them, and the remainder only when the reply is complete. From a longer reply it
 * removes the middle. The relay also needs many seconds to copy a long answer. So the relay copies
 * only a short answer, and gives a long one as a summary that reaches the voice complete and in a
 * few seconds (#6659).
 *
 * The longest answer, in UTF-8 bytes, that the relay copies: about 80 English words. Codex also tells
 * the relay to be concise, so the relay sometimes shortens an answer that has no mark, and then it
 * does not name the chat. Thus the limit is small: a marked answer always gets a summary that does.
 */
const RELAY_VERBATIM_BYTES = 600;
/** The longest summary of a longer answer, in words. */
const RELAY_SUMMARY_WORDS = 150;
/** The first line of a tool result with a longer answer. The relay model does not measure the length reliably. */
const LONG_ANSWER_MARK = "[long answer]";
/** How a model makes the spoken summary of a long answer: the relay, or a summary without a request. */
const SUMMARY_RULES =
  `its most important facts in ${RELAY_SUMMARY_WORDS} words or fewer, in the language of the answer. ` +
  "Use only facts from the answer, and never add or change one. " +
  "Write plain sentences without links, lists, formatting or code. " +
  "End with one sentence that says that the full answer is in the chat. ";
const RELAY_INSTRUCTIONS =
  "You relay requests. For every user request, call ask_agent exactly once with the request verbatim. " +
  "Never answer on your own. The tool result is the agent's answer, and a voice says your reply aloud. " +
  `If the first line of the result is ${LONG_ANSWER_MARK}, the answer is too long for the voice: reply with ` +
  SUMMARY_RULES +
  "If the result has no such first line, your reply is the complete result, word for word and nothing else: " +
  "do not shorten it, and do not change its form.";
/** The longest agent name that the voice gets, in characters. */
const VOICE_NAME_LIMIT = 80;
/**
 * The first message in the voice conversation. The voice model reads it as the user's. It is in English,
 * so without the language rule the voice says its own words, such as an acknowledgment, in English (#6871).
 * The voice model also ignores Codex's prompt on a ChatGPT login, so this message gives it the agent's name:
 * without the name, it says that it is ChatGPT (#9825). OpenAI ends the user's turn at a short pause, and
 * each request goes to the chat as a message: so the voice waits for the rest of a sentence that stops in
 * the middle, and does not give the agent the parts as separate requests (#9960).
 */
const relayVoiceRule = (name: string) =>
  (name
    ? `You are the voice of my agent "${name}". When I ask who you are, you are ${name}. ` +
      "Never say that you are ChatGPT, Codex or another OpenAI assistant. "
    : "") +
  "From now on, give every request of mine to the background agent, even simple questions and small talk. " +
  "When I stop in the middle of a sentence to think, wait silently for the rest, " +
  "and then give the complete request to the agent in one piece. " +
  "Never answer from your own knowledge. Wait for the agent's result before you give an answer. " +
  "Say only what the result says, and add no facts of your own. " +
  "Always speak the language that I speak, also for your own short words such as greetings and acknowledgments. " +
  "Keep that language when a short or unclear phrase sounds like a different one. " +
  "If I ask you to speak a different language, use it. " +
  "Do not reply to this message.";
/**
 * What the voice says when a spoken request waits behind another turn of the agent, which can take minutes.
 * It goes straight to the voice: as a tool result, the relay model often replaces it with a failure of its own.
 */
const QUEUED_NOTICE =
  "Your request is in the queue. The agent is still working on an earlier request. " +
  "You hear the answer when the agent finishes.";
/** What the voice says about a long answer when OpenBot cannot make a summary of it. */
const LONG_ANSWER_FALLBACK = "The agent gave a long answer. It is in the chat.";
/** The prompt that makes the summary of a long answer that the voice says without a request. */
const summaryPrompt = (answer: string) =>
  `A voice says your reply aloud. The answer below is too long for the voice: reply with ${SUMMARY_RULES}` +
  `Reply with the summary only.\n\nAnswer:\n${answer}`;
/** What the relay gets for a request that the agent answered in the same turn as an earlier request. */
const SAME_TURN_REPLY = "The agent answered this request together with the previous one.";
/**
 * How Codex gives each voice request to the relay: `<realtime_delegation>`, an optional `<source>`, then
 * `<input>` with the request, and `<transcript_delta>` with the call. Codex escapes `&`, `<` and `>` in
 * the text. The relay model sometimes copies all of it into `ask_agent`, and the chat then shows the tags.
 */
const RELAY_DELEGATION = /^<realtime_delegation>\s*(?:<source>[^<]*<\/source>\s*)?<input>([^<]*)<\/input>/;

/**
 * The request in a copied Codex wrapper, or the text as it is. Only a complete `<input>` with text counts:
 * Codex also saves the call in wrappers with an empty `<input>`, and such a request must not get lost.
 */
function relayRequest(text: string): string {
  const input = RELAY_DELEGATION.exec(text)?.[1]
    ?.replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .trim();
  return input || text;
}

const logger = createOpenBotLogger("live-voice");

class LiveVoiceFailed extends Schema.TaggedError<LiveVoiceFailed>()("LiveVoiceFailed", {
  cause: Schema.Defect(),
}) {}

const liveStep = <A>(run: () => A) => Effect.try({ try: run, catch: (cause) => new LiveVoiceFailed({ cause }) });
const liveFailure = (text: string) => new LiveVoiceFailed({ cause: new Error(text) });
const toLiveVoiceFailed = Effect.mapError(
  (failure: { readonly cause: unknown }) => new LiveVoiceFailed({ cause: failure.cause }),
);

/** A Codex process for the voice of one session, with the model that relays its requests. */
interface LiveVoiceRelay {
  readonly client: AgentClient;
  readonly model: string;
  readonly effort: AgentReasoningEffort;
}

/** The end of a request that the voice gave to the agent: its answer, or why there is none. */
export interface LiveVoiceReply {
  readonly success: boolean;
  readonly text: string;
  /** The turn that gave the answer, so that the voice does not say it a second time. */
  readonly turnId?: string;
}

/**
 * Who started a session: a member of this server, or the user of this computer (null). Each owner has
 * at most one session, and only the owner gets its events.
 */
export interface LiveVoiceOwner {
  readonly memberId: string;
  /** The sender of the spoken requests in the chat. */
  readonly sender: ConversationMessageSender | undefined;
}

export interface LiveVoiceHooks {
  agent(agentId: string): AgentSummary;
  /** A new Codex process that is not started yet. It runs no agent: it only connects the voice. */
  relay(agent: AgentSummary): Effect.Effect<LiveVoiceRelay, { readonly cause: unknown }>;
  /** Sends a spoken request to the agent as the user's message, and gives its delivery id. */
  send(
    agentId: string,
    text: string,
    sender: ConversationMessageSender | undefined,
  ): Effect.Effect<string, { readonly cause: unknown }>;
  /** The reply to a delivery, or null while the agent still works on it. */
  reply(agentId: string, deliveryId: string): LiveVoiceReply | null;
  /** Whether the agent runs a turn now, so that a new message waits in the queue. */
  busy(agentId: string): boolean;
  /** The answer of a completed turn in the agent's own chat, or null for a turn of another thread or with no answer. */
  answer(agentId: string, threadId: string, turnId: string): string | null;
  /** A short spoken summary of a long answer. */
  summarize(agentId: string, prompt: string): Effect.Effect<string, { readonly cause: unknown }>;
  /** `memberId` is null for a session of this computer. */
  emit(event: VoiceLiveEvent, memberId: string | null): void;
  redact(text: string): string;
}

interface LiveSession {
  readonly id: string;
  readonly agentId: string;
  readonly owner: LiveVoiceOwner | null;
  readonly client: AgentClient;
  readonly cwd: string;
  threadId: string | null;
  readonly answer: Deferred.Deferred<string, LiveVoiceFailed>;
  readonly onNotification: (notification: AppServerNotification) => void;
  readonly onRequest: (request: AppServerRequest) => void;
  readonly onExit: (error: Error) => void;
  /** Keeps the order of the answers that the voice says without a request. */
  readonly speech: Semaphore.Semaphore;
  /** The turns whose answer went to the voice already. */
  readonly answeredTurns: Set<string>;
  /** The texts that wait for the voice, so that the end of the session stops them. */
  readonly speaking: Set<Fiber.Fiber<void>>;
}

/**
 * A request that the voice gave to the agent, while the agent works on it. With a request id, the
 * relay waits for the answer. Without one, the relay stopped waiting, and the voice says the answer
 * when it comes.
 */
interface PendingAsk {
  readonly session: LiveSession;
  readonly requestId: AppServerRequest["id"] | null;
  readonly deliveryId: string;
}

/**
 * Live voice: OpenAI realtime voice through Codex, for an agent of any provider. The renderer sends a
 * WebRTC offer, and a separate Codex process connects it to OpenAI with the user's own Codex sign-in.
 * Audio goes between the renderer and OpenAI. OpenBot never reads the Codex credentials.
 *
 * The voice runs on a relay thread of that process, not on the agent's thread. When the voice model
 * hands a request off, the relay calls `ask_agent`, and OpenBot sends the request to the agent as the
 * user's message. The agent's answer goes back to the voice, which speaks it: a short answer as it
 * is, a long one as a summary. So the voice does not depend on the agent's provider or model, and a
 * model change does not end it. The chat shows each request and the full answer as usual.
 *
 * When a request waits behind another turn, the voice tells the user at once, so that it does not wait in
 * silence. The voice also says each other answer of the agent in its chat while the session runs, such
 * as the answer to a typed message.
 *
 * One session runs at a time for each owner: the user of this computer, or one member of the server.
 */
export class LiveVoice {
  readonly #hooks: LiveVoiceHooks;
  readonly #sessions = new Map<string, LiveSession>();
  readonly #asks = new Set<PendingAsk>();
  /** The stops of relay processes that still run, so that `dispose` can wait for them. */
  readonly #closing = new Set<Fiber.Fiber<void>>();
  /** Counts the starts of each owner, so that a start that a newer one replaced does not keep its session. */
  readonly #starts = new Map<string | null, number>();

  constructor(hooks: LiveVoiceHooks) {
    this.#hooks = hooks;
  }

  /** `voice` is the user's choice in Settings; null lets OpenAI choose. `owner` is null for this computer. */
  readonly start = Effect.fn("LiveVoice.start")(function* (
    this: LiveVoice,
    input: VoiceLiveStart,
    voice: CodexLiveVoice | null,
    owner: LiveVoiceOwner | null = null,
  ) {
    const agent = yield* liveStep(() => this.#hooks.agent(input.agentId));
    // One line without quotes, so that the name cannot change the rule around it.
    const name = this.#hooks
      .redact(agent.name.replace(/["\s]+/g, " ").trim())
      .slice(0, VOICE_NAME_LIMIT)
      .trim();
    const key = owner?.memberId ?? null;
    for (const session of [...this.#sessions.values()])
      if ((session.owner?.memberId ?? null) === key) yield* this.#stopSession(session);
    const start = (this.#starts.get(key) ?? 0) + 1;
    this.#starts.set(key, start);
    const relay = yield* this.#hooks.relay(agent).pipe(toLiveVoiceFailed);
    const cwd = yield* makeToollessDirectory().pipe(toLiveVoiceFailed);
    const session: LiveSession = {
      id: randomUUID(),
      agentId: agent.id,
      owner,
      client: relay.client,
      cwd,
      threadId: null,
      answer: Deferred.makeUnsafe<string, LiveVoiceFailed>(),
      onNotification: (notification) => this.#notification(session, notification),
      onRequest: (request) => this.#request(session, request),
      onExit: () => this.#end(session, sourceText("error.voice.live.disconnected")),
      speech: Semaphore.makeUnsafe(1),
      answeredTurns: new Set(),
      speaking: new Set(),
    };
    this.#sessions.set(session.id, session);
    relay.client.on("notification", session.onNotification);
    relay.client.on("request", session.onRequest);
    relay.client.once("exit", session.onExit);

    const sdp = yield* Effect.gen({ self: this }, function* () {
      yield* startToolless(relay.client).pipe(toLiveVoiceFailed);
      const config = yield* toollessConfig(relay.client).pipe(toLiveVoiceFailed);
      const thread = yield* relay.client
        .request(
          "thread/start",
          {
            cwd,
            model: relay.model,
            effort: relay.effort,
            ephemeral: true,
            persistSession: false,
            sandbox: "read-only",
            approvalPolicy: "never",
            dynamicTools: [
              {
                type: "namespace",
                name: ASK_NAMESPACE,
                description: "OpenBot, which runs the agent.",
                tools: [
                  {
                    type: "function",
                    name: ASK_TOOL,
                    description: "Pass the user's spoken request to the agent and return its answer.",
                    inputSchema: {
                      type: "object",
                      properties: { request: { type: "string", description: "The user's request, verbatim." } },
                      required: ["request"],
                      additionalProperties: false,
                    },
                  },
                ],
              },
            ],
            baseInstructions: RELAY_INSTRUCTIONS,
            config: {
              ...config,
              features: {
                ...config.features,
                code_mode: { enabled: false, direct_only_tool_namespaces: [ASK_NAMESPACE] },
              },
            },
          },
          decodeRecordResponse,
        )
        .pipe(toLiveVoiceFailed);
      const threadId = getString(getRecord(thread, "thread"), "id");
      if (!threadId || start !== this.#starts.get(key))
        return yield* liveFailure(sourceText("error.voice.live.disconnected"));
      session.threadId = threadId;
      yield* relay.client
        .request(
          "thread/realtime/start",
          {
            threadId,
            outputModality: "audio",
            transport: { type: "webrtc", sdp: input.sdp },
            // A ChatGPT login reaches only the AVAS calls, which refuse the default v1 protocol.
            version: "v3",
            // The startup context describes the user's other Codex threads and files. The relay needs none of it.
            includeStartupContext: false,
            ...(voice ? { voice } : {}),
          },
          decodeRecordResponse,
        )
        .pipe(toLiveVoiceFailed);
      const answer = yield* Deferred.await(session.answer).pipe(
        Effect.timeoutOrElse({
          duration: ANSWER_TIMEOUT_MS,
          orElse: () => Effect.fail(liveFailure(sourceText("error.voice.live.timedOut"))),
        }),
      );
      // The voice model answers small questions itself, and ignores Codex's prompt settings on a ChatGPT login.
      // A control message in the conversation makes it give each request to the agent.
      yield* relay.client
        .request("thread/realtime/appendText", { threadId, text: relayVoiceRule(name) }, decodeRecordResponse)
        .pipe(toLiveVoiceFailed);
      return answer;
    }).pipe(
      Effect.mapError((failure) => this.#startFailure(failure)),
      Effect.onError(() => Effect.sync(() => this.#end(session, null, false))),
    );
    return { sessionId: session.id, sdp } satisfies VoiceLiveSession;
  });

  /** Stops a session of `memberId`; null stops a session of this computer. A session of another owner stays. */
  readonly stop = Effect.fn("LiveVoice.stop")(function* (
    this: LiveVoice,
    sessionId: string,
    memberId: string | null = null,
  ) {
    const session = this.#sessions.get(sessionId);
    if (session && (session.owner?.memberId ?? null) === memberId) yield* this.#stopSession(session);
  });

  /**
   * Reads the events of the agent service. A queue change follows the end of each delivery, after
   * the turn's messages are saved, so it can carry the answer to a request of the voice. A completed
   * turn in the agent's own chat also follows the save: the voice says its answer, unless the answer
   * went to the voice already. A turn that continues, or a quiet routine run, has no answer to say.
   */
  observe(event: AgentEvent): void {
    if (this.#sessions.size === 0) return;
    if (event.type === "queue-changed" || event.type === "turn-completed") this.#answerSettled();
    if (event.type !== "turn-completed" || event.status !== "completed" || event.quiet || event.continues) return;
    for (const session of this.#sessions.values()) {
      if (session.agentId !== event.agentId || !session.threadId) continue;
      if (session.answeredTurns.delete(event.turnId)) continue;
      const answer = this.#hooks.answer(event.agentId, event.threadId, event.turnId);
      if (answer) this.#say(session, this.#speech(session.agentId, answer));
    }
  }

  /** Ends every session and waits until each relay process stops. */
  readonly dispose = Effect.fn("LiveVoice.dispose")(function* (this: LiveVoice) {
    for (const session of [...this.#sessions.values()]) this.#end(session, null);
    yield* Fiber.joinAll([...this.#closing]);
  });

  #notification(session: LiveSession, notification: AppServerNotification): void {
    if (!this.#sessions.has(session.id) || !notification.method.startsWith("thread/realtime/")) return;
    const params = notification.params;
    if (getString(params, "threadId") !== session.threadId) return;
    switch (notification.method) {
      case "thread/realtime/sdp": {
        const sdp = getString(params, "sdp");
        if (sdp) Deferred.doneUnsafe(session.answer, Effect.succeed(sdp));
        return;
      }
      case "thread/realtime/error": {
        this.#end(session, this.#reason(getString(params, "message")));
        return;
      }
      case "thread/realtime/closed": {
        const reason = getString(params, "reason");
        this.#end(session, reason ? this.#reason(reason) : null);
        return;
      }
      case "thread/realtime/transcript/delta":
      case "thread/realtime/transcript/done": {
        const role = getString(params, "role");
        if (role !== "user" && role !== "assistant") return;
        const final = notification.method === "thread/realtime/transcript/done";
        const text = getString(params, final ? "text" : "delta");
        if (text)
          this.#hooks.emit(
            { type: "transcript", sessionId: session.id, role, text, final },
            session.owner?.memberId ?? null,
          );
        return;
      }
    }
  }

  /** The relay thread has no approvals and one tool, so the only request it can make is `ask_agent`. */
  #request(session: LiveSession, request: AppServerRequest): void {
    const params = request.params;
    if (
      request.method !== "item/tool/call" ||
      getString(params, "threadId") !== session.threadId ||
      getString(params, "namespace") !== ASK_NAMESPACE ||
      getString(params, "tool") !== ASK_TOOL
    ) {
      session.client.respondError(request.id, { code: -32601, message: "Live voice answers only ask_agent." });
      return;
    }
    const asked = getString(getRecord(params, "arguments"), "request")?.trim();
    const text = asked && relayRequest(asked);
    if (!text) {
      session.client.respond(request.id, toolResult({ success: false, text: "The request is empty." }));
      return;
    }
    // Read before the send: a message to an idle agent can wait in the queue for a moment too.
    const waits = this.#hooks.busy(session.agentId);
    Effect.runFork(
      this.#hooks.send(session.agentId, text, session.owner?.sender).pipe(
        Effect.match({
          onFailure: (failure) =>
            this.#respond(session, request.id, {
              success: false,
              text: failure.cause instanceof Error ? failure.cause.message : String(failure.cause),
            }),
          onSuccess: (deliveryId) => {
            if (!this.#sessions.has(session.id)) return;
            // Codex stops waiting when the relay turn ends. The voice says the answer when it comes.
            const ask: PendingAsk = { session, requestId: request.signal?.aborted ? null : request.id, deliveryId };
            this.#asks.add(ask);
            request.signal?.addEventListener(
              "abort",
              () => {
                if (!this.#asks.delete(ask)) return;
                this.#asks.add({ session, requestId: null, deliveryId });
              },
              { once: true },
            );
            this.#answerSettled();
            if (waits && this.#asks.has(ask)) this.#say(session, Effect.succeed(QUEUED_NOTICE), false);
          },
        }),
      ),
    );
  }

  #answerSettled(): void {
    for (const ask of [...this.#asks]) {
      const reply = this.#hooks.reply(ask.session.agentId, ask.deliveryId);
      if (!reply) continue;
      this.#asks.delete(ask);
      // The agent answers the requests that waited together in one turn: the voice says the answer once.
      const repeat = reply.turnId !== undefined && ask.session.answeredTurns.has(reply.turnId);
      if (reply.turnId) ask.session.answeredTurns.add(reply.turnId);
      if (ask.requestId !== null)
        this.#respond(ask.session, ask.requestId, repeat ? { success: true, text: SAME_TURN_REPLY } : reply);
      else if (!repeat) this.#say(ask.session, this.#speech(ask.session.agentId, reply.text));
    }
  }

  /** Each result goes to OpenAI, so it loses the configured secrets first. */
  #respond(session: LiveSession, requestId: AppServerRequest["id"], reply: LiveVoiceReply): void {
    if (!this.#sessions.has(session.id)) return;
    session.client.respond(requestId, toolResult({ ...reply, text: this.#hooks.redact(reply.text) }));
  }

  /**
   * What the voice says for an answer that no open request waits for: a short answer as plain sentences,
   * a long one as a summary. The text goes to OpenAI, so it loses the configured secrets first.
   */
  #speech(agentId: string, answer: string): Effect.Effect<string> {
    const redacted = this.#hooks.redact(answer);
    if (Buffer.byteLength(redacted) <= RELAY_VERBATIM_BYTES) return Effect.succeed(speechTextFromMarkdown(redacted));
    return this.#hooks.summarize(agentId, summaryPrompt(redacted)).pipe(
      Effect.map((summary) => this.#hooks.redact(summary.trim()) || LONG_ANSWER_FALLBACK),
      Effect.catch((failure) =>
        Effect.sync(() => {
          logger.warn("Could not make a summary of an answer for live voice.", { error: failure.cause });
          return LONG_ANSWER_FALLBACK;
        }),
      ),
    );
  }

  /**
   * Gives text to the voice to say. An answer waits for the answers that came before it. A notice
   * (`ordered` false) does not wait for a summary that OpenBot still makes. The end of the session stops it.
   */
  #say(session: LiveSession, text: Effect.Effect<string>, ordered = true): void {
    const say = text.pipe(
      Effect.flatMap((speech) => {
        const threadId = session.threadId;
        if (!speech || !threadId || !this.#sessions.has(session.id)) return Effect.void;
        return session.client
          .request("thread/realtime/appendSpeech", { threadId, text: speech }, decodeRecordResponse)
          .pipe(
            Effect.catch((failure) =>
              Effect.sync(() => logger.warn("Live voice could not say an answer.", { error: failure })),
            ),
          );
      }),
    );
    const fiber = Effect.runFork(ordered ? session.speech.withPermit(say) : say);
    session.speaking.add(fiber);
    fiber.addObserver(() => session.speaking.delete(fiber));
  }

  #startFailure(failure: LiveVoiceFailed): LiveVoiceFailed {
    const message = failure.cause instanceof Error ? failure.cause.message : String(failure.cause);
    const text = this.#plainText(message);
    return text ? liveFailure(text) : failure;
  }

  #reason(message: string | null): string {
    if (!message) return sourceText("error.voice.live.disconnected");
    return (
      this.#plainText(message) ??
      sourceText("error.voice.live.failed", { reason: this.#hooks.redact(message).slice(0, REASON_LIMIT) })
    );
  }

  /**
   * Plain text for an OpenAI refusal that Codex reports, or null for another error. The log keeps
   * OpenAI's request details.
   */
  #plainText(message: string): string | null {
    // Codex sends an API key login and a missing login to the paid Realtime API, which refuses both.
    if (UNAUTHORIZED.test(message)) return sourceText("error.voice.live.signIn");
    const key = CALL_NOT_FOUND.test(message)
      ? "error.voice.live.unavailable"
      : FORBIDDEN.test(message)
        ? "error.voice.live.refused"
        : null;
    if (!key) return null;
    logger.warn("OpenAI refused the live voice call.", {
      text: key,
      reason: this.#hooks.redact(message).slice(0, REASON_LIMIT),
    });
    return sourceText(key);
  }

  readonly #stopSession = Effect.fn("LiveVoice.stopSession")(function* (this: LiveVoice, session: LiveSession) {
    if (!this.#sessions.has(session.id)) return;
    const threadId = session.threadId;
    if (threadId)
      yield* session.client
        .request("thread/realtime/stop", { threadId }, decodeRecordResponse)
        .pipe(Effect.timeout(ANSWER_TIMEOUT_MS), Effect.ignore);
    this.#end(session, null);
  });

  /** Ends a session and stops its relay process. The agent finishes the requests it has. */
  #end(session: LiveSession, error: string | null, announce = true): void {
    if (!this.#sessions.delete(session.id)) return;
    session.client.off("notification", session.onNotification);
    session.client.off("request", session.onRequest);
    session.client.off("exit", session.onExit);
    for (const ask of this.#asks) if (ask.session === session) this.#asks.delete(ask);
    for (const fiber of session.speaking) Effect.runFork(Fiber.interrupt(fiber));
    Deferred.doneUnsafe(session.answer, Effect.fail(liveFailure(error ?? sourceText("error.voice.live.disconnected"))));
    const closing = Effect.runFork(
      stopToolless(session.client).pipe(
        Effect.ignore,
        Effect.andThen(removeToollessDirectory(session.cwd).pipe(Effect.ignore)),
      ),
    );
    this.#closing.add(closing);
    closing.addObserver(() => this.#closing.delete(closing));
    if (announce) this.#hooks.emit({ type: "ended", sessionId: session.id, error }, session.owner?.memberId ?? null);
  }
}

/**
 * A long answer gets the mark that tells the relay to give a summary of it. A failure does not: the
 * chat can have no answer for it.
 */
function toolResult(reply: LiveVoiceReply): DynamicToolResult {
  const long = reply.success && Buffer.byteLength(reply.text) > RELAY_VERBATIM_BYTES;
  const text = long ? `${LONG_ANSWER_MARK}\n${reply.text}` : reply.text;
  return { contentItems: [{ type: "inputText", text }], success: reply.success };
}
