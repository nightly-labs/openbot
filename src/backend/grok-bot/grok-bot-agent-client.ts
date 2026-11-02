import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { attachmentMimeTypeForName } from "@openbot/contracts/attachment-files";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import type { AgentClient, DiagnosticOrigin } from "../agent-client";
import { thisComputer } from "../host-tools/host-tool-machines";
import { pendingHostToolAsks } from "../host-tools/host-tool-runner";
import { runLocalExecClient } from "../host-tools/local-exec-client";
import {
  type LocalExecRequestFrame,
  type LocalExecResponseFrame,
  localExecHeaders,
} from "../host-tools/local-exec-frames";
import { PendingServerRequests } from "../pending-server-requests";
import type {
  AppServerNotification,
  AppServerRequest,
  DynamicToolResult,
  RequestId,
  ResponseDecoder,
  RpcError,
} from "../protocol";
import { getString, isRecord } from "../protocol";
import { type ProviderClientOperationError, providerFailure } from "../provider-client-effects";
import { accessTokenNeedsRefresh, type GrokBotAccountStore, type GrokBotGatewaySession } from "./grok-bot-account";
import { readOrCreateMachineId } from "./grok-bot-checksum";
import {
  createGrokBotAgent,
  listGrokBotAgents,
  readGrokBotRoster,
  readGrokBotTranscript,
  sendGrokBotPrompt,
} from "./grok-bot-gateway";
import {
  createGatewayEventQueue,
  GROK_BOT_SSE_CONNECT_MS,
  sleepWithSignal,
  startGrokBotEventStream,
} from "./grok-bot-gateway-events";
import {
  GROK_BOT_MAX_IMAGE_BYTES,
  GROK_BOT_MODEL_ID,
  type GrokBotAdvertisedTool,
  type GrokBotImagePart,
  type GrokBotInferenceMessage,
  type GrokBotStreamTool,
  type GrokBotTextPart,
  type GrokBotToolCall,
  type GrokBotToolResultPart,
  grokBotStreamBody,
  readGrokBotInference,
} from "./grok-bot-inference";
import {
  type GrokBotTranscriptToolStep,
  transcriptActivityAfterPrompt,
  transcriptToMessages,
} from "./grok-bot-transcript";
import {
  applyGatewayEvent,
  applyRosterBody,
  createTurnWatch,
  grokBotActivityDetail,
  grokBotUsageParams,
  noteSendMessagePending,
  rosterBodyHasRunningField,
} from "./grok-bot-turn-watch";
import { readGrokBotUsageSummary } from "./grok-bot-usage";

const DEFAULT_API = "https://api2.cursor.sh";
const usageLogger = createOpenBotLogger("grok-bot-inference-usage");

interface ClientEvents {
  notification: [AppServerNotification];
  request: [AppServerRequest];
  exit: [Error];
  diagnostic: [string, DiagnosticOrigin?];
}

interface SandThread {
  id: string;
  instructions: string | null;
  messages: GrokBotInferenceMessage[];
  tools: readonly GrokBotAdvertisedTool[];
  turn: { id: string; itemId: string; text: string; controller: AbortController } | null;
}

export interface GrokBotAgentClientOptions {
  readonly store?: GrokBotAccountStore;
  readonly requestTimeoutMs?: number;
  readonly apiBaseUrl?: string;
  readonly allowLoopback?: boolean;
  readonly fetchImpl?: typeof fetch;
  /** A fixed machine id. Tests use this. A path is used when this is absent. */
  readonly machineId?: string;
  readonly machineIdPath?: string;
  readonly checksumNow?: () => number;
  /** Call `InferenceService/Stream` directly (old path). Off by default: BotAI uses the box gateway. */
  readonly directInference?: boolean;
  readonly gatewayPollMs?: number;
  /**
   * Last-resort quiet window. Used only when the gateway has no event stream and `listAgents`
   * has no running flag. Default 12s.
   */
  readonly gatewayQuietMs?: number;
  readonly gatewayTurnTimeoutMs?: number;
  /** BotAI stall watchdog. Default 35s. */
  readonly gatewayEventsStallMs?: number;
  /** How long to wait for the first `GET /events` response. Default 15s. */
  readonly gatewayEventsConnectMs?: number;
  /** Local-exec frames for this turn. Absent means the turn does not subscribe. */
  readonly hostTools?: {
    handle(
      frame: LocalExecRequestFrame,
      context: { agentId: string; threadId: string; turnId: string },
    ): Promise<LocalExecResponseFrame | null>;
  };
}

/** Gateway bearer and stored gateway headers. The account access token is not a parameter. */
export function grokLocalExecHeaders(
  session: Pick<GrokBotGatewaySession, "token" | "headers">,
): Record<string, string> {
  return localExecHeaders({ token: session.token, headers: session.headers });
}

