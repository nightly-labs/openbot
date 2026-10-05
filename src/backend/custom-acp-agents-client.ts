// The one client of the provider `acp`: a router over the ACP processes of the custom agents.
//
// The rest of the backend sees one provider with one catalogue. A model id names the custom agent
// (`<customAgentId>/<agentModel>`), and a session id that leaves here names it and its folder too
// (`<customAgentId>:<folderTag>:<agentSessionId>`), so a turn, a resume or an answer finds the
// process that owns it. Two agents, or two folders of one agent, can give the same session id; the
// prefix keeps them apart. A session saved before folders had processes of their own has no folder
// tag (`<customAgentId>:<agentSessionId>`), and keeps that id when it is resumed.
//
// A process serves one agent in one working folder, and starts when that pair is first needed. An
// agent can refuse a session in a second folder (Command Code serves one folder for each process),
// so two folders never share a process. The models come from one more process for each agent, in a
// folder apart from every workspace, so a model list never opens a session on a process that serves
// a thread. The list is kept, so a list that fails later answers with the last one, and an agent
// that never listed stays out of the catalogue: an empty answer would move the agents on it to
// another model.

import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { CUSTOM_AGENT_DEFAULT_MODEL, customAgentIdOfModel } from "@openbot/contracts/agent-providers";
import { isAgentModel } from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Exit } from "effect";
import { assertAgentArgs, assertWindowsScriptArgs, resolveAgentCommand } from "./acp-agent-command";
import type { AgentClient, DiagnosticOrigin } from "./agent-client";
import {
  type AppServerNotification,
  type AppServerRequest,
  decodeModelListResponse,
  decodeRecordResponse,
  getRecord,
  getString,
  isRecord,
  type ModelListResponse,
  type RequestId,
  type ResponseDecoder,
  type RpcError,
} from "./protocol";
import { ProviderClientOperationError } from "./provider-client-effects";

export interface CustomAgentConfig {
  readonly id: string;
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: readonly { readonly name: string; readonly value: string }[];
}

/** The saved custom agents, read when a process starts. */
export type CustomAgentSource = () => readonly CustomAgentConfig[];

/**
 * Builds the ACP client of one agent, on the file its command resolved to, for the sessions of one
 * working folder. `null` is the process that lists the agent's models.
 */
export type CustomAgentChildFactory = (
  config: CustomAgentConfig,
  executable: string,
  folder: string | null,
) => AgentClient;

const MODEL_LIST_TIMEOUT_MS = 5_000;

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string, origin?: DiagnosticOrigin];
}

type ModelEntry = ModelListResponse["data"][number];

/** The custom agent that a routed session id names, or null for an id that no custom agent gave. */
function sessionAgent(value: string): string | null {
  const colon = value.indexOf(":");
  if (colon <= 0 || colon === value.length - 1) return null;
  const agentId = value.slice(0, colon);
  return customAgentIdOfModel(`${agentId}/x`) === agentId ? agentId : null;
}

/**
 * A stable tag of one working folder. Each folder has a process of its own, and two processes can
 * give the same session id, so a new session id names the folder too: `<agentId>:<tag>:<sessionId>`.
 */
function folderTag(folder: string): string {
  return createHash("sha256").update(folder).digest("hex").slice(0, 12);
}

/**
 * The agent's own id of a routed session in `folder`. A session saved when one process served every
 * folder has no tag: `<agentId>:<sessionId>`.
 */
function ownSessionId(threadId: string, agentId: string, folder: string): string {
  const tagged = `${agentId}:${folderTag(folder)}:`;
  return threadId.startsWith(tagged) ? threadId.slice(tagged.length) : threadId.slice(agentId.length + 1);
}

/** The process that holds a session, and the session's id in that process. */
interface HeldSession {
  readonly child: AgentClient;
  readonly sessionId: string;
}

/** Read as a missing session by `isMissingProviderSessionError`, so the caller opens a new one. */
function unknownSession(threadId: string): Error {
  return new Error(`Unknown ACP session: ${threadId}`);
}

/** The key of one agent's process for one folder, or for its model list when `folder` is null. */
function childKey(agentId: string, folder: string | null): string {
  return `${agentId}\0${folder ?? ""}`;
}

function requiredCwd(params: unknown): string {
  const cwd = getString(params, "cwd");
  if (!cwd) throw new Error("cwd is required.");
  return cwd;
}

