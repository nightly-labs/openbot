import {
  WORKFLOW_GITHUB_DELIVERY_LIMIT,
  WORKFLOW_GITHUB_DELIVERY_OUTCOMES,
  WORKFLOW_GITHUB_EVENTS,
  WORKFLOW_GITHUB_SKIP_REASONS,
  type WorkflowGitHubAction,
  type WorkflowGitHubDelivery,
  type WorkflowGitHubDeliveryOutcome,
  type WorkflowGitHubEvent,
  type WorkflowGitHubHistory,
  type WorkflowGitHubItem,
  type WorkflowGitHubSkipReason,
} from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import {
  checkedColumn,
  databaseRow,
  databaseRows,
  optionalNumberColumn,
  optionalStringColumn,
  placeholders,
  requiredNumberColumn,
  requiredStringColumn,
} from "../database/database-rows";
import type { OpenBotDatabase } from "../openbot-database";
import { workflowTransaction } from "./workflow-transaction";

const OPEN_RUN_STATUSES = ["running", "approval", "stopping"] as const;
const OFFLINE_MERGE_MS = 2 * 60_000;

export interface NewGitHubDelivery {
  workflowId: string;
  nodeId: string;
  deliveryId: string;
  event: WorkflowGitHubEvent;
  item: WorkflowGitHubItem | null;
  receivedAt: string;
  outcome: WorkflowGitHubDeliveryOutcome;
  reason: WorkflowGitHubSkipReason | null;
  runId: string | null;
  payload: string | null;
  causedByBot: boolean;
}

export interface WaitingGitHubDelivery {
  workflowId: string;
  nodeId: string;
  deliveryId: string;
  item: WorkflowGitHubItem;
  payload: string;
  causedByBot: boolean;
}

export interface NewGitHubRun {
  runId: string;
  workflowId: string;
  nodeId: string;
  deliveryId: string | null;
  item: WorkflowGitHubItem;
  causedByBot: boolean;
  startedAt: string;
}

const GITHUB_ACTION_STATUSES = ["sending", "done"] as const;

export interface NewGitHubAction {
  actionKey: string;
  workflowId: string;
  runId: string | null;
  stepId: string;
  repository: string;
  number: number | null;
  action: WorkflowGitHubAction;
  objectKeys: readonly string[];
}

export interface GitHubActionRecord {
  stepId: string;
  number: number | null;
  status: (typeof GITHUB_ACTION_STATUSES)[number];
  objectKeys: string[];
}

export class WorkflowGitHubStore {
  readonly #database: OpenBotDatabase;

  constructor(options: { database: OpenBotDatabase }) {
    this.#database = options.database;
  }

  hasDelivery(workflowId: string, nodeId: string, deliveryId: string): boolean {
    return (
      databaseRow(
        this.#database.connection
          .prepare(
            "SELECT 1 AS found FROM workflow_github_deliveries WHERE workflow_id = ? AND node_id = ? AND delivery_id = ?",
          )
          .get(workflowId, nodeId, deliveryId),
      ) !== null
    );
  }

