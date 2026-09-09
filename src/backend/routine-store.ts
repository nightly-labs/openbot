import { randomUUID } from "node:crypto";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { RoutineFields, RoutineRunFields, RoutineRunStatus, RoutineSchedule } from "@openbot/contracts/ipc";
import { isRoutineSchedule } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import type { OpenBotDatabase } from "./openbot-database";
import { nextRoutineOccurrence, normalizeRoutineSchedule, validateRoutineSchedule } from "./routine-schedule";

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
}

export interface RoutineUpdateFields {
  routineId: string;
  name?: string;
  instruction?: string;
  active?: boolean;
  schedule?: RoutineSchedule;
}

/**
 * Owner-agnostic on purpose: every method takes an `ownerId` and returns `Owned*` rows. The two
 * subclasses re-name the owner and the handle, so `AgentRoutineStore` keeps the public signatures
 * its callers already use.
 */
export class RoutineStore {
  constructor(
    protected readonly database: OpenBotDatabase,
    protected readonly tables: RoutineTables,
  ) {}

  protected get routineColumns(): string {
    return `routine_id, ${this.tables.ownerColumn}, name, instruction, active, timezone, created_at, updated_at`;
  }

  protected get runColumns(): string {
    return `run_id, routine_id, ${this.tables.ownerColumn}, trigger_id, run_kind, scheduled_for, routine_name,
            instruction, ${this.tables.handleColumn}, status, error, created_at, updated_at`;
  }

