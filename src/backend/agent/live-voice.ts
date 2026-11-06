import { randomUUID } from "node:crypto";
import type {
  AgentEvent,
  AgentReasoningEffort,
  AgentSummary,
  CodexLiveVoice,
  VoiceLiveEvent,
  VoiceLiveSession,
  VoiceLiveStart,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Fiber, Schema } from "effect";
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
/** How Codex reports that OpenAI refused the call: `unexpected status 401 Unauthorized: …`. */
const UNAUTHORIZED = /\bstatus 401\b|\b401 Unauthorized\b/;
/** The one tool of the relay thread. Codex calls it for each request that the voice model hands off. */
const ASK_TOOL = "ask_agent";
const RELAY_INSTRUCTIONS =
  "You relay requests. For every user request, call ask_agent exactly once with the request verbatim. " +
  "Then reply with the tool result verbatim and nothing else. Never answer on your own.";
/** The first message in the voice conversation. The voice model reads it as the user's. */
const RELAY_VOICE_RULE =
  "From now on, give every request of mine to the background agent, even simple questions and small talk. " +
  "Never answer from your own knowledge. Wait for the agent's result before you give an answer. " +
  "Do not reply to this message.";

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
}

export interface LiveVoiceHooks {
  agent(agentId: string): AgentSummary;
  /** A new Codex process that is not started yet. It runs no agent: it only connects the voice. */
  relay(agent: AgentSummary): Effect.Effect<LiveVoiceRelay, { readonly cause: unknown }>;
  /** Sends a spoken request to the agent as the user's message, and gives its delivery id. */
  send(agentId: string, text: string): Effect.Effect<string, { readonly cause: unknown }>;
  /** The reply to a delivery, or null while the agent still works on it. */
  reply(agentId: string, deliveryId: string): LiveVoiceReply | null;
  emit(event: VoiceLiveEvent): void;
  redact(text: string): string;
}

interface LiveSession {
  readonly id: string;
  readonly agentId: string;
  readonly client: AgentClient;
  readonly cwd: string;
  threadId: string | null;
  readonly answer: Deferred.Deferred<string, LiveVoiceFailed>;
  readonly onNotification: (notification: AppServerNotification) => void;
  readonly onRequest: (request: AppServerRequest) => void;
  readonly onExit: (error: Error) => void;
}

/** A request that the voice gave to the agent, while the agent works on it. */
interface PendingAsk {
  readonly session: LiveSession;
  readonly requestId: AppServerRequest["id"];
  readonly deliveryId: string;
}

/**
 * Live voice: OpenAI realtime voice through Codex, for an agent of any provider. The renderer sends a
 * WebRTC offer, and a separate Codex process connects it to OpenAI with the user's own Codex sign-in.
 * Audio goes between the renderer and OpenAI. OpenBot never reads the Codex credentials.
 *
 * The voice runs on a relay thread of that process, not on the agent's thread. When the voice model
 * hands a request off, the relay calls `ask_agent`, and OpenBot sends the request to the agent as the
 * user's message. The agent's answer goes back to the voice, which speaks it. So the voice does not
 * depend on the agent's provider or model, and a model change does not end it. The chat shows each
 * request and answer as usual.
 *
 * One session runs at a time.
 */
export class LiveVoice {
  readonly #hooks: LiveVoiceHooks;
  readonly #sessions = new Map<string, LiveSession>();
  readonly #asks = new Set<PendingAsk>();
  /** The stops of relay processes that still run, so that `dispose` can wait for them. */
  readonly #closing = new Set<Fiber.Fiber<void>>();
  /** Counts the starts, so that a start that a newer one replaced does not keep its session. */
  #starts = 0;

  constructor(hooks: LiveVoiceHooks) {
    this.#hooks = hooks;
  }

