/**
 * The routine result tables: each routine's destination and each run's delivery. Rows are written
 * directly, not through `database.dispatch`, because a delivery holds the answer text and the event log
 * is never deleted from. It reads the routine and run tables but never writes them. It owns no events:
 * the runtime says when something changed.
 */

import {
  MESSAGING_PLATFORMS,
  ROUTINE_RESULT_DELIVERY_REASONS,
  ROUTINE_RESULT_DELIVERY_STATUSES,
  type RoutineResultDelivery,
  type RoutineResultDeliveryReason,
  type RoutineResultDestination,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isOneOf } from "@openbot/contracts/runtime-values";
import { databaseRow, databaseRows } from "../database/database-rows";
import type { OpenBotDatabase } from "../openbot-database";

/** A delivery the runtime can send: its place and the text, which a quiet run never has. */
export interface RoutineResultOutgoing {
  runId: string;
  agentId: string;
  destination: RoutineResultDestination;
  text: string;
  attempts: number;
  expiresAt: string;
}

/**
 * A run with an answer (succeeded, or failed by its agent's report) whose routine has a destination,
 * and no delivery yet.
 */
export interface RoutineResultPendingRun {
  runId: string;
  routineId: string;
  agentId: string;
  routineName: string;
  deliveryId: string | null;
  destination: RoutineResultDestination;
}

/** How long a delivery waits for its connection to run before it fails. */
const ROUTINE_RESULT_EXPIRY_MS = 24 * 60 * 60 * 1000;
/** The newest deliveries the editor shows, which is more than its run history lists. */
const DELIVERY_LIST_LIMIT = 50;

export class RoutineResultStore {
  readonly #database: OpenBotDatabase;

  constructor(database: OpenBotDatabase) {
    this.#database = database;
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

  destination(routineId: string): RoutineResultDestination | null {
    const row = databaseRow(
      this.#database.connection
        .prepare("SELECT * FROM routine_result_destinations WHERE routine_id = ?")
        .get(routineId),
    );
    return row ? toDestination(row) : null;
  }

  /**
   * Saves or removes a routine's destination. A save marks the time, so only the runs that end after
   * it send their answers there. The same place again keeps the time: nothing new is sent. A removal
   * also ends the answers that wait, so none posts after the user stopped sending. A post on its way
   * keeps going: part of it can be in the place already.
   */
  setDestination(
    routineId: string,
    destination: RoutineResultDestination | null,
    now = new Date().toISOString(),
  ): RoutineResultDestination | null {
    const db = this.#database.connection;
    if (!destination) {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM routine_result_destinations WHERE routine_id = ?").run(routineId);
        db.prepare(
          `UPDATE routine_result_deliveries SET status = 'failed', reason = 'stopped', next_attempt_at = NULL,
             updated_at = ? WHERE routine_id = ? AND status = 'pending'`,
        ).run(now, routineId);
        db.exec("COMMIT");
      } catch (error) {
        // SQLite may have rolled back already, and a second ROLLBACK would replace the error that did it.
        if (db.isTransaction) db.exec("ROLLBACK");
        throw error;
      }
      return null;
    }
    db.prepare(
      `INSERT INTO routine_result_destinations
         (routine_id, connection_id, platform, connection_name, place_id, place_name, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(routine_id) DO UPDATE SET
         platform = excluded.platform, connection_name = excluded.connection_name,
         place_name = excluded.place_name,
         updated_at = CASE
           WHEN connection_id = excluded.connection_id AND place_id = excluded.place_id THEN updated_at
           ELSE excluded.updated_at END,
         connection_id = excluded.connection_id, place_id = excluded.place_id`,
    ).run(
      routineId,
      destination.connectionId,
      destination.platform,
      destination.connectionName,
      destination.placeId,
      destination.placeName,
      now,
    );
    return this.destination(routineId);
  }

