import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AgentDefaults,
  type AgentModelOption,
  type AgentSummary,
  agentAutomationAllowed,
  isAgentModel,
  isAgentProvider,
  isProviderAccountId,
  isReasoningEffort,
  type QueueDelivery,
  type Routine,
  type RoutineRun,
  type UpdateAgentInput,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { ContextResetBusyError } from "@openbot/contracts/team-protocol/context-reset-v1";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, registerSecretValue, toLogValue } from "@openbot/logging";
import { RoutineInputError } from "@openbot/team-client/routine-schedule";
import { Effect, Exit, Schema, Scope, Semaphore } from "effect";
import { AgentSettingsRefused } from "../backend/agent/agent-settings-refused";
import { InactiveAttentionRequest } from "../backend/agent/inactive-attention-request";
import { type ModelRequest, requestedRuntime } from "../backend/agent/model-tools";
import type { AgentLifecycleFailed, AgentService } from "../backend/agent-service";
import { writeFileAtomically } from "../backend/atomic-json-file";
import { AUTOMATION_HEADERS_FILE, AUTOMATION_TOKEN_FILE, AUTOMATION_URL_FILE } from "../backend/automation-command";
import { causeHelpers, runCauseEffect } from "../backend/effect-boundary";
import { readBodyWithin } from "./http-body";
import { listenLoopback } from "./listen-loopback";
import { HttpError } from "./team-api/http-error";
import { approvalDecision, promptAnswers } from "./team-api/request-helpers";

const logger = createOpenBotLogger("automation");

/** A script that loops can wake an agent at most this often, so it cannot spend the user's quota. */
const AUTOMATION_RUNS_PER_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;
// A payload is at most 4,000 characters; four UTF-8 bytes each plus JSON escapes stay below this.
const BODY_LIMIT_BYTES = 32 * 1024;
const RUN_PATH = /^\/v1\/agents\/([^/]+)\/routines\/([^/]+)\/run$/;
const AGENT_PATH =
  /^\/v1\/agents\/([^/]+)\/(messages|pending|settings|context\/clear|deliveries\/([^/]+)|prompts\/([^/]+)\/answer|approvals\/([^/]+)\/respond)$/;
/** A delivery in one of these states has no more work. Its turn's answer is final. */
const ENDED_DELIVERY_STATUSES: ReadonlySet<QueueDelivery["status"]> = new Set([
  "completed",
  "failed",
  "interrupted",
  "cancelled",
]);

/** A start or close that failed. It is only logged; the next `sync` tries again. */
class AutomationServerFailed extends Schema.TaggedError<AutomationServerFailed>()("AutomationServerFailed", {
  cause: Schema.Defect(),
}) {}

const { io: automationIO, rewrap: toAutomationServerFailed } = causeHelpers(AutomationServerFailed);

/** The fields of an updated agent that a script reads back. */
export type UpdatedAgent = Pick<
  AgentSummary,
  "id" | "name" | "provider" | "model" | "reasoningEffort" | "providerAccountId"
>;

export interface AutomationServerOptions {
  /** The folder that holds the URL and token files. Only the user can read it. */
  root: string;
  listAgents: () => readonly Pick<
    AgentSummary,
    "id" | "name" | "allowAutomation" | "hiddenAt" | "provider" | "model" | "reasoningEffort"
  >[];
  /** The account defaults; an agent with no automation setting of its own follows them. */
  agentDefaults: () => AgentDefaults;
  /** The models that the provider CLIs list now. */
  listModels: () => AgentModelOption[];
  listRoutines: (agentId: string) => readonly Pick<Routine, "id" | "name" | "active">[];
  runRoutine: (input: {
    agentId: string;
    routineId: string;
    payload: string;
    /** The open wait the event continues. Absent: the run wakes every wait it matches. */
    waitId?: string;
  }) => Effect.Effect<Pick<RoutineRun, "id" | "deliveryId">, AgentLifecycleFailed>;
  now?: () => number;
  sendMessage: AgentService["sendMessage"];
  getLocalAttention: AgentService["getLocalAttention"];
  respondToLocalAttention: AgentService["respondToLocalAttention"];
  /** A delivery by its ID, or null when it is gone. */
  delivery: (deliveryId: string) => Pick<QueueDelivery, "recipientAgentId" | "status" | "turnId" | "error"> | null;
  /** The answer an agent gave in one turn, or null when it gave none. */
  turnAnswer: (agentId: string, turnId: string) => string | null;
  /** The same update as the agent's settings. It refuses a provider or account change while the agent works. */
  updateAgent: (input: UpdateAgentInput) => Effect.Effect<UpdatedAgent, { readonly cause: unknown }>;
  /** The same as **New chat** in the agent's settings. It fails with `ContextResetBusyError` while the agent works. */
  clearAgentContext: (agentId: string) => Effect.Effect<void, { readonly cause: unknown }>;
}

