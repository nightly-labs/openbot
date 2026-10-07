import { randomUUID } from "node:crypto";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  RoutineFields,
  RoutineLimitPolicy,
  RoutineRunFields,
  RoutineRunStatus,
  RoutineSchedule,
} from "@openbot/contracts/ipc";
import { isRoutineSchedule, ROUTINE_LIMIT_POLICIES } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import {
  nextRoutineOccurrence,
  normalizeRoutineSchedule,
  RoutineInputError,
  validateRoutineSchedule,
} from "@openbot/team-client/routine-schedule";
import {
  databaseRows,
  optionalStringColumn,
  requiredNumberColumn,
  requiredStringColumn,
} from "./database/database-rows";
import { EventStore } from "./event-store";
import type { OpenBotDatabase } from "./openbot-database";

/**
 * Three table names, one owner column and one handle column are the whole difference between an
 * agent's routines and a channel's. Writing the SQL once is also what keeps the two constraints
 * that matter - `UNIQUE(routine_id)` on the trigger and `UNIQUE(trigger_id, scheduled_for)` on the
 * run - identical for both owners: they are what make one fire produce one run.
 *
 * The aggregate names stay per-owner. `database/agent-roster.ts` purges the events of a deleted
 * agent by `aggregate_type IN ('agent-routine', 'routine-run')`, and a channel must not be swept
 * up by that query.
 */
export interface RoutineTables {
  routineTable: string;
  triggerTable: string;
  runTable: string;
  ownerColumn: "agent_id" | "channel_id";
  handleColumn: "delivery_id" | "request_message_id";
  routineAggregate: "agent-routine" | "channel-routine";
  runAggregate: "routine-run" | "channel-routine-run";
  commandPrefix: string;
  eventPrefix: string;
  limit: number;
  limitMessage: string;
}

/** A routine read back with the owner column it was stored under. */
export interface OwnedRoutine extends RoutineFields {
  ownerId: string;
}

/** A run read back with its owner and the handle that names the work it started. */
export interface OwnedRoutineRun extends RoutineRunFields {
  ownerId: string;
  handleId: string | null;
}

export interface DueRoutine {
  routine: OwnedRoutine;
  triggerId: string;
  nextRunAt: string;
  schedule: RoutineSchedule;
}

export interface RoutineInputFields {
  name: string;
  instruction: string;
  active: boolean;
  timezone: string;
  schedule: RoutineSchedule;
  limitPolicy?: RoutineLimitPolicy;
}

export interface RoutineUpdateFields {
  routineId: string;
  name?: string;
  instruction?: string;
  active?: boolean;
  schedule?: RoutineSchedule;
  limitPolicy?: RoutineLimitPolicy;
}

/**
 * Owner-agnostic on purpose: every method takes an `ownerId` and returns `Owned*` rows. The two
 * subclasses re-name the owner and the handle, so `AgentRoutineStore` keeps the public signatures
 * its callers already use.
 */
/** The time from a hold of the routines to the restart that the hold waited for. */
export interface RoutineHoldWindow {
  since: Date;
  until: Date;
}

export class RoutineStore {
  constructor(
    protected readonly database: OpenBotDatabase,
    protected readonly tables: RoutineTables,
  ) {}

  protected get routineColumns(): string {
    return `routine_id, ${this.tables.ownerColumn}, name, instruction, active, timezone, limit_policy, created_at,
            updated_at`;
  }

  protected get runColumns(): string {
    return `run_id, routine_id, ${this.tables.ownerColumn}, trigger_id, run_kind, scheduled_for, routine_name,
            instruction, ${this.tables.handleColumn}, status, error, created_at, updated_at`;
  }

