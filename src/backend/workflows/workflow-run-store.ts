/**
 * The run tables of workflows: runs and the steps of each run, and steps that ran alone. Rows are
 * written directly, like the graph tables. Each change of a step is conditional on the status it
 * leaves, so two sweeps, or a sweep and a user action, never both settle one step.
 */

import {
  isWorkflowGraph,
  WORKFLOW_BRANCHES,
  WORKFLOW_NODE_KINDS,
  WORKFLOW_RUN_SOURCES,
  WORKFLOW_RUN_STATUSES,
  WORKFLOW_STEP_STATUSES,
  type WorkflowBranch,
  type WorkflowGraph,
  type WorkflowNodeKind,
  type WorkflowRun,
  type WorkflowRunPage,
  type WorkflowRunSource,
  type WorkflowRunStatus,
  type WorkflowStep,
  type WorkflowStepStatus,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isOneOf } from "@openbot/contracts/runtime-values";
import {
  checkedColumn,
  databaseRow,
  databaseRows,
  optionalStringColumn,
  placeholders,
  requiredNumberColumn,
  requiredStringColumn,
} from "../database/database-rows";
import type { OpenBotDatabase } from "../openbot-database";
import { webhookReceiptCutoff } from "../webhook-route-store";
import { workflowTransaction } from "./workflow-transaction";

/** A run as the runtime reads it: the public row and the graph it started from. */
export interface StoredWorkflowRun extends WorkflowRun {
  graph: WorkflowGraph;
  fromNodeId: string | null;
  scheduledFor: string | null;
  payload: string | null;
}

/** A step as the runtime reads it: the public row and what the runtime alone needs. */
export interface StoredWorkflowStep extends WorkflowStep {
  kind: WorkflowNodeKind;
  input: string;
  deliveryId: string | null;
  turnId: string | null;
  createdAt: string;
  /** The order in which the steps of a run were added: a later step has a larger number. */
  sequence: number;
}

const OPEN_STEP_STATUSES = ["running", "approval"] as const satisfies readonly WorkflowStepStatus[];
/** Whether a step has not ended yet. */
export function isOpenStep(step: Pick<WorkflowStep, "status">): boolean {
  return isOneOf(OPEN_STEP_STATUSES, step.status);
}
const OPEN_RUN_STATUSES = ["running", "approval", "stopping"] as const satisfies readonly WorkflowRunStatus[];

/** One delivery that a webhook trigger received: the run it started, or why it started none. */
export interface WorkflowWebhookReceipt {
  workflowId: string;
  nodeId: string;
  deliveryId: string;
  status: "started" | "ignored";
  reason: "busy" | "refused" | null;
  runId: string | null;
  receivedAt: string;
}

const OUTPUT_STATUSES = ["pending", "sending", "sent", "failed", "uncertain"] as const;
export type WorkflowOutputEnd = Exclude<(typeof OUTPUT_STATUSES)[number], "pending" | "sending">;

/**
 * The post of an output step to a messaging place. `sending` is set before the post starts, so a
 * post that a stop or a crash cut off becomes `uncertain`: part of it can be in the place.
 */
export interface WorkflowOutputDelivery {
  stepId: string;
  connectionId: string;
  placeId: string;
  text: string;
  status: (typeof OUTPUT_STATUSES)[number];
  reason: string | null;
}

export interface NewWorkflowRun {
  workflowId: string;
  triggerNodeId: string | null;
  fromNodeId: string | null;
  source: WorkflowRunSource;
  scheduledFor: string | null;
  idempotencyKey: string;
  revision: number;
  graph: WorkflowGraph;
  payload: string | null;
}

export interface NewWorkflowStep {
  workflowId: string;
  runId: string | null;
  nodeId: string;
  kind: WorkflowNodeKind;
  requestId: string;
  agentId: string | null;
  status: WorkflowStepStatus;
  input: string;
  output?: string | null;
  branch?: WorkflowBranch | null;
  error?: string | null;
}

export interface WorkflowStepEnd {
  status: Exclude<WorkflowStepStatus, "running" | "approval">;
  output?: string | null;
  branch?: WorkflowBranch | null;
  error?: string | null;
}

export class WorkflowRunStore {
  readonly #database: OpenBotDatabase;
  readonly #createId: () => string;

  constructor(options: { database: OpenBotDatabase; createId?: () => string }) {
    this.#database = options.database;
    this.#createId = options.createId ?? (() => crypto.randomUUID());
  }

