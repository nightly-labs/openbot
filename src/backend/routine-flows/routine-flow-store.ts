/**
 * The routine flow tables: links, node positions and steps. Rows are written directly, not through
 * `database.dispatch`, because a step holds the text one agent gave another and the event log is
 * never deleted from. It reads the routine runs table but never writes it. It owns no events: the
 * runtime says when something changed.
 */

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  ROUTINE_FLOW_STEP_STATUSES,
  type RoutineFlowLink,
  type RoutineFlowPosition,
  type RoutineFlowStep,
  type RoutineFlowStepStatus,
  type RoutineRunStatus,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isOneOf } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { databaseRow, databaseRows } from "../database/database-rows";
import type { OpenBotDatabase } from "../openbot-database";
import { routineFlowConnectProblem, routineFlowDepths } from "./routine-flow-graph";

/** A refusal the user reads: the text is already a sentence for them. */
export class RoutineFlowError extends Error {}

/** The parts of a routine run the runtime reads to continue its flow. */
export interface RoutineFlowRun {
  id: string;
  routineId: string;
  agentId: string;
  routineName: string;
  scheduledFor: string;
  instruction: string;
  deliveryId: string | null;
  status: RoutineRunStatus;
  error: string | null;
  createdAt: string;
}

export interface RoutineFlowStoreOptions {
  database: OpenBotDatabase;
  createId?: () => string;
}

const PROBLEM_TEXT = {
  "same-agent": "error.backend.routineFlowSameAgent",
  "into-owner": "error.backend.routineFlowIntoOwner",
  "not-on-path": "error.backend.routineFlowNotOnPath",
  duplicate: "error.backend.routineFlowDuplicate",
  cycle: "error.backend.routineFlowCycle",
} as const;

const TERMINAL_RUN_STATUSES = ["succeeded", "failed", "interrupted", "cancelled"] as const;
const RUN_STATUSES = [
  "queued",
  "running",
  "needs-attention",
  ...TERMINAL_RUN_STATUSES,
] as const satisfies readonly RoutineRunStatus[];

export class RoutineFlowStore {
  readonly #database: OpenBotDatabase;
  readonly #createId: () => string;

  constructor(options: RoutineFlowStoreOptions) {
    this.#database = options.database;
    this.#createId = options.createId ?? (() => crypto.randomUUID());
  }

  linksForRoutines(routineIds: readonly string[]): RoutineFlowLink[] {
    if (routineIds.length === 0) return [];
    return databaseRows(
      this.#database.connection
        .prepare(
          `SELECT * FROM routine_flow_links WHERE routine_id IN (${placeholders(routineIds)})
           ORDER BY created_at, link_id`,
        )
        .all(...routineIds),
    ).map(toLink);
  }

  link(linkId: string): RoutineFlowLink | null {
    const row = databaseRow(
      this.#database.connection.prepare("SELECT * FROM routine_flow_links WHERE link_id = ?").get(linkId),
    );
    return row ? toLink(row) : null;
  }

  /** Gives one link a new instruction: what the next agent is asked to do with the answer. */
  updateLinkInstruction(linkId: string, instruction: string): RoutineFlowLink {
    this.#database.connection
      .prepare("UPDATE routine_flow_links SET instruction = ? WHERE link_id = ?")
      .run(instruction.trim(), linkId);
    const link = this.link(linkId);
    if (!link) throw new RoutineFlowError(sourceText("error.backend.routineFlowLinkGone"));
    return link;
  }

  /** The agent a routine belongs to, or null when the routine is gone. */
  routineOwner(routineId: string): string | null {
    const row = databaseRow(
      this.#database.connection
        .prepare("SELECT agent_id FROM projection_agent_routines WHERE routine_id = ?")
        .get(routineId),
    );
    return row ? String(row.agent_id) : null;
  }

  /** Every routine with a link that starts or ends at this agent. */
  routineIdsTouching(agentId: string): string[] {
    return databaseRows(
      this.#database.connection
        .prepare(
          "SELECT DISTINCT routine_id FROM routine_flow_links WHERE from_agent_id = ? OR to_agent_id = ? ORDER BY routine_id",
        )
        .all(agentId, agentId),
    ).map((row) => String(row.routine_id));
  }