  protected listRoutines(ownerId: string): OwnedRoutine[] {
    return databaseRows(
      this.database.connection
        .prepare(
          `SELECT ${this.routineColumns}
           FROM ${this.tables.routineTable} routine
           WHERE routine.${this.tables.ownerColumn} = ?
             AND NOT EXISTS (
               SELECT 1 FROM projection_event_routine_triggers event_trigger
               WHERE event_trigger.routine_id = routine.routine_id
             )
             AND EXISTS (
               SELECT 1 FROM ${this.tables.triggerTable} schedule_trigger
               WHERE schedule_trigger.routine_id = routine.routine_id
             )
           ORDER BY updated_at DESC, routine_id`,
        )
        .all(ownerId),
    ).map((row) => this.#routine(row));
  }

  protected getRoutine(ownerId: string, routineId: string): OwnedRoutine | null {
    return this.getRoutineIncludingEvent(ownerId, routineId, false);
  }

  protected getRoutineIncludingEvent(ownerId: string, routineId: string, includeEvent = true): OwnedRoutine | null {
    const row = this.database.connection
      .prepare(
        `SELECT ${this.routineColumns}
         FROM ${this.tables.routineTable} routine
         WHERE routine.routine_id = ? AND routine.${this.tables.ownerColumn} = ?
           AND (? = 1 OR NOT EXISTS (
             SELECT 1 FROM projection_event_routine_triggers event_trigger
             WHERE event_trigger.routine_id = routine.routine_id
           ))
           AND (? = 1 OR EXISTS (
             SELECT 1 FROM ${this.tables.triggerTable} schedule_trigger
             WHERE schedule_trigger.routine_id = routine.routine_id
           ))`,
      )
      .get(routineId, ownerId, includeEvent ? 1 : 0, includeEvent ? 1 : 0);
    return isDynamicRecord(row) ? this.#routine(row) : null;
  }

  protected ensureRoutineRecord(
    ownerId: string,
    input: { id: string; name: string; instruction: string; timezone: string; limitPolicy?: RoutineLimitPolicy },
    now = new Date(),
  ): void {
    const current = this.database.connection
      .prepare(
        `SELECT routine_id FROM ${this.tables.routineTable} WHERE routine_id = ? AND ${this.tables.ownerColumn} = ?`,
      )
      .get(input.id, ownerId);
    const updatedAt = now.toISOString();
    this.database.dispatch(
      `${this.tables.commandPrefix}:event-sync:${input.id}:${updatedAt}`,
      [
        {
          aggregateType: this.tables.routineAggregate,
          aggregateId: input.id,
          eventType: `${this.tables.eventPrefix}.event-synced`,
          payload: { ownerId },
        },
      ],
      (db, sequences) => {
        const sequence = sequences[0] ?? 0;
        if (!isDynamicRecord(current)) {
          db.prepare(
            `INSERT INTO ${this.tables.routineTable}
               (routine_id, ${this.tables.ownerColumn}, name, instruction, active, timezone, limit_policy, created_at, updated_at, last_event_sequence)
             VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
          ).run(
            input.id,
            ownerId,
            input.name.trim(),
            input.instruction.trim(),
            input.timezone,
            input.limitPolicy ?? "wait",
            updatedAt,
            updatedAt,
            sequence,
          );
        } else {
          db.prepare(
            `UPDATE ${this.tables.routineTable}
             SET name = ?, instruction = ?, active = 0, timezone = ?, limit_policy = ?, updated_at = ?, last_event_sequence = ?
             WHERE routine_id = ? AND ${this.tables.ownerColumn} = ?`,
          ).run(
            input.name.trim(),
            input.instruction.trim(),
            input.timezone,
            input.limitPolicy ?? "wait",
            updatedAt,
            sequence,
            input.id,
            ownerId,
          );
        }
        return null;
      },
    );
  }

  /** Converts an event routine shadow row into a schedule row with the same routine id. */
  protected convertEventRoutineToScheduleRow(
    ownerId: string,
    input: {
      routineId: string;
      name: string;
      instruction: string;
      active: boolean;
      timezone: string;
      schedule: RoutineSchedule;
      limitPolicy?: RoutineLimitPolicy;
      createdAt?: string;
    },
    now = new Date(),
  ): OwnedRoutine {
    this.#validateInput(input.name, input.instruction, input.timezone, input.schedule);
    const schedule = normalizeRoutineSchedule(input.schedule, now);
    const current = this.database.connection
      .prepare(
        `SELECT routine_id, ${this.tables.ownerColumn}, created_at FROM ${this.tables.routineTable}
         WHERE routine_id = ?`,
      )
      .get(input.routineId);
    if (isDynamicRecord(current) && current[this.tables.ownerColumn] !== ownerId) {
      throw new RoutineInputError(sourceText("error.backend.routineGone"));
    }
    const timestamp = now.toISOString();
    const createdAt =
      isDynamicRecord(current) && isString(current.created_at) ? current.created_at : (input.createdAt ?? timestamp);
    const { commandPrefix, eventPrefix, routineAggregate, routineTable, triggerTable, ownerColumn } = this.tables;
    return this.database.dispatch(
      `${commandPrefix}:event-to-schedule:${input.routineId}:${randomUUID()}`,
      [
        {
          aggregateType: routineAggregate,
          aggregateId: input.routineId,
          eventType: `${eventPrefix}.event-converted-to-schedule`,
          payload: { ownerId, ...input },
        },
      ],
      (db, sequences) => {
        const sequence = sequences[0] ?? 0;
        db.prepare(
          `INSERT INTO ${routineTable}
             (routine_id, ${ownerColumn}, name, instruction, active, timezone, limit_policy, created_at, updated_at, last_event_sequence)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(routine_id) DO UPDATE SET
             ${ownerColumn} = excluded.${ownerColumn}, name = excluded.name, instruction = excluded.instruction,
             active = excluded.active, timezone = excluded.timezone, limit_policy = excluded.limit_policy,
             updated_at = excluded.updated_at, last_event_sequence = excluded.last_event_sequence`,
        ).run(
          input.routineId,
          ownerId,
          input.name.trim(),
          input.instruction.trim(),
          input.active ? 1 : 0,
          input.timezone,
          input.limitPolicy ?? "wait",
          createdAt,
          timestamp,
          sequence,
        );
        db.prepare(`DELETE FROM ${triggerTable} WHERE routine_id = ?`).run(input.routineId);
        this.#insertTrigger(db, input.routineId, input.timezone, schedule, timestamp, sequence, now);
        return this.#requireIncludingEvent(input.routineId, ownerId);
      },
    );
  }

  protected createRoutine(ownerId: string, input: RoutineInputFields, now = new Date()): OwnedRoutine {
    this.#validateInput(input.name, input.instruction, input.timezone, input.schedule);
    if (this.listRoutines(ownerId).length >= this.tables.limit) throw new RoutineInputError(this.tables.limitMessage);
    const routineId = randomUUID();
    const createdAt = now.toISOString();
    const schedule = normalizeRoutineSchedule(input.schedule, now);
    const { commandPrefix, eventPrefix, routineAggregate, routineTable, ownerColumn } = this.tables;
    return this.database.dispatch(
      `${commandPrefix}:create:${routineId}`,
      [
        {
          aggregateType: routineAggregate,
          aggregateId: routineId,
          eventType: `${eventPrefix}.created`,
          payload: { ...input, ownerId },
        },
      ],
      (db, sequences) => {
        const sequence = sequences[0] ?? 0;
        db.prepare(
          `INSERT INTO ${routineTable} (
             routine_id, ${ownerColumn}, name, instruction, active, timezone, limit_policy, created_at, updated_at,
             last_event_sequence
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          routineId,
          ownerId,
          input.name.trim(),
          input.instruction.trim(),
          input.active ? 1 : 0,
          input.timezone,
          input.limitPolicy ?? "wait",
          createdAt,
          createdAt,
          sequence,
        );
        this.#insertTrigger(db, routineId, input.timezone, schedule, createdAt, sequence, now);
        return this.#require(routineId, ownerId);
      },
    );
  }

  protected updateRoutine(ownerId: string, input: RoutineUpdateFields, now = new Date()): OwnedRoutine {
    const current = this.getRoutine(ownerId, input.routineId);
    if (!current) throw new RoutineInputError(sourceText("error.backend.routineGone"));
    const name = input.name ?? current.name;
    const instruction = input.instruction ?? current.instruction;
    const schedule = normalizeRoutineSchedule(input.schedule ?? current.trigger.schedule, now);
    this.#validateInput(name, instruction, current.timezone, schedule);
    const active = input.active ?? current.active;
    const limitPolicy = input.limitPolicy ?? current.limitPolicy ?? "wait";
    const reactivating = !current.active && active;
    const updatedAt = now.toISOString();
    const { commandPrefix, eventPrefix, routineAggregate, routineTable, triggerTable, ownerColumn } = this.tables;
    return this.database.dispatch(
      `${commandPrefix}:update:${input.routineId}:${randomUUID()}`,
      [
        {
          aggregateType: routineAggregate,
          aggregateId: input.routineId,
          eventType: `${eventPrefix}.updated`,
          payload: { ...input, ownerId },
        },
      ],
      (db, sequences) => {
        const sequence = sequences[0] ?? 0;
        db.prepare(
          `UPDATE ${routineTable}
           SET name = ?, instruction = ?, active = ?, limit_policy = ?, updated_at = ?, last_event_sequence = ?
           WHERE routine_id = ? AND ${ownerColumn} = ?`,
        ).run(
          name.trim(),
          instruction.trim(),
          active ? 1 : 0,
          limitPolicy,
          updatedAt,
          sequence,
          input.routineId,
          ownerId,
        );
        if (input.schedule) {
          db.prepare(`DELETE FROM ${triggerTable} WHERE routine_id = ?`).run(input.routineId);
          this.#insertTrigger(db, input.routineId, current.timezone, schedule, updatedAt, sequence, now);
        } else if (reactivating) {
          db.prepare(
            `UPDATE ${triggerTable}
             SET next_run_at = ?, updated_at = ?, last_event_sequence = ?
             WHERE trigger_id = ? AND routine_id = ?`,
          ).run(
            nextRoutineOccurrence(schedule, current.timezone, now).toISOString(),
            updatedAt,
            sequence,
            current.trigger.id,
            input.routineId,
          );
        }
        return this.#require(input.routineId, ownerId);
      },
    );
  }

  delete(ownerId: string, routineId: string): void {
    if (!this.getRoutine(ownerId, routineId)) throw new RoutineInputError(sourceText("error.backend.routineGone"));
    const { commandPrefix, eventPrefix, routineAggregate, routineTable, ownerColumn } = this.tables;
    this.database.dispatch(
      `${commandPrefix}:delete:${routineId}:${randomUUID()}`,
      [
        {
          aggregateType: routineAggregate,
          aggregateId: routineId,
          eventType: `${eventPrefix}.deleted`,
          payload: { ownerId },
        },
      ],
      (db) => {
        db.prepare(`DELETE FROM ${routineTable} WHERE routine_id = ? AND ${ownerColumn} = ?`).run(routineId, ownerId);
        return null;
      },
    );
  }

  /** Deletes an event routine's shadow projection while retaining its run history. */
  protected deleteEventRoutineProjection(ownerId: string, routineId: string): void {
    const { commandPrefix, eventPrefix, routineAggregate, routineTable, triggerTable, ownerColumn } = this.tables;
    this.database.dispatch(
      `${commandPrefix}:event-delete:${routineId}:${randomUUID()}`,
      [
        {
          aggregateType: routineAggregate,
          aggregateId: routineId,
          eventType: `${eventPrefix}.deleted`,
          payload: { ownerId },
        },
      ],
      (db) => {
        db.prepare(`DELETE FROM ${triggerTable} WHERE routine_id = ?`).run(routineId);
        db.prepare(`DELETE FROM ${routineTable} WHERE routine_id = ? AND ${ownerColumn} = ?`).run(routineId, ownerId);
        return null;
      },
    );
  }

  protected listRunRows(ownerId: string, routineId: string, limit = 50): OwnedRoutineRun[] {
    const safeLimit = Math.max(1, Math.min(INPUT_LIMITS.routineRunsPage, limit));
    return databaseRows(
      this.database.connection
        .prepare(
          `SELECT ${this.runColumns}
           FROM ${this.tables.runTable}
           WHERE routine_id = ? AND ${this.tables.ownerColumn} = ?
           ORDER BY created_at DESC, run_id DESC LIMIT ?`,
        )
        .all(routineId, ownerId, safeLimit),
    ).map((row) => this.#run(row));
  }

  /** Runs that were created but never got a handle - the crash window between the two writes. */
  protected pendingRunRows(): OwnedRoutineRun[] {
    return this.#queuedRunRows(`AND ${this.tables.handleColumn} IS NULL`);
  }

  /** Queued runs, including ones whose handle was saved before the command was issued. */
  protected queuedRunRows(): OwnedRoutineRun[] {
    return this.#queuedRunRows("");
  }

  #queuedRunRows(condition: string): OwnedRoutineRun[] {
    return databaseRows(
      this.database.connection
        .prepare(
          `SELECT ${this.runColumns}
           FROM ${this.tables.runTable}
           WHERE status = 'queued' ${condition}
           ORDER BY created_at, run_id`,
        )
        .all(),
    ).map((row) => this.#run(row));
  }

  protected activeRunRows(ownerId: string, routineId: string): OwnedRoutineRun[] {
    return databaseRows(
      this.database.connection
        .prepare(
          `SELECT ${this.runColumns}
           FROM ${this.tables.runTable}
           WHERE routine_id = ? AND ${this.tables.ownerColumn} = ?
             AND status IN ('queued', 'running', 'needs-attention')
           ORDER BY created_at, run_id`,
        )
        .all(routineId, ownerId),
    ).map((row) => this.#run(row));
  }

  /**
   * Every unfinished run of one owner, across all of its routines. A channel reconciles by owner,
   * not by routine: one channel change can settle runs of several routines at once.
   */
  protected openRunRows(ownerId: string): OwnedRoutineRun[] {
    return databaseRows(
      this.database.connection
        .prepare(
          `SELECT ${this.runColumns}
           FROM ${this.tables.runTable}
           WHERE ${this.tables.ownerColumn} = ? AND status IN ('queued', 'running', 'needs-attention')
           ORDER BY created_at, run_id`,
        )
        .all(ownerId),
    ).map((row) => this.#run(row));
  }

  /**
   * The failed runs of one owner that name one of these handles. A retry restarts the work under
   * the request the run already holds, so a run a failure settled has to be reconciled again with
   * it, or the history keeps a failure the reader has answered.
   */
  protected failedRunRowsForHandles(ownerId: string, handles: readonly string[]): OwnedRoutineRun[] {
    if (!handles.length) return [];
    return databaseRows(
      this.database.connection
        .prepare(
          `SELECT ${this.runColumns}
           FROM ${this.tables.runTable}
           WHERE ${this.tables.ownerColumn} = ? AND status = 'failed'
             AND ${this.tables.handleColumn} IN (${handles.map(() => "?").join(", ")})
           ORDER BY created_at, run_id`,
        )
        .all(ownerId, ...handles),
    ).map((row) => this.#run(row));
  }

  /** The owners that still have an unfinished run, so a boot reconcile can visit only those. */
  protected ownersWithOpenRuns(): string[] {
    return databaseRows(
      this.database.connection
        .prepare(
          `SELECT DISTINCT ${this.tables.ownerColumn}
           FROM ${this.tables.runTable}
           WHERE status IN ('queued', 'running', 'needs-attention')`,
        )
        .all(),
    ).map((row) => requiredStringColumn(row, this.tables.ownerColumn));
  }

  protected dueRoutines(now = new Date(), excludedOwnerIds: ReadonlySet<string> = new Set()): DueRoutine[] {
    const { triggerTable, routineTable, ownerColumn } = this.tables;
    return databaseRows(
      this.database.connection
        .prepare(
          `SELECT trigger.trigger_id, trigger.next_run_at, trigger.schedule_json, routine.routine_id,
                  routine.${ownerColumn}, routine.name, routine.instruction, routine.active, routine.timezone,
                  routine.limit_policy, routine.created_at, routine.updated_at
           FROM ${triggerTable} trigger
           JOIN ${routineTable} routine ON routine.routine_id = trigger.routine_id
           WHERE routine.active = 1 AND trigger.next_run_at <= ?
             AND NOT EXISTS (
               SELECT 1 FROM projection_event_routine_triggers event_trigger
               WHERE event_trigger.routine_id = routine.routine_id
             )
           ORDER BY trigger.next_run_at, trigger.trigger_id`,
        )
        .all(now.toISOString()),
    )
      .map((row) => ({
        routine: this.#routine(row),
        triggerId: requiredStringColumn(row, "trigger_id"),
        nextRunAt: requiredStringColumn(row, "next_run_at"),
        schedule: scheduleColumn(row),
      }))
      .filter((due) => !excludedOwnerIds.has(due.routine.ownerId));
  }

  nextDueAt(excludedOwnerIds: ReadonlySet<string> = new Set()): string | null {
    const { triggerTable, routineTable, ownerColumn } = this.tables;
    const row = databaseRows(
      this.database.connection
        .prepare(
          `SELECT trigger.next_run_at, routine.${ownerColumn}
           FROM ${triggerTable} trigger
           JOIN ${routineTable} routine ON routine.routine_id = trigger.routine_id
           WHERE routine.active = 1
             AND NOT EXISTS (
               SELECT 1 FROM projection_event_routine_triggers event_trigger
               WHERE event_trigger.routine_id = routine.routine_id
             )
           ORDER BY trigger.next_run_at, trigger.trigger_id`,
        )
        .all(),
    ).find((candidate) => !excludedOwnerIds.has(requiredStringColumn(candidate, ownerColumn)));
    return row && isString(row.next_run_at) ? row.next_run_at : null;
  }

  advanceTrigger(routineId: string, triggerId: string, nextRunAt: string): void {
    const { commandPrefix, eventPrefix, routineAggregate, triggerTable } = this.tables;
    this.database.dispatch(
      `${commandPrefix}-trigger:advance:${triggerId}:${nextRunAt}`,
      [
        {
          aggregateType: routineAggregate,
          aggregateId: routineId,
          eventType: `${eventPrefix}.trigger-advanced`,
          payload: { triggerId, nextRunAt },
        },
      ],
      (db, sequences) => {
        db.prepare(
          `UPDATE ${triggerTable} SET next_run_at = ?, updated_at = ?, last_event_sequence = ?
           WHERE trigger_id = ? AND routine_id = ?`,
        ).run(nextRunAt, new Date().toISOString(), sequences[0] ?? 0, triggerId, routineId);
        return null;
      },
    );
  }

  /**
   * Missed occurrences are dropped, never replayed: a closed app must not wake into a backlog. A
   * trigger that came due while a restart held the routines stays due, so it runs once now.
   */
  skipMissed(now = new Date(), held?: RoutineHoldWindow): void {
    for (const routine of this.#allActive()) {
      const due = Date.parse(routine.trigger.nextRunAt);
      if (held && due >= held.since.getTime() && due <= held.until.getTime()) continue;
      const next = nextRoutineOccurrence(routine.trigger.schedule, routine.timezone, now).toISOString();
      this.advanceTrigger(routine.id, routine.trigger.id, next);
    }
  }

  protected createRunRow(
    routine: OwnedRoutine,
    triggerId: string | null,
    kind: OwnedRoutineRun["kind"],
    scheduledFor: string,
    runId: string = randomUUID(),
  ): OwnedRoutineRun {
    const { commandPrefix, eventPrefix, runAggregate, runTable, ownerColumn, handleColumn } = this.tables;
    const existing = this.database.connection
      .prepare(`SELECT ${this.runColumns} FROM ${runTable} WHERE run_id = ?`)
      .get(runId);
    if (isDynamicRecord(existing)) return this.#run(existing);
    const commandId = triggerId
      ? `${commandPrefix}-run:scheduled:${triggerId}:${scheduledFor}`
      : `${commandPrefix}-run:manual:${routine.id}:${randomUUID()}`;
    const createdAt = new Date().toISOString();
    return this.database.dispatch(
      commandId,
      [
        {
          aggregateType: runAggregate,
          aggregateId: routine.id,
          eventType: `${eventPrefix}.run-created`,
          payload: { runId, triggerId, kind, scheduledFor },
        },
      ],
      (db, sequences) => {
        db.prepare(
          `INSERT INTO ${runTable} (
             run_id, routine_id, ${ownerColumn}, trigger_id, run_kind, scheduled_for, routine_name, instruction,
             ${handleColumn}, status, error, created_at, updated_at, last_event_sequence
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'queued', NULL, ?, ?, ?)`,
        ).run(
          runId,
          routine.id,
          routine.ownerId,
          triggerId,
          kind,
          scheduledFor,
          routine.name,
          routine.instruction,
          createdAt,
          createdAt,
          sequences[0] ?? 0,
        );
        return this.#requireRun(runId);
      },
    );
  }

  protected attachHandleRow(runId: string, handleId: string): OwnedRoutineRun {
    const { runTable, handleColumn } = this.tables;
    return this.#mutateRun(runId, `${this.tables.eventPrefix}.run-queued`, (db, sequence, now) => {
      db.prepare(
        `UPDATE ${runTable} SET ${handleColumn} = ?, status = 'queued', error = NULL,
                updated_at = ?, last_event_sequence = ? WHERE run_id = ?`,
      ).run(handleId, now, sequence, runId);
    });
  }

  protected updateRunRow(runId: string, status: RoutineRunStatus, error: string | null = null): OwnedRoutineRun {
    const current = this.#requireRun(runId);
    if (current.status === status && current.error === error) return current;
    return this.#mutateRun(runId, `${this.tables.eventPrefix}.run-${status}`, (db, sequence, now) => {
      db.prepare(
        `UPDATE ${this.tables.runTable} SET status = ?, error = ?, updated_at = ?, last_event_sequence = ?
         WHERE run_id = ?`,
      ).run(status, error, now, sequence, runId);
    });
  }

  protected runForHandleRow(handleId: string): OwnedRoutineRun | null {
    const row = this.database.connection
      .prepare(`SELECT ${this.runColumns} FROM ${this.tables.runTable} WHERE ${this.tables.handleColumn} = ?`)
      .get(handleId);
    return isDynamicRecord(row) ? this.#run(row) : null;
  }

  #allActive(): OwnedRoutine[] {
    return databaseRows(
      this.database.connection
        .prepare(
          `SELECT ${this.routineColumns}
           FROM ${this.tables.routineTable} routine
           WHERE routine.active = 1
             AND NOT EXISTS (
               SELECT 1 FROM projection_event_routine_triggers event_trigger
               WHERE event_trigger.routine_id = routine.routine_id
             )
             AND EXISTS (
               SELECT 1 FROM ${this.tables.triggerTable} schedule_trigger
               WHERE schedule_trigger.routine_id = routine.routine_id
             )`,
        )
        .all(),
    ).map((row) => this.#routine(row));
  }

  #routine(row: DynamicRecord): OwnedRoutine {
    const routineId = requiredStringColumn(row, "routine_id");
    const limitPolicy = requiredStringColumn(row, "limit_policy");
    if (!isOneOf(ROUTINE_LIMIT_POLICIES, limitPolicy)) throw new Error("The stored routine limit policy is invalid.");
    return {
      id: routineId,
      ownerId: requiredStringColumn(row, this.tables.ownerColumn),
      name: requiredStringColumn(row, "name"),
      instruction: requiredStringColumn(row, "instruction"),
      active: requiredNumberColumn(row, "active") === 1,
      timezone: requiredStringColumn(row, "timezone"),
      trigger: (() => {
        const trigger = this.database.connection
          .prepare(
            `SELECT trigger_id, routine_id, schedule_json, next_run_at, created_at, updated_at
             FROM ${this.tables.triggerTable} WHERE routine_id = ?`,
          )
          .get(routineId);
        if (!isDynamicRecord(trigger)) throw new Error("The routine trigger projection could not be read.");
        return {
          id: requiredStringColumn(trigger, "trigger_id"),
          routineId,
          schedule: scheduleColumn(trigger),
          nextRunAt: requiredStringColumn(trigger, "next_run_at"),
          createdAt: requiredStringColumn(trigger, "created_at"),
          updatedAt: requiredStringColumn(trigger, "updated_at"),
        };
      })(),
      limitPolicy,
      createdAt: requiredStringColumn(row, "created_at"),
      updatedAt: requiredStringColumn(row, "updated_at"),
    };
  }

  #run(row: DynamicRecord): OwnedRoutineRun {
    const status = requiredStringColumn(row, "status");
    if (!isRoutineRunStatus(status)) throw new Error("The stored routine run status is invalid.");
    const kind = requiredStringColumn(row, "run_kind");
    if (kind !== "scheduled" && kind !== "manual") throw new Error("The stored routine run kind is invalid.");
    return {
      id: requiredStringColumn(row, "run_id"),
      routineId: requiredStringColumn(row, "routine_id"),
      ownerId: requiredStringColumn(row, this.tables.ownerColumn),
      triggerId: optionalStringColumn(row, "trigger_id"),
      kind,
      scheduledFor: requiredStringColumn(row, "scheduled_for"),
      routineName: requiredStringColumn(row, "routine_name"),
      instruction: requiredStringColumn(row, "instruction"),
      handleId: optionalStringColumn(row, this.tables.handleColumn),
      status,
      error: optionalStringColumn(row, "error"),
      createdAt: requiredStringColumn(row, "created_at"),
      updatedAt: requiredStringColumn(row, "updated_at"),
    };
  }

  #require(routineId: string, ownerId: string): OwnedRoutine {
    const routine = this.getRoutine(ownerId, routineId);
    if (!routine) throw new Error("The routine projection could not be read.");
    return routine;
  }

