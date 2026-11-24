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

const ANSWER_TIMEOUT_MS = 20_000;
const REASON_LIMIT = 1_000;
const UNAUTHORIZED = /\bstatus 401\b|\b401 Unauthorized\b/;
const CALL_NOT_FOUND = /\bstatus 404\b[\s\S]*\/realtime\/calls\b/;
const FORBIDDEN = /^(?=[\s\S]*\brealtime\b)[\s\S]*(?:\bstatus 403\b|\b403 Forbidden\b)/;
const ASK_TOOL = "ask_agent";
const ASK_NAMESPACE = "openbot";
const RELAY_VERBATIM_BYTES = 600;
const RELAY_SUMMARY_WORDS = 150;
const LONG_ANSWER_MARK = "[long answer]";
const SUMMARY_RULES =
  `its most important facts in ${RELAY_SUMMARY_WORDS} words or fewer, in the language of the answer. ` +
  "Use only facts from the answer, and never add or change one. " +
  "Write plain sentences without links, lists, formatting or code. " +
  "End with one sentence that says that the full answer is in the chat. ";
const RELAY_INSTRUCTIONS =
  "You relay requests. For every user request, call ask_agent exactly once with the user's complete request " +
  "in the user's own words, as the transcript gives them. Do not shorten or summarize it, and add no question of your own. " +
  "Never answer on your own. The tool result is the agent's answer, and a voice says your reply aloud. " +
  `If the first line of the result is ${LONG_ANSWER_MARK}, the answer is too long for the voice: reply with ` +
  SUMMARY_RULES +
  "If the result has no such first line, your reply is the complete result, word for word and nothing else: " +
  "do not shorten it, and do not change its form.";
const VOICE_NAME_LIMIT = 80;
const relayVoiceRule = (name: string) =>
  (name
    ? `You are the voice of my agent "${name}". When I ask who you are, you are ${name}. ` +
      "Never say that you are ChatGPT, Codex or another OpenAI assistant. "
    : "") +
  "From now on, give every request of mine to the agent, even simple questions and small talk. " +
  "You and the agent are one: speak as the agent. Never say that you pass, forward or hand over a request, " +
  "or that someone else answers it. " +
  "When I stop in the middle of a sentence to think, wait silently for the rest, " +
  "and then give the complete request to the agent in one piece. " +
  "Never answer from your own knowledge. Wait for the agent's result before you give an answer. " +
  "Say only what the result says, and add no facts of your own. " +
  "Always speak the language that I speak, also for your own short words such as greetings. " +
  "Keep that language when a short or unclear phrase sounds like a different one. " +
  "Also use the same regional variety of the language as I do, for example European or Brazilian Portuguese. " +
  "If I ask you to speak a different language or variety, use it. " +
  "Do not reply to this message.";
const QUEUED_NOTICE =
  "Your request is in the queue. The agent is still working on an earlier request. " +
  "You hear the answer when the agent finishes.";
const LONG_ANSWER_FALLBACK = "The agent gave a long answer. It is in the chat.";
const summaryPrompt = (answer: string) =>
  `A voice says your reply aloud. The answer below is too long for the voice: reply with ${SUMMARY_RULES}` +
  `Reply with the summary only.\n\nAnswer:\n${answer}`;
const SAME_TURN_REPLY = "The agent answered this request together with the previous one.";
const RELAY_DELEGATION = /^<realtime_delegation>\s*(?:<source>[^<]*<\/source>\s*)?<input>([^<]*)<\/input>/;

function relayRequest(text: string): string {
  const input = RELAY_DELEGATION.exec(text)?.[1]
    ?.replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .trim();
  return input || text;
}

const HEARD_LINE_LIMIT = 20;
const USER_LINE_WAIT_MS = 2_000;
const oneLine = (text: string) => text.replace(/\s+/gu, " ").trim();

const logger = createOpenBotLogger("live-voice");

class LiveVoiceFailed extends Schema.TaggedError<LiveVoiceFailed>()("LiveVoiceFailed", {
  cause: Schema.Defect(),
}) {}

const liveStep = <A>(run: () => A) => Effect.try({ try: run, catch: (cause) => new LiveVoiceFailed({ cause }) });
const liveFailure = (text: string) => new LiveVoiceFailed({ cause: new Error(text) });
const toLiveVoiceFailed = Effect.mapError(
  (failure: { readonly cause: unknown }) => new LiveVoiceFailed({ cause: failure.cause }),
);

