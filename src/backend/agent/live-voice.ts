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
import { isFixedSourceText, sourceText, sourceTextValues } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Deferred, Effect, Fiber, Schema, Semaphore } from "effect";
import type { AgentClient } from "../agent-client";
import {
  type AppServerNotification,
  type AppServerRequest,
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
const START_REASON_LIMIT = 160;
const UNAUTHORIZED = /\bstatus 401\b|\b401 Unauthorized\b/;
const CALL_NOT_FOUND = /\bstatus 404\b[\s\S]*\/realtime\/calls\b/;
const FORBIDDEN = /^(?=[\s\S]*\brealtime\b)[\s\S]*(?:\bstatus 403\b|\b403 Forbidden\b)/;
const RELAY_VERBATIM_BYTES = 600;
const RELAY_SUMMARY_WORDS = 150;
const SUMMARY_RULES =
  `its most important facts in ${RELAY_SUMMARY_WORDS} words or fewer, in the language of the answer. ` +
  "Use only facts from the answer, and never add or change one. " +
  "Write plain sentences without links, lists, formatting or code. " +
  "End with one sentence that says that the full answer is in the chat. ";
const UNUSED_TURN_INSTRUCTIONS =
  "A different program answers every message in this thread, and nobody reads your reply. " +
  "Reply with the word OK and nothing else.";
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
  "Say the result word for word, in my language: do not shorten it, and add nothing of your own. " +
  "Always speak the language that I speak, also for your own short words such as greetings. " +
  "Keep that language when a short or unclear phrase sounds like a different one. " +
  "Also use the same regional variety of the language as I do, for example European or Brazilian Portuguese. " +
  "If I ask you to speak a different language or variety, use it. " +
  "Do not reply to this message.";
const QUEUED_NOTICE =
  "Your request is in the queue. The agent is still working on an earlier request. " +
  "You hear the answer when the agent finishes.";
const LONG_ANSWER_FALLBACK = "The agent gave a long answer. It is in the chat.";
const UNSPEAKABLE_ANSWER_FALLBACK = "The answer is in the chat.";
const FAILED_REQUEST_FALLBACK = "The request failed.";
const summaryPrompt = (answer: string) =>
  `A voice says your reply aloud. The answer below is too long for the voice: reply with ${SUMMARY_RULES}` +
  `Reply with the summary only.\n\nAnswer:\n${answer}`;
const VOICE_REQUEST_ITEM = "handoff_request";
const HEARD_LINE_LIMIT = 20;
const oneLine = (text: string) => text.replace(/\s+/gu, " ").trim();
const withoutLeadingStops = (text: string) => text.replace(/^[\s…\p{Terminal_Punctuation}]+/u, "").trim();
const STOP_OR_SPACE = /[\s…\p{Terminal_Punctuation}]/u;
const wordsAfter = (text: string, start: string) =>
  start &&
  text.startsWith(start) &&
  (STOP_OR_SPACE.test(start.at(-1) ?? "") || STOP_OR_SPACE.test(text.charAt(start.length)))
    ? withoutLeadingStops(text.slice(start.length))
    : "";
const words = (text: string) =>
  text
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.join(" ") ?? "";
const startsWithWords = (text: string, start: string) => start !== "" && `${text} `.startsWith(`${start} `);
const endsWithWords = (text: string, end: string) => end !== "" && ` ${text}`.endsWith(` ${end}`);

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
  readonly accountId: string | undefined;
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
  summarize(
    agentId: string,
    accountId: string | undefined,
    prompt: string,
  ): Effect.Effect<string, { readonly cause: unknown }>;
  emit(event: VoiceLiveEvent, memberId: string | null): void;
  redact(text: string): string;
  otherAccounts(agentId: string): boolean;
}