  protected listRoutines(ownerId: string): OwnedRoutine[] {
    return rows(
      this.database.connection
        .prepare(
          `SELECT ${this.routineColumns}
           FROM ${this.tables.routineTable} WHERE ${this.tables.ownerColumn} = ?
           ORDER BY updated_at DESC, routine_id`,
        )
        .all(ownerId),
    ).map((row) => this.#routine(row));
  }

  protected getRoutine(ownerId: string, routineId: string): OwnedRoutine | null {
    const row = this.database.connection
      .prepare(
        `SELECT ${this.routineColumns}
         FROM ${this.tables.routineTable} WHERE routine_id = ? AND ${this.tables.ownerColumn} = ?`,
      )
      .get(routineId, ownerId);
    return isDynamicRecord(row) ? this.#routine(row) : null;
  }

  protected createRoutine(ownerId: string, input: RoutineInputFields, now = new Date()): OwnedRoutine {
    this.#validateInput(input.name, input.instruction, input.timezone, input.schedule);
    if (this.listRoutines(ownerId).length >= this.tables.limit) throw new Error(this.tables.limitMessage);
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
             routine_id, ${ownerColumn}, name, instruction, active, timezone, created_at, updated_at,
             last_event_sequence
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          routineId,
          ownerId,
          input.name.trim(),
          input.instruction.trim(),
          input.active ? 1 : 0,
          input.timezone,
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
    if (!current) throw new Error("This routine no longer exists.");
    const name = input.name ?? current.name;
    const instruction = input.instruction ?? current.instruction;
    const schedule = normalizeRoutineSchedule(input.schedule ?? current.trigger.schedule, now);
    this.#validateInput(name, instruction, current.timezone, schedule);
    const active = input.active ?? current.active;
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
           SET name = ?, instruction = ?, active = ?, updated_at = ?, last_event_sequence = ?
           WHERE routine_id = ? AND ${ownerColumn} = ?`,
        ).run(name.trim(), instruction.trim(), active ? 1 : 0, updatedAt, sequence, input.routineId, ownerId);
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
    if (!this.getRoutine(ownerId, routineId)) throw new Error("This routine no longer exists.");
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

  protected listRunRows(ownerId: string, routineId: string, limit = 50): OwnedRoutineRun[] {
    const safeLimit = Math.max(1, Math.min(INPUT_LIMITS.routineRunsPage, limit));
    return rows(
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
    return rows(
      this.database.connection
        .prepare(
          `SELECT ${this.runColumns}
           FROM ${this.tables.runTable}
           WHERE status = 'queued' AND ${this.tables.handleColumn} IS NULL
           ORDER BY created_at, run_id`,
        )
        .all(),
    ).map((row) => this.#run(row));
  }

  protected activeRunRows(ownerId: string, routineId: string): OwnedRoutineRun[] {
    return rows(
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
    return rows(
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

  /** The owners that still have an unfinished run, so a boot reconcile can visit only those. */
  protected ownersWithOpenRuns(): string[] {
    return rows(
      this.database.connection
        .prepare(
          `SELECT DISTINCT ${this.tables.ownerColumn}
           FROM ${this.tables.runTable}
           WHERE status IN ('queued', 'running', 'needs-attention')`,
        )
        .all(),
    ).map((row) => stringColumn(row, this.tables.ownerColumn));
  }

  protected dueRoutines(now = new Date(), excludedOwnerIds: ReadonlySet<string> = new Set()): DueRoutine[] {
    const { triggerTable, routineTable, ownerColumn } = this.tables;
    return rows(
      this.database.connection
        .prepare(
          `SELECT trigger.trigger_id, trigger.next_run_at, trigger.schedule_json, routine.routine_id,
                  routine.${ownerColumn}, routine.name, routine.instruction, routine.active, routine.timezone,
                  routine.created_at, routine.updated_at
           FROM ${triggerTable} trigger
           JOIN ${routineTable} routine ON routine.routine_id = trigger.routine_id
           WHERE routine.active = 1 AND trigger.next_run_at <= ?
           ORDER BY trigger.next_run_at, trigger.trigger_id`,
        )
        .all(now.toISOString()),
    )
      .map((row) => ({
        routine: this.#routine(row),
        triggerId: stringColumn(row, "trigger_id"),
        nextRunAt: stringColumn(row, "next_run_at"),
        schedule: scheduleColumn(row),
      }))
      .filter((due) => !excludedOwnerIds.has(due.routine.ownerId));
  }

  nextDueAt(excludedOwnerIds: ReadonlySet<string> = new Set()): string | null {
    const { triggerTable, routineTable, ownerColumn } = this.tables;
    const row = rows(
      this.database.connection
        .prepare(
          `SELECT trigger.next_run_at, routine.${ownerColumn}
           FROM ${triggerTable} trigger
           JOIN ${routineTable} routine ON routine.routine_id = trigger.routine_id
           WHERE routine.active = 1
           ORDER BY trigger.next_run_at, trigger.trigger_id`,
        )
        .all(),
    ).find((candidate) => !excludedOwnerIds.has(stringColumn(candidate, ownerColumn)));
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

  /** Missed occurrences are dropped, never replayed: a closed app must not wake into a backlog. */
  skipMissed(now = new Date()): void {
    for (const routine of this.#allActive()) {
      const next = nextRoutineOccurrence(routine.trigger.schedule, routine.timezone, now).toISOString();
      this.advanceTrigger(routine.id, routine.trigger.id, next);
    }
  }

  protected createRunRow(
    routine: OwnedRoutine,
    triggerId: string | null,
    kind: OwnedRoutineRun["kind"],
    scheduledFor: string,
  ): OwnedRoutineRun {
    const { commandPrefix, eventPrefix, runAggregate, runTable, ownerColumn, handleColumn } = this.tables;
    const commandId = triggerId
      ? `${commandPrefix}-run:scheduled:${triggerId}:${scheduledFor}`
      : `${commandPrefix}-run:manual:${routine.id}:${randomUUID()}`;
    const runId = randomUUID();
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
    return rows(
      this.database.connection
        .prepare(`SELECT ${this.routineColumns} FROM ${this.tables.routineTable} WHERE active = 1`)
        .all(),
    ).map((row) => this.#routine(row));
  }

  #routine(row: DynamicRecord): OwnedRoutine {
    const routineId = stringColumn(row, "routine_id");
    return {
      id: routineId,
      ownerId: stringColumn(row, this.tables.ownerColumn),
      name: stringColumn(row, "name"),
      instruction: stringColumn(row, "instruction"),
      active: numberColumn(row, "active") === 1,
      timezone: stringColumn(row, "timezone"),
      trigger: (() => {
        const trigger = this.database.connection
          .prepare(
            `SELECT trigger_id, routine_id, schedule_json, next_run_at, created_at, updated_at
             FROM ${this.tables.triggerTable} WHERE routine_id = ?`,
          )
          .get(routineId);
        if (!isDynamicRecord(trigger)) throw new Error("The routine trigger projection could not be read.");
        return {
          id: stringColumn(trigger, "trigger_id"),
          routineId,
          schedule: scheduleColumn(trigger),
          nextRunAt: stringColumn(trigger, "next_run_at"),
          createdAt: stringColumn(trigger, "created_at"),
          updatedAt: stringColumn(trigger, "updated_at"),
        };
      })(),
      createdAt: stringColumn(row, "created_at"),
      updatedAt: stringColumn(row, "updated_at"),
    };
  }

  #run(row: DynamicRecord): OwnedRoutineRun {
    const status = stringColumn(row, "status");
    if (!isRoutineRunStatus(status)) throw new Error("The stored routine run status is invalid.");
    const kind = stringColumn(row, "run_kind");
    if (kind !== "scheduled" && kind !== "manual") throw new Error("The stored routine run kind is invalid.");
    return {
      id: stringColumn(row, "run_id"),
      routineId: stringColumn(row, "routine_id"),
      ownerId: stringColumn(row, this.tables.ownerColumn),
      triggerId: nullableStringColumn(row, "trigger_id"),
      kind,
      scheduledFor: stringColumn(row, "scheduled_for"),
      routineName: stringColumn(row, "routine_name"),
      instruction: stringColumn(row, "instruction"),
      handleId: nullableStringColumn(row, this.tables.handleColumn),
      status,
      error: nullableStringColumn(row, "error"),
      createdAt: stringColumn(row, "created_at"),
      updatedAt: stringColumn(row, "updated_at"),
    };
  }

  #require(routineId: string, ownerId: string): OwnedRoutine {
    const routine = this.getRoutine(ownerId, routineId);
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
    return this.database.dispatch(
      `${this.tables.commandPrefix}-run:update:${runId}:${randomUUID()}`,
      [{ aggregateType: this.tables.runAggregate, aggregateId: current.routineId, eventType, payload: { runId } }],
      (db, sequences) => {
        mutate(db, sequences[0] ?? 0, new Date().toISOString());
        return this.#requireRun(runId);
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
    if (!normalizedName) throw new Error("A routine name is required.");
    if (name.length > INPUT_LIMITS.routineName) throw new Error("The routine name is too long.");
    if (!normalizedInstruction) throw new Error("A routine instruction is required.");
    if (instruction.length > INPUT_LIMITS.routineInstruction) throw new Error("The routine instruction is too long.");
    validateRoutineSchedule(schedule, timezone);
  }
}

function scheduleColumn(row: DynamicRecord): RoutineSchedule {
  const value = JSON.parse(stringColumn(row, "schedule_json"));
  if (!isRoutineSchedule(value)) throw new Error("The stored routine schedule is invalid.");
  return value;
}

function rows(values: unknown[]): DynamicRecord[] {
  return values.map((value) => {
    if (!isDynamicRecord(value)) throw new Error("A routine database row is invalid.");
    return value;
  });
}

function stringColumn(row: DynamicRecord, key: string): string {
  const value = row[key];
  if (!isString(value)) throw new Error(`The routine ${key} column is invalid.`);
  return value;
}

function nullableStringColumn(row: DynamicRecord, key: string): string | null {
  const value = row[key];
  if (value === null) return null;
  return stringColumn(row, key);
}

function numberColumn(row: DynamicRecord, key: string): number {
  const value = row[key];
  if (!isNumber(value)) throw new Error(`The routine ${key} column is invalid.`);
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