interface LiveVoiceRelay {
  readonly client: AgentClient;
  readonly model: string;
  readonly effort: AgentReasoningEffort;
}

export interface LiveVoiceReply {
  readonly success: boolean;
  readonly text: string;
  readonly turnId?: string;
}

export interface LiveVoiceOwner {
  readonly memberId: string;
  readonly sender: ConversationMessageSender | undefined;
}

interface LiveVoiceLine {
  readonly role: "user" | "assistant";
  readonly text: string;
}

export interface LiveVoiceRelayed {
  readonly shown: string;
  readonly request: string;
  readonly heard: readonly LiveVoiceLine[];
}

export interface LiveVoiceHooks {
  agent(agentId: string): AgentSummary;
  relay(agent: AgentSummary): Effect.Effect<LiveVoiceRelay, { readonly cause: unknown }>;
  send(
    agentId: string,
    relayed: LiveVoiceRelayed,
    sender: ConversationMessageSender | undefined,
  ): Effect.Effect<string, { readonly cause: unknown }>;
  reply(agentId: string, deliveryId: string): LiveVoiceReply | null;
  busy(agentId: string): boolean;
  answer(agentId: string, threadId: string, turnId: string): string | null;
  summarize(agentId: string, prompt: string): Effect.Effect<string, { readonly cause: unknown }>;
  emit(event: VoiceLiveEvent, memberId: string | null): void;
  redact(text: string): string;
  otherAccounts(agentId: string): boolean;
}

interface OpenUserLine {
  text: string;
  readonly done: Deferred.Deferred<void>;
}

interface LiveSession {
  readonly id: string;
  readonly agentId: string;
  readonly owner: LiveVoiceOwner | null;
  readonly client: AgentClient;
  readonly cwd: string;
  threadId: string | null;
  readonly rule: string;
  readonly heard: LiveVoiceLine[];
  userLine: OpenUserLine | null;
  userLineGiven: boolean;
  readonly answer: Deferred.Deferred<string, LiveVoiceFailed>;
  readonly onNotification: (notification: AppServerNotification) => void;
  readonly onRequest: (request: AppServerRequest) => void;
  readonly onExit: (error: Error) => void;
  readonly speech: Semaphore.Semaphore;
  readonly answeredTurns: Set<string>;
  readonly speaking: Set<Fiber.Fiber<void>>;
}

interface PendingAsk {
  readonly session: LiveSession;
  readonly requestId: AppServerRequest["id"] | null;
  readonly deliveryId: string;
}

export class LiveVoice {
  readonly #hooks: LiveVoiceHooks;
  readonly #sessions = new Map<string, LiveSession>();
  readonly #asks = new Set<PendingAsk>();
  readonly #closing = new Set<Fiber.Fiber<void>>();
  readonly #starts = new Map<string | null, number>();

  constructor(hooks: LiveVoiceHooks) {
    this.#hooks = hooks;
  }

