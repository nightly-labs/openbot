import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { CUSTOM_AGENT_DEFAULT_MODEL, customAgentIdOfModel } from "@openbot/contracts/agent-providers";
import { type AgentSessionSettingsSnapshot, type AgentSessionSettingValue, isAgentModel } from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Exit } from "effect";
import { assertAgentArgs, assertWindowsScriptArgs, resolveAgentCommand } from "./acp-agent-command";
import type { AcpHistoryPersistence } from "./acp-client";
import { type AcpFlavor, customAgentFlavor } from "./acp-flavor";
import { type AgentClient, AgentProcessExitError, type DiagnosticOrigin } from "./agent-client";
import { agentLaunchPath } from "./cli";
import { causeHelpers } from "./effect-boundary";
import { encodedModelId, providerModelValue } from "./encoded-model-id";
import { isPathInside } from "./path-containment";
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
  type ThreadItem,
} from "./protocol";
import { ProviderClientOperationError, toProviderClientOperationError } from "./provider-client-effects";
import type { ProviderHistoryConsumer, ProviderHistoryFragment, ProviderHistoryRequest } from "./provider-history";

const { sync: customStep } = causeHelpers(ProviderClientOperationError);

export interface CustomAgentConfig {
  readonly id: string;
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: readonly { readonly name: string; readonly value: string }[];
  readonly usagePrompt: string | null;
}

export type CustomAgentSource = () => readonly CustomAgentConfig[];

export type CustomAgentChildFactory = (
  config: CustomAgentConfig,
  executable: string,
  folder: string | null,
  history?: AcpHistoryPersistence,
  launchPath?: string | null,
) => AgentClient;

const MODEL_LIST_TIMEOUT_MS = 5_000;

const WRITE_DENIED = /\bEPERM\b|operation not permitted|attempt to write a readonly database/iu;
const WORKSPACE_ONLY_HINT = sourceText("error.provider.customAgentWorkspaceOnly", { reason: "" });

function withWorkspaceOnlyHint(message: string): string {
  return sourceText("error.provider.customAgentWorkspaceOnly", { reason: message.trimEnd().replace(/\.$/u, "") });
}

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string, origin?: DiagnosticOrigin];
}

type ModelEntry = ModelListResponse["data"][number];

function sessionAgent(value: string): string | null {
  const colon = value.indexOf(":");
  if (colon <= 0 || colon === value.length - 1) return null;
  const agentId = value.slice(0, colon);
  return customAgentIdOfModel(`${agentId}/x`) === agentId ? agentId : null;
}

function folderTag(folder: string): string {
  return createHash("sha256").update(folder).digest("hex").slice(0, 12);
}

function ownSessionId(threadId: string, agentId: string, folder: string): string {
  const tagged = `${agentId}:${folderTag(folder)}:`;
  return threadId.startsWith(tagged) ? threadId.slice(tagged.length) : threadId.slice(agentId.length + 1);
}

interface HeldSession {
  readonly child: AgentClient;
  readonly sessionId: string;
}

function unknownSession(threadId: string): Error {
  return new Error(`Unknown ACP session: ${threadId}`);
}

function childKey(agentId: string, folder: string | null): string {
  return `${agentId}\0${folder ?? ""}`;
}

function folderOfChildKey(key: string): string | null {
  const folder = key.slice(key.indexOf("\0") + 1);
  return folder === "" ? null : folder;
}

function requiredCwd(params: unknown): string {
  const cwd = getString(params, "cwd");
  if (!cwd) throw new Error("cwd is required.");
  return cwd;
}

export class CustomAcpAgentsClient extends EventEmitter<ClientEvents> implements AgentClient {
  readonly contextCompaction = "unsupported";
  readonly provider = "acp" as const;
  readonly turnContext = true;
  readonly #source: CustomAgentSource;
  readonly #createChild: CustomAgentChildFactory;
  readonly #resolve: typeof resolveAgentCommand;
  readonly #history: AcpHistoryPersistence | undefined;
  readonly #confined: boolean;
  readonly #children = new Map<string, Deferred.Deferred<AgentClient, ProviderClientOperationError>>();
  readonly #sessions = new Map<string, HeldSession>();
  readonly #requests = new Map<RequestId, { child: AgentClient; id: RequestId }>();
  #nextRequestId = 0;
  readonly #lastModels = new Map<string, ModelEntry[]>();
  #running = false;