/**
 * The loopback API for local scripts that work with an enabled agent.
 *
 * It listens only while at least one agent allows local scripts. A caller proves that it runs as
 * this OS user by reading the token file; the token changes at each start. A request with an
 * `Origin` header or a foreign `Host` is refused before the token is read, so a web page cannot
 * reach it through DNS rebinding. It never shows or focuses a window.
 */
export class AutomationServer {
  readonly #options: AutomationServerOptions;
  readonly #now: () => number;
  /** The run times of each agent in the last hour. */
  readonly #runs = new Map<string, number[]>();
  #server: Server | null = null;
  #port = 0;
  #token: Buffer = Buffer.alloc(0);
  /** One state change at a time, in the order the calls came. */
  readonly #lock = Semaphore.makeUnsafe(1);
  /** The background syncs that `requestSync` starts; `stop` interrupts those that still wait. */
  readonly #scope = Scope.makeUnsafe();
  #stopped = false;
  /** False until the first close, which also removes files that a crash left behind. */
  #filesClean = false;

  constructor(options: AutomationServerOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  /** Starts or stops the listener to match the agents' setting. Calls run in order. Never fails. */
  readonly sync = Effect.fn("AutomationServer.sync")(function* (this: AutomationServer) {
    yield* this.#step(
      Effect.suspend(() => {
        const wanted =
          !this.#stopped &&
          this.#options.listAgents().some((agent) => agentAutomationAllowed(agent, this.#options.agentDefaults()));
        if (wanted && !this.#server) return this.#start();
        if (!wanted) return this.#close();
        return Effect.void;
      }),
    );
  }).bind(this);

  /** Starts a `sync` that nobody waits for. `stop` interrupts it while it waits for its turn. */
  readonly requestSync = Effect.fn("AutomationServer.requestSync")(function* (this: AutomationServer) {
    yield* Effect.forkIn(this.sync(), this.#scope, { startImmediately: true });
  }).bind(this);

  readonly stop = Effect.fn("AutomationServer.stop")(function* (this: AutomationServer) {
    this.#stopped = true;
    yield* Scope.close(this.#scope, Exit.void);
    yield* this.#step(this.#close());
  }).bind(this);

  /** Never fails: a failed start is logged, and the next `sync` tries again. */
  #step(step: Effect.Effect<void, AutomationServerFailed>): Effect.Effect<void> {
    return this.#lock.withPermit(
      step.pipe(
        Effect.catch((error) =>
          Effect.sync(() => logger.warn("The automation server could not change state.", error.cause)),
        ),
        // A step that started finishes, so the files and the listener always agree.
        Effect.uninterruptible,
      ),
    );
  }

  readonly #start = Effect.fn("AutomationServer.start")(function* (this: AutomationServer) {
    const token = randomBytes(32).toString("base64url");
    registerSecretValue(token);
    const server = createServer((request, response) => void this.#handle(request, response));
    const port = yield* automationIO(() =>
      listenLoopback(server, () => new Error("Unable to bind the automation server.")),
    );
    this.#server = server;
    this.#port = port;
    this.#token = Buffer.from(token);
    this.#filesClean = false;
    const { root } = this.#options;
    yield* Effect.gen(function* () {
      yield* automationIO(() => mkdir(root, { recursive: true, mode: 0o700 }));
      // `mkdir` keeps the mode of a folder that already exists.
      if (process.platform !== "win32") yield* automationIO(() => chmod(root, 0o700));
      // The token first: a script that finds the new URL also finds the token that goes with it.
      yield* writeAutomationFile(join(root, AUTOMATION_TOKEN_FILE), token);
      yield* writeAutomationFile(join(root, AUTOMATION_HEADERS_FILE), `Authorization: Bearer ${token}\n`);
      yield* writeAutomationFile(join(root, AUTOMATION_URL_FILE), `http://127.0.0.1:${port}`);
    }).pipe(
      // Closed, so that the next `sync` starts again instead of keeping a door nobody can find.
      Effect.catch((error) => Effect.andThen(this.#close(), Effect.fail(error))),
    );
    logger.info(`The automation server listens on port ${this.#port}.`);
  }).bind(this);

  readonly #close = Effect.fn("AutomationServer.close")(function* (this: AutomationServer) {
    const server = this.#server;
    if (!server && this.#filesClean) return;
    this.#server = null;
    this.#token = Buffer.alloc(0);
    this.#runs.clear();
    const { root } = this.#options;
    yield* automationIO(() =>
      Promise.all(
        [AUTOMATION_URL_FILE, AUTOMATION_TOKEN_FILE, AUTOMATION_HEADERS_FILE].map((name) =>
          rm(join(root, name), { force: true }),
        ),
      ),
    );
    this.#filesClean = true;
    if (!server) return;
    server.closeAllConnections();
    yield* Effect.callback<void>((resume) => {
      server.close(() => resume(Effect.void));
    });
    logger.info("The automation server stopped.");
  }).bind(this);

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (request.headers.host !== `127.0.0.1:${this.#port}` || request.headers.origin !== undefined) {
        return send(response, 403, { error: "forbidden" });
      }
      if (!this.#authorized(request.headers.authorization)) return send(response, 401, { error: "unauthorized" });
      const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      if (path === "/v1/agents") {
        if (request.method !== "GET") return send(response, 405, { error: "method not allowed" });
        return send(response, 200, this.#listAgents());
      }
      const agentMatch = AGENT_PATH.exec(path);
      if (agentMatch?.[1] && agentMatch[2]) {
        const agentId = decodePathPart(agentMatch[1]);
        if (agentId === null) return send(response, 404, { error: "not found" });
        await this.#agentRequest(
          request,
          response,
          agentId,
          agentMatch[2],
          agentMatch[3] ?? agentMatch[4] ?? agentMatch[5],
        );
        return;
      }
      const match = RUN_PATH.exec(path);
      if (!match?.[1] || !match[2]) return send(response, 404, { error: "not found" });
      if (request.method !== "POST") return send(response, 405, { error: "method not allowed" });
      const agentId = decodePathPart(match[1]);
      const routineId = decodePathPart(match[2]);
      if (agentId === null || routineId === null) return send(response, 404, { error: "not found" });
      await this.#run(request, response, agentId, routineId);
    } catch (error) {
      if (error instanceof HttpError) return send(response, error.status, { error: error.message });
      if (error instanceof InactiveAttentionRequest) return send(response, 409, { error: error.message });
      if (error instanceof AgentSettingsRefused) return send(response, 409, { error: error.message });
      if (error instanceof ContextResetBusyError) return send(response, 409, { error: error.message });
      logger.warn("An automation request failed.", error);
      if (!response.headersSent) send(response, 500, { error: "internal error" });
    }
  }