  readonly start = Effect.fn("LiveVoice.start")(function* (
    this: LiveVoice,
    input: VoiceLiveStart,
    voice: CodexLiveVoice | null,
    owner: LiveVoiceOwner | null = null,
  ) {
    const agent = yield* liveStep(() => this.#hooks.agent(input.agentId));
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
      rule: oneLine(relayVoiceRule(name)),
      heard: [],
      userLine: null,
      userLineGiven: false,
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
            version: "v3",
            includeStartupContext: false,
            delegationAckFiller: false,
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
      yield* relay.client
        .request("thread/realtime/appendText", { threadId, text: relayVoiceRule(name) }, decodeRecordResponse)
        .pipe(toLiveVoiceFailed);
      return answer;
    }).pipe(
      Effect.mapError((failure) => this.#startFailure(failure, session.agentId)),
      Effect.onError(() => Effect.sync(() => this.#end(session, null, false))),
    );
    return { sessionId: session.id, sdp } satisfies VoiceLiveSession;
  });

  readonly stop = Effect.fn("LiveVoice.stop")(function* (
    this: LiveVoice,
    sessionId: string,
    memberId: string | null = null,
  ) {
    const session = this.#sessions.get(sessionId);
    if (session && (session.owner?.memberId ?? null) === memberId) yield* this.#stopSession(session);
  });

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
        this.#end(session, this.#reason(getString(params, "message"), session.agentId));
        return;
      }
      case "thread/realtime/closed": {
        const reason = getString(params, "reason");
        this.#end(session, reason ? this.#reason(reason, session.agentId) : null);
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
        const line = final ? text?.trim() : undefined;
        const given = role === "user" && final && session.userLineGiven;
        if (line && !given && !(role === "user" && oneLine(line) === session.rule)) {
          session.heard.push({ role, text: line });
          if (session.heard.length > HEARD_LINE_LIMIT) session.heard.shift();
        }
        if (role === "user" && (final || text)) trackUserLine(session, final, text ?? "");
        return;
      }
    }
  }

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
    const waits = this.#hooks.busy(session.agentId);
    const pending = session.heard.some((line) => line.role === "user") ? null : session.userLine;
    const settled = pending
      ? Deferred.await(pending.done).pipe(Effect.timeoutOption(USER_LINE_WAIT_MS), Effect.asVoid)
      : Effect.void;
    const send = Effect.suspend(() => {
      const heard = takeHeard(session, pending);
      const said = heard.flatMap((line) => (line.role === "user" ? [line.text] : [])).join("\n");
      return this.#hooks
        .send(session.agentId, { shown: said || text, request: text, heard }, session.owner?.sender)
        .pipe(
          Effect.match({
            onFailure: (failure) => {
              session.heard.unshift(...heard);
              session.heard.splice(0, session.heard.length - HEARD_LINE_LIMIT);
              this.#respond(session, request.id, {
                success: false,
                text: failure.cause instanceof Error ? failure.cause.message : String(failure.cause),
              });
            },
            onSuccess: (deliveryId) => {
              if (!this.#sessions.has(session.id)) return;
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
        );
    });
    Effect.runFork(settled.pipe(Effect.andThen(send)));
  }

  #answerSettled(): void {
    for (const ask of [...this.#asks]) {
      const reply = this.#hooks.reply(ask.session.agentId, ask.deliveryId);
      if (!reply) continue;
      this.#asks.delete(ask);
      const repeat = reply.turnId !== undefined && ask.session.answeredTurns.has(reply.turnId);
      if (reply.turnId) ask.session.answeredTurns.add(reply.turnId);
      if (ask.requestId !== null)
        this.#respond(ask.session, ask.requestId, repeat ? { success: true, text: SAME_TURN_REPLY } : reply);
      else if (!repeat) this.#say(ask.session, this.#speech(ask.session.agentId, reply.text));
    }
  }

  #respond(session: LiveSession, requestId: AppServerRequest["id"], reply: LiveVoiceReply): void {
    if (!this.#sessions.has(session.id)) return;
    session.client.respond(requestId, toolResult({ ...reply, text: this.#hooks.redact(reply.text) }));
  }

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

  #startFailure(failure: LiveVoiceFailed, agentId: string): LiveVoiceFailed {
    const message = failure.cause instanceof Error ? failure.cause.message : String(failure.cause);
    const text = this.#plainText(message, agentId);
    return text ? liveFailure(text) : failure;
  }

  #reason(message: string | null, agentId: string): string {
    if (!message) return sourceText("error.voice.live.disconnected");
    return (
      this.#plainText(message, agentId) ??
      sourceText("error.voice.live.failed", { reason: this.#hooks.redact(message).slice(0, REASON_LIMIT) })
    );
  }

  #plainText(message: string, agentId: string): string | null {
    if (UNAUTHORIZED.test(message))
      return sourceText(
        this.#hooks.otherAccounts(agentId) ? "error.voice.live.chooseAccount" : "error.voice.live.signIn",
      );
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

function trackUserLine(session: LiveSession, final: boolean, text: string): void {
  if (!final) {
    session.userLine ??= { text: "", done: Deferred.makeUnsafe<void>() };
    session.userLine.text += text;
    return;
  }
  if (session.userLine) Deferred.doneUnsafe(session.userLine.done, Effect.void);
  session.userLine = null;
  session.userLineGiven = false;
}

function takeHeard(session: LiveSession, pending: OpenUserLine | null): LiveVoiceLine[] {
  const heard = session.heard.splice(0);
  if (!pending || session.userLine !== pending || Deferred.isDoneUnsafe(pending.done)) return heard;
  session.userLine = null;
  session.userLineGiven = true;
  const partial = pending.text.trim();
  if (partial) heard.push({ role: "user", text: partial });
  return heard;
}

function toolResult(reply: LiveVoiceReply): DynamicToolResult {
  const long = reply.success && Buffer.byteLength(reply.text) > RELAY_VERBATIM_BYTES;
  const text = long ? `${LONG_ANSWER_MARK}\n${reply.text}` : reply.text;
  return { contentItems: [{ type: "inputText", text }], success: reply.success };
}