/**
 * One OpenBot thread is one sand agent id from `POST /api/createAgent`.
 * A turn is `POST /api/sendPrompt` on the sand gateway. The sand host runs the model.
 * The user-visible reply is a text `send-message` card. OpenBot stores that card as the
 * assistant message. A `tool-call` card becomes a sand tool row. OpenBot shows the row.
 * OpenBot does not run that tool. The turn ends when the gateway event stream delivers `turn-ended`
 * for this agent, or when that agent's running flag goes from true to false. A subagent keeps the
 * parent running. Retrying is not an idle end. Composing is on while a SendMessage tool is pending,
 * and off on send-message or turn-ended. The transcript tail still fills tool rows and reply text.
 * The quiet window is only the fallback when `/events` is absent and the roster has no running flag.
 * `InferenceService/Stream` runs only when `directInference` is set.
 */
export class GrokBotAgentClient extends EventEmitter<ClientEvents> implements AgentClient {
  readonly provider = "grok-bot" as const;
  readonly contextCompaction = "unsupported" as const;
  #running = false;
  #machineId: string | null = null;
  readonly #threads = new Map<string, SandThread>();
  readonly #requests = new PendingServerRequests((request) => this.emit("request", request));
  readonly #options: GrokBotAgentClientOptions;

  constructor(options: GrokBotAgentClientOptions = {}) {
    super();
    this.#options = options;
  }

  get running(): boolean {
    return this.#running;
  }

  start(): void {
    this.#running = true;
  }

  stop(): Effect.Effect<void, ProviderClientOperationError> {
    this.#running = false;
    this.#requests.rejectAll(sourceText("error.provider.grokBotSessionEnded"));
    for (const thread of this.#threads.values()) {
      const turn = thread.turn;
      if (!turn) continue;
      turn.controller.abort();
      // Abort does not always reject a blocked read before the process exits. Finish the turn
      // here so the chat leaves thinking.
      this.#finishTurn(thread, turn, "interrupted");
    }
    this.#threads.clear();
    return Effect.void;
  }

  notify(): void {
    /* OpenBot sends `initialized` after `initialize`. This client has nothing to start. */
  }

  respond(id: RequestId, result: unknown): void {
    this.#requests.resolve(id, result);
  }

  respondError(id: RequestId, error: RpcError): void {
    this.#requests.reject(id, error);
  }

