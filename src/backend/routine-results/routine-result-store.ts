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
import { withTransaction } from "../database/sqlite-transaction";
import type { OpenBotDatabase } from "../openbot-database";

export interface RoutineResultOutgoing {
  runId: string;
  agentId: string;
  destination: RoutineResultDestination;
  text: string;
  attempts: number;
  expiresAt: string;
}

export interface RoutineResultPendingRun {
  runId: string;
  routineId: string;
  agentId: string;
  routineName: string;
  deliveryId: string | null;
  endedAt: string;
  destination: RoutineResultDestination;
}

const ROUTINE_RESULT_EXPIRY_MS = 24 * 60 * 60 * 1000;
const DELIVERY_LIST_LIMIT = 50;

export class RoutineResultStore {
  readonly #database: OpenBotDatabase;

  constructor(database: OpenBotDatabase) {
    this.#database = database;
  }

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

  setDestination(
    routineId: string,
    destination: RoutineResultDestination | null,
    now = new Date().toISOString(),
  ): RoutineResultDestination | null {
    const db = this.#database.connection;
    if (!destination) {
      withTransaction(db, () => {
        db.prepare("DELETE FROM routine_result_destinations WHERE routine_id = ?").run(routineId);
        db.prepare(
          `UPDATE routine_result_deliveries SET status = 'failed', reason = 'stopped', next_attempt_at = NULL,
             updated_at = ? WHERE routine_id = ? AND status = 'pending'`,
        ).run(now, routineId);
      });
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

  runsWithoutDelivery(since: string): RoutineResultPendingRun[] {
    return databaseRows(
      this.#database.connection
        .prepare(
          `SELECT run.run_id, run.routine_id, run.agent_id, run.routine_name, run.delivery_id, run.updated_at AS run_updated_at, destination.*
           FROM projection_routine_runs AS run
           CROSS JOIN routine_result_destinations AS destination ON destination.routine_id = run.routine_id
           WHERE run.status IN ('succeeded', 'failed')
             AND (run.status = 'succeeded'
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
      endedAt: String(row.run_updated_at),
      destination: toDestination(row),
    }));
  }

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

  nextAttemptAt(): string | null {
    const row = databaseRow(
      this.#database.connection
        .prepare("SELECT MIN(next_attempt_at) AS next FROM routine_result_deliveries WHERE status = 'pending'")
        .get(),
    );
    return row ? nullableString(row.next) : null;
  }

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

  retryAt(runId: string, nextAttemptAt: string, now = new Date().toISOString()): void {
    this.#database.connection
      .prepare(
        `UPDATE routine_result_deliveries SET status = 'pending', next_attempt_at = ?, updated_at = ?
         WHERE run_id = ? AND status = 'sending'`,
      )
      .run(nextAttemptAt, now, runId);
  }

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

  deliveryOwner(runId: string): string | null {
    const row = databaseRow(
      this.#database.connection.prepare("SELECT agent_id FROM routine_result_deliveries WHERE run_id = ?").get(runId),
    );
    return row ? String(row.agent_id) : null;
  }

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
    platform: isOneOf(MESSAGING_PLATFORMS, row.platform) ? row.platform : "slack",
    connectionName: String(row.connection_name),
    placeId: String(row.place_id),
    placeName: String(row.place_name),
  };
}

function toDelivery(row: DynamicRecord): RoutineResultDelivery {
  return {
    runId: String(row.run_id),
    status: isOneOf(ROUTINE_RESULT_DELIVERY_STATUSES, row.status) ? row.status : "failed",
    reason: isOneOf(ROUTINE_RESULT_DELIVERY_REASONS, row.reason) ? row.reason : null,
    attempts: Number(row.attempts),
    destination: toDestination(row),
    updatedAt: String(row.updated_at),
    sentAt: nullableString(row.sent_at),
  };
}