interface LiveSession {
  readonly id: string;
  readonly agentId: string;
  readonly owner: LiveVoiceOwner | null;
  readonly accountId: string | undefined;
  readonly client: AgentClient;
  readonly cwd: string;
  threadId: string | null;
  readonly rule: string;
  readonly heard: LiveVoiceLine[];
  unfinishedUserLine: string;
  sentTurnIsOpen: boolean;
  sending: number;
  lastAskId: number;
  lastTranscript: string;
  lastUserFinal: string;
  answerSpoken: boolean;
  userSpokeAfterAnswer: boolean;
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
  readonly deliveryId: string;
  readonly askId: number;
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
      accountId: relay.accountId,
      client: relay.client,
      cwd,
      threadId: null,
      rule: oneLine(relayVoiceRule(name)),
      heard: [],
      unfinishedUserLine: "",
      sentTurnIsOpen: false,
      sending: 0,
      lastAskId: 0,
      lastTranscript: "",
      lastUserFinal: "",
      answerSpoken: false,
      userSpokeAfterAnswer: false,
      answer: Deferred.makeUnsafe<string, LiveVoiceFailed>(),
      onNotification: (notification) => this.#notification(session, notification),
      onRequest: (request) =>
        relay.client.respondError(request.id, { code: -32601, message: "Live voice has no tools." }),
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
            baseInstructions: UNUSED_TURN_INSTRUCTIONS,
            config,
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
            clientManagedHandoffs: true,
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
      if (answer) this.#say(session, this.#speech(session, answer));
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
        if (!final) {
          if (role === "user" && text) {
            session.unfinishedUserLine += text;
            if (session.answerSpoken && words(text)) session.userSpokeAfterAnswer = true;
          }
          return;
        }
        if (role === "assistant" && !this.#waitsForAnswer(session)) session.answerSpoken = true;
        const line =
          role === "user" && session.sentTurnIsOpen ? withoutLeadingStops(session.unfinishedUserLine) : text?.trim();
        if (role === "user") {
          session.sentTurnIsOpen = false;
          session.unfinishedUserLine = "";
        }
        if (line && !(role === "user" && oneLine(line) === session.rule)) {
          session.heard.push({ role, text: line });
          if (role === "user") {
            session.lastUserFinal = line;
            if (session.answerSpoken && words(line)) session.userSpokeAfterAnswer = true;
          }
          if (session.heard.length > HEARD_LINE_LIMIT) session.heard.shift();
        }
        return;
      }
      case "thread/realtime/itemAdded": {
        const item = getRecord(params, "item");
        if (getString(item, "type") === VOICE_REQUEST_ITEM)
          this.#ask(session, oneLine(getString(item, "input_transcript") ?? ""));
        return;
      }
    }
  }

  #ask(session: LiveSession, voiceHeard: string): void {
    const rawUnfinished = withoutLeadingStops(session.unfinishedUserLine);
    const unfinished = oneLine(rawUnfinished) === session.rule ? "" : rawUnfinished;
    const finalLine = session.sentTurnIsOpen || unfinished ? "" : session.lastUserFinal;
    const latest = unfinished || finalLine;
    const heard: LiveVoiceLine[] = unfinished
      ? [...session.heard, { role: "user", text: unfinished }]
      : [...session.heard];
    const said = heard.flatMap((line) => (line.role === "user" ? [line.text] : [])).join("\n");
    const request = this.#requestText(session, voiceHeard, latest);
    if (!request) return;
    if (this.#isRetry(session, voiceHeard, latest)) {
      logger.info("Live voice gave the same request again without new speech. It is not sent again.");
      return;
    }
    const turnClosed = endsWithWords(words(finalLine), words(request));
    session.lastAskId += 1;
    const askId = session.lastAskId;
    if (voiceHeard) session.lastTranscript = voiceHeard;
    session.lastUserFinal = "";
    session.heard.length = 0;
    session.unfinishedUserLine = "";
    if (!turnClosed) session.sentTurnIsOpen = true;
    session.answerSpoken = false;
    session.userSpokeAfterAnswer = false;
    session.sending += 1;
    const waits = this.#hooks.busy(session.agentId);
    Effect.runFork(
      this.#hooks.send(session.agentId, { shown: said || request, request, heard }, session.owner?.sender).pipe(
        Effect.match({
          onFailure: (failure) => {
            if (!this.#sessions.has(session.id)) return;
            if (session.lastAskId === askId) session.lastTranscript = "";
            session.heard.unshift(...heard);
            session.heard.splice(0, session.heard.length - HEARD_LINE_LIMIT);
            this.#say(
              session,
              this.#failure(failure.cause instanceof Error ? failure.cause.message : String(failure.cause)),
            );
          },
          onSuccess: (deliveryId) => {
            if (!this.#sessions.has(session.id)) return;
            const ask: PendingAsk = { session, deliveryId, askId };
            this.#asks.add(ask);
            this.#answerSettled();
            if (waits && this.#asks.has(ask)) this.#say(session, Effect.succeed(QUEUED_NOTICE), false);
          },
        }),
        Effect.ensuring(
          Effect.sync(() => {
            session.sending -= 1;
          }),
        ),
      ),
    );
  }

  #requestText(session: LiveSession, voiceHeard: string, latest: string): string {
    const voiceWords = words(voiceHeard);
    const latestWords = words(latest);
    if (voiceWords === latestWords) return voiceHeard;
    if (endsWithWords(latestWords, voiceWords)) return latest;
    const newText = wordsAfter(voiceHeard, session.lastTranscript);
    const newWords = words(newText);
    if (newText && this.#matchesLatest(newWords, latestWords)) return newText;
    if (endsWithWords(latestWords, newWords)) return latest;
    return voiceHeard || latest;
  }

  #matchesLatest(text: string, latestWords: string): boolean {
    return startsWithWords(text, latestWords) || startsWithWords(latestWords, text) || endsWithWords(text, latestWords);
  }

  #isRetry(session: LiveSession, voiceHeard: string, latest: string): boolean {
    const voiceWords = words(voiceHeard);
    if (!voiceWords || voiceWords !== words(session.lastTranscript)) return false;
    if (session.userSpokeAfterAnswer) return false;
    const latestWords = words(latest);
    return !startsWithWords(latestWords, voiceWords) && !endsWithWords(latestWords, voiceWords);
  }

  #waitsForAnswer(session: LiveSession): boolean {
    if (session.sending > 0 || session.speaking.size > 0) return true;
    for (const ask of this.#asks) if (ask.session === session) return true;
    return false;
  }

  #answerSettled(): void {
    for (const ask of [...this.#asks]) {
      const reply = this.#hooks.reply(ask.session.agentId, ask.deliveryId);
      if (!reply) continue;
      this.#asks.delete(ask);
      if (!reply.success && ask.session.lastAskId === ask.askId) ask.session.lastTranscript = "";
      const spoken = reply.turnId !== undefined && ask.session.answeredTurns.has(reply.turnId);
      if (reply.turnId) ask.session.answeredTurns.add(reply.turnId);
      if (spoken) continue;
      this.#say(ask.session, reply.success ? this.#speech(ask.session, reply.text) : this.#failure(reply.text));
    }
  }

  #speech(session: LiveSession, answer: string): Effect.Effect<string> {
    const redacted = this.#hooks.redact(answer);
    if (Buffer.byteLength(redacted) <= RELAY_VERBATIM_BYTES)
      return Effect.succeed(speechTextFromMarkdown(redacted) || UNSPEAKABLE_ANSWER_FALLBACK);
    return this.#hooks.summarize(session.agentId, session.accountId, summaryPrompt(redacted)).pipe(
      Effect.map((summary) => this.#hooks.redact(summary.trim()) || LONG_ANSWER_FALLBACK),
      Effect.catch((failure) =>
        Effect.sync(() => {
          logger.warn("Could not make a summary of an answer for live voice.", { error: failure.cause });
          return LONG_ANSWER_FALLBACK;
        }),
      ),
    );
  }

  #failure(reason: string): Effect.Effect<string> {
    const speech = speechTextFromMarkdown(this.#hooks.redact(reason)).slice(0, RELAY_VERBATIM_BYTES);
    return Effect.succeed(speech || FAILED_REQUEST_FALLBACK);
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
    if (text) return liveFailure(text);
    if (isFixedSourceText(message)) return failure;
    const fullReason = sourceTextValues(message, "error.voice.live.failed")?.reason ?? this.#hooks.redact(message);
    logger.warn("Codex could not start live voice.", { reason: fullReason.slice(0, REASON_LIMIT) });
    const reason = Array.from(fullReason).slice(0, START_REASON_LIMIT).join("");
    return liveFailure(sourceText("error.voice.live.startFailed", { reason }));
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
