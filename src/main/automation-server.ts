import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { type AgentSummary, agentAutomationAllowed, type Routine, type RoutineRun } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, registerSecretValue } from "@openbot/logging";
import { RoutineInputError } from "@openbot/team-client/routine-schedule";
import { Effect, Exit, Schema, Scope, Semaphore } from "effect";
import type { AgentLifecycleFailed } from "../backend/agent-service";
import { writeFileAtomically } from "../backend/atomic-json-file";
import { AUTOMATION_HEADERS_FILE, AUTOMATION_TOKEN_FILE, AUTOMATION_URL_FILE } from "../backend/automation-command";
import { causeHelpers, runCauseEffect } from "../backend/effect-boundary";
import { readBodyWithin } from "./http-body";

const logger = createOpenBotLogger("automation");

/** A script that loops can wake an agent at most this often, so it cannot spend the user's quota. */
export const AUTOMATION_RUNS_PER_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;
// A payload is at most 4,000 characters; four UTF-8 bytes each plus JSON escapes stay below this.
const BODY_LIMIT_BYTES = 32 * 1024;
const RUN_PATH = /^\/v1\/agents\/([^/]+)\/routines\/([^/]+)\/run$/;

/** A start or close that failed. It is only logged; the next `sync` tries again. */
class AutomationServerFailed extends Schema.TaggedError<AutomationServerFailed>()("AutomationServerFailed", {
  cause: Schema.Defect(),
}) {}

const { io: automationIO, rewrap: toAutomationServerFailed } = causeHelpers(AutomationServerFailed);

export interface AutomationServerOptions {
  /** The folder that holds the URL and token files. Only the user can read it. */
  root: string;
  listAgents: () => readonly Pick<AgentSummary, "id" | "name" | "allowAutomation">[];
  listRoutines: (agentId: string) => readonly Pick<Routine, "id" | "name" | "active">[];
  runRoutine: (input: {
    agentId: string;
    routineId: string;
    payload: string;
  }) => Effect.Effect<Pick<RoutineRun, "id" | "deliveryId">, AgentLifecycleFailed>;
  now?: () => number;
}

/**
 * The loopback door through which a local script runs a routine of an agent that allows it.
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
        const wanted = !this.#stopped && this.#options.listAgents().some(agentAutomationAllowed);
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
    yield* automationIO(
      () =>
        new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", () => {
            server.off("error", reject);
            resolve();
          });
        }),
    );
    const address = server.address();
    if (!address || isString(address)) {
      server.close();
      return yield* new AutomationServerFailed({ cause: new Error("Unable to bind the automation server.") });
    }
    this.#server = server;
    this.#port = address.port;
    this.#token = Buffer.from(token);
    this.#filesClean = false;
    const { root } = this.#options;
    const port = this.#port;
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
      const match = RUN_PATH.exec(path);
      if (!match?.[1] || !match[2]) return send(response, 404, { error: "not found" });
      if (request.method !== "POST") return send(response, 405, { error: "method not allowed" });
      const agentId = decodePathPart(match[1]);
      const routineId = decodePathPart(match[2]);
      if (agentId === null || routineId === null) return send(response, 404, { error: "not found" });
      await this.#run(request, response, agentId, routineId);
    } catch (error) {
      logger.warn("An automation request failed.", error);
      if (!response.headersSent) send(response, 500, { error: "internal error" });
    }
  }

  async #run(request: IncomingMessage, response: ServerResponse, agentId: string, routineId: string): Promise<void> {
    if (request.headers["content-type"]?.split(";", 1)[0]?.trim() !== "application/json") {
      return send(response, 415, { error: "Content-Type must be application/json." });
    }
    const body = await readBody(request);
    if (body === null) return send(response, 413, { error: "The request body is too large." });
    let value: unknown;
    try {
      value = body.length === 0 ? {} : JSON.parse(body);
    } catch {
      return send(response, 400, { error: "The request body is not JSON." });
    }
    const payload = isDynamicRecord(value) ? (value.payload ?? "") : null;
    if (!isString(payload)) return send(response, 400, { error: "payload must be a string." });
    if (payload.length > INPUT_LIMITS.automationPayload) {
      const error = sourceText("error.agent.automationPayloadTooLong", { limit: INPUT_LIMITS.automationPayload });
      return send(response, 413, { error });
    }
    const agent = this.#options.listAgents().find((candidate) => candidate.id === agentId);
    if (!agent) return send(response, 404, { error: "not found" });
    if (!agentAutomationAllowed(agent)) return send(response, 403, { error: sourceText("error.agent.automationOff") });
    if (!this.#options.listRoutines(agentId).some((routine) => routine.id === routineId)) {
      return send(response, 404, { error: sourceText("error.backend.routineGone") });
    }
    const now = this.#now();
    const recent = (this.#runs.get(agentId) ?? []).filter((time) => now - time < HOUR_MS);
    if (recent.length >= AUTOMATION_RUNS_PER_HOUR) {
      this.#runs.set(agentId, recent);
      const error = sourceText("error.agent.automationRateLimited", { limit: AUTOMATION_RUNS_PER_HOUR });
      return send(response, 429, { error });
    }
    // The slot is taken before the run starts, so parallel requests cannot pass the limit together.
    this.#runs.set(agentId, [...recent, now]);
    let run: Pick<RoutineRun, "id" | "deliveryId">;
    try {
      run = await runCauseEffect(this.#options.runRoutine({ agentId, routineId, payload }));
    } catch (error) {
      this.#releaseSlot(agentId, now);
      // Only a known refusal goes back to the script; another error is logged and gets a 500.
      if (error instanceof RoutineInputError) return send(response, 409, { error: error.message });
      throw error;
    }
    logger.info(`A local script ran routine ${routineId} of agent ${agentId}.`);
    send(response, 202, { runId: run.id, deliveryId: run.deliveryId });
  }

  #listAgents() {
    return this.#options
      .listAgents()
      .filter(agentAutomationAllowed)
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        routines: this.#options
          .listRoutines(agent.id)
          .map((routine) => ({ id: routine.id, name: routine.name, active: routine.active })),
      }));
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
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