  readonly request = Effect.fn("GrokBotAgentClient.request")(function* <T>(
    this: GrokBotAgentClient,
    method: string,
    params: unknown,
    decoder: ResponseDecoder<T>,
  ): Effect.fn.Return<T, ProviderClientOperationError> {
    if (!this.#running) return yield* providerFailure(new Error(sourceText("error.provider.grokBotSessionEnded")));
    const response = yield* this.#dispatch(method, params);
    return yield* Effect.try({
      try: () => decoder(response),
      catch: (cause) => providerFailure(cause),
    });
  });

  readonly #dispatch = Effect.fn("GrokBotAgentClient.dispatch")(function* (
    this: GrokBotAgentClient,
    method: string,
    params: unknown,
  ) {
    switch (method) {
      case "initialize":
      case "plugin/list":
      case "config/read":
        return method === "plugin/list" ? { marketplaces: [] } : {};
      case "account/read":
        return yield* this.#account();
      case "account/rateLimits/read":
        return yield* this.#usage();
      case "model/list":
        return {
          data: [
            {
              model: GROK_BOT_MODEL_ID,
              displayName: "Grok Bot",
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
              reasoningEffortConfigurable: false,
            },
          ],
        };
      case "thread/start":
        return yield* this.#startThread(params);
      case "thread/resume":
        return yield* this.#resumeThread(params);
      case "thread/read":
        return { thread: { id: requiredId(params, "threadId"), turns: [] } };
      case "turn/start":
        return this.#startTurn(params);
      case "turn/interrupt":
        return this.#interrupt(params);
      default:
        return yield* providerFailure(new Error(sourceText("error.provider.grokBotTurnFailed")));
    }
  });

  readonly #account = Effect.fn("GrokBotAgentClient.account")(function* (this: GrokBotAgentClient) {
    const record = this.#options.store
      ? yield* this.#options.store.load().pipe(Effect.mapError(providerFailure))
      : null;
    return {
      account: record ? { type: "grok-bot", email: null } : null,
      requiresOpenaiAuth: false,
    };
  });

  readonly #usage = Effect.fn("GrokBotAgentClient.usage")(function* (this: GrokBotAgentClient) {
    if (!this.#options.store) return { rateLimits: null, rateLimitsByLimitId: null };
    const summary = yield* readGrokBotUsageSummary(this.#options.store, this.#callOptions()).pipe(
      Effect.mapError(providerFailure),
    );
    if (!summary || summary.includedUsedPercent === null) return { rateLimits: null, rateLimitsByLimitId: null };
    return {
      rateLimits: {
        primary: {
          usedPercent: summary.includedUsedPercent,
          windowDurationMins: null,
          resetsAt: summary.includedResetsAt,
        },
        secondary: null,
      },
      rateLimitsByLimitId: null,
    };
  });

  readonly #startThread = Effect.fn("GrokBotAgentClient.startThread")(function* (
    this: GrokBotAgentClient,
    params: unknown,
  ) {
    const store = this.#options.store;
    if (!store) return yield* providerFailure(new Error(sourceText("error.provider.grokBotNotSignedIn")));
    const created = yield* createGrokBotAgent(
      store,
      { name: "OpenBot", description: "" },
      { ...this.#callOptions(), allowLoopback: this.#options.allowLoopback === true },
    ).pipe(Effect.mapError(providerFailure));
    const instructions = isRecord(params) ? getString(params, "developerInstructions") : null;
    this.#threads.set(created.id, {
      id: created.id,
      instructions,
      messages: instructions ? [{ role: "SYSTEM", text: instructions }] : [],
      tools: advertisedTools(isRecord(params) ? params.dynamicTools : undefined),
      turn: null,
    });
    return { thread: { id: created.id } };
  });

  readonly #resumeThread = Effect.fn("GrokBotAgentClient.resumeThread")(function* (
    this: GrokBotAgentClient,
    params: unknown,
  ) {
    const id = requiredId(params, "threadId");
    const known = this.#threads.get(id);
    if (known) return { thread: { id: known.id } };
    const store = this.#options.store;
    if (!store) return yield* providerFailure(new Error(sourceText("error.provider.grokBotNotSignedIn")));
    const agents = yield* listGrokBotAgents(store, {
      ...this.#callOptions(),
      allowLoopback: this.#options.allowLoopback === true,
    }).pipe(Effect.mapError(providerFailure));
    if (!agents.some((agent) => agent.id === id)) {
      return yield* providerFailure(new Error("Grok Bot session not found"));
    }
    const instructions = isRecord(params) ? getString(params, "developerInstructions") : null;
    const history = yield* readGrokBotTranscript(store, id, {
      ...this.#callOptions(),
      allowLoopback: this.#options.allowLoopback === true,
    }).pipe(
      Effect.map((body) => transcriptToMessages(body)),
      Effect.catch(() => Effect.succeed([])),
    );
    this.#threads.set(id, {
      id,
      instructions,
      messages: [...(instructions ? [{ role: "SYSTEM" as const, text: instructions }] : []), ...history],
      tools: advertisedTools(isRecord(params) ? params.dynamicTools : undefined),
      turn: null,
    });
    return { thread: { id } };
  });

  #startTurn(params: unknown): { turn: { id: string; status: string } } {
    const threadId = requiredId(params, "threadId");
    const thread = this.#threads.get(threadId);
    if (!thread) throw new Error("Grok Bot session not found");
    if (thread.turn) throw new Error(sourceText("error.provider.grokBotTurnFailed"));
    if (!hasPrompt(params)) throw new Error(sourceText("error.provider.grokBotTurnFailed"));
    const listed = advertisedTools(isRecord(params) ? params.dynamicTools : undefined);
    if (listed.length > 0) thread.tools = listed;
    const model = isRecord(params) ? getString(params, "model") : null;
    const turnId = randomUUID();
    const controller = new AbortController();
    const itemId = `msg-${turnId}`;
    thread.turn = { id: turnId, itemId, text: "", controller };
    this.#emit("turn/started", { threadId, turn: { id: turnId, status: "inProgress" } });
    void (this.#options.directInference === true
      ? this.#stream(thread, params, model && model.length > 0 ? model : GROK_BOT_MODEL_ID)
      : this.#viaGateway(thread, params));
    return { turn: { id: turnId, status: "inProgress" } };
  }

  async #stream(thread: SandThread, params: unknown, modelId: string): Promise<void> {
    const turn = thread.turn;
    const store = this.#options.store;
    if (!turn) return;
    if (!store) {
      this.#finishTurn(thread, turn, "failed", sourceText("error.provider.grokBotNotSignedIn"));
      return;
    }
    try {
      let record = await Effect.runPromise(store.load());
      if (!record) throw new Error(sourceText("error.provider.grokBotNotSignedIn"));
      // Match BotAI's getValidAccessToken: refresh the sand access token before InferenceService/Stream.
      const refresh = async (force: boolean) => {
        if (!record) return;
        if (!force && !accessTokenNeedsRefresh(record.accessToken, Date.now())) return;
        const next = await Effect.runPromise(store.refreshAccess(this.#callOptions()));
        if (!next) throw new Error(sourceText("error.provider.grokBotNotSignedIn"));
        record = next;
      };
      await refresh(false);
      const machineId = await this.#machine();
      let messages: GrokBotInferenceMessage[] = [...thread.messages, await userMessage(params)];
      let lastText = "";
      for (let round = 0; round < 8; round += 1) {
        const calls: GrokBotStreamTool[] = [];
        const roundText = { value: "" };
        const streamRound = (accessToken: string, attempt: number) =>
          readGrokBotInference({
            apiBaseUrl: this.#apiBase(),
            accessToken,
            machineId,
            ...(this.#options.checksumNow ? { checksumNow: this.#options.checksumNow } : {}),
            signal: turn.controller.signal,
            ...(this.#options.fetchImpl ? { fetchImpl: this.#options.fetchImpl } : {}),
            body: grokBotStreamBody({
              messages,
              tools: thread.tools,
              modelId,
              conversationId: thread.id,
              invocationId: `${turn.id}:${round}`,
            }),
            onUsage: (counts) => {
              // Keep raw counters out of ACP analytics: this protocol does not establish whether
              // input includes cache reads/writes. The default gateway provides no counters here.
              const sample = { turnId: turn.id, round, attempt, counts };
              usageLogger.info("Grok Bot direct inference token counts.", sample);
              this.emit("diagnostic", `Grok Bot direct inference token counts: ${JSON.stringify(sample)}`);
            },
            onEvent: (event) => {
              if (thread.turn?.id !== turn.id) return;
              if (event.kind === "tool") {
                if (event.isComplete) calls.push(event);
                else this.#emitTool(thread, turn.id, event, "inProgress");
                return;
              }
              if (event.kind === "thinking") {
                this.#emit("item/reasoning/textDelta", {
                  threadId: thread.id,
                  turnId: turn.id,
                  itemId: `think-${turn.id}`,
                  delta: event.text,
                });
                return;
              }
              roundText.value += event.text;
              turn.text += event.text;
              this.#emit("item/agentMessage/delta", {
                threadId: thread.id,
                turnId: turn.id,
                itemId: turn.itemId,
                delta: event.text,
              });
            },
          });
        try {
          await streamRound(record.accessToken, 1);
        } catch (error) {
          if (!isUnauthenticated(error) || roundText.value.length > 0 || calls.length > 0) throw error;
          await refresh(true);
          await streamRound(record.accessToken, 2);
        }
        if (thread.turn?.id !== turn.id) return;
        lastText = roundText.value;
        if (calls.length === 0) break;
        const results: GrokBotToolResultPart[] = [];
        for (const call of calls) {
          results.push(await this.#runTool(thread, turn.id, call));
        }
        messages = [
          ...messages,
          {
            role: "ASSISTANT",
            text: roundText.value,
            toolCalls: calls.map((call) => toolCallRecord(call)),
          },
          { role: "TOOL", results },
        ];
      }
      if (thread.turn?.id !== turn.id) return;
      thread.messages = [...messages, { role: "ASSISTANT", text: lastText }];
      this.#finishTurn(thread, turn, "completed");
    } catch (error) {
      if (thread.turn?.id !== turn.id) return;
      if (turn.controller.signal.aborted) {
        this.#finishTurn(thread, turn, "interrupted");
        return;
      }
      const message = error instanceof Error ? error.message : sourceText("error.provider.grokBotTurnFailed");
      this.#finishTurn(thread, turn, "failed", message);
    }
  }

  /**
   * Ends this turn once. A second call, including one from `stop` while the read is still
   * finishing, does nothing. The assistant text is sent before `turn/completed` so the chat
   * can store it before the thinking state clears.
   */
  #finishTurn(
    thread: SandThread,
    turn: NonNullable<SandThread["turn"]>,
    status: "completed" | "failed" | "interrupted",
    errorMessage?: string,
  ): void {
    if (thread.turn?.id !== turn.id) return;
    thread.turn = null;
    if (status === "completed") {
      this.#emit("item/completed", {
        threadId: thread.id,
        turnId: turn.id,
        item: { type: "agentMessage", id: turn.itemId, text: turn.text, status: "completed" },
      });
    }
    if (status === "failed") {
      const message =
        errorMessage && errorMessage.length > 0 ? errorMessage : sourceText("error.provider.grokBotTurnFailed");
      // Without an `error` notification the chat shows only the user message (the turn ends silently).
      this.emit("diagnostic", `Grok Bot turn failed: ${message}`);
      this.#emit("error", { threadId: thread.id, turnId: turn.id, message });
      this.#emit("turn/completed", {
        threadId: thread.id,
        turn: { id: turn.id, status: "failed", error: { message } },
      });
      return;
    }
    this.#emit("turn/completed", { threadId: thread.id, turn: { id: turn.id, status } });
  }

  /**
   * BotAI path: `POST /api/sendPrompt` returns when the prompt is accepted. The sand host owns the
   * model stream. This method watches `GET /events` and the roster running flag, and polls the
   * transcript tail for tool rows and reply text. It does not call `item/tool/call`.
   */
  async #viaGateway(thread: SandThread, params: unknown): Promise<void> {
    const turn = thread.turn;
    const store = this.#options.store;
    if (!turn || !store) return;
    const options = { ...this.#callOptions(), allowLoopback: this.#options.allowLoopback === true };
    const shownTools = new Map<string, GrokBotTranscriptToolStep["status"]>();
    const readTail = async () => Effect.runPromise(readGrokBotTranscript(store, thread.id, options));
    const streamAbort = new AbortController();
    const hostAbort = new AbortController();
    const abortStream = () => streamAbort.abort();
    turn.controller.signal.addEventListener("abort", abortStream);
    try {
      const prompt = promptText(params);
      const queue = createGatewayEventQueue();
      const watch = createTurnWatch();
      const session = (await Effect.runPromise(store.load()))?.gateway ?? null;
      let mode: "events" | "roster" | "quiet" = "quiet";
      if (session) {
        const stream = startGrokBotEventStream({
          session,
          signal: streamAbort.signal,
          ...(this.#options.fetchImpl ? { fetchImpl: this.#options.fetchImpl } : {}),
          ...(this.#options.gatewayEventsStallMs ? { stallMs: this.#options.gatewayEventsStallMs } : {}),
          onEvent: (event) => queue.push(event),
        });
        void stream.done.catch(() => undefined);
        const connectMs = this.#options.gatewayEventsConnectMs ?? GROK_BOT_SSE_CONNECT_MS;
        const connectSleep = sleepWithSignal(connectMs, streamAbort.signal).then(
          () => "timeout" as const,
          () => "aborted" as const,
        );
        const ready = await Promise.race([stream.ready, connectSleep]);
        if (ready === "open") mode = "events";
        else streamAbort.abort();
      }
      if (mode !== "events") {
        const roster = await Effect.runPromise(readGrokBotRoster(store, options)).catch(() => null);
        if (roster && rosterBodyHasRunningField(roster)) {
          mode = "roster";
          applyRosterBody(watch, thread.id, roster);
        } else {
          this.emit("diagnostic", "Grok Bot has no gateway turn signal. The turn ends after a quiet window.");
        }
      }
      const hostTools = this.#options.hostTools;
      if (hostTools && session) {
        const computer = thisComputer();
        void runLocalExecClient({
          baseUrl: session.url,
          session: { token: session.token, headers: session.headers },
          signal: hostAbort.signal,
          hello: () => ({
            kind: "hello",
            localRoot: homedir(),
            terminalsFolder: homedir(),
            computerId: computer.id,
            label: computer.label,
          }),
          onFrame: (frame) => hostTools.handle(frame, { agentId: thread.id, threadId: thread.id, turnId: turn.id }),
        }).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "";
          if (message.length > 0) this.emit("diagnostic", message);
        });
      }
      await Effect.runPromise(sendGrokBotPrompt(store, { agentId: thread.id, prompt, clientNonce: turn.id }, options));
      const started = Date.now();
      const timeoutMs = this.#options.gatewayTurnTimeoutMs ?? 10 * 60_000;
      const pollMs = this.#options.gatewayPollMs ?? 1500;
      const quietMs = Math.max(this.#options.gatewayQuietMs ?? 12_000, pollMs * 2);
      let lastSignature = "";
      let lastChange = Date.now();
      let shownActivity: "writing" | "retrying" | null = null;
      let usageSent = false;
      let quietOpen = false;
      const project = (body: unknown) => {
        const messages = transcriptToMessages(body);
        const activity = transcriptActivityAfterPrompt(body, prompt);
        this.#projectSandTools(thread.id, turn.id, activity.steps, shownTools);
        noteSendMessagePending(
          watch,
          activity.steps.some((step) => step.name === "SendMessage" && step.status === "inProgress"),
        );
        const reply = replyAfter(messages, prompt);
        if (reply.length > turn.text.length && reply.startsWith(turn.text)) {
          const delta = reply.slice(turn.text.length);
          turn.text = reply;
          this.#emit("item/agentMessage/delta", { threadId: thread.id, turnId: turn.id, itemId: turn.itemId, delta });
        } else if (reply !== turn.text && reply.length > 0) {
          turn.text = reply;
        }
        quietOpen =
          activity.steps.some((step) => step.status === "inProgress") ||
          activity.permissionPending ||
          reply.length === 0 ||
          pendingHostToolAsks() > 0;
        return JSON.stringify([
          reply,
          activity.steps.map((step) => [step.id, step.status, step.detail]),
          activity.permissionPending,
        ]);
      };
      const publishWatch = () => {
        if (watch.activity !== shownActivity) {
          shownActivity = watch.activity;
          this.#emit("openbot/activity", {
            threadId: thread.id,
            turnId: turn.id,
            detail: grokBotActivityDetail(watch.activity),
          });
        }
        if (watch.usage && !usageSent) {
          usageSent = true;
          this.#emit("openbot/usage", { threadId: thread.id, turnId: turn.id, usage: grokBotUsageParams(watch.usage) });
        }
      };
      while (Date.now() - started < timeoutMs) {
        if (queue.size === 0) {
          const poke = new AbortController();
          const onTurnAbort = () => poke.abort();
          turn.controller.signal.addEventListener("abort", onTurnAbort);
          await Promise.race([
            sleepWithSignal(pollMs, turn.controller.signal).catch(() => undefined),
            queue.wait(poke.signal),
          ]);
          poke.abort();
          turn.controller.signal.removeEventListener("abort", onTurnAbort);
        }
        if (thread.turn?.id !== turn.id || turn.controller.signal.aborted) return;
        const body = await readTail().catch(() => null);
        let signature = lastSignature;
        if (body) signature = project(body);
        for (const event of queue.drain()) applyGatewayEvent(watch, thread.id, event);
        if (mode === "roster") {
          const roster = await Effect.runPromise(readGrokBotRoster(store, options)).catch(() => null);
          if (roster) applyRosterBody(watch, thread.id, roster);
        }
        publishWatch();
        if (watch.ended) {
          const latest = await readTail().catch(() => null);
          if (latest) project(latest);
          publishWatch();
          break;
        }
        if (mode !== "quiet" || !body) continue;
        if (signature !== lastSignature) {
          lastSignature = signature;
          lastChange = Date.now();
          continue;
        }
        // An open tool row or permission card is not a missing reply. Empty reads are not success.
        if (quietOpen) continue;
        if (Date.now() - lastChange >= quietMs) break;
      }
      if (thread.turn?.id !== turn.id) return;
      if (turn.text.length === 0) throw new Error(sourceText("error.provider.grokBotTurnFailed"));
      thread.messages = [...thread.messages, { role: "USER", text: prompt }, { role: "ASSISTANT", text: turn.text }];
      this.#emit("item/completed", {
        threadId: thread.id,
        turnId: turn.id,
        item: { type: "agentMessage", id: turn.itemId, text: turn.text, status: "completed" },
      });
      thread.turn = null;
      this.#emit("turn/completed", { threadId: thread.id, turn: { id: turn.id, status: "completed" } });
    } catch (error) {
      if (thread.turn?.id !== turn.id) return;
      thread.turn = null;
      if (turn.controller.signal.aborted) {
        this.#emit("turn/completed", { threadId: thread.id, turn: { id: turn.id, status: "interrupted" } });
        return;
      }
      const message = error instanceof Error ? error.message : sourceText("error.provider.grokBotTurnFailed");
      this.emit("diagnostic", `Grok Bot turn failed: ${message}`);
      this.#emit("error", { threadId: thread.id, turnId: turn.id, message });
      this.#emit("turn/completed", {
        threadId: thread.id,
        turn: { id: turn.id, status: "failed", error: { message } },
      });
    } finally {
      streamAbort.abort();
      hostAbort.abort();
      turn.controller.signal.removeEventListener("abort", abortStream);
    }
  }

  #interrupt(params: unknown): { turn: { id: string; status: string } } | Record<string, never> {
    const threadId = isRecord(params) ? getString(params, "threadId") : null;
    const thread = threadId ? this.#threads.get(threadId) : undefined;
    const turn = thread?.turn;
    if (!thread || !turn) return {};
    turn.controller.abort();
    this.#finishTurn(thread, turn, "interrupted");
    return { turn: { id: turn.id, status: "interrupted" } };
  }

  async #machine(): Promise<string> {
    if (this.#options.machineId) return this.#options.machineId;
    if (this.#machineId) return this.#machineId;
    if (this.#options.machineIdPath) {
      this.#machineId = await readOrCreateMachineId(this.#options.machineIdPath);
      return this.#machineId;
    }
    this.#machineId = randomUUID();
    return this.#machineId;
  }

  async #runTool(thread: SandThread, turnId: string, call: GrokBotStreamTool): Promise<GrokBotToolResultPart> {
    const parsed = parseToolArgs(call.args);
    const names = splitToolName(call.toolName, thread.tools);
    this.#emitTool(thread, turnId, call, "inProgress");
    const result = await Effect.runPromise(
      this.#requests.call(
        "item/tool/call",
        {
          threadId: thread.id,
          turnId,
          callId: call.toolCallId,
          namespace: names.namespace,
          tool: names.tool,
          arguments: parsed,
        },
        thread.turn?.controller.signal,
      ),
    );
    const toolResult = toolResultPart(call, result);
    this.#emit("item/completed", {
      threadId: thread.id,
      turnId,
      item: {
        id: call.toolCallId,
        type: "dynamicToolCall",
        namespace: names.namespace,
        tool: names.tool,
        arguments: parsed,
        status: toolResult.isError ? "failed" : "completed",
        contentItems: [
          { type: "inputText", text: toolResult.text },
          ...toolResult.images.map((image) => ({ type: "inputImage", imageUrl: image.data })),
        ],
      },
    });
    return toolResult;
  }

  /** Show one sand tool card. A later poll does not run the tool and does not send the row again. */
  #projectSandTools(
    threadId: string,
    turnId: string,
    steps: readonly GrokBotTranscriptToolStep[],
    shown: Map<string, GrokBotTranscriptToolStep["status"]>,
  ): void {
    for (const step of steps) {
      const previous = shown.get(step.id);
      if (step.status === "inProgress") {
        if (previous !== undefined) continue;
        this.#emitSandTool(threadId, turnId, step, "started");
        shown.set(step.id, "inProgress");
        continue;
      }
      if (previous === "completed" || previous === "failed") continue;
      if (previous === undefined) this.#emitSandTool(threadId, turnId, step, "started");
      this.#emitSandTool(threadId, turnId, step, "completed");
      shown.set(step.id, step.status);
    }
  }

  #emitSandTool(
    threadId: string,
    turnId: string,
    step: GrokBotTranscriptToolStep,
    phase: "started" | "completed",
  ): void {
    const status = phase === "started" ? "inProgress" : step.status;
    this.#emit(phase === "started" ? "item/started" : "item/completed", {
      threadId,
      turnId,
      item: {
        id: step.id,
        type: "dynamicToolCall",
        namespace: "sand",
        tool: step.name,
        status,
        ...(phase === "completed" && step.detail.length > 0
          ? { contentItems: [{ type: "inputText", text: step.detail }] }
          : {}),
      },
    });
  }

  #emitTool(thread: SandThread, turnId: string, call: GrokBotStreamTool, status: string): void {
    const names = splitToolName(call.toolName, thread.tools);
    this.#emit("item/started", {
      threadId: thread.id,
      turnId,
      item: {
        id: call.toolCallId,
        type: "dynamicToolCall",
        namespace: names.namespace,
        tool: names.tool,
        arguments: parseToolArgs(call.args),
        status,
      },
    });
  }

  #emit(method: string, params: unknown): void {
    this.emit("notification", { method, params });
  }

  #apiBase(): string {
    return (this.#options.apiBaseUrl ?? DEFAULT_API).replace(/\/+$/u, "");
  }

  #callOptions(): { apiBaseUrl: string; fetchImpl?: typeof fetch } {
    return {
      apiBaseUrl: this.#apiBase(),
      ...(this.#options.fetchImpl ? { fetchImpl: this.#options.fetchImpl } : {}),
    };
  }
}