  #requireIncludingEvent(routineId: string, ownerId: string): OwnedRoutine {
    const routine = this.getRoutineIncludingEvent(ownerId, routineId, true);
    if (!routine) throw new Error("The routine projection could not be read.");
    return routine;
  }

  #requireRun(runId: string): OwnedRoutineRun {
    const row = this.database.connection
      .prepare(`SELECT ${this.runColumns} FROM ${this.tables.runTable} WHERE run_id = ?`)
      .get(runId);
    if (!isDynamicRecord(row)) throw new Error("The routine run no longer exists.");
    return this.#run(row);
  }

  #mutateRun(
    runId: string,
    eventType: string,
    mutate: (db: OpenBotDatabase["connection"], sequence: number, now: string) => void,
  ): OwnedRoutineRun {
    const current = this.#requireRun(runId);
    const transitionEventId = randomUUID();
    return this.database.dispatch(
      `${this.tables.commandPrefix}-run:update:${runId}:${randomUUID()}`,
      [{ aggregateType: this.tables.runAggregate, aggregateId: current.routineId, eventType, payload: { runId } }],
      (db, sequences) => {
        mutate(db, sequences[0] ?? 0, new Date().toISOString());
        const updated = this.#requireRun(runId);
        const notification = routineRunNotification(updated, transitionEventId);
        if (notification && current.status !== updated.status) {
          const sourceEvent = db
            .prepare("SELECT event_id FROM projection_event_dispatches WHERE run_id = ?")
            .get(updated.id);
          const sourceEventId =
            isDynamicRecord(sourceEvent) && isString(sourceEvent.event_id) ? sourceEvent.event_id : null;
          new EventStore(this.database).recordRoutineRunTransitionInTransaction(db, notification, sourceEventId);
        }
        return updated;
      },
    );
  }

  #insertTrigger(
    db: OpenBotDatabase["connection"],
    routineId: string,
    timezone: string,
    schedule: RoutineSchedule,
    timestamp: string,
    sequence: number,
    now: Date,
  ): void {
    db.prepare(
      `INSERT INTO ${this.tables.triggerTable} (
         trigger_id, routine_id, schedule_json, next_run_at, created_at, updated_at, last_event_sequence
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      routineId,
      JSON.stringify(schedule),
      nextRoutineOccurrence(schedule, timezone, now).toISOString(),
      timestamp,
      timestamp,
      sequence,
    );
  }

  #validateInput(name: string, instruction: string, timezone: string, schedule: RoutineSchedule): void {
    const normalizedName = name.trim();
    const normalizedInstruction = instruction.trim();
    if (!normalizedName) throw new RoutineInputError(sourceText("error.backend.routineNameRequired"));
    if (name.length > INPUT_LIMITS.routineName)
      throw new RoutineInputError(sourceText("error.backend.routineNameTooLong"));
    if (!normalizedInstruction) throw new RoutineInputError(sourceText("error.backend.routineInstructionRequired"));
    if (instruction.length > INPUT_LIMITS.routineInstruction)
      throw new RoutineInputError(sourceText("error.backend.routineInstructionTooLong"));
    validateRoutineSchedule(schedule, timezone);
  }
}

function routineRunNotification(
  run: OwnedRoutineRun,
  eventId: string,
): import("@openbot/contracts/ipc-events").RoutineRunNotification | null {
  switch (run.status) {
    case "running":
      return {
        eventId,
        eventType: "routine.run.started",
        runId: run.id,
        routineId: run.routineId,
        routineName: run.routineName,
        status: "started",
        occurredAt: run.updatedAt,
      };
    case "succeeded":
      return {
        eventId,
        eventType: "routine.run.succeeded",
        runId: run.id,
        routineId: run.routineId,
        routineName: run.routineName,
        status: "succeeded",
        occurredAt: run.updatedAt,
      };
    case "failed":
      return {
        eventId,
        eventType: "routine.run.failed",
        runId: run.id,
        routineId: run.routineId,
        routineName: run.routineName,
        status: "failed",
        occurredAt: run.updatedAt,
      };
    case "needs-attention":
      return {
        eventId,
        eventType: "routine.run.needs_attention",
        runId: run.id,
        routineId: run.routineId,
        routineName: run.routineName,
        status: "needs-attention",
        occurredAt: run.updatedAt,
      };
    default:
      return null;
  }
}

function scheduleColumn(row: DynamicRecord): RoutineSchedule {
  const value = JSON.parse(requiredStringColumn(row, "schedule_json"));
  if (!isRoutineSchedule(value)) throw new Error("The stored routine schedule is invalid.");
  return value;
}

function isRoutineRunStatus(value: string): value is RoutineRunStatus {
  return (
    value === "queued" ||
    value === "running" ||
    value === "needs-attention" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "interrupted" ||
    value === "cancelled"
  );
}
