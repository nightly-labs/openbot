import { createHash } from "node:crypto";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentTask } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { z } from "zod";
import type { AgentTasks } from "../agent-tasks/agent-tasks";
import type { AgentThreadRecord } from "../agent-threads/agent-thread-store";
import { isServerWorkThread } from "./server-work-identity";
import { ToolOperationFailed, toolStep } from "./tool-operation";

const decisionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("new"),
    title: z.string().trim().min(1).max(INPUT_LIMITS.agentTaskTitle).optional(),
  }),
  z.strictObject({ kind: z.literal("existing"), taskId: z.string().trim().min(1).max(INPUT_LIMITS.identifier) }),
  z.strictObject({ kind: z.literal("main") }),
]);

export type ServerWorkRouteDecision =
  | { kind: "new"; title?: string }
  | { kind: "existing"; taskId: string }
  | { kind: "main" };

export interface ServerWorkRouteInput {
  agentId: string;
  senderAgentId: string;
  text: string;
  requestId: string;
}

export interface ServerWorkRouteCandidate {
  taskId: string;
  agentId: string;
  title: string;
  state: AgentTask["state"];
  hold: AgentTask["hold"];
  outcome: AgentTask["outcome"];
  updatedAt: string;
}

export interface ServerWorkRouteDecisionInput extends ServerWorkRouteInput {
  candidates: ServerWorkRouteCandidate[];
  /** Bounded current main-chat subject, not its transcript. */
  mainTitle?: string;
}

export interface ServerWorkRoutePlan {
  kind: "new" | "existing" | "main";
  taskId?: string;
  title?: string;
  /** The host's creation timestamp, never a value supplied by the decider. */
  generation?: string;
}

export interface ServerWorkRoutingOptions {
  tasks: AgentTasks;
  sharingScope(senderAgentId: string, recipientAgentId: string): string;
  decide(input: ServerWorkRouteDecisionInput): Effect.Effect<unknown, ToolOperationFailed>;
  mainTitle?(agentId: string): string;
}

type RouteScope = Pick<ServerWorkRouteInput, "agentId" | "senderAgentId">;

/**
 * Owns a host-only routing decision. The decider sees the incoming text and permitted work metadata,
 * never another work transcript. Its output cannot create work or grant access. The caller keeps
 * admission, task creation, enqueue and failure policy; explicit replies bypass this planner.
 */
export class ServerWorkRouting {
  readonly #options: ServerWorkRoutingOptions;

  constructor(options: ServerWorkRoutingOptions) {
    this.#options = options;
  }

  #prefix(input: RouteScope): string {
    return `openbot-work-${hash([input.agentId, this.#options.sharingScope(input.senderAgentId, input.agentId)]).slice(0, 20)}-`;
  }

  #allowed(input: RouteScope, task: AgentThreadRecord): boolean {
    return (
      task.agentId === input.agentId &&
      task.closedAt === null &&
      task.routineId === null &&
      (input.senderAgentId === input.agentId ||
        (isServerWorkThread(task.threadId) && task.threadId.startsWith(this.#prefix(input))))
    );
  }

  /** Recheck immediately before commit after any provider or attachment wait. */
  isAllowed(input: RouteScope, taskId: string): boolean {
    return (
      this.#options.tasks.has(input.agentId, taskId) &&
      this.#allowed(input, this.#options.tasks.require(input.agentId, taskId))
    );
  }

  assertAllowed(input: RouteScope, taskId: string): void {
    if (!this.isAllowed(input, taskId)) throw new Error(sourceText("error.backend.threadNotFound"));
  }

  /** A decision can wait for admission; check current scope and generation before using it. */
  isPlanCurrent(input: RouteScope, plan: ServerWorkRoutePlan): boolean {
    if (plan.kind === "main") return true;
    if (!plan.taskId) return false;
    if (plan.kind === "new") return isServerWorkThread(plan.taskId) && plan.taskId.startsWith(this.#prefix(input));
    return (
      this.isAllowed(input, plan.taskId) &&
      plan.generation !== undefined &&
      this.#options.tasks.require(input.agentId, plan.taskId).createdAt === plan.generation
    );
  }

  readonly plan = Effect.fn("ServerWorkRouting.plan")(
    function* (
      this: ServerWorkRouting,
      input: ServerWorkRouteInput,
    ): Effect.fn.Return<ServerWorkRoutePlan, ToolOperationFailed> {
      const records = this.#options.tasks
        .openTaskIds(input.agentId)
        .map((taskId) => this.#options.tasks.require(input.agentId, taskId))
        .filter((task) => this.#allowed(input, task))
        .slice(0, INPUT_LIMITS.agentTasks);
      const candidates = records.map((task): ServerWorkRouteCandidate => {
        const view = this.#options.tasks.publicTask(task);
        return {
          taskId: task.taskId,
          agentId: task.agentId,
          title: view.title,
          state: view.state,
          hold: view.hold,
          outcome: view.outcome,
          updatedAt: view.updatedAt,
        };
      });
      const listed = new Set(candidates.map((task) => task.taskId));
      const generations = new Map(records.map((task) => [task.taskId, task.createdAt]));
      const mainTitle = input.senderAgentId === input.agentId ? this.#options.mainTitle?.(input.agentId) : undefined;
      const value = yield* this.#options.decide({ ...input, candidates, ...(mainTitle ? { mainTitle } : {}) }).pipe(
        Effect.timeout("10 seconds"),
        Effect.mapError((cause) => (cause instanceof ToolOperationFailed ? cause : new ToolOperationFailed({ cause }))),
      );
      const parsed = decisionSchema.safeParse(value);
      if (!parsed.success) throw new Error("The work router returned an invalid decision.");
      const decision: ServerWorkRouteDecision = parsed.data;
      if (decision.kind === "main") return { kind: "main" };
      if (decision.kind === "existing") {
        if (!listed.has(decision.taskId)) throw new Error(sourceText("error.backend.threadNotFound"));
        yield* toolStep(() => this.assertAllowed(input, decision.taskId));
        const generation = generations.get(decision.taskId);
        if (
          generation === undefined ||
          this.#options.tasks.require(input.agentId, decision.taskId).createdAt !== generation
        )
          throw new Error(sourceText("error.backend.threadNotFound"));
        return { kind: "existing", taskId: decision.taskId, generation };
      }
      return {
        kind: "new",
        taskId: `${this.#prefix(input)}${hash([input.agentId, "route", input.senderAgentId, input.requestId]).slice(0, 40)}`,
        ...(decision.title ? { title: decision.title } : {}),
      };
    },
    Effect.catchDefect((cause) => Effect.fail(new ToolOperationFailed({ cause }))),
  );
}

function hash(parts: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