  /**
   * Runs with an answer that ended since `since`, after their routine got its destination, with no
   * delivery: succeeded runs, and failed runs whose agent answered and reported the failure, so their
   * queue delivery completed. A provider failure has no answer and sends nothing.
   */
  runsWithoutDelivery(since: string): RoutineResultPendingRun[] {
    return databaseRows(
      this.#database.connection
        .prepare(
          `SELECT run.run_id, run.routine_id, run.agent_id, run.routine_name, run.delivery_id, destination.*
           FROM projection_routine_runs AS run
           JOIN routine_result_destinations AS destination ON destination.routine_id = run.routine_id
           WHERE (run.status = 'succeeded'
               OR (run.status = 'failed' AND EXISTS (SELECT 1 FROM projection_deliveries AS queued
                 WHERE queued.delivery_id = run.delivery_id AND queued.status = 'completed')))
             AND run.updated_at >= ? AND run.updated_at >= destination.updated_at
             AND NOT EXISTS (SELECT 1 FROM routine_result_deliveries AS delivery WHERE delivery.run_id = run.run_id)
           ORDER BY run.updated_at, run.run_id`,
        )
        .all(since),
    ).map((row) => ({
      runId: String(row.run_id),
      routineId: String(row.routine_id),
      agentId: String(row.agent_id),
      routineName: String(row.routine_name),
      deliveryId: nullableString(row.delivery_id),
      destination: toDestination(row),
    }));
  }