function requiredId(params: unknown, key: string): string {
  const value = isRecord(params) ? getString(params, key) : null;
  if (!value) throw new Error(sourceText("error.provider.grokBotTurnFailed"));
  return value;
}

function hasPrompt(params: unknown): boolean {
  return inputItems(params).some(
    (item) =>
      (item.type === "text" && typeof item.text === "string" && item.text.trim().length > 0) ||
      (item.type === "localImage" && typeof item.path === "string") ||
      (item.type === "mention" && typeof item.path === "string"),
  );
}

function inputItems(params: unknown): DynamicRecord[] {
  if (!isDynamicRecord(params) || !Array.isArray(params.input)) return [];
  return params.input.filter(isDynamicRecord);
}

async function userMessage(params: unknown): Promise<GrokBotInferenceMessage> {
  const parts: Array<GrokBotTextPart | GrokBotImagePart> = [];
  for (const item of inputItems(params)) {
    if (item.type === "text" && typeof item.text === "string") parts.push({ type: "text", text: item.text });
    if (item.type === "mention" && typeof item.path === "string") {
      parts.push({ type: "text", text: `Attached local file: ${item.path}` });
    }
    if (item.type === "localImage" && typeof item.path === "string") parts.push(await imageFromPath(item.path));
  }
  if (!parts.some((part) => part.type === "image")) {
    return {
      role: "USER",
      text: parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n")
        .trim(),
    };
  }
  return { role: "USER", parts };
}

