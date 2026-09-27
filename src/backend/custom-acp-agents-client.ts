// The one client of the provider `acp`: a router over one ACP process for each custom agent.
//
// The rest of the backend sees one provider with one catalogue. A model id names the custom agent
// (`<customAgentId>/<agentModel>`), and a session id that leaves here names it too
// (`<customAgentId>:<agentSessionId>`), so a turn, a resume or an answer finds the process that owns
// it. Two agents can give the same session id; the prefix keeps them apart.
//
// A process starts when its agent is first needed. Its model list is kept, so a list that fails
// later answers with the last one, and an agent that never listed stays out of the catalogue: an
// empty answer would move the agents on it to another model.

import { EventEmitter } from "node:events";
import { CUSTOM_AGENT_DEFAULT_MODEL, customAgentIdOfModel } from "@openbot/contracts/agent-providers";
import { isAgentModel } from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { assertAgentArgs, assertWindowsScriptArgs, resolveAgentCommand } from "./acp-agent-command";
import type { AgentClient } from "./agent-client";
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
import { withTimeout } from "./with-timeout";

export interface CustomAgentConfig {
  readonly id: string;
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: readonly { readonly name: string; readonly value: string }[];
}

/** The saved custom agents, read when a process starts. */
export type CustomAgentSource = () => readonly CustomAgentConfig[];

/** Builds the ACP client of one agent, on the file its command resolved to. */
export type CustomAgentChildFactory = (config: CustomAgentConfig, executable: string) => AgentClient;

const MODEL_LIST_TIMEOUT_MS = 5_000;

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string];
}

type ModelEntry = ModelListResponse["data"][number];

/** `<agentId>:<sessionId>`, or null for an id that no custom agent gave. */
export function splitCustomAgentSessionId(value: string): { agentId: string; sessionId: string } | null {
  const colon = value.indexOf(":");
  if (colon <= 0 || colon === value.length - 1) return null;
  const agentId = value.slice(0, colon);
  return customAgentIdOfModel(`${agentId}/x`) === agentId ? { agentId, sessionId: value.slice(colon + 1) } : null;
}

/** Read as a missing session by `isMissingProviderSessionError`, so the caller opens a new one. */
function unknownSession(threadId: string): Error {
  return new Error(`Unknown ACP session: ${threadId}`);
}

export class CustomAcpAgentsClient extends EventEmitter<ClientEvents> implements AgentClient {
  readonly provider = "acp" as const;
  readonly #source: CustomAgentSource;
  readonly #createChild: CustomAgentChildFactory;
  readonly #resolve: typeof resolveAgentCommand;
  readonly #children = new Map<string, Promise<AgentClient>>();
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