  addDelivery(delivery: NewGitHubDelivery): void {
    workflowTransaction(this.#database, () => {
      const db = this.#database.connection;
      const { item } = delivery;
      db.prepare(
        `INSERT INTO workflow_github_deliveries (workflow_id, node_id, delivery_id, event, repository, number,
           pull_request, title, received_at, outcome, reason, run_id, payload, caused_by_bot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workflow_id, node_id, delivery_id) DO NOTHING`,
      ).run(
        delivery.workflowId,
        delivery.nodeId,
        delivery.deliveryId,
        delivery.event,
        item?.repository ?? null,
        item?.number ?? null,
        item ? Number(item.pullRequest) : null,
        item?.title ?? null,
        delivery.receivedAt,
        delivery.outcome,
        delivery.reason,
        delivery.runId,
        delivery.payload,
        Number(delivery.causedByBot),
      );
      this.#prune(delivery.workflowId, delivery.nodeId);
    });
  }

  addOffline(
    triggers: readonly { workflowId: string; nodeId: string; event: WorkflowGitHubEvent }[],
    from: Date,
    to: Date,
  ) {
    workflowTransaction(this.#database, () => {
      const db = this.#database.connection;
      for (const trigger of triggers) {
        const newest = databaseRow(
          db
            .prepare(
              `SELECT delivery_id, received_at, reason FROM workflow_github_deliveries
               WHERE workflow_id = ? AND node_id = ? ORDER BY received_at DESC, delivery_id DESC LIMIT 1`,
            )
            .get(trigger.workflowId, trigger.nodeId),
        );
        if (
          newest &&
          optionalStringColumn(newest, "reason") === "offline" &&
          from.getTime() - Date.parse(requiredStringColumn(newest, "received_at")) <= OFFLINE_MERGE_MS
        ) {
          db.prepare(
            "UPDATE workflow_github_deliveries SET received_at = ? WHERE workflow_id = ? AND node_id = ? AND delivery_id = ?",
          ).run(to.toISOString(), trigger.workflowId, trigger.nodeId, requiredStringColumn(newest, "delivery_id"));
          continue;
        }
        this.addDelivery({
          workflowId: trigger.workflowId,
          nodeId: trigger.nodeId,
          deliveryId: `offline:${from.toISOString()}`,
          event: trigger.event,
          item: null,
          receivedAt: to.toISOString(),
          outcome: "skipped",
          reason: "offline",
          runId: null,
          payload: null,
          causedByBot: false,
        });
      }
    });
  }

  itemBusy(workflowId: string, item: Pick<WorkflowGitHubItem, "repository" | "number">): boolean {
    return this.runOpen(workflowId, item) || this.nextWaiting(workflowId, item) !== null;
  }

  runOpen(workflowId: string, item: Pick<WorkflowGitHubItem, "repository" | "number">): boolean {
    return (
      databaseRow(
        this.#database.connection
          .prepare(
            `SELECT 1 AS found FROM workflow_github_runs g JOIN workflow_runs r ON r.run_id = g.run_id
           WHERE g.workflow_id = ? AND g.repository = ? AND g.number = ?
             AND r.status IN (${placeholders(OPEN_RUN_STATUSES)}) LIMIT 1`,
          )
          .get(workflowId, item.repository, item.number, ...OPEN_RUN_STATUSES),
      ) !== null
    );
  }

  addRun(run: NewGitHubRun): void {
    this.#database.connection
      .prepare(
        `INSERT INTO workflow_github_runs (run_id, workflow_id, node_id, delivery_id, repository, number, pull_request,
           title, caused_by_bot, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.runId,
        run.workflowId,
        run.nodeId,
        run.deliveryId,
        run.item.repository,
        run.item.number,
        Number(run.item.pullRequest),
        run.item.title,
        Number(run.causedByBot),
        run.startedAt,
      );
  }

  botRunsSince(item: Pick<WorkflowGitHubItem, "repository" | "number">, since: Date): number {
    return requiredNumberColumn(
      databaseRow(
        this.#database.connection
          .prepare(
            `SELECT COUNT(*) AS count FROM workflow_github_runs
             WHERE repository = ? AND number = ? AND caused_by_bot = 1 AND started_at >= ?`,
          )
          .get(item.repository, item.number, since.toISOString()),
      ) ?? {},
      "count",
    );
  }

  selfCaused(
    workflowId: string,
    item: Pick<WorkflowGitHubItem, "repository" | "number">,
    objectKey: string | null,
    since: Date,
  ): boolean {
    const db = this.#database.connection;
    const sending = databaseRow(
      db
        .prepare(
          `SELECT 1 AS found FROM workflow_github_actions
           WHERE workflow_id = ? AND repository = ? AND number = ? AND status = 'sending' AND updated_at >= ? LIMIT 1`,
        )
        .get(workflowId, item.repository, item.number, since.toISOString()),
    );
    if (sending) return true;
    if (!objectKey) return false;
    return (
      databaseRow(
        db
          .prepare(
            `SELECT 1 AS found FROM workflow_github_actions
             WHERE workflow_id = ? AND repository = ? AND (number IS NULL OR number = ?) AND updated_at >= ?
               AND instr(char(10) || object_id || char(10), char(10) || ? || char(10)) > 0 LIMIT 1`,
          )
          .get(workflowId, item.repository, item.number, since.toISOString(), objectKey),
      ) !== null
    );
  }

  runItem(runId: string): WorkflowGitHubItem | null {
    const row = databaseRow(
      this.#database.connection
        .prepare("SELECT repository, number, pull_request, title FROM workflow_github_runs WHERE run_id = ?")
        .get(runId),
    );
    return row ? toItem(row) : null;
  }

  action(actionKey: string): GitHubActionRecord | null {
    const row = databaseRow(
      this.#database.connection
        .prepare("SELECT step_id, number, status, object_id FROM workflow_github_actions WHERE action_key = ?")
        .get(actionKey),
    );
    if (!row) return null;
    return {
      stepId: requiredStringColumn(row, "step_id"),
      number: optionalNumberColumn(row, "number"),
      status: checkedColumn(row, "status", GITHUB_ACTION_STATUSES),
      objectKeys: objectKeysOf(optionalStringColumn(row, "object_id")),
    };
  }

  startAction(action: NewGitHubAction, at: Date): void {
    this.#database.connection
      .prepare(
        `INSERT INTO workflow_github_actions (action_key, workflow_id, run_id, step_id, repository, number, action, status,
           object_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'sending', ?, ?, ?)
         ON CONFLICT(action_key) DO UPDATE SET step_id = excluded.step_id, number = excluded.number,
           status = 'sending', object_id = excluded.object_id, updated_at = excluded.updated_at`,
      )
      .run(
        action.actionKey,
        action.workflowId,
        action.runId,
        action.stepId,
        action.repository,
        action.number,
        action.action,
        objectIdOf(action.objectKeys),
        at.toISOString(),
        at.toISOString(),
      );
  }

  finishAction(actionKey: string, number: number | null, objectKeys: readonly string[], at: Date): void {
    this.#database.connection
      .prepare(
        `UPDATE workflow_github_actions SET status = 'done', number = coalesce(?, number), object_id = ?, updated_at = ?
         WHERE action_key = ?`,
      )
      .run(number, objectIdOf(objectKeys), at.toISOString(), actionKey);
  }

  dropAction(actionKey: string): void {
    this.#database.connection.prepare("DELETE FROM workflow_github_actions WHERE action_key = ?").run(actionKey);
  }

  nextWaiting(
    workflowId: string,
    item: Pick<WorkflowGitHubItem, "repository" | "number">,
  ): WaitingGitHubDelivery | null {
    const row = databaseRow(
      this.#database.connection
        .prepare(
          `${WAITING_SELECT} AND d.repository = ? AND d.number = ? ORDER BY d.received_at, d.delivery_id LIMIT 1`,
        )
        .get(workflowId, item.repository, item.number),
    );
    return row ? toWaiting(row) : null;
  }

  waiting(workflowId: string): WaitingGitHubDelivery[] {
    const seen = new Set<string>();
    return databaseRows(
      this.#database.connection.prepare(`${WAITING_SELECT} ORDER BY d.received_at, d.delivery_id`).all(workflowId),
    )
      .map(toWaiting)
      .filter((delivery) => {
        const key = `${delivery.item.repository}#${delivery.item.number}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  waitingWorkflows(): string[] {
    return databaseRows(
      this.#database.connection
        .prepare("SELECT DISTINCT workflow_id FROM workflow_github_deliveries WHERE outcome = 'waiting'")
        .all(),
    ).map((row) => requiredStringColumn(row, "workflow_id"));
  }

  endWaiting(
    delivery: Pick<WaitingGitHubDelivery, "workflowId" | "nodeId" | "deliveryId">,
    end: { runId: string } | { reason: WorkflowGitHubSkipReason },
  ): void {
    const started = "runId" in end;
    this.#database.connection
      .prepare(
        `UPDATE workflow_github_deliveries SET outcome = ?, reason = ?, run_id = ?, payload = NULL
         WHERE workflow_id = ? AND node_id = ? AND delivery_id = ? AND outcome = 'waiting'`,
      )
      .run(
        started ? "started" : "skipped",
        started ? null : end.reason,
        started ? end.runId : null,
        delivery.workflowId,
        delivery.nodeId,
        delivery.deliveryId,
      );
    this.#prune(delivery.workflowId, delivery.nodeId);
  }

  history(workflowId: string): WorkflowGitHubHistory {
    const db = this.#database.connection;
    const deliveries = databaseRows(
      db
        .prepare(
          `SELECT node_id, delivery_id, event, repository, number, pull_request, title, received_at, outcome, reason,
             run_id FROM workflow_github_deliveries WHERE workflow_id = ?
           ORDER BY received_at DESC, delivery_id DESC`,
        )
        .all(workflowId),
    ).map(toDelivery);
    const runs = databaseRows(
      db
        .prepare(
          `SELECT g.run_id, g.repository, g.number, g.pull_request, g.title FROM workflow_github_runs g
           JOIN workflow_runs r ON r.run_id = g.run_id
           WHERE g.workflow_id = ? AND (r.status IN (${placeholders(OPEN_RUN_STATUSES)}) OR g.run_id IN (
             SELECT run_id FROM workflow_github_deliveries WHERE workflow_id = ? AND run_id IS NOT NULL))
           ORDER BY g.started_at DESC, g.run_id`,
        )
        .all(workflowId, ...OPEN_RUN_STATUSES, workflowId),
    ).map((row) => ({ runId: requiredStringColumn(row, "run_id"), item: toItem(row) }));
    return { deliveries, runs };
  }

  #prune(workflowId: string, nodeId: string): void {
    this.#database.connection
      .prepare(
        `DELETE FROM workflow_github_deliveries
         WHERE workflow_id = ? AND node_id = ? AND outcome <> 'waiting' AND delivery_id NOT IN (
           SELECT delivery_id FROM workflow_github_deliveries WHERE workflow_id = ? AND node_id = ?
           ORDER BY received_at DESC, delivery_id DESC LIMIT ?)`,
      )
      .run(workflowId, nodeId, workflowId, nodeId, WORKFLOW_GITHUB_DELIVERY_LIMIT);
  }
}