  constructor(
    source: CustomAgentSource,
    createChild: CustomAgentChildFactory,
    resolve = resolveAgentCommand,
    history?: AcpHistoryPersistence,
    confined = false,
  ) {
    super();
    this.#source = source;
    this.#createChild = createChild;
    this.#resolve = resolve;
    this.#history = history;
    this.#confined = confined;
  }

  get running(): boolean {
    return this.#running;
  }

  canReleaseProcess(): boolean {
    const children = new Set([...this.#sessions.values()].map(({ child }) => child));
    return [...children].every((child) => child.canReleaseProcess?.() !== false);
  }

  readonly readHistory = Effect.fn("CustomAcp.readHistory")(function* (
    this: CustomAcpAgentsClient,
    request: ProviderHistoryRequest,
    consume: ProviderHistoryConsumer,
  ): Effect.fn.Return<void, ProviderClientOperationError> {
    const history = this.#history;
    const durableReplay = history?.append && history.read;
    const complete = history?.complete;
    if (request.providerOnly && complete && (yield* complete(request))) return;
    let stopped = false;
    const reader = history?.read;
    const readStored = (storedRequest: ProviderHistoryRequest) =>
      reader
        ? reader(storedRequest, (fragment) =>
            consume(fragment).pipe(
              Effect.tap((continueReading) =>
                Effect.sync(() => {
                  stopped = !continueReading;
                }),
              ),
            ),
          )
        : Effect.void;
    if (!request.providerOnly && history?.read) {
      if (!durableReplay) {
        yield* readStored(request);
        if (stopped) return;
        if (complete && (yield* complete(request))) return;
      } else if (complete && (yield* complete(request))) {
        yield* readStored(request);
        return;
      }
    }
    const agentId = sessionAgent(request.threadId);
    if (!agentId || !request.cwd) {
      if (history && durableReplay && !request.providerOnly) yield* readStored(request);
      return;
    }
    const child = yield* this.#child(agentId, request.cwd).pipe(toProviderClientOperationError);
    if (!child.readHistory) return;
    const sessionId = ownSessionId(request.threadId, agentId, request.cwd);
    yield* child
      .readHistory({ ...request, threadId: sessionId, ...(durableReplay ? { providerOnly: true } : {}) }, consume)
      .pipe(toProviderClientOperationError);
  });

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

  readonly releaseFolderProcesses = Effect.fn("CustomAcp.releaseFolderProcesses")(function* (
    this: CustomAcpAgentsClient,
    folder: string,
  ) {
    let kept = false;
    for (const [key, pending] of [...this.#children]) {
      const childFolder = folderOfChildKey(key);
      if (!childFolder || !isPathInside(folder, childFolder)) continue;
      const started = yield* Effect.exit(Deferred.await(pending));
      if (Exit.isFailure(started) || this.#children.get(key) !== pending) continue;
      const child = started.value;
      if (child.canReleaseProcess?.() === false) {
        kept = true;
        continue;
      }
      this.#children.delete(key);
      for (const [threadId, held] of this.#sessions) if (held.child === child) this.#sessions.delete(threadId);
      for (const [id, request] of this.#requests) if (request.child === child) this.#requests.delete(id);
      yield* child.stop().pipe(Effect.ignore);
    }
    return kept;
  }, Effect.uninterruptible);

  readonly mcpToolsFixedAtStart = (externalThreadId: string): boolean =>
    this.#flavorOf(sessionAgent(externalThreadId))?.mcpToolsFixedAtStart === true;

  readonly imageInput = (externalThreadId: string): boolean => {
    const held = this.#sessions.get(externalThreadId);
    return held?.child.imageInput?.(held.sessionId) === true;
  };

  readonly catalogAsMcpTools = (model: string): boolean =>
    this.#flavorOf(customAgentIdOfModel(model))?.catalogAsMcpTools === true;

  #flavorOf(agentId: string | null): AcpFlavor | undefined {
    const config = agentId ? this.#source().find((candidate) => candidate.id === agentId) : undefined;
    return config ? customAgentFlavor(config.command) : undefined;
  }

  readonly releaseThread = Effect.fn("CustomAcp.releaseThread")(function* (
    this: CustomAcpAgentsClient,
    externalThreadId: string,
  ) {
    const held = this.#sessions.get(externalThreadId);
    const release = held?.child.releaseThread?.bind(held.child);
    if (held && release) yield* release(held.sessionId).pipe(toProviderClientOperationError);
  });

  readonly readSessionSettings = Effect.fn("CustomAcp.readSessionSettings")(function* (
    this: CustomAcpAgentsClient,
    externalThreadId: string,
  ): Effect.fn.Return<AgentSessionSettingsSnapshot, ProviderClientOperationError> {
    const held = this.#sessions.get(externalThreadId);
    if (!held?.child.readSessionSettings)
      return yield* new ProviderClientOperationError({
        cause: new Error(sourceText("error.provider.sessionSettingUnavailable")),
      });
    return yield* held.child.readSessionSettings(held.sessionId);
  });

  readonly setSessionSetting = Effect.fn("CustomAcp.setSessionSetting")(function* (
    this: CustomAcpAgentsClient,
    externalThreadId: string,
    configId: string,
    value: AgentSessionSettingValue,
  ): Effect.fn.Return<AgentSessionSettingsSnapshot, ProviderClientOperationError> {
    const held = this.#sessions.get(externalThreadId);
    if (!held?.child.setSessionSetting)
      return yield* new ProviderClientOperationError({
        cause: new Error(sourceText("error.provider.sessionSettingUnavailable")),
      });
    return yield* held.child.setSessionSetting(held.sessionId, configId, value);
  });

  readonly readUsageText = Effect.fn("CustomAcp.readUsageText")(function* (
    this: CustomAcpAgentsClient,
    model: string,
    prompt: string,
  ): Effect.fn.Return<string | null, ProviderClientOperationError> {
    if (!this.#running)
      return yield* new ProviderClientOperationError({ cause: new Error("ACP client is not running.") });
    const agentId = yield* customStep(() => this.#modelAgent({ model }));
    const child = yield* this.#child(agentId, null).pipe(toProviderClientOperationError);
    if (!child.readUsageText) return null;
    return yield* child.readUsageText(model, prompt).pipe(toProviderClientOperationError);
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
          const child = yield* this.#child(agentId, cwd).pipe(toProviderClientOperationError);
          const response = yield* child
            .request(method, forChild(params, null), decodeRecordResponse, timeoutMs)
            .pipe(toProviderClientOperationError);
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
          const child = yield* this.#child(agentId, cwd).pipe(toProviderClientOperationError);
          const held = { child, sessionId: ownSessionId(threadId, agentId, cwd) };
          this.#sessions.set(threadId, held);
          return yield* child.request(method, forChild(params, held.sessionId), decodeRecordResponse, timeoutMs).pipe(
            toProviderClientOperationError,
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
          if (isRecord(params) && params.includeTurns === true) {
            const turns = new Map<string, { id: string; status?: string; startedAt?: number; items: ThreadItem[] }>();
            const seenItems = new Map<string, Set<string>>();
            const cwd = getString(params, "cwd");
            yield* this.readHistory(
              {
                threadId,
                items: "full",
                ...(cwd === null ? {} : { cwd }),
              },
              (fragment) =>
                Effect.sync(() => {
                  let turn = turns.get(fragment.turnId);
                  if (!turn) {
                    turn = { id: fragment.turnId, items: [] };
                    turns.set(fragment.turnId, turn);
                  }
                  if (fragment.status !== undefined) turn.status = fragment.status;
                  if (fragment.startedAt !== undefined) turn.startedAt = fragment.startedAt;
                  const ids = seenItems.get(fragment.turnId) ?? new Set<string>();
                  for (const item of fragment.items) {
                    if (item.id && ids.has(item.id)) continue;
                    if (item.id) ids.add(item.id);
                    turn.items.push(item);
                  }
                  seenItems.set(fragment.turnId, ids);
                  return true;
                }),
            );
            return yield* customStep(() =>
              decoder({
                thread: {
                  id: threadId,
                  turns: [...turns.values()].reverse(),
                },
              }),
            );
          }
          const agentId = sessionAgent(threadId);
          if (!agentId || !this.#source().some((config) => config.id === agentId)) {
            return yield* customStep(() => decoder({ thread: { id: threadId, turns: [] } }));
          }
          const cwd = getString(params, "cwd");
          const held =
            this.#sessions.get(threadId) ??
            (cwd
              ? {
                  child: yield* this.#child(agentId, cwd).pipe(toProviderClientOperationError),
                  sessionId: ownSessionId(threadId, agentId, cwd),
                }
              : null);
          if (!held) return yield* customStep(() => decoder({ thread: { id: threadId, turns: [] } }));
          const response = yield* held.child
            .request(method, forChild(params, held.sessionId), decodeRecordResponse, timeoutMs)
            .pipe(toProviderClientOperationError);
          return yield* customStep(() => decoder(withThreadId(response, () => threadId)));
        }
        case "turn/start":
        case "turn/steer": {
          const threadId = getString(params, "threadId") ?? "";
          yield* customStep(() => this.#routedAgent(params));
          const held = this.#sessions.get(threadId);
          if (!held) return yield* new ProviderClientOperationError({ cause: unknownSession(threadId) });
          return yield* held.child
            .request(method, forChild(params, held.sessionId), decoder, timeoutMs)
            .pipe(toProviderClientOperationError);
        }
        case "turn/interrupt": {
          const held = this.#sessions.get(getString(params, "threadId") ?? "");
          if (!held) return yield* customStep(() => decoder({}));
          return yield* held.child
            .request(method, forChild(params, held.sessionId), decoder, timeoutMs)
            .pipe(toProviderClientOperationError);
        }
        default:
          return yield* new ProviderClientOperationError({
            cause: new Error(`ACP adapter does not implement ${method}.`),
          });
      }
    },
    Effect.mapError((error) => new ProviderClientOperationError({ cause: this.#publicError(error.cause) })),
  );

  notify(): void {}

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

  #modelAgent(params: unknown): string {
    const agentId = customAgentIdOfModel(getString(params, "model") ?? "");
    if (!agentId) throw new Error(sourceText("error.provider.customAgentMissing"));
    return agentId;
  }

  #routedAgent(params: unknown): string {
    const threadId = getString(params, "threadId") ?? "";
    const agentId = sessionAgent(threadId);
    if (!agentId) throw unknownSession(threadId);
    const model = getString(params, "model");
    if (model && customAgentIdOfModel(model) !== agentId) throw unknownSession(threadId);
    return agentId;
  }

  #routedSessionId(child: AgentClient, prefix: string, sessionId: string): string {
    for (const [threadId, held] of this.#sessions) {
      if (held.child === child && held.sessionId === sessionId) return threadId;
    }
    return `${prefix}:${sessionId}`;
  }

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
      const executable = yield* this.#resolve(config.command).pipe(toProviderClientOperationError);
      if (!executable)
        return yield* new ProviderClientOperationError({
          cause: new Error(sourceText("error.provider.customAgentNotFound", { command: config.command })),
        });
      yield* customStep(() => assertWindowsScriptArgs(executable, config.args));
      const launchPath = yield* agentLaunchPath().pipe(toProviderClientOperationError);
      const prefix = folder === null ? agentId : `${agentId}:${folderTag(folder)}`;
      let child: AgentClient | null = null;
      const history =
        folder === null || !this.#history
          ? undefined
          : {
              read: (request: ProviderHistoryRequest, consume: ProviderHistoryConsumer) =>
                this.#history?.read?.(
                  {
                    ...request,
                    threadId: child
                      ? this.#routedSessionId(child, prefix, request.threadId)
                      : `${prefix}:${request.threadId}`,
                  },
                  consume,
                ) ?? Effect.void,
              append: (sessionId: string, fragment: ProviderHistoryFragment) =>
                this.#history?.append?.(
                  child ? this.#routedSessionId(child, prefix, sessionId) : `${prefix}:${sessionId}`,
                  fragment,
                ) ?? Effect.void,
            };
      const created = yield* customStep(() => this.#createChild(config, executable, folder, history, launchPath));
      child = created;
      const route = (sessionId: string) => this.#routedSessionId(created, prefix, sessionId);
      created.on("notification", (notification) => {
        const message = notification.method === "error" ? getString(notification.params, "message") : null;
        const explained =
          message === null
            ? notification
            : { ...notification, params: { ...getRecord(notification, "params"), message: this.#explain(message) } };
        this.emit("notification", withRoutedThreadId(explained, route));
      });
      created.on("request", (request) => {
        this.#nextRequestId += 1;
        const id = `${agentId}:${this.#nextRequestId}`;
        this.#requests.set(id, { child: created, id: request.id });
        this.emit("request", withRoutedThreadId({ ...request, id }, route));
      });
      created.on("diagnostic", (message, origin) => this.emit("diagnostic", this.#redact(message), origin));
      created.once("exit", (error) => this.#childExited(key, folder, created, this.#publicError(error)));
      yield* customStep(() => created.start());
      yield* created
        .request("initialize", {}, decodeRecordResponse)
        .pipe(toProviderClientOperationError)
        .pipe(Effect.onError(() => created.stop().pipe(Effect.catch(() => Effect.void))));
      return created;
    },
    Effect.mapError((error) => new ProviderClientOperationError({ cause: this.#publicError(error.cause) })),
  );

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

  #redact(text: string): string {
    let result = text;
    for (const config of this.#source()) {
      for (const { value } of config.env) {
        if (value.length >= 4) result = result.split(value).join("[redacted]");
      }
    }
    return result;
  }

  #redactError<E>(error: E): E | Error {
    if (!(error instanceof Error)) return error;
    const message = this.#redact(error.message);
    return message === error.message ? error : new Error(message);
  }

  #deniedWrite(message: string): boolean {
    return this.#confined && WRITE_DENIED.test(message) && !message.includes(WORKSPACE_ONLY_HINT);
  }

  #explain(message: string): string {
    return this.#deniedWrite(message) ? withWorkspaceOnlyHint(message) : message;
  }

  #publicError<E>(error: E): E | Error {
    const redacted = this.#redactError(error);
    if (!(redacted instanceof Error)) return redacted;
    if (redacted instanceof AgentProcessExitError) {
      return this.#deniedWrite(redacted.withDetail((text) => this.#redact(text)).message)
        ? redacted.withMessage(withWorkspaceOnlyHint(redacted.message))
        : redacted;
    }
    return this.#deniedWrite(redacted.message)
      ? new Error(withWorkspaceOnlyHint(redacted.message), { cause: redacted })
      : redacted;
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
          .pipe(toProviderClientOperationError)
          .pipe(
            Effect.flatMap((child) =>
              child
                .request("model/list", params, decodeModelListResponse, timeoutMs)
                .pipe(toProviderClientOperationError),
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
                const models = routedModels(config, response.data, response.steersTurns === true);
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

function routedModels(config: CustomAgentConfig, data: readonly ModelEntry[], steersTurns: boolean): ModelEntry[] {
  const steering = steersTurns ? { steersTurns: true } : {};
  if (data.length === 0) {
    return [{ model: `${config.id}/${CUSTOM_AGENT_DEFAULT_MODEL}`, displayName: config.name, ...steering }];
  }
  return data.flatMap((item) => {
    const model = item.model?.trim();
    if (!model) return [];
    const id = encodedModelId(`${config.id}/`, model);
    return isAgentModel(id)
      ? [{ ...item, model: id, displayName: `${config.name}/${item.displayName ?? model}`, ...steering }]
      : [];
  });
}

function forChild(params: unknown, sessionId: string | null): DynamicRecord {
  const record: DynamicRecord = isRecord(params) ? params : {};
  const { model, ...rest } = record;
  const agentModel = typeof model === "string" ? providerModelValue(model.slice(model.indexOf("/") + 1)) : "";
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

function withThreadId(response: DynamicRecord, route: (sessionId: string) => string): DynamicRecord {
  const thread = getRecord(response, "thread");
  const id = getString(thread, "id");
  if (!thread || id === null) return response;
  return { ...response, thread: { ...thread, id: route(id) } };
}