async function imageFromPath(path: string): Promise<GrokBotTextPart | GrokBotImagePart> {
  const bytes = await readFile(path);
  const mimeType = attachmentMimeTypeForName(path);
  if (bytes.length > GROK_BOT_MAX_IMAGE_BYTES) {
    return { type: "text", text: `[image omitted: failed to process ${bytes.length} bytes (${mimeType})]` };
  }
  return { type: "image", data: `data:${mimeType};base64,${bytes.toString("base64")}`, mimeType };
}

function advertisedTools(value: unknown): GrokBotAdvertisedTool[] {
  if (!Array.isArray(value)) return [];
  const tools: GrokBotAdvertisedTool[] = [];
  for (const namespace of value) {
    if (!isDynamicRecord(namespace) || typeof namespace.name !== "string" || !Array.isArray(namespace.tools)) continue;
    for (const tool of namespace.tools) {
      if (!isDynamicRecord(tool) || typeof tool.name !== "string") continue;
      tools.push({
        name: `${namespace.name}.${tool.name}`,
        description: typeof tool.description === "string" ? tool.description : "",
        parameters: isDynamicRecord(tool.inputSchema) ? tool.inputSchema : { type: "object" },
      });
    }
  }
  return tools;
}

function splitToolName(
  name: string,
  tools: readonly GrokBotAdvertisedTool[],
): { namespace: string | null; tool: string } {
  const source = tools.find((tool) => tool.name === name)?.name ?? name;
  const dot = source.indexOf(".");
  if (dot <= 0) return { namespace: null, tool: source };
  return { namespace: source.slice(0, dot), tool: source.slice(dot + 1) };
}