  async stop(): Promise<void> {
    this.#running = false;
    const children = [...this.#children.values()];
    this.#children.clear();
    this.#requests.clear();
    await Promise.all(children.map((child) => child.then((client) => client.stop()).catch(() => undefined)));
  }

  async releaseThread(externalThreadId: string): Promise<void> {
    const routed = splitCustomAgentSessionId(externalThreadId);
    if (!routed) return;
    const child = await this.#children.get(routed.agentId)?.catch(() => null);
    await child?.releaseThread?.(routed.sessionId);
  }

  async request<T>(method: string, params: unknown, decoder: ResponseDecoder<T>, timeoutMs?: number): Promise<T> {
    if (!this.#running) throw new Error("ACP client is not running.");
    try {
      return await this.#request(method, params, decoder, timeoutMs);
    } catch (error) {
      throw this.#redactError(error);
    }
  }

  async #request<T>(method: string, params: unknown, decoder: ResponseDecoder<T>, timeoutMs?: number): Promise<T> {
    switch (method) {
      case "initialize":
        return decoder({});
      case "account/read":
        return decoder(
          this.#source().length > 0
            ? { account: { type: "acp", email: null, planType: null }, requiresOpenaiAuth: false }
            : { account: null, requiresOpenaiAuth: false },
        );
      case "account/rateLimits/read":
        return decoder({ rateLimits: null, rateLimitsByLimitId: null });
      case "plugin/list":
        return decoder({ marketplaces: [] });
      case "model/list":
        return decoder({ data: await this.#listModels(params, timeoutMs ?? MODEL_LIST_TIMEOUT_MS) });
      case "thread/start": {
        const agentId = this.#modelAgent(params);
        const child = await this.#child(agentId);
        const response = await child.request(method, forChild(params, null), decodeRecordResponse, timeoutMs);
        return decoder(withThreadId(response, agentId));
      }
      case "thread/resume": {
        const routed = this.#routed(params);
        const child = await this.#child(routed.agentId);
        const response = await child.request(
          method,
          forChild(params, routed.sessionId),
          decodeRecordResponse,
          timeoutMs,
        );
        return decoder(withThreadId(response, routed.agentId));
      }
      case "thread/read": {
        const threadId = getString(params, "threadId") ?? "";
        const routed = splitCustomAgentSessionId(threadId);
        // A read has nothing to recover: a session of an agent that is gone has no turns to show.
        if (!routed || !this.#source().some((config) => config.id === routed.agentId)) {
          return decoder({ thread: { id: threadId, turns: [] } });
        }
        const child = await this.#child(routed.agentId);
        const response = await child.request(
          method,
          forChild(params, routed.sessionId),
          decodeRecordResponse,
          timeoutMs,
        );
        return decoder(withThreadId(response, routed.agentId));
      }
      case "turn/start":
      case "turn/steer": {
        const routed = this.#routed(params);
        const child = await this.#child(routed.agentId);
        return child.request(method, forChild(params, routed.sessionId), decoder, timeoutMs);
      }
      case "turn/interrupt": {
        const routed = splitCustomAgentSessionId(getString(params, "threadId") ?? "");
        const child = routed ? await this.#children.get(routed.agentId)?.catch(() => null) : null;
        if (!routed || !child) return decoder({});
        return child.request(method, forChild(params, routed.sessionId), decoder, timeoutMs);
      }
      case "thread/compact/start":
        return decoder({});
      default:
        throw new Error(`ACP adapter does not implement ${method}.`);
    }
  }

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
   * The agent and its own session id. A session of another agent than the model names is missing
   * for this turn: the user switched agents, and the caller opens a session on the new one, with the
   * conversation handed over.
   */
  #routed(params: unknown): { agentId: string; sessionId: string } {
    const threadId = getString(params, "threadId") ?? "";
    const routed = splitCustomAgentSessionId(threadId);
    if (!routed) throw unknownSession(threadId);
    const model = getString(params, "model");
    if (model && customAgentIdOfModel(model) !== routed.agentId) throw unknownSession(threadId);
    return routed;
  }

  /** One started, initialized process for each agent, however many callers ask for it at once. */
  #child(agentId: string): Promise<AgentClient> {
    const existing = this.#children.get(agentId);
    if (existing) return existing;
    const starting = this.#startChild(agentId);
    this.#children.set(agentId, starting);
    starting.catch(() => {
      if (this.#children.get(agentId) === starting) this.#children.delete(agentId);
    });
    return starting;
  }

  async #startChild(agentId: string): Promise<AgentClient> {
    const config = this.#source().find((candidate) => candidate.id === agentId);
    if (!config) throw new Error(sourceText("error.provider.customAgentMissing"));
    assertAgentArgs(config.args);
    const executable = await this.#resolve(config.command);
    if (!executable) throw new Error(sourceText("error.provider.customAgentNotFound", { command: config.command }));
    assertWindowsScriptArgs(executable, config.args);
    const child = this.#createChild(config, executable);
    child.on("notification", (notification) => {
      this.emit("notification", withRoutedThreadId(notification, agentId));
    });
    child.on("request", (request) => {
      this.#nextRequestId += 1;
      const id = `${agentId}:${this.#nextRequestId}`;
      this.#requests.set(id, { child, id: request.id });
      this.emit("request", withRoutedThreadId({ ...request, id }, agentId));
    });
    child.on("diagnostic", (message) => this.emit("diagnostic", this.#redact(message)));
    child.once("exit", (error) => this.#childExited(agentId, child, this.#redactError(error)));
    child.start();
    try {
      await child.request("initialize", {}, decodeRecordResponse);
    } catch (error) {
      await child.stop().catch(() => undefined);
      throw error;
    }
    return child;
  }

  /**
   * One agent's process ended on its own. The runtime replaces the whole router, which is how the
   * other providers recover as well: the threads of every custom agent are loaded again.
   */
  #childExited(agentId: string, child: AgentClient, error: Error): void {
    void this.#children
      .get(agentId)
      ?.then((current) => {
        if (current !== child || !this.#running) return;
        this.#running = false;
        this.emit("exit", error);
      })
      .catch(() => undefined);
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

  async #listModels(params: unknown, timeoutMs: number): Promise<ModelEntry[]> {
    const configs = this.#source();
    const lists = await Promise.all(
      configs.map(async (config) => {
        try {
          const response = await withTimeout(
            this.#child(config.id).then((child) =>
              child.request("model/list", params, decodeModelListResponse, timeoutMs),
            ),
            timeoutMs,
            `${config.name} request timed out: model/list`,
          );
          const models = routedModels(config, response.data);
          this.#lastModels.set(config.id, models);
          return models;
        } catch (error) {
          this.emit("diagnostic", this.#redact(`Custom agent ${config.id} did not list its models: ${String(error)}`));
          return this.#lastModels.get(config.id) ?? [];
        }
      }),
    );
    return lists.flat();
  }
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

function withRoutedThreadId<T extends { params: unknown }>(message: T, agentId: string): T {
  const { params } = message;
  if (!isRecord(params)) return message;
  const threadId = getString(params, "threadId");
  return threadId === null ? message : { ...message, params: { ...params, threadId: `${agentId}:${threadId}` } };
}

function withThreadId(response: DynamicRecord, agentId: string): DynamicRecord {
  const thread = getRecord(response, "thread");
  const id = getString(thread, "id");
  if (!thread || id === null) return response;
  return { ...response, thread: { ...thread, id: `${agentId}:${id}` } };
}