  /**
   * Starts a run, or answers the run that the same key already started. `created` writes what belongs
   * to a new run, such as its version and its first steps, in the same transaction.
   */
  startRun(
    input: NewWorkflowRun,
    now = new Date(),
    created: (run: StoredWorkflowRun) => void = () => {},
  ): { run: StoredWorkflowRun; created: boolean } {
    return this.#transaction(() => {
      const db = this.#database.connection;
      const existing = databaseRow(
        db
          .prepare("SELECT run_id FROM workflow_runs WHERE workflow_id = ? AND idempotency_key = ?")
          .get(input.workflowId, input.idempotencyKey),
      );
      if (existing) {
        const run = this.run(requiredStringColumn(existing, "run_id"));
        if (run) return { run, created: false };
      }
      const numbered = databaseRow(
        db
          .prepare(
            "UPDATE workflows SET next_run_number = next_run_number + 1 WHERE workflow_id = ? RETURNING next_run_number - 1 AS number",
          )
          .get(input.workflowId),
      );
      if (!numbered) throw new Error("The workflow of a new run does not exist.");
      const runId = this.#createId();
      const at = now.toISOString();
      db.prepare(
        `INSERT INTO workflow_runs (run_id, workflow_id, number, trigger_node_id, from_node_id, source, scheduled_for,
          idempotency_key, graph_revision, graph_json, payload, status, started_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)`,
      ).run(
        runId,
        input.workflowId,
        requiredNumberColumn(numbered, "number"),
        input.triggerNodeId,
        input.fromNodeId,
        input.source,
        input.scheduledFor,
        input.idempotencyKey,
        input.revision,
        JSON.stringify(input.graph),
        input.payload,
        at,
        at,
      );
      const run = this.run(runId);
      if (!run) throw new Error("A new workflow run was not stored.");
      created(run);
      return { run, created: true };
    });
  }

  /** Whether the trigger received this delivery before, inside the retention window. */
  hasWebhookReceipt(receipt: Pick<WorkflowWebhookReceipt, "workflowId" | "nodeId" | "deliveryId" | "receivedAt">) {
    return (
      databaseRow(
        this.#database.connection
          .prepare(
            `SELECT 1 AS found FROM workflow_webhook_receipts
             WHERE workflow_id = ? AND node_id = ? AND delivery_id = ? AND received_at >= ?`,
          )
          .get(receipt.workflowId, receipt.nodeId, receipt.deliveryId, webhookReceiptCutoff(receipt.receivedAt)),
      ) !== null
    );
  }

  /** Records one received delivery and drops the receipts past retention. */
  addWebhookReceipt(receipt: WorkflowWebhookReceipt): void {
    this.#transaction(() => {
      const db = this.#database.connection;
      db.prepare("DELETE FROM workflow_webhook_receipts WHERE received_at < ?").run(
        webhookReceiptCutoff(receipt.receivedAt),
      );
      db.prepare(
        `INSERT INTO workflow_webhook_receipts (receipt_id, workflow_id, node_id, delivery_id, status, reason, run_id,
           received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workflow_id, node_id, delivery_id) DO UPDATE SET status = excluded.status,
           reason = excluded.reason, run_id = excluded.run_id, received_at = excluded.received_at`,
      ).run(
        this.#createId(),
        receipt.workflowId,
        receipt.nodeId,
        receipt.deliveryId,
        receipt.status,
        receipt.reason,
        receipt.runId,
        receipt.receivedAt,
      );
    });
  }

  run(runId: string): StoredWorkflowRun | null {
    const row = databaseRow(this.#database.connection.prepare(`${RUN_SELECT} WHERE run_id = ?`).get(runId));
    return row ? toRun(row) : null;
  }

  /** Runs that can still move: running, waiting for an approval, or stopping. */
  openRuns(): StoredWorkflowRun[] {
    return databaseRows(
      this.#database.connection
        .prepare(`${RUN_SELECT} WHERE status IN (${placeholders(OPEN_RUN_STATUSES)}) ORDER BY started_at, run_id`)
        .all(...OPEN_RUN_STATUSES),
    ).map(toRun);
  }

  /** Changes an open run's status. Answers whether it changed. */
  setRunStatus(runId: string, status: WorkflowRunStatus, error: string | null, now = new Date()): boolean {
    const at = now.toISOString();
    const ended = isOneOf(OPEN_RUN_STATUSES, status) ? null : at;
    return (
      this.#database.connection
        .prepare(
          `UPDATE workflow_runs SET status = ?, error = ?, ended_at = ?, updated_at = ?
           WHERE run_id = ? AND status IN (${placeholders(OPEN_RUN_STATUSES)}) AND (status <> ? OR error IS NOT ?)`,
        )
        .run(status, error, ended, at, runId, ...OPEN_RUN_STATUSES, status, error).changes > 0
    );
  }

  /** Opens an ended run again, for a retried step. */
  reopenRun(runId: string, now = new Date()): boolean {
    return (
      this.#database.connection
        .prepare(
          `UPDATE workflow_runs SET status = 'running', error = NULL, ended_at = NULL, updated_at = ?
           WHERE run_id = ? AND status IN ('done', 'failed', 'stopped')`,
        )
        .run(now.toISOString(), runId).changes > 0
    );
  }

  /** Every attempt of the run's steps, oldest first. */
  steps(runId: string): StoredWorkflowStep[] {
    return databaseRows(
      this.#database.connection
        .prepare(`${STEP_SELECT} WHERE run_id = ? ORDER BY created_at, attempt, step_id`)
        .all(runId),
    ).map(toStep);
  }

  step(stepId: string): StoredWorkflowStep | null {
    const row = databaseRow(this.#database.connection.prepare(`${STEP_SELECT} WHERE step_id = ?`).get(stepId));
    return row ? toStep(row) : null;
  }

  /** Steps that have not ended, of runs and alone. */
  openSteps(): StoredWorkflowStep[] {
    return databaseRows(
      this.#database.connection
        .prepare(`${STEP_SELECT} WHERE status IN (${placeholders(OPEN_STEP_STATUSES)}) ORDER BY created_at, step_id`)
        .all(...OPEN_STEP_STATUSES),
    ).map(toStep);
  }

  /**
   * The newest step of each node that ended with an answer, of runs and alone. A run from a node
   * reads the steps before that node from here.
   */
  latestDone(workflowId: string): Map<string, StoredWorkflowStep> {
    const rows = databaseRows(
      this.#database.connection
        .prepare(`${STEP_SELECT} WHERE workflow_id = ? AND status = 'done' ORDER BY created_at, attempt, step_id`)
        .all(workflowId),
    ).map(toStep);
    return new Map(rows.map((step) => [step.nodeId, step]));
  }

  /**
   * Adds a step, or answers the step that the same request already added. The attempt is the
   * node's next one in its run; a step alone is always the first.
   */
  addStep(input: NewWorkflowStep, now = new Date()): StoredWorkflowStep {
    return this.#transaction(() => {
      const db = this.#database.connection;
      const existing = databaseRow(
        db
          .prepare("SELECT step_id FROM workflow_steps WHERE workflow_id = ? AND request_id = ?")
          .get(input.workflowId, input.requestId),
      );
      if (existing) {
        const step = this.step(requiredStringColumn(existing, "step_id"));
        if (step) return step;
      }
      const attempt =
        input.runId === null
          ? 1
          : requiredNumberColumn(
              databaseRow(
                db
                  .prepare(
                    "SELECT COALESCE(MAX(attempt), 0) + 1 AS attempt FROM workflow_steps WHERE run_id = ? AND node_id = ?",
                  )
                  .get(input.runId, input.nodeId),
              ) ?? {},
              "attempt",
            );
      const stepId = this.#createId();
      const at = now.toISOString();
      const ended = isOneOf(OPEN_STEP_STATUSES, input.status) ? null : at;
      db.prepare(
        `INSERT INTO workflow_steps (step_id, workflow_id, run_id, node_id, attempt, request_id, kind, agent_id, status,
          input, output, branch, error, started_at, ended_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        stepId,
        input.workflowId,
        input.runId,
        input.nodeId,
        attempt,
        input.requestId,
        input.kind,
        input.agentId,
        input.status,
        input.input,
        input.output ?? null,
        input.branch ?? null,
        input.error ?? null,
        at,
        ended,
        at,
        at,
      );
      const step = this.step(stepId);
      if (!step) throw new Error("A new workflow step was not stored.");
      return step;
    });
  }

  attachDelivery(stepId: string, deliveryId: string, now = new Date()): void {
    this.#database.connection
      .prepare("UPDATE workflow_steps SET delivery_id = ?, updated_at = ? WHERE step_id = ? AND delivery_id IS NULL")
      .run(deliveryId, now.toISOString(), stepId);
  }

  attachTurn(stepId: string, turnId: string, now = new Date()): void {
    this.#database.connection
      .prepare("UPDATE workflow_steps SET turn_id = ?, updated_at = ? WHERE step_id = ? AND turn_id IS NOT ?")
      .run(turnId, now.toISOString(), stepId, turnId);
  }

  /** Holds a running step for a person's decision. */
  awaitApproval(stepId: string, now = new Date()): boolean {
    return (
      this.#database.connection
        .prepare(
          "UPDATE workflow_steps SET status = 'approval', updated_at = ? WHERE step_id = ? AND status = 'running'",
        )
        .run(now.toISOString(), stepId).changes > 0
    );
  }

  /** Ends a step that has not ended. Answers whether it ended it. */
  settleStep(stepId: string, end: WorkflowStepEnd, now = new Date()): boolean {
    const at = now.toISOString();
    return (
      this.#database.connection
        .prepare(
          `UPDATE workflow_steps SET status = ?, output = ?, branch = ?, error = ?, ended_at = ?, updated_at = ?,
            started_at = COALESCE(started_at, ?)
           WHERE step_id = ? AND status IN (${placeholders(OPEN_STEP_STATUSES)})`,
        )
        .run(
          end.status,
          end.output ?? null,
          end.branch ?? null,
          end.error ?? null,
          at,
          at,
          at,
          stepId,
          ...OPEN_STEP_STATUSES,
        ).changes > 0
    );
  }

  /** Keeps the post of an output step before it is sent. A second call for the step keeps the first. */
  addOutput(output: Pick<WorkflowOutputDelivery, "stepId" | "connectionId" | "placeId" | "text">, now = new Date()) {
    const at = now.toISOString();
    this.#database.connection
      .prepare(
        `INSERT OR IGNORE INTO workflow_output_deliveries
           (step_id, connection_id, place_id, text, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(output.stepId, output.connectionId, output.placeId, output.text, at, at);
  }

  output(stepId: string): WorkflowOutputDelivery | null {
    const row = databaseRow(
      this.#database.connection.prepare("SELECT * FROM workflow_output_deliveries WHERE step_id = ?").get(stepId),
    );
    return row ? toOutput(row) : null;
  }

  /** Marks a waiting post as on its way, before it starts. False when it does not wait now. */
  claimOutput(stepId: string, now = new Date()): boolean {
    return (
      this.#database.connection
        .prepare(
          `UPDATE workflow_output_deliveries SET status = 'sending', attempts = attempts + 1, updated_at = ?
           WHERE step_id = ? AND status = 'pending'`,
        )
        .run(now.toISOString(), stepId).changes > 0
    );
  }

  /** Ends a post that waits or is on its way. */
  endOutput(stepId: string, status: WorkflowOutputEnd, reason: string | null, now = new Date()): void {
    const at = now.toISOString();
    this.#database.connection
      .prepare(
        `UPDATE workflow_output_deliveries SET status = ?, reason = ?, sent_at = ?, updated_at = ?
         WHERE step_id = ? AND status IN ('pending', 'sending')`,
      )
      .run(status, reason, status === "sent" ? at : null, at, stepId);
  }

  /**
   * Runs newest first, after the `before` cursor of the page before when given, and on the first page
   * the newest steps alone. The cursor is `<started at>|<run id>`, so runs that started in the same
   * millisecond are not skipped.
   */
  page(workflowId: string, before: string | undefined, limit: number): WorkflowRunPage {
    const db = this.#database.connection;
    const cursor = before === undefined ? null : runCursor(before);
    const rows = databaseRows(
      cursor === null
        ? db
            .prepare(`${RUN_SELECT} WHERE workflow_id = ? ORDER BY started_at DESC, run_id DESC LIMIT ?`)
            .all(workflowId, limit + 1)
        : db
            .prepare(
              `${RUN_SELECT} WHERE workflow_id = ? AND (started_at < ? OR (started_at = ? AND run_id < ?))
               ORDER BY started_at DESC, run_id DESC LIMIT ?`,
            )
            .all(workflowId, cursor.startedAt, cursor.startedAt, cursor.runId, limit + 1),
    ).map(toRun);
    const runs = rows.slice(0, limit);
    const last = runs.at(-1);
    const soloSteps =
      before === undefined
        ? databaseRows(
            db
              .prepare(
                `${STEP_SELECT} WHERE workflow_id = ? AND run_id IS NULL ORDER BY created_at DESC, step_id DESC LIMIT ?`,
              )
              .all(workflowId, limit),
          ).map(toStep)
        : [];
    return {
      runs: runs.map((run) => ({ run: publicRun(run), steps: this.steps(run.id).map(publicStep) })),
      soloSteps: soloSteps.map(publicStep),
      nextBefore: rows.length > limit && last ? `${last.startedAt}|${last.id}` : null,
    };
  }

  #transaction<T>(work: () => T): T {
    return workflowTransaction(this.#database, work);
  }
}

/** The start and the id of the last run of a page. */
function runCursor(before: string): { startedAt: string; runId: string } {
  const bar = before.lastIndexOf("|");
  // A time alone has no id: no run id is less than the empty string, so the page starts before that time.
  return bar < 0 ? { startedAt: before, runId: "" } : { startedAt: before.slice(0, bar), runId: before.slice(bar + 1) };
}

/** The public part of a run, as IPC and the Team API carry it. */
export function publicRun(run: StoredWorkflowRun): WorkflowRun {
  return {
    id: run.id,
    workflowId: run.workflowId,
    number: run.number,
    triggerNodeId: run.triggerNodeId,
    source: run.source,
    status: run.status,
    error: run.error,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
  };
}

/** The public part of a step, as IPC and the Team API carry it. */
export function publicStep(step: StoredWorkflowStep): WorkflowStep {
  return {
    id: step.id,
    workflowId: step.workflowId,
    runId: step.runId,
    nodeId: step.nodeId,
    attempt: step.attempt,
    agentId: step.agentId,
    status: step.status,
    output: step.output,
    branch: step.branch,
    error: step.error,
    startedAt: step.startedAt,
    endedAt: step.endedAt,
  };
}

const RUN_SELECT = `
  SELECT run_id, workflow_id, number, trigger_node_id, from_node_id, source, scheduled_for, graph_json, payload,
    status, error, started_at, ended_at
  FROM workflow_runs`;

const STEP_SELECT = `
  SELECT step_id, workflow_id, run_id, node_id, attempt, kind, agent_id, status, delivery_id, turn_id, input, output,
    branch, error, started_at, ended_at, created_at, rowid AS sequence
  FROM workflow_steps`;

function toRun(row: DynamicRecord): StoredWorkflowRun {
  const graph = JSON.parse(requiredStringColumn(row, "graph_json"));
  if (!isWorkflowGraph(graph)) throw new Error("Invalid SQLite column: workflow_runs.graph_json");
  return {
    id: requiredStringColumn(row, "run_id"),
    workflowId: requiredStringColumn(row, "workflow_id"),
    number: requiredNumberColumn(row, "number"),
    triggerNodeId: optionalStringColumn(row, "trigger_node_id"),
    fromNodeId: optionalStringColumn(row, "from_node_id"),
    source: checkedColumn(row, "source", WORKFLOW_RUN_SOURCES),
    status: checkedColumn(row, "status", WORKFLOW_RUN_STATUSES),
    error: optionalStringColumn(row, "error"),
    startedAt: requiredStringColumn(row, "started_at"),
    endedAt: optionalStringColumn(row, "ended_at"),
    scheduledFor: optionalStringColumn(row, "scheduled_for"),
    payload: optionalStringColumn(row, "payload"),
    graph,
  };
}

function toStep(row: DynamicRecord): StoredWorkflowStep {
  const branch = row.branch;
  return {
    id: requiredStringColumn(row, "step_id"),
    workflowId: requiredStringColumn(row, "workflow_id"),
    runId: optionalStringColumn(row, "run_id"),
    nodeId: requiredStringColumn(row, "node_id"),
    attempt: requiredNumberColumn(row, "attempt"),
    kind: checkedColumn(row, "kind", WORKFLOW_NODE_KINDS),
    agentId: optionalStringColumn(row, "agent_id"),
    status: checkedColumn(row, "status", WORKFLOW_STEP_STATUSES),
    deliveryId: optionalStringColumn(row, "delivery_id"),
    turnId: optionalStringColumn(row, "turn_id"),
    input: requiredStringColumn(row, "input"),
    output: optionalStringColumn(row, "output"),
    branch: isOneOf(WORKFLOW_BRANCHES, branch) ? branch : null,
    error: optionalStringColumn(row, "error"),
    startedAt: optionalStringColumn(row, "started_at"),
    endedAt: optionalStringColumn(row, "ended_at"),
    createdAt: requiredStringColumn(row, "created_at"),
    sequence: requiredNumberColumn(row, "sequence"),
  };
}

function toOutput(row: DynamicRecord): WorkflowOutputDelivery {
  return {
    stepId: requiredStringColumn(row, "step_id"),
    connectionId: requiredStringColumn(row, "connection_id"),
    placeId: requiredStringColumn(row, "place_id"),
    text: requiredStringColumn(row, "text"),
    status: checkedColumn(row, "status", OUTPUT_STATUSES),
    reason: optionalStringColumn(row, "reason"),
  };
}