  async #agentRequest(
    request: IncomingMessage,
    response: ServerResponse,
    agentId: string,
    route: string,
    encodedRequestId: string | undefined,
  ): Promise<void> {
    this.#requireAgent(agentId);
    if (route.startsWith("deliveries/")) {
      if (request.method !== "GET") return send(response, 405, { error: "method not allowed" });
      const deliveryId = encodedRequestId === undefined ? null : decodePathPart(encodedRequestId);
      if (!deliveryId) return send(response, 404, { error: "not found" });
      return send(response, 200, this.#deliveryResult(agentId, deliveryId));
    }
    if (route === "pending") {
      if (request.method !== "GET") return send(response, 405, { error: "method not allowed" });
      const pending = this.#options.getLocalAttention(agentId);
      return send(response, 200, {
        ...pending,
        prompts: pending.prompts.map((prompt) => ({
          ...prompt,
          questions: prompt.requiresOpenBot
            ? []
            : prompt.questions.map(({ id, header, question, options }) => ({ id, header, question, options })),
        })),
      });
    }
    if (request.method !== "POST") return send(response, 405, { error: "method not allowed" });
    if (route === "context/clear") {
      // No body: the agent is the whole request, and the busy refusal comes back as 409.
      await runCauseEffect(this.#options.clearAgentContext(agentId));
      logger.info(`A local script started a new chat with agent ${agentId}.`);
      return send(response, 200, { ok: true });
    }
    const value = await readJson(request);
    // The setting can change while the script uploads its body.
    const agent = this.#requireAgent(agentId);
    if (route === "settings") {
      const { runtime, providerAccountId } = settingsRequest(value);
      // The same resolution as the agent's `update_profile` tool: a model names its provider, and an
      // effort that the new model does not support is refused or replaced by the model's default.
      const input: UpdateAgentInput = {
        agentId,
        ...requestedRuntime(agent, runtime, this.#options.listModels()),
        ...(providerAccountId === undefined ? {} : { providerAccountId }),
      };
      const updated = await runCauseEffect(this.#options.updateAgent(input));
      logger.info(`A local script changed the settings of agent ${agentId}.`);
      return send(response, 200, {
        id: updated.id,
        name: updated.name,
        provider: updated.provider,
        model: updated.model,
        reasoningEffort: updated.reasoningEffort,
        providerAccountId: updated.providerAccountId ?? null,
      });
    }
    if (route === "messages") {
      const text = requiredString(value, "text", INPUT_LIMITS.messageText);
      const clientMessageId = requiredString(value, "clientMessageId", INPUT_LIMITS.identifier);
      this.#requireNotHidden(agentId);
      const now = this.#takeSlot(agentId);
      try {
        // Separate script retry keys from local UI retry keys without inventing a team member.
        const receipt = await runCauseEffect(
          this.#options.sendMessage({ agentId, text, clientMessageId: `automation:${clientMessageId}` }),
        );
        return send(response, 202, receipt);
      } catch (error) {
        this.#releaseSlot(agentId, now);
        throw error;
      }
    }
    const requestId = encodedRequestId === undefined ? null : decodePathPart(encodedRequestId);
    if (!requestId || requestId.length > INPUT_LIMITS.identifier) throw new HttpError(400, "requestId is invalid.");
    const input = route.startsWith("prompts/")
      ? { kind: "prompt" as const, requestId, answers: promptAnswers(value.answers) }
      : { kind: "approval" as const, requestId, decision: approvalDecision(value.decision) };
    await runCauseEffect(this.#options.respondToLocalAttention(agentId, input));
    send(response, 200, { ok: true });
  }

  /** The state of one message delivery to this agent, and the turn's answer once the delivery ended. */
  #deliveryResult(agentId: string, deliveryId: string) {
    const delivery = this.#options.delivery(deliveryId);
    if (!delivery || delivery.recipientAgentId !== agentId) throw new HttpError(404, "not found");
    const ended = ENDED_DELIVERY_STATUSES.has(delivery.status);
    return {
      id: deliveryId,
      status: delivery.status,
      turnId: delivery.turnId,
      error: delivery.error,
      answer: ended && delivery.turnId ? this.#options.turnAnswer(agentId, delivery.turnId) : null,
    };
  }

  /**
   * A hidden agent takes no new work: no message and no routine run. An answer to a prompt or an
   * approval of a turn that already runs is still accepted.
   */
  #requireNotHidden(agentId: string): void {
    if (this.#options.listAgents().some((agent) => agent.id === agentId && agent.hiddenAt !== undefined))
      throw new HttpError(409, sourceText("error.backend.recipientHidden"));
  }

  #requireAgent(agentId: string, routine = false) {
    const agent = this.#options.listAgents().find((candidate) => candidate.id === agentId);
    if (!agent) throw new HttpError(404, "not found");
    if (!agentAutomationAllowed(agent, this.#options.agentDefaults()))
      throw new HttpError(
        403,
        routine ? sourceText("error.agent.automationOff") : sourceText("error.agent.localScriptsOff"),
      );
    return agent;
  }

  async #run(request: IncomingMessage, response: ServerResponse, agentId: string, routineId: string): Promise<void> {
    const value = await readJson(request);
    const payload = value.payload ?? "";
    if (!isString(payload)) return send(response, 400, { error: "payload must be a string." });
    const waitId = value.waitId;
    if (waitId !== undefined && (!isString(waitId) || !waitId || waitId.length > INPUT_LIMITS.identifier))
      return send(response, 400, { error: "waitId must be a wait id." });
    if (payload.length > INPUT_LIMITS.automationPayload) {
      const error = sourceText("error.agent.automationPayloadTooLong", { limit: INPUT_LIMITS.automationPayload });
      return send(response, 413, { error });
    }
    this.#requireAgent(agentId, true);
    this.#requireNotHidden(agentId);
    if (!this.#options.listRoutines(agentId).some((routine) => routine.id === routineId)) {
      return send(response, 404, { error: sourceText("error.backend.routineGone") });
    }
    const now = this.#takeSlot(agentId, true);
    let run: Pick<RoutineRun, "id" | "deliveryId">;
    try {
      run = await runCauseEffect(
        this.#options.runRoutine({ agentId, routineId, payload, ...(waitId === undefined ? {} : { waitId }) }),
      );
    } catch (error) {
      this.#releaseSlot(agentId, now);
      // Only a known refusal goes back to the script; another error is logged and gets a 500.
      if (error instanceof RoutineInputError) return send(response, 409, { error: error.message });
      throw error;
    }
    logger.info(`A local script ran routine ${routineId} of agent ${agentId}.`);
    send(response, 202, { runId: run.id, deliveryId: run.deliveryId });
  }

  #takeSlot(agentId: string, routine = false): number {
    const now = this.#now();
    const recent = (this.#runs.get(agentId) ?? []).filter((time) => now - time < HOUR_MS);
    this.#runs.set(agentId, recent);
    if (recent.length >= AUTOMATION_RUNS_PER_HOUR) {
      const params = { limit: AUTOMATION_RUNS_PER_HOUR };
      throw new HttpError(
        429,
        routine
          ? sourceText("error.agent.automationRateLimited", params)
          : sourceText("error.agent.localScriptsRateLimited", params),
      );
    }
    recent.push(now);
    return now;
  }

  #listAgents() {
    return (
      this.#options
        .listAgents()
        // A hidden agent takes no new work, so a script does not see it until it is restored.
        .filter((agent) => agentAutomationAllowed(agent, this.#options.agentDefaults()) && agent.hiddenAt === undefined)
        .map((agent) => ({
          id: agent.id,
          name: agent.name,
          routines: this.#options
            .listRoutines(agent.id)
            .map((routine) => ({ id: routine.id, name: routine.name, active: routine.active })),
        }))
    );
  }

  #releaseSlot(agentId: string, time: number): void {
    const runs = this.#runs.get(agentId);
    const index = runs?.indexOf(time) ?? -1;
    if (runs && index >= 0) runs.splice(index, 1);
  }

  #authorized(header: string | undefined): boolean {
    if (!header?.startsWith("Bearer ") || this.#token.length === 0) return false;
    const candidate = Buffer.from(header.slice(7));
    return candidate.length === this.#token.length && timingSafeEqual(candidate, this.#token);
  }
}

function writeAutomationFile(path: string, content: string): Effect.Effect<void, AutomationServerFailed> {
  return writeFileAtomically(path, content).pipe(toAutomationServerFailed);
}

/** A path segment, or null when its percent encoding is not valid. */
function decodePathPart(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** The body as text, or null when it is larger than the limit. */
async function readBody(request: IncomingMessage): Promise<string | null> {
  const body = await readBodyWithin(request, BODY_LIMIT_BYTES);
  return body === null ? null : body.toString("utf8");
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(toLogValue(body)));
}

async function readJson(request: IncomingMessage): Promise<DynamicRecord> {
  if (request.headers["content-type"]?.split(";", 1)[0]?.trim() !== "application/json") {
    throw new HttpError(415, "Content-Type must be application/json.");
  }
  const body = await readBody(request);
  if (body === null) throw new HttpError(413, "The request body is too large.");
  let value: unknown;
  try {
    value = body.length === 0 ? {} : JSON.parse(body);
  } catch {
    throw new HttpError(400, "The request body is not JSON.");
  }
  if (!isDynamicRecord(value)) throw new HttpError(400, "The request body must be an object.");
  return value;
}

/**
 * The model and account fields of an update. Name, permissions and Local scripts itself stay in the
 * app: a script can choose how an agent runs, not who it is or what it may do.
 */
function settingsRequest(value: DynamicRecord): {
  runtime: ModelRequest;
  providerAccountId: UpdateAgentInput["providerAccountId"];
} {
  const { provider, model, reasoningEffort, providerAccountId, ...rest } = value;
  if (Object.keys(rest).length > 0) throw new HttpError(400, `${Object.keys(rest)[0]} cannot be changed here.`);
  if (provider !== undefined && !isAgentProvider(provider)) throw new HttpError(400, "provider is invalid.");
  if (model !== undefined && !isAgentModel(model)) throw new HttpError(400, "model is invalid.");
  if (reasoningEffort !== undefined && !isReasoningEffort(reasoningEffort))
    throw new HttpError(400, "reasoningEffort is invalid.");
  if (providerAccountId !== undefined && providerAccountId !== null && !isProviderAccountId(providerAccountId))
    throw new HttpError(400, "providerAccountId is invalid.");
  if (provider === undefined && model === undefined && reasoningEffort === undefined && providerAccountId === undefined)
    throw new HttpError(400, "Send provider, model, reasoningEffort or providerAccountId.");
  return { runtime: { provider, model, reasoningEffort }, providerAccountId };
}

function requiredString(value: DynamicRecord, key: string, limit: number): string {
  const text = value[key];
  if (!isString(text) || !text.trim() || text.length > limit) throw new HttpError(400, `${key} is invalid.`);
  return text;
}
