/**
 * The GitHub tables of workflows (migration 49): the events that GitHub triggers received, the queue of
 * events that wait for the open run of their item, the items of GitHub runs, and what the loop guard
 * reads. The runtime calls it under its lock.
 */

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
/** Two times offline closer than this are one gap in the history. */
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
  /** The run payload of a `waiting` event. */
  payload: string | null;
  causedByBot: boolean;
}

/** An event that waits for the open run of its item. */
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

/** One change of a GitHub output. `objectKeys` are the `githubObjectKey`s of what it changes. */
export interface NewGitHubAction {
  actionKey: string;
  workflowId: string;
  /** Null for a step that runs alone. */
  runId: string | null;
  stepId: string;
  repository: string;
  number: number | null;
  action: WorkflowGitHubAction;
  objectKeys: readonly string[];
}

export interface GitHubActionRecord {
  stepId: string;
  /** The item, or the issue that `issue.create` made. */
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

  /** Records one event and drops the oldest of the trigger past the limit. A waiting event stays. */
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

  /**
   * Records a time when the GitHub route was lost for each trigger. A gap that begins soon after the
   * newest gap of a trigger ends extends that one, so a host that reconnects often shows one gap.
   */
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
        // The ID keeps when the gap began; the time is when it ended, so the gap sorts after the events before it.
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

  /**
   * Whether an event of the item must wait: a GitHub run of the workflow for the item is open, or an
   * older event of the item waits already.
   */
  itemBusy(workflowId: string, item: Pick<WorkflowGitHubItem, "repository" | "number">): boolean {
    return this.runOpen(workflowId, item) || this.nextWaiting(workflowId, item) !== null;
  }

  /** Whether a GitHub run of the workflow for the item is open. */
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

  /** The runs that OpenBot's bot caused on the item since `since`, in every workflow. */
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

  /**
   * Whether a GitHub output of the workflow made the change that the event reports: its key matches
   * one that the output kept since `since`, or an output of the workflow on the item is on its way and
   * has no key yet. The caller asks only for events that OpenBot's bot caused.
   */
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
    // `object_id` is one key a line. A new issue is an action without an item number; its key names the issue.
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

  /** The item of a run that a GitHub event, or the newest item of a trigger, started. */
  runItem(runId: string): WorkflowGitHubItem | null {
    const row = databaseRow(
      this.#database.connection
        .prepare("SELECT repository, number, pull_request, title FROM workflow_github_runs WHERE run_id = ?")
        .get(runId),
    );
    return row ? toItem(row) : null;
  }

  /** The change that a GitHub output keeps under `actionKey`, or null when it made none. */
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

  /**
   * Writes `sending` before the call to GitHub, with the keys that the change is known to make. A step
   * that runs again takes the row over.
   */
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

  /** The change is on GitHub. A new issue gives its number and key only now. */
  finishAction(actionKey: string, number: number | null, objectKeys: readonly string[], at: Date): void {
    this.#database.connection
      .prepare(
        `UPDATE workflow_github_actions SET status = 'done', number = coalesce(?, number), object_id = ?, updated_at = ?
         WHERE action_key = ?`,
      )
      .run(number, objectIdOf(objectKeys), at.toISOString(), actionKey);
  }

  /** The change failed or stopped: no event of it can come, so the loop guard must not wait for one. */
  dropAction(actionKey: string): void {
    this.#database.connection.prepare("DELETE FROM workflow_github_actions WHERE action_key = ?").run(actionKey);
  }

  /** The oldest event of the item that waits, of any trigger of the workflow. */
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

  /** The oldest waiting event of each item of the workflow. */
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

  /** The workflows that have an event that waits. */
  waitingWorkflows(): string[] {
    return databaseRows(
      this.#database.connection
        .prepare("SELECT DISTINCT workflow_id FROM workflow_github_deliveries WHERE outcome = 'waiting'")
        .all(),
    ).map((row) => requiredStringColumn(row, "workflow_id"));
  }

  /** Ends the wait of an event: it started a run, or it is skipped. */
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

  /** The newest events of the workflow's GitHub triggers, newest first, and the items of their open and listed runs. */
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

  /** Drops the oldest events of the trigger past the limit. Waiting events stay until they start. */
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