function parseToolArgs(raw: string): DynamicRecord {
  try {
    const parsed = JSON.parse(raw);
    if (isDynamicRecord(parsed)) return parsed;
  } catch {
    return {};
  }
  return {};
}

function toolCallRecord(call: GrokBotStreamTool): GrokBotToolCall {
  return { toolCallId: call.toolCallId, toolName: call.toolName, args: parseToolArgs(call.args), rawArgs: call.args };
}

function toolResultPart(call: GrokBotStreamTool, result: unknown): GrokBotToolResultPart {
  if (!isToolResult(result)) {
    return {
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      text: sourceText("error.provider.grokBotTurnFailed"),
      isError: true,
      images: [],
    };
  }
  return {
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    text: result.contentItems.flatMap((item) => (item.type === "inputText" ? [item.text] : [])).join("\n"),
    isError: !result.success,
    images: result.contentItems.flatMap((item) => (item.type === "inputImage" ? [imagePart(item.imageUrl)] : [])),
  };
}

function imagePart(imageUrl: string): GrokBotImagePart {
  const mimeType = imageUrl.startsWith("data:")
    ? (imageUrl.slice(5).split(";")[0] ?? "application/octet-stream")
    : "image/png";
  return { type: "image", data: imageUrl, mimeType };
}

function isToolResult(value: unknown): value is DynamicToolResult {
  return (
    isRecord(value) &&
    typeof value.success === "boolean" &&
    Array.isArray(value.contentItems) &&
    value.contentItems.every(
      (item) =>
        isRecord(item) &&
        ((item.type === "inputText" && typeof item.text === "string") ||
          (item.type === "inputImage" && typeof item.imageUrl === "string")),
    )
  );
}