  /** Adds one handoff to a routine whose own agent is `ownerAgentId`, after the flow rules accept it. */
  createLink(
    ownerAgentId: string,
    input: { routineId: string; fromAgentId: string; toAgentId: string; instruction?: string },
    now = new Date().toISOString(),
  ): RoutineFlowLink {
    return this.#transaction(() => {
      const links = this.linksForRoutines([input.routineId]);
      if (links.length >= INPUT_LIMITS.routineFlowLinks)
        throw new RoutineFlowError(
          sourceText("error.backend.routineFlowLinkLimit", { limit: INPUT_LIMITS.routineFlowLinks }),
        );
      const problem = routineFlowConnectProblem(ownerAgentId, links, input.fromAgentId, input.toAgentId);
      if (problem) throw new RoutineFlowError(sourceText(PROBLEM_TEXT[problem]));
      const link: RoutineFlowLink = {
        id: this.#createId(),
        routineId: input.routineId,
        fromAgentId: input.fromAgentId,
        toAgentId: input.toAgentId,
        instruction: input.instruction?.trim() ?? "",
        createdAt: now,
      };
      this.#database.connection
        .prepare(
          `INSERT INTO routine_flow_links (link_id, routine_id, from_agent_id, to_agent_id, instruction, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(link.id, link.routineId, link.fromAgentId, link.toAgentId, link.instruction, link.createdAt);
      return link;
    });
  }

  /**
   * Removes a link, and every link of the same routine that only it kept on the flow: an agent the
   * flow no longer reaches would otherwise hand work on from nowhere.
   */
  deleteLink(linkId: string, ownerAgentId: (routineId: string) => string | null): RoutineFlowLink[] {
    return this.#transaction(() => {
      const row = databaseRow(
        this.#database.connection.prepare("SELECT * FROM routine_flow_links WHERE link_id = ?").get(linkId),
      );
      if (!row) throw new RoutineFlowError(sourceText("error.backend.routineFlowLinkGone"));
      const link = toLink(row);
      const owner = ownerAgentId(link.routineId);
      let remaining = this.linksForRoutines([link.routineId]).filter((candidate) => candidate.id !== link.id);
      const removed = [link];
      // Each pass strands at least one link or stops, so this ends within the routine's link count.
      for (
        let stranded = strandedLinks(owner, remaining);
        stranded.length > 0;
        stranded = strandedLinks(owner, remaining)
      ) {
        removed.push(...stranded);
        remaining = remaining.filter((candidate) => !stranded.includes(candidate));
      }
      const remove = this.#database.connection.prepare("DELETE FROM routine_flow_links WHERE link_id = ?");
      for (const gone of removed) remove.run(gone.id);
      return removed;
    });
  }

  positions(canvasAgentId: string): RoutineFlowPosition[] {
    return databaseRows(
      this.#database.connection
        .prepare("SELECT node_key, x, y FROM routine_flow_positions WHERE canvas_agent_id = ? ORDER BY node_key")
        .all(canvasAgentId),
    ).map((row) => ({ nodeKey: String(row.node_key), x: Number(row.x), y: Number(row.y) }));
  }

  savePosition(canvasAgentId: string, nodeKey: string, x: number, y: number, now = new Date().toISOString()): void {
    this.#database.connection
      .prepare(
        `INSERT INTO routine_flow_positions (canvas_agent_id, node_key, x, y, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(canvas_agent_id, node_key) DO UPDATE SET x = excluded.x, y = excluded.y,
           updated_at = excluded.updated_at`,
      )
      .run(canvasAgentId, nodeKey, x, y, now);
  }

  removePosition(canvasAgentId: string, nodeKey: string): void {
    this.#database.connection
      .prepare("DELETE FROM routine_flow_positions WHERE canvas_agent_id = ? AND node_key = ?")
      .run(canvasAgentId, nodeKey);
  }

  steps(runId: string): RoutineFlowStep[] {
    return databaseRows(
      this.#database.connection
        .prepare("SELECT * FROM routine_flow_steps WHERE run_id = ? ORDER BY created_at, step_id")
        .all(runId),
    ).map(toStep);
  }

  stepForDelivery(deliveryId: string): RoutineFlowStep | null {
    const row = databaseRow(
      this.#database.connection.prepare("SELECT * FROM routine_flow_steps WHERE delivery_id = ?").get(deliveryId),
    );
    return row ? toStep(row) : null;
  }

  runningSteps(): RoutineFlowStep[] {
    return databaseRows(
      this.#database.connection
        .prepare("SELECT * FROM routine_flow_steps WHERE status = 'running' ORDER BY created_at, step_id")
        .all(),
    ).map(toStep);
  }

  /**
   * Adds one agent's step to a run, once: a second call for the same agent and run answers null, so
   * two events about one answer never send it on twice.
   */
  addStep(
    input: {
      runId: string;
      agentId: string;
      input: string;
      status: RoutineFlowStepStatus;
      output?: string | null;
      error?: string | null;
    },
    now = new Date().toISOString(),
  ): RoutineFlowStep | null {
    const id = this.#createId();
    const result = this.#database.connection
      .prepare(
        `INSERT OR IGNORE INTO routine_flow_steps
           (step_id, run_id, agent_id, delivery_id, input, output, status, error, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.runId,
        input.agentId,
        input.input,
        input.output ?? null,
        input.status,
        input.error ?? null,
        now,
        now,
      );
    if (Number(result.changes) === 0) return null;
    return this.steps(input.runId).find((step) => step.id === id) ?? null;
  }

  attachDelivery(stepId: string, deliveryId: string, now = new Date().toISOString()): void {
    this.#database.connection
      .prepare("UPDATE routine_flow_steps SET delivery_id = ?, updated_at = ? WHERE step_id = ?")
      .run(deliveryId, now, stepId);
  }

  /** Ends a running step. A step that already ended keeps what it has. */
  settleStep(
    stepId: string,
    status: Exclude<RoutineFlowStepStatus, "running">,
    output: string | null,
    error: string | null,
    now = new Date().toISOString(),
  ): boolean {
    const result = this.#database.connection
      .prepare(
        `UPDATE routine_flow_steps SET status = ?, output = ?, error = ?, updated_at = ?
         WHERE step_id = ? AND status = 'running'`,
      )
      .run(status, output, error, now, stepId);
    return Number(result.changes) > 0;
  }

  /** Ids of the runs whose flow changed since `since`: the ones that may have a next step to send. */
  runIdsWithStepsSince(since: string): string[] {
    return databaseRows(
      this.#database.connection
        .prepare("SELECT DISTINCT run_id FROM routine_flow_steps WHERE updated_at >= ? ORDER BY run_id")
        .all(since),
    ).map((row) => String(row.run_id));
  }

  /** Runs that ended since `since` and whose own agent has no step yet. */
  endedRunsWithoutOwnerStep(since: string): RoutineFlowRun[] {
    return databaseRows(
      this.#database.connection
        .prepare(
          `SELECT * FROM projection_routine_runs AS run
           WHERE run.status IN (${placeholders(TERMINAL_RUN_STATUSES)}) AND run.updated_at >= ?
             AND NOT EXISTS (
               SELECT 1 FROM routine_flow_steps AS step WHERE step.run_id = run.run_id AND step.agent_id = run.agent_id
             )
           ORDER BY run.updated_at, run.run_id`,
        )
        .all(...TERMINAL_RUN_STATUSES, since),
    ).map(toRun);
  }

  run(runId: string): RoutineFlowRun | null {
    const row = databaseRow(
      this.#database.connection.prepare("SELECT * FROM projection_routine_runs WHERE run_id = ?").get(runId),
    );
    return row ? toRun(row) : null;
  }

  #transaction<T>(work: () => T): T {
    const db = this.#database.connection;
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      // SQLite may have rolled back already, and a second ROLLBACK would replace the error that did it.
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }
}

/** The links whose sending agent the flow no longer reaches. Without an owner, there is no flow to keep. */
function strandedLinks(owner: string | null, links: readonly RoutineFlowLink[]): RoutineFlowLink[] {
  if (!owner) return [];
  const reached = routineFlowDepths(owner, links);
  return links.filter((link) => !reached.has(link.fromAgentId));
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function toLink(row: DynamicRecord): RoutineFlowLink {
  return {
    id: String(row.link_id),
    routineId: String(row.routine_id),
    fromAgentId: String(row.from_agent_id),
    toAgentId: String(row.to_agent_id),
    instruction: String(row.instruction),
    createdAt: String(row.created_at),
  };
}

function toStep(row: DynamicRecord): RoutineFlowStep {
  return {
    id: String(row.step_id),
    runId: String(row.run_id),
    agentId: String(row.agent_id),
    deliveryId: nullableString(row.delivery_id),
    input: String(row.input),
    output: nullableString(row.output),
    // The CHECK constraint holds the column to these values; the guard only narrows the type.
    status: isOneOf(ROUTINE_FLOW_STEP_STATUSES, row.status) ? row.status : "failed",
    error: nullableString(row.error),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toRun(row: DynamicRecord): RoutineFlowRun {
  return {
    id: String(row.run_id),
    routineId: String(row.routine_id),
    agentId: String(row.agent_id),
    routineName: String(row.routine_name),
    scheduledFor: String(row.scheduled_for),
    instruction: String(row.instruction),
    deliveryId: nullableString(row.delivery_id),
    status: isOneOf(RUN_STATUSES, row.status) ? row.status : "failed",
    error: nullableString(row.error),
    createdAt: String(row.created_at),
  };
}