export class CustomAcpAgentsClient extends EventEmitter<ClientEvents> implements AgentClient {
  readonly provider = "acp" as const;
  readonly #source: CustomAgentSource;
  readonly #createChild: CustomAgentChildFactory;
  readonly #resolve: typeof resolveAgentCommand;
  readonly #children = new Map<string, Deferred.Deferred<AgentClient, ProviderClientOperationError>>();
  /** The process that opened or loaded each session, by the routed id that the caller knows. */
  readonly #sessions = new Map<string, HeldSession>();
  /**
   * Which process sent each request that waits for an answer, and its own id. Two processes can use
   * the same id, so the router gives each request an id of its own.
   */
  readonly #requests = new Map<RequestId, { child: AgentClient; id: RequestId }>();
  #nextRequestId = 0;
  readonly #lastModels = new Map<string, ModelEntry[]>();
  #running = false;

  constructor(source: CustomAgentSource, createChild: CustomAgentChildFactory, resolve = resolveAgentCommand) {
    super();
    this.#source = source;
    this.#createChild = createChild;
    this.#resolve = resolve;
  }

  get running(): boolean {
    return this.#running;
  }

  start(): void {
    this.#running = true;
  }

  readonly stop = Effect.fn("CustomAcp.stop")(function* (this: CustomAcpAgentsClient) {
    this.#running = false;
    const children = [...this.#children.values()];
    this.#children.clear();
    this.#sessions.clear();
    this.#requests.clear();
    yield* Effect.forEach(
      children,
      (pending) =>
        Deferred.await(pending).pipe(
          Effect.flatMap((client) => client.stop()),
          Effect.catch(() => Effect.void),
        ),
      { concurrency: "unbounded", discard: true },
    );
  });

  readonly releaseThread = Effect.fn("CustomAcp.releaseThread")(function* (
    this: CustomAcpAgentsClient,
    externalThreadId: string,
  ) {
    const held = this.#sessions.get(externalThreadId);
    const release = held?.child.releaseThread?.bind(held.child);
    if (held && release)
      yield* release(held.sessionId).pipe(
        Effect.mapError((failure) => new ProviderClientOperationError({ cause: failure.cause })),
      );
  });

  readonly request = Effect.fn("CustomAcp.request")(
    function* <T>(
      this: CustomAcpAgentsClient,
      method: string,
      params: unknown,
      decoder: ResponseDecoder<T>,
      timeoutMs?: number,
    ): Effect.fn.Return<T, ProviderClientOperationError> {
      if (!this.#running)
        return yield* new ProviderClientOperationError({ cause: new Error("ACP client is not running.") });
      switch (method) {
        case "initialize":
        case "thread/compact/start":
          return yield* customStep(() => decoder({}));
        case "account/read":
          return yield* customStep(() =>
            decoder(
              this.#source().length > 0
                ? { account: { type: "acp", email: null, planType: null }, requiresOpenaiAuth: false }
                : { account: null, requiresOpenaiAuth: false },
            ),
          );
        case "account/rateLimits/read":
          return yield* customStep(() => decoder({ rateLimits: null, rateLimitsByLimitId: null }));
        case "plugin/list":
          return yield* customStep(() => decoder({ marketplaces: [] }));
        case "model/list": {
          const data = yield* this.#listModels(params, timeoutMs ?? MODEL_LIST_TIMEOUT_MS);
          return yield* customStep(() => decoder({ data }));
        }
        case "thread/start": {
          const agentId = yield* customStep(() => this.#modelAgent(params));
          const cwd = yield* customStep(() => requiredCwd(params));
          const child = yield* this.#child(agentId, cwd).pipe(
            Effect.mapError((failure) => new ProviderClientOperationError({ cause: failure.cause })),
          );
          const response = yield* child
            .request(method, forChild(params, null), decodeRecordResponse, timeoutMs)
            .pipe(Effect.mapError((failure) => new ProviderClientOperationError({ cause: failure.cause })));
          return yield* customStep(() =>
            decoder(
              withThreadId(response, (sessionId) => {
                const threadId = `${agentId}:${folderTag(cwd)}:${sessionId}`;
                this.#sessions.set(threadId, { child, sessionId });
                return threadId;
              }),
            ),
          );
        }
        case "thread/resume": {
          const threadId = getString(params, "threadId") ?? "";
          const agentId = yield* customStep(() => this.#routedAgent(params));
          const cwd = yield* customStep(() => requiredCwd(params));
          const child = yield* this.#child(agentId, cwd).pipe(
            Effect.mapError((failure) => new ProviderClientOperationError({ cause: failure.cause })),
          );
          const held = { child, sessionId: ownSessionId(threadId, agentId, cwd) };
          // Held before the agent answers, so what it sends while it loads the session reaches the
          // caller under the id the caller knows, a saved id with no folder tag included.
          this.#sessions.set(threadId, held);
          return yield* child.request(method, forChild(params, held.sessionId), decodeRecordResponse, timeoutMs).pipe(
            Effect.mapError((failure) => new ProviderClientOperationError({ cause: failure.cause })),
            Effect.flatMap((response) => customStep(() => decoder(withThreadId(response, () => threadId)))),
            Effect.onError(() =>
              Effect.sync(() => {
                if (this.#sessions.get(threadId) === held) this.#sessions.delete(threadId);
              }),
            ),
          );
        }
        case "thread/read": {
          const threadId = getString(params, "threadId") ?? "";
          const agentId = sessionAgent(threadId);
          // A read has nothing to recover: a session of an agent that is gone has no turns to show.
          if (!agentId || !this.#source().some((config) => config.id === agentId)) {
            return yield* customStep(() => decoder({ thread: { id: threadId, turns: [] } }));
          }
          const cwd = getString(params, "cwd");
          // Only the process of the session's folder can load it. With no folder, nothing can.
          const held =
            this.#sessions.get(threadId) ??
            (cwd
              ? {
                  child: yield* this.#child(agentId, cwd).pipe(
                    Effect.mapError((failure) => new ProviderClientOperationError({ cause: failure.cause })),
                  ),
                  sessionId: ownSessionId(threadId, agentId, cwd),
                }
              : null);
          if (!held) return yield* customStep(() => decoder({ thread: { id: threadId, turns: [] } }));
          const response = yield* held.child
            .request(method, forChild(params, held.sessionId), decodeRecordResponse, timeoutMs)
            .pipe(Effect.mapError((failure) => new ProviderClientOperationError({ cause: failure.cause })));
          return yield* customStep(() => decoder(withThreadId(response, () => threadId)));
        }
        case "turn/start":
        case "turn/steer": {
          const threadId = getString(params, "threadId") ?? "";
          yield* customStep(() => this.#routedAgent(params));
          // A session that no process holds is missing, and the caller resumes it in its folder.
          const held = this.#sessions.get(threadId);
          if (!held) return yield* new ProviderClientOperationError({ cause: unknownSession(threadId) });
          return yield* held.child
            .request(method, forChild(params, held.sessionId), decoder, timeoutMs)
            .pipe(Effect.mapError((failure) => new ProviderClientOperationError({ cause: failure.cause })));
        }
        case "turn/interrupt": {
          const held = this.#sessions.get(getString(params, "threadId") ?? "");
          if (!held) return yield* customStep(() => decoder({}));
          return yield* held.child
            .request(method, forChild(params, held.sessionId), decoder, timeoutMs)
            .pipe(Effect.mapError((failure) => new ProviderClientOperationError({ cause: failure.cause })));
        }
        default:
          return yield* new ProviderClientOperationError({
            cause: new Error(`ACP adapter does not implement ${method}.`),
          });
      }
    },
    Effect.mapError((error) => new ProviderClientOperationError({ cause: this.#redactError(error.cause) })),
  );

  notify(): void {
    // The processes are initialized when they start. There is nothing to send to all of them.
  }

  respond(id: RequestId, result: unknown): void {
    const pending = this.#requests.get(id);
    this.#requests.delete(id);
    pending?.child.respond(pending.id, result);
  }

  respondError(id: RequestId, error: RpcError): void {
    const pending = this.#requests.get(id);
    this.#requests.delete(id);
    pending?.child.respondError(pending.id, error);
  }

  /** The custom agent that the model in `params` names. */
  #modelAgent(params: unknown): string {
    const agentId = customAgentIdOfModel(getString(params, "model") ?? "");
    if (!agentId) throw new Error(sourceText("error.provider.customAgentMissing"));
    return agentId;
  }

  /**
   * The agent that the session in `params` belongs to. A session of another agent than the model
   * names is missing for this turn: the user switched agents, and the caller opens a session on the
   * new one, with the conversation handed over.
   */
  #routedAgent(params: unknown): string {
    const threadId = getString(params, "threadId") ?? "";
    const agentId = sessionAgent(threadId);
    if (!agentId) throw unknownSession(threadId);
    const model = getString(params, "model");
    if (model && customAgentIdOfModel(model) !== agentId) throw unknownSession(threadId);
    return agentId;
  }

  /**
   * The id that the caller knows for a session of `child`. A session that the router does not hold
   * yet, such as one that `session/new` is still opening, gets the id that `thread/start` gives it.
   */
  #routedSessionId(child: AgentClient, prefix: string, sessionId: string): string {
    for (const [threadId, held] of this.#sessions) {
      if (held.child === child && held.sessionId === sessionId) return threadId;
    }
    return `${prefix}:${sessionId}`;
  }

  /**
   * One started, initialized process for each agent and folder, however many callers ask for it at
   * once. The folder `null` is the process that lists the agent's models.
   */
  readonly #child = Effect.fn("CustomAcp.child")(function* (
    this: CustomAcpAgentsClient,
    agentId: string,
    folder: string | null,
  ) {
    const key = childKey(agentId, folder);
    const existing = this.#children.get(key);
    if (existing) return yield* Deferred.await(existing);
    const starting = Deferred.makeUnsafe<AgentClient, ProviderClientOperationError>();
    this.#children.set(key, starting);
    const exit = yield* Effect.exit(this.#startChild(agentId, folder, key));
    yield* Deferred.done(starting, exit);
    if (Exit.isFailure(exit) && this.#children.get(key) === starting) this.#children.delete(key);
    return yield* exit;
  }, Effect.uninterruptible);

  readonly #startChild = Effect.fn("CustomAcp.startChild")(
    function* (this: CustomAcpAgentsClient, agentId: string, folder: string | null, key: string) {
      const config = this.#source().find((candidate) => candidate.id === agentId);
      if (!config)
        return yield* new ProviderClientOperationError({
          cause: new Error(sourceText("error.provider.customAgentMissing")),
        });
      yield* customStep(() => assertAgentArgs(config.args));
      const executable = yield* this.#resolve(config.command).pipe(
        Effect.mapError((failure) => new ProviderClientOperationError({ cause: failure.cause })),
      );
      if (!executable)
        return yield* new ProviderClientOperationError({
          cause: new Error(sourceText("error.provider.customAgentNotFound", { command: config.command })),
        });
      yield* customStep(() => assertWindowsScriptArgs(executable, config.args));
      const child = yield* customStep(() => this.#createChild(config, executable, folder));
      const prefix = folder === null ? agentId : `${agentId}:${folderTag(folder)}`;
      const route = (sessionId: string) => this.#routedSessionId(child, prefix, sessionId);
      child.on("notification", (notification) => {
        this.emit("notification", withRoutedThreadId(notification, route));
      });
      child.on("request", (request) => {
        this.#nextRequestId += 1;
        const id = `${agentId}:${this.#nextRequestId}`;
        this.#requests.set(id, { child, id: request.id });
        this.emit("request", withRoutedThreadId({ ...request, id }, route));
      });
      child.on("diagnostic", (message, origin) => this.emit("diagnostic", this.#redact(message), origin));
      child.once("exit", (error) => this.#childExited(key, folder, child, this.#redactError(error)));
      yield* customStep(() => child.start());
      yield* child
        .request("initialize", {}, decodeRecordResponse)
        .pipe(Effect.mapError((failure) => new ProviderClientOperationError({ cause: failure.cause })))
        .pipe(Effect.onError(() => child.stop().pipe(Effect.catch(() => Effect.void))));
      return child;
    },
    Effect.mapError((error) => new ProviderClientOperationError({ cause: this.#redactError(error.cause) })),
  );

  /**
   * One agent's process ended on its own. The runtime replaces the whole router, which is how the
   * other providers recover as well: the threads of every custom agent are loaded again. A process
   * that only lists models holds no thread, so it is forgotten, and the next list starts another.
   */
  #childExited(key: string, folder: string | null, child: AgentClient, error: Error): void {
    const pending = this.#children.get(key);
    if (!pending) return;
    Effect.runFork(
      Deferred.await(pending).pipe(
        Effect.tap((current) =>
          Effect.sync(() => {
            if (current !== child || !this.#running) return;
            if (folder === null) {
              if (this.#children.get(key) === pending) this.#children.delete(key);
              return;
            }
            this.#running = false;
            this.emit("exit", error);
          }),
        ),
        Effect.ignore,
      ),
    );
  }

  /**
   * The saved environment values of every custom agent, masked. An agent can quote one in an RPC
   * error, and the router's errors and diagnostics go to the log and to the renderer.
   */
  #redact(text: string): string {
    let result = text;
    for (const config of this.#source()) {
      for (const { value } of config.env) {
        if (value.length >= 4) result = result.split(value).join("[redacted]");
      }
    }
    return result;
  }

  /** The same error when it holds no value, so its type and fields stay for the callers that read them. */
  #redactError<E>(error: E): E | Error {
    if (!(error instanceof Error)) return error;
    const message = this.#redact(error.message);
    return message === error.message ? error : new Error(message);
  }

  readonly #listModels = Effect.fn("CustomAcp.listModels")(function* (
    this: CustomAcpAgentsClient,
    params: unknown,
    timeoutMs: number,
  ) {
    const configs = this.#source();
    const lists = yield* Effect.forEach(
      configs,
      (config) =>
        this.#child(config.id, null)
          .pipe(Effect.mapError((failure) => new ProviderClientOperationError({ cause: failure.cause })))
          .pipe(
            Effect.flatMap((child) =>
              child
                .request("model/list", params, decodeModelListResponse, timeoutMs)
                .pipe(Effect.mapError((failure) => new ProviderClientOperationError({ cause: failure.cause }))),
            ),
            Effect.timeoutOrElse({
              duration: timeoutMs,
              orElse: () =>
                Effect.fail(
                  new ProviderClientOperationError({
                    cause: new Error(`${config.name} request timed out: model/list`),
                  }),
                ),
            }),
            Effect.flatMap((response) =>
              customStep(() => {
                const models = routedModels(config, response.data);
                this.#lastModels.set(config.id, models);
                return models;
              }),
            ),
            Effect.catch((error) =>
              Effect.sync(() => {
                this.emit(
                  "diagnostic",
                  this.#redact(`Custom agent ${config.id} did not list its models: ${String(error.cause)}`),
                );
                return this.#lastModels.get(config.id) ?? [];
              }),
            ),
          ),
      { concurrency: "unbounded" },
    );
    return lists.flat();
  });
}

/**
 * The agent's models under its id. An id that the contract refuses is dropped alone: the model list
 * decoders fail closed on the whole array. An agent with no list gets the one model `default`.
 */
function routedModels(config: CustomAgentConfig, data: readonly ModelEntry[]): ModelEntry[] {
  if (data.length === 0) {
    return [{ model: `${config.id}/${CUSTOM_AGENT_DEFAULT_MODEL}`, displayName: config.name }];
  }
  return data.flatMap((item) => {
    const model = item.model?.trim();
    if (!model) return [];
    const id = `${config.id}/${model}`;
    // `<agent name>/<model name>`, as a custom endpoint's models are named: the picker groups by it.
    return isAgentModel(id) ? [{ ...item, model: id, displayName: `${config.name}/${item.displayName ?? model}` }] : [];
  });
}

/** The params as the agent's own process takes them: its session id, and its model with no prefix. */
function forChild(params: unknown, sessionId: string | null): DynamicRecord {
  const record: DynamicRecord = isRecord(params) ? params : {};
  const { model, ...rest } = record;
  const agentModel = typeof model === "string" ? model.slice(model.indexOf("/") + 1) : "";
  return {
    ...rest,
    ...(sessionId === null ? {} : { threadId: sessionId }),
    ...(agentModel && agentModel !== CUSTOM_AGENT_DEFAULT_MODEL ? { model: agentModel } : {}),
  };
}

function withRoutedThreadId<T extends { params: unknown }>(message: T, route: (sessionId: string) => string): T {
  const { params } = message;
  if (!isRecord(params)) return message;
  const threadId = getString(params, "threadId");
  return threadId === null ? message : { ...message, params: { ...params, threadId: route(threadId) } };
}

/** The response with the routed id of the session that the agent named. */
function withThreadId(response: DynamicRecord, route: (sessionId: string) => string): DynamicRecord {
  const thread = getRecord(response, "thread");
  const id = getString(thread, "id");
  if (!thread || id === null) return response;
  return { ...response, thread: { ...thread, id: route(id) } };
}

function customStep<A>(run: () => A): Effect.Effect<A, ProviderClientOperationError> {
  return Effect.try({ try: run, catch: (cause) => new ProviderClientOperationError({ cause }) });
}