function isUnauthenticated(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /unauthenticated|HTTP 401/iu.test(text);
}

/** Text of the user's prompt from `turn/start` params (`input` text items). */
function promptText(params: unknown): string {
  const parts: string[] = [];
  for (const item of inputItems(params)) {
    if (item.type === "text" && typeof item.text === "string") parts.push(item.text);
    if (item.type === "mention" && typeof item.path === "string") parts.push(`Attached local file: ${item.path}`);
  }
  const text = parts.join("\n").trim();
  if (text.length === 0) throw new Error(sourceText("error.provider.grokBotTurnFailed"));
  return text;
}

/**
 * Assistant text after this prompt in the transcript tail.
 * `getAgentTranscriptTail` returns a fixed window. A full window drops the oldest rows, so this
 * prompt is not at the previous window's length. The last user row with this text is this turn.
 */
function replyAfter(after: readonly GrokBotInferenceMessage[], prompt: string): string {
  let start = -1;
  const wanted = prompt.trim();
  for (let index = after.length - 1; index >= 0; index -= 1) {
    const message = after[index];
    if (message && message.role === "USER" && "text" in message && message.text.trim() === wanted) {
      start = index;
      break;
    }
  }
  if (start < 0) return "";
  return after
    .slice(start + 1)
    .filter((message) => message.role === "ASSISTANT" && "text" in message)
    .map((message) => ("text" in message ? message.text : ""))
    .join("\n\n");
}