  /** `voice` is the user's choice in Settings; null lets OpenAI choose. */
  readonly start = Effect.fn("LiveVoice.start")(function* (
    this: LiveVoice,
    input: VoiceLiveStart,
    voice: CodexLiveVoice | null,
  ) {
    const agent = yield* liveStep(() => this.#hooks.agent(input.agentId));
    for (const session of [...this.#sessions.values()]) yield* this.#stopSession(session);
    const start = ++this.#starts;
    const relay = yield* this.#hooks.relay(agent).pipe(toLiveVoiceFailed);
    const cwd = yield* makeToollessDirectory().pipe(toLiveVoiceFailed);
    const session: LiveSession = {
      id: randomUUID(),
      agentId: agent.id,
      client: relay.client,
      cwd,
      threadId: null,
      answer: Deferred.makeUnsafe<string, LiveVoiceFailed>(),
      onNotification: (notification) => this.#notification(session, notification),
      onRequest: (request) => this.#request(session, request),
      onExit: () => this.#end(session, sourceText("error.voice.live.disconnected")),
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
            baseInstructions: RELAY_INSTRUCTIONS,
            config,
          },
          decodeRecordResponse,
        )
        .pipe(toLiveVoiceFailed);
      const threadId = getString(getRecord(thread, "thread"), "id");
      if (!threadId || start !== this.#starts) return yield* liveFailure(sourceText("error.voice.live.disconnected"));
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
        .request("thread/realtime/appendText", { threadId, text: RELAY_VOICE_RULE }, decodeRecordResponse)
        .pipe(toLiveVoiceFailed);
      return answer;
    }).pipe(
      Effect.mapError((failure) => this.#startFailure(failure)),
      Effect.onError(() => Effect.sync(() => this.#end(session, null, false))),
    );
    return { sessionId: session.id, sdp } satisfies VoiceLiveSession;
  });

  readonly stop = Effect.fn("LiveVoice.stop")(function* (this: LiveVoice, sessionId: string) {
    const session = this.#sessions.get(sessionId);
    if (session) yield* this.#stopSession(session);
  });

  /**
   * Reads the events of the agent service. A queue change follows the end of each delivery, after
   * the turn's messages are saved, so it can carry the answer to a request of the voice.
   */
  observe(event: AgentEvent): void {
    if (this.#asks.size === 0) return;
    if (event.type === "queue-changed" || event.type === "turn-completed") this.#answerSettled();
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
        if (text) this.#hooks.emit({ type: "transcript", sessionId: session.id, role, text, final });
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
      getString(params, "tool") !== ASK_TOOL
    ) {
      session.client.respondError(request.id, { code: -32601, message: "Live voice answers only ask_agent." });
      return;
    }
    const text = getString(getRecord(params, "arguments"), "request")?.trim();
    if (!text) {
      session.client.respond(request.id, toolResult({ success: false, text: "The request is empty." }));
      return;
    }
    Effect.runFork(
      this.#hooks.send(session.agentId, text).pipe(
        Effect.match({
          onFailure: (failure) =>
            this.#respond(session, request.id, {
              success: false,
              text: failure.cause instanceof Error ? failure.cause.message : String(failure.cause),
            }),
          onSuccess: (deliveryId) => {
            if (request.signal?.aborted || !this.#sessions.has(session.id)) return;
            const ask: PendingAsk = { session, requestId: request.id, deliveryId };
            this.#asks.add(ask);
            // Codex stops waiting when the relay turn ends. The agent still answers in the chat.
            request.signal?.addEventListener("abort", () => this.#asks.delete(ask), { once: true });
            this.#answerSettled();
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
      this.#respond(ask.session, ask.requestId, reply);
    }
  }

  /** Each result goes to OpenAI, so it loses the configured secrets first. */
  #respond(session: LiveSession, requestId: AppServerRequest["id"], reply: LiveVoiceReply): void {
    if (!this.#sessions.has(session.id)) return;
    session.client.respond(requestId, toolResult({ ...reply, text: this.#hooks.redact(reply.text) }));
  }

  #startFailure(failure: LiveVoiceFailed): LiveVoiceFailed {
    const message = failure.cause instanceof Error ? failure.cause.message : String(failure.cause);
    return UNAUTHORIZED.test(message) ? liveFailure(sourceText("error.voice.live.signIn")) : failure;
  }

  #reason(message: string | null): string {
    if (!message) return sourceText("error.voice.live.disconnected");
    // Codex sends an API key login and a missing login to the paid Realtime API, which refuses both.
    if (UNAUTHORIZED.test(message)) return sourceText("error.voice.live.signIn");
    return sourceText("error.voice.live.failed", { reason: this.#hooks.redact(message) });
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
    Deferred.doneUnsafe(session.answer, Effect.fail(liveFailure(error ?? sourceText("error.voice.live.disconnected"))));
    const closing = Effect.runFork(
      stopToolless(session.client).pipe(
        Effect.ignore,
        Effect.andThen(removeToollessDirectory(session.cwd).pipe(Effect.ignore)),
      ),
    );
    this.#closing.add(closing);
    closing.addObserver(() => this.#closing.delete(closing));
    if (announce) this.#hooks.emit({ type: "ended", sessionId: session.id, error });
  }
}

function toolResult(reply: LiveVoiceReply): DynamicToolResult {
  return { contentItems: [{ type: "inputText", text: reply.text }], success: reply.success };
}