  /** Records a run's answer for its place. Null text is a quiet run: it ends at once and sends nothing. */
  createDelivery(run: RoutineResultPendingRun, text: string | null, now = new Date().toISOString()): void {
    const { destination } = run;
    this.#database.connection
      .prepare(
        `INSERT OR IGNORE INTO routine_result_deliveries
           (run_id, routine_id, agent_id, connection_id, platform, connection_name, place_id, place_name, text,
            status, next_attempt_at, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.runId,
        run.routineId,
        run.agentId,
        destination.connectionId,
        destination.platform,
        destination.connectionName,
        destination.placeId,
        destination.placeName,
        text,
        text === null ? "quiet" : "pending",
        text === null ? null : now,
        text === null ? null : expiry(now),
        now,
        now,
      );
  }

  /** Pending deliveries whose time came, oldest first. */
  due(now: string): RoutineResultOutgoing[] {
    return databaseRows(
      this.#database.connection
        .prepare(
          `SELECT * FROM routine_result_deliveries
           WHERE status = 'pending' AND next_attempt_at <= ? AND text IS NOT NULL
           ORDER BY next_attempt_at, run_id`,
        )
        .all(now),
    ).map((row) => ({
      runId: String(row.run_id),
      agentId: String(row.agent_id),
      destination: toDestination(row),
      text: String(row.text),
      attempts: Number(row.attempts),
      expiresAt: String(row.expires_at),
    }));
  }

  /** When the next pending delivery is due, or null when none waits. */
  nextAttemptAt(): string | null {
    const row = databaseRow(
      this.#database.connection
        .prepare("SELECT MIN(next_attempt_at) AS next FROM routine_result_deliveries WHERE status = 'pending'")
        .get(),
    );
    return row ? nullableString(row.next) : null;
  }

  /** Marks a pending delivery as on its way, before the post starts. False when it is not pending now. */
  claim(runId: string, now = new Date().toISOString()): boolean {
    const result = this.#database.connection
      .prepare(
        `UPDATE routine_result_deliveries SET status = 'sending', attempts = attempts + 1, updated_at = ?
         WHERE run_id = ? AND status = 'pending'`,
      )
      .run(now, runId);
    return Number(result.changes) > 0;
  }

  markSent(runId: string, now = new Date().toISOString()): void {
    this.#database.connection
      .prepare(
        `UPDATE routine_result_deliveries
         SET status = 'sent', reason = NULL, next_attempt_at = NULL, sent_at = ?, updated_at = ?
         WHERE run_id = ? AND status = 'sending'`,
      )
      .run(now, now, runId);
  }

  /** Puts a delivery back to wait: nothing of it was posted. */
  retryAt(runId: string, nextAttemptAt: string, now = new Date().toISOString()): void {
    this.#database.connection
      .prepare(
        `UPDATE routine_result_deliveries SET status = 'pending', next_attempt_at = ?, updated_at = ?
         WHERE run_id = ? AND status = 'sending'`,
      )
      .run(nextAttemptAt, now, runId);
  }

  /** Ends a delivery that is on its way or waits. */
  end(
    runId: string,
    status: "failed" | "uncertain",
    reason: RoutineResultDeliveryReason,
    now = new Date().toISOString(),
  ): void {
    this.#database.connection
      .prepare(
        `UPDATE routine_result_deliveries SET status = ?, reason = ?, next_attempt_at = NULL, updated_at = ?
         WHERE run_id = ? AND status IN ('pending', 'sending')`,
      )
      .run(status, reason, now, runId);
  }

  /** A post that a stop or a crash cut off may be in the place in part. Returns the agents it touched. */
  interruptSending(now = new Date().toISOString()): string[] {
    const db = this.#database.connection;
    const agents = databaseRows(
      db.prepare("SELECT DISTINCT agent_id FROM routine_result_deliveries WHERE status = 'sending'").all(),
    ).map((row) => String(row.agent_id));
    db.prepare(
      `UPDATE routine_result_deliveries SET status = 'uncertain', reason = 'restart', next_attempt_at = NULL,
         updated_at = ? WHERE status = 'sending'`,
    ).run(now);
    return agents;
  }

  /** A routine's deliveries, newest first. A quiet run sent nothing, so it has none to show. */
  deliveries(routineId: string): RoutineResultDelivery[] {
    return databaseRows(
      this.#database.connection
        .prepare(
          `SELECT * FROM routine_result_deliveries WHERE routine_id = ? AND status <> 'quiet'
           ORDER BY created_at DESC, run_id LIMIT ?`,
        )
        .all(routineId, DELIVERY_LIST_LIMIT),
    ).map(toDelivery);
  }

  /** The agent of a run's delivery, or null when it has none. */
  deliveryOwner(runId: string): string | null {
    const row = databaseRow(
      this.#database.connection.prepare("SELECT agent_id FROM routine_result_deliveries WHERE run_id = ?").get(runId),
    );
    return row ? String(row.agent_id) : null;
  }

  /**
   * Sends an ended delivery again, with the saved text and place, and a new day to wait. False when
   * the delivery waits or is on its way already, or the run was quiet.
   */
  resend(runId: string, now = new Date().toISOString()): boolean {
    const result = this.#database.connection
      .prepare(
        `UPDATE routine_result_deliveries
         SET status = 'pending', reason = NULL, attempts = 0, next_attempt_at = ?, expires_at = ?, updated_at = ?
         WHERE run_id = ? AND status IN ('sent', 'failed', 'uncertain') AND text IS NOT NULL`,
      )
      .run(now, expiry(now), now, runId);
    return Number(result.changes) > 0;
  }
}

function expiry(now: string): string {
  return new Date(Date.parse(now) + ROUTINE_RESULT_EXPIRY_MS).toISOString();
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function toDestination(row: DynamicRecord): RoutineResultDestination {
  return {
    connectionId: String(row.connection_id),
    // The host writes only known platforms; the guard only narrows the type.
    platform: isOneOf(MESSAGING_PLATFORMS, row.platform) ? row.platform : "slack",
    connectionName: String(row.connection_name),
    placeId: String(row.place_id),
    placeName: String(row.place_name),
  };
}

function toDelivery(row: DynamicRecord): RoutineResultDelivery {
  return {
    runId: String(row.run_id),
    // The CHECK constraint holds the column to these values; `quiet` rows are not read here.
    status: isOneOf(ROUTINE_RESULT_DELIVERY_STATUSES, row.status) ? row.status : "failed",
    reason: isOneOf(ROUTINE_RESULT_DELIVERY_REASONS, row.reason) ? row.reason : null,
    attempts: Number(row.attempts),
    destination: toDestination(row),
    updatedAt: String(row.updated_at),
    sentAt: nullableString(row.sent_at),
  };
}