const WAITING_SELECT = `
  SELECT d.workflow_id, d.node_id, d.delivery_id, d.repository, d.number, d.pull_request, d.title, d.payload,
    d.caused_by_bot, d.received_at FROM workflow_github_deliveries d
  WHERE d.workflow_id = ? AND d.outcome = 'waiting'`;

function toItem(row: DynamicRecord): WorkflowGitHubItem {
  return {
    repository: requiredStringColumn(row, "repository"),
    number: requiredNumberColumn(row, "number"),
    pullRequest: requiredNumberColumn(row, "pull_request") === 1,
    title: requiredStringColumn(row, "title"),
  };
}

function toWaiting(row: DynamicRecord): WaitingGitHubDelivery {
  return {
    workflowId: requiredStringColumn(row, "workflow_id"),
    nodeId: requiredStringColumn(row, "node_id"),
    deliveryId: requiredStringColumn(row, "delivery_id"),
    item: toItem(row),
    payload: requiredStringColumn(row, "payload"),
    causedByBot: requiredNumberColumn(row, "caused_by_bot") === 1,
  };
}

function toDelivery(row: DynamicRecord): WorkflowGitHubDelivery {
  const number = optionalNumberColumn(row, "number");
  return {
    id: requiredStringColumn(row, "delivery_id"),
    nodeId: requiredStringColumn(row, "node_id"),
    event: checkedColumn(row, "event", WORKFLOW_GITHUB_EVENTS),
    item: number === null ? null : toItem(row),
    receivedAt: requiredStringColumn(row, "received_at"),
    outcome: checkedColumn(row, "outcome", WORKFLOW_GITHUB_DELIVERY_OUTCOMES),
    reason: row.reason === null ? null : checkedColumn(row, "reason", WORKFLOW_GITHUB_SKIP_REASONS),
    runId: optionalStringColumn(row, "run_id"),
  };
}

function objectIdOf(keys: readonly string[]): string | null {
  return keys.length > 0 ? keys.join("\n") : null;
}

function objectKeysOf(value: string | null): string[] {
  return value ? value.split("\n") : [];
}
