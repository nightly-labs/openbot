import { randomUUID } from "node:crypto";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  RoutineFields,
  RoutineLimitPolicy,
  RoutineMissedPolicy,
  RoutineRunFields,
  RoutineRunStatus,
  RoutineSchedule,
} from "@openbot/contracts/ipc";
import {
  isRoutineSchedule,
  ROUTINE_LIMIT_POLICIES,
  ROUTINE_MISSED_COUNT_LIMIT,
  ROUTINE_MISSED_POLICIES,
} from "@openbot/contracts/ipc";
import type { EventFilter, EventJsonValue, EventRoutineOwner } from "@openbot/contracts/ipc-events";
import { type DynamicRecord, isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import {
  nextRoutineOccurrence,
  nextValidRoutineOccurrence,
  normalizeRoutineSchedule,
  RoutineInputError,
  validateRoutineSchedule,
  validateStoredRoutineSchedule,
} from "@openbot/team-client/routine-schedule";
import {
  databaseRows,
  optionalStringColumn,
  requiredNumberColumn,
  requiredStringColumn,
} from "./database/database-rows";
import type { OpenBotDatabase } from "./openbot-database";
import { hasWebhookReceipt, insertWebhookReceipt, revokeRoutineWebhooks } from "./webhook-route-store";
import { parseEventFilters, validateWebhookTrigger, webhookMismatch, webhookRunInstruction } from "./webhook-trigger";

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
  ownerKind: EventRoutineOwner["kind"];
  routineTable: string;
  triggerTable: string;
  webhookTable: string;
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
  missedPolicy?: RoutineMissedPolicy;
}

export interface RoutineUpdateFields {
  routineId: string;
  name?: string;
  instruction?: string;
  active?: boolean;
  schedule?: RoutineSchedule;
  limitPolicy?: RoutineLimitPolicy;
  missedPolicy?: RoutineMissedPolicy;
}

interface RoutineWebhookFields {
  routeId: string;
  url: string | null;
  eventType: string | null;
  filters: EventFilter[];
  createdAt: string;
  updatedAt: string;
}

/**
 * A routine starts from a schedule trigger row or from a webhook row, never both. The released
 * routine API reads only the schedule kind; `listRecords` and `getRecord` read both.
 */
type RoutineRecordTrigger =
  | ({ kind: "schedule" } & OwnedRoutine["trigger"])
  | ({ kind: "webhook" } & RoutineWebhookFields);

export interface OwnedRoutineRecord extends Omit<OwnedRoutine, "trigger"> {
  trigger: RoutineRecordTrigger;
}

export interface RoutineRecordInput {
  name: string;
  instruction: string;
  active: boolean;
  timezone: string;
  limitPolicy?: RoutineLimitPolicy;
  missedPolicy?: RoutineMissedPolicy;
  trigger:
    | { kind: "schedule"; schedule: RoutineSchedule }
    /** A null secret keeps the stored one. */
    | { kind: "webhook"; eventType: string | null; filters: EventFilter[]; secretCiphertext: string | null };
}

export interface ReceivedWebhookEvent {
  deliveryId: string;
  eventType: string;
  data: EventJsonValue;
  occurredAt: string;
  receivedAt: string;
}

export type WebhookReceiveResult<Run = OwnedRoutineRun> =
  | { kind: "started"; run: Run }
  | { kind: "ignored"; reason: "event-type" | "filter" | "inactive" }
  | { kind: "duplicate" }
  | { kind: "gone" }
  | { kind: "too-large" };

/** The time from a hold of the routines to the restart that the hold waited for. */
export interface RoutineHoldWindow {
  since: Date;
  until: Date;
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
    return `routine_id, ${this.tables.ownerColumn}, name, instruction, active, timezone, limit_policy, missed_policy,
            created_at, updated_at`;
  }

  protected get runColumns(): string {
    return `run_id, routine_id, ${this.tables.ownerColumn}, trigger_id, run_kind, scheduled_for, routine_name,
            instruction, ${this.tables.handleColumn}, status, error, missed_count, missed_until, created_at, updated_at`;
  }

  protected listRoutines(ownerId: string): OwnedRoutine[] {
    return databaseRows(
      this.database.connection
        .prepare(
          `SELECT ${this.routineColumns}
           FROM ${this.tables.routineTable} WHERE ${this.tables.ownerColumn} = ? AND ${this.#hasSchedule}
           ORDER BY updated_at DESC, routine_id`,
        )
        .all(ownerId),
    ).map((row) => this.#routine(row));
  }

  /** Routines of every trigger kind. */
  listRecords(ownerId: string): OwnedRoutineRecord[] {
    return databaseRows(
      this.database.connection
        .prepare(
          `SELECT ${this.routineColumns}
           FROM ${this.tables.routineTable} WHERE ${this.tables.ownerColumn} = ?
           ORDER BY updated_at DESC, routine_id`,
        )
        .all(ownerId),
    ).map((row) => this.#record(row));
  }

  getRecord(ownerId: string, routineId: string): OwnedRoutineRecord | null {
    const row = this.database.connection
      .prepare(
        `SELECT ${this.routineColumns}
         FROM ${this.tables.routineTable} WHERE routine_id = ? AND ${this.tables.ownerColumn} = ?`,
      )
      .get(routineId, ownerId);
    return isDynamicRecord(row) ? this.#record(row) : null;
  }

  /** The released routine API sees only routines that a schedule starts. */
  get #hasSchedule(): string {
    return `EXISTS (SELECT 1 FROM ${this.tables.triggerTable} WHERE routine_id = ${this.tables.routineTable}.routine_id)`;
  }

  protected getRoutine(ownerId: string, routineId: string): OwnedRoutine | null {
    const row = this.database.connection
      .prepare(
        `SELECT ${this.routineColumns}
         FROM ${this.tables.routineTable}
         WHERE routine_id = ? AND ${this.tables.ownerColumn} = ? AND ${this.#hasSchedule}`,
      )
      .get(routineId, ownerId);
    return isDynamicRecord(row) ? this.#routine(row) : null;
  }

  protected createRoutine(ownerId: string, input: RoutineInputFields, now = new Date()): OwnedRoutine {
    this.#validateInput(input.name, input.instruction, input.timezone, input.schedule, null);
    this.#assertBelowLimit(ownerId);
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
             routine_id, ${ownerColumn}, name, instruction, active, timezone, limit_policy, missed_policy, created_at,
             updated_at, last_event_sequence
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          routineId,
          ownerId,
          input.name.trim(),
          input.instruction.trim(),
          input.active ? 1 : 0,
          input.timezone,
          input.limitPolicy ?? "wait",
          input.missedPolicy ?? "skip",
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
    this.#validateInput(name, instruction, current.timezone, schedule, current.trigger.schedule);
    const active = input.active ?? current.active;
    const limitPolicy = input.limitPolicy ?? current.limitPolicy ?? "wait";
    const missedPolicy = input.missedPolicy ?? current.missedPolicy ?? "skip";
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
           SET name = ?, instruction = ?, active = ?, limit_policy = ?, missed_policy = ?, updated_at = ?,
               last_event_sequence = ?
           WHERE routine_id = ? AND ${ownerColumn} = ?`,
        ).run(
          name.trim(),
          instruction.trim(),
          active ? 1 : 0,
          limitPolicy,
          missedPolicy,
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

  /**
   * Creates or replaces a routine of either trigger kind. A changed trigger kind keeps the routine
   * ID and its runs. Leaving the webhook kind revokes the public route in the same transaction.
   */
  saveRecord(
    ownerId: string,
    routineId: string | undefined,
    input: RoutineRecordInput,
    now = new Date(),
  ): OwnedRoutineRecord {
    this.#validateFields(input.name, input.instruction);
    const current = routineId === undefined ? null : this.getRecord(ownerId, routineId);
    if (routineId !== undefined && !current) throw new RoutineInputError(sourceText("error.backend.routineGone"));
    if (!current) this.#assertBelowLimit(ownerId);
    const trigger = input.trigger;
    let schedule: RoutineSchedule | null = null;
    if (trigger.kind === "schedule") {
      schedule = normalizeRoutineSchedule(trigger.schedule, now);
      const stored = current?.trigger.kind === "schedule" ? current.trigger.schedule : null;
      this.#validateSchedule(schedule, input.timezone, stored);
    } else {
      validateWebhookTrigger(trigger.eventType, trigger.filters);
    }
    const id = current?.id ?? randomUUID();
    const limitPolicy = input.limitPolicy ?? current?.limitPolicy ?? "wait";
    const missedPolicy = input.missedPolicy ?? current?.missedPolicy ?? "skip";
    const timestamp = now.toISOString();
    const { commandPrefix, eventPrefix, routineAggregate, routineTable, triggerTable, webhookTable, ownerColumn } =
      this.tables;
    const eventTrigger =
      trigger.kind === "schedule"
        ? { kind: "schedule", schedule }
        : { kind: "webhook", eventType: trigger.eventType, filters: trigger.filters };
    return this.database.dispatch(
      `${commandPrefix}:${current ? "update" : "create"}:${id}:${randomUUID()}`,
      [
        {
          aggregateType: routineAggregate,
          aggregateId: id,
          eventType: `${eventPrefix}.${current ? "updated" : "created"}`,
          payload: {
            ownerId,
            name: input.name,
            instruction: input.instruction,
            active: input.active,
            timezone: input.timezone,
            limitPolicy,
            missedPolicy,
            trigger: eventTrigger,
          },
        },
      ],
      (db, sequences) => {
        const sequence = sequences[0] ?? 0;
        db.prepare(
          `INSERT INTO ${routineTable} (
             routine_id, ${ownerColumn}, name, instruction, active, timezone, limit_policy, missed_policy, created_at,
             updated_at, last_event_sequence
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(routine_id) DO UPDATE SET
             name = excluded.name, instruction = excluded.instruction, active = excluded.active,
             timezone = excluded.timezone, limit_policy = excluded.limit_policy,
             missed_policy = excluded.missed_policy, updated_at = excluded.updated_at,
             last_event_sequence = excluded.last_event_sequence`,
        ).run(
          id,
          ownerId,
          input.name.trim(),
          input.instruction.trim(),
          input.active ? 1 : 0,
          input.timezone,
          limitPolicy,
          missedPolicy,
          current?.createdAt ?? timestamp,
          timestamp,
          sequence,
        );
        if (schedule) {
          if (current?.trigger.kind === "webhook") {
            revokeRoutineWebhooks(db, this.tables.ownerKind, [id], { forget: false }, now);
          }
          const unchanged =
            current?.trigger.kind === "schedule" &&
            current.timezone === input.timezone &&
            JSON.stringify(current.trigger.schedule) === JSON.stringify(schedule);
          if (unchanged && !current.active && input.active) {
            db.prepare(
              `UPDATE ${triggerTable} SET next_run_at = ?, updated_at = ?, last_event_sequence = ?
               WHERE routine_id = ?`,
            ).run(nextRoutineOccurrence(schedule, input.timezone, now).toISOString(), timestamp, sequence, id);
          } else if (!unchanged) {
            db.prepare(`DELETE FROM ${triggerTable} WHERE routine_id = ?`).run(id);
            this.#insertTrigger(db, id, input.timezone, schedule, timestamp, sequence, now);
          }
        } else if (trigger.kind === "webhook") {
          if (current?.trigger.kind === "webhook") {
            db.prepare(
              `UPDATE ${webhookTable}
               SET event_type = ?, filters_json = ?, secret_ciphertext = COALESCE(?, secret_ciphertext),
                   updated_at = ?, last_event_sequence = ?
               WHERE routine_id = ?`,
            ).run(
              trigger.eventType,
              JSON.stringify(trigger.filters),
              trigger.secretCiphertext,
              timestamp,
              sequence,
              id,
            );
          } else {
            db.prepare(`DELETE FROM ${triggerTable} WHERE routine_id = ?`).run(id);
            db.prepare(
              `INSERT INTO ${webhookTable} (
                 routine_id, route_id, event_type, filters_json, secret_ciphertext, url, created_at, updated_at,
                 last_event_sequence
               ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
            ).run(
              id,
              randomUUID(),
              trigger.eventType,
              JSON.stringify(trigger.filters),
              trigger.secretCiphertext,
              timestamp,
              timestamp,
              sequence,
            );
          }
        }
        const saved = this.getRecord(ownerId, id);
        if (!saved) throw new Error("The routine projection could not be read.");
        return saved;
      },
    );
  }

  /**
   * Records one verified webhook request and, when it matches, creates the run in the same
   * transaction. The caller starts the run after the commit; a crash before that leaves a run that
   * `pendingRunRows` resumes. The event stays in the run instruction only, as framed data.
   */
  protected receiveWebhookRow(ownerId: string, routineId: string, event: ReceivedWebhookEvent): WebhookReceiveResult {
    const routine = this.getRecord(ownerId, routineId);
    if (routine?.trigger.kind !== "webhook") return { kind: "gone" };
    const db = this.database.connection;
    const receipt = {
      ownerKind: this.tables.ownerKind,
      routineId,
      deliveryId: event.deliveryId,
      eventType: event.eventType,
      receivedAt: event.receivedAt,
    };
    if (hasWebhookReceipt(db, receipt)) return { kind: "duplicate" };
    const reason = routine.active
      ? webhookMismatch(routine.trigger, { type: event.eventType, data: event.data })
      : "inactive";
    if (reason) {
      insertWebhookReceipt(db, { ...receipt, status: "ignored", reason, runId: null });
      return { kind: "ignored", reason };
    }
    const runId = randomUUID();
    const instruction = webhookRunInstruction(routine.instruction, {
      version: 1,
      id: event.deliveryId,
      routineId,
      type: event.eventType,
      occurredAt: event.occurredAt,
      receivedAt: event.receivedAt,
      data: event.data,
    });
    // The run input goes through the message limit. No receipt, so the sender can retry after a change.
    if (instruction.length > INPUT_LIMITS.messageText) return { kind: "too-large" };
    const { commandPrefix, eventPrefix, runAggregate } = this.tables;
    return this.database.dispatch(
      `${commandPrefix}-run:webhook:${routineId}:${randomUUID()}`,
      [
        {
          aggregateType: runAggregate,
          aggregateId: routineId,
          eventType: `${eventPrefix}.run-created`,
          payload: { runId, triggerId: null, kind: "manual", scheduledFor: event.receivedAt },
        },
      ],
      (db, sequences): WebhookReceiveResult => {
        insertWebhookReceipt(db, { ...receipt, status: "started", reason: null, runId });
        this.#insertRun(db, runId, { ...routine, instruction }, null, "manual", event.receivedAt, sequences[0] ?? 0);
        return { kind: "started", run: this.#requireRun(runId) };
      },
    );
  }

  delete(ownerId: string, routineId: string): void {
    if (!this.getRecord(ownerId, routineId)) throw new RoutineInputError(sourceText("error.backend.routineGone"));
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
        revokeRoutineWebhooks(db, this.tables.ownerKind, [routineId], { forget: true });
        db.prepare(`DELETE FROM ${routineTable} WHERE routine_id = ? AND ${ownerColumn} = ?`).run(routineId, ownerId);
        return null;
      },
    );
  }

  /** Skipped-run records only fill the local history, so other readers do not get them by default. */
  protected listRunRows(ownerId: string, routineId: string, limit = 50, withSkipped = false): OwnedRoutineRun[] {
    const safeLimit = Math.max(1, Math.min(INPUT_LIMITS.routineRunsPage, limit));
    return databaseRows(
      this.database.connection
        .prepare(
          `SELECT ${this.runColumns}
           FROM ${this.tables.runTable}
           WHERE routine_id = ? AND ${this.tables.ownerColumn} = ?${withSkipped ? "" : " AND missed_count IS NULL"}
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
                  routine.limit_policy, routine.missed_policy, routine.created_at, routine.updated_at
           FROM ${triggerTable} trigger
           JOIN ${routineTable} routine ON routine.routine_id = trigger.routine_id
           WHERE routine.active = 1 AND trigger.next_run_at <= ?
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
   * Missed occurrences are never replayed: a closed app must not wake into a backlog. The ones a
   * routine drops are recorded on one cancelled run. A routine set to run once keeps its newest
   * occurrence due, so the scheduler runs it now. A trigger that came due while a restart held the
   * routines stays due as well, so it runs once now.
   */
  skipMissed(now = new Date(), held?: RoutineHoldWindow): void {
    for (const routine of this.#allActive()) {
      const { trigger } = routine;
      const due = Date.parse(trigger.nextRunAt);
      if (held && due >= held.since.getTime() && due <= held.until.getTime()) continue;
      if (due > now.getTime()) {
        this.advanceTrigger(
          routine.id,
          trigger.id,
          nextRoutineOccurrence(trigger.schedule, routine.timezone, now).toISOString(),
        );
        continue;
      }
      // A crash after a run was made and before its trigger moved leaves that occurrence due. It ran.
      // The scheduler can make that run at a later, collapsed occurrence, so the newest run counts.
      const ran = this.#latestScheduledRun(trigger.id, trigger.nextRunAt);
      const first = ran ? nextRoutineOccurrence(trigger.schedule, routine.timezone, new Date(ran)) : new Date(due);
      if (first.getTime() > now.getTime()) {
        this.advanceTrigger(routine.id, trigger.id, first.toISOString());
        continue;
      }
      const missed = missedOccurrences(trigger.schedule, routine.timezone, first, now);
      if (routine.missedPolicy === "run-once") {
        if (!missed.previous) continue;
        const count = missed.truncated ? missed.count : missed.count - 1;
        this.#recordMissed(routine, { first, until: missed.previous, count }, missed.last);
      } else {
        this.#recordMissed(routine, { first, until: missed.last, count: missed.count }, missed.next);
      }
    }
  }

  /** The newest scheduled run of the trigger at or after `from`. */
  #latestScheduledRun(triggerId: string, from: string): string | null {
    const row = this.database.connection
      .prepare(
        `SELECT MAX(scheduled_for) AS scheduled_for FROM ${this.tables.runTable}
         WHERE trigger_id = ? AND run_kind = 'scheduled' AND scheduled_for >= ?`,
      )
      .get(triggerId, from);
    return isDynamicRecord(row) && typeof row.scheduled_for === "string" ? row.scheduled_for : null;
  }

  /**
   * Records the skipped occurrences on one cancelled run and moves the trigger in one transaction, so
   * a crash cannot record them twice. The run is never queued: it only fills the history.
   */
  #recordMissed(routine: OwnedRoutine, skipped: { first: Date; until: Date; count: number }, nextRunAt: Date): void {
    const { commandPrefix, eventPrefix, routineAggregate, runAggregate, triggerTable, runTable, ownerColumn } =
      this.tables;
    const triggerId = routine.trigger.id;
    const runId = randomUUID();
    const scheduledFor = skipped.first.toISOString();
    const until = skipped.count > 1 ? skipped.until.toISOString() : null;
    const next = nextRunAt.toISOString();
    this.database.dispatch(
      `${commandPrefix}-trigger:missed:${triggerId}:${scheduledFor}`,
      [
        {
          aggregateType: runAggregate,
          aggregateId: routine.id,
          eventType: `${eventPrefix}.run-missed`,
          payload: { runId, triggerId, scheduledFor, until, count: skipped.count },
        },
        {
          aggregateType: routineAggregate,
          aggregateId: routine.id,
          eventType: `${eventPrefix}.trigger-advanced`,
          payload: { triggerId, nextRunAt: next },
        },
      ],
      (db, sequences) => {
        const timestamp = new Date().toISOString();
        db.prepare(
          `INSERT INTO ${runTable} (
             run_id, routine_id, ${ownerColumn}, trigger_id, run_kind, scheduled_for, routine_name, instruction,
             status, error, missed_count, missed_until, created_at, updated_at, last_event_sequence
           ) VALUES (?, ?, ?, ?, 'scheduled', ?, ?, ?, 'cancelled', NULL, ?, ?, ?, ?, ?)`,
        ).run(
          runId,
          routine.id,
          routine.ownerId,
          triggerId,
          scheduledFor,
          routine.name,
          routine.instruction,
          skipped.count,
          until,
          timestamp,
          timestamp,
          sequences[0] ?? 0,
        );
        db.prepare(
          `UPDATE ${triggerTable} SET next_run_at = ?, updated_at = ?, last_event_sequence = ?
           WHERE trigger_id = ? AND routine_id = ?`,
        ).run(next, timestamp, sequences[1] ?? 0, triggerId, routine.id);
        return null;
      },
    );
  }

  protected createRunRow(
    routine: RunSource,
    triggerId: string | null,
    kind: OwnedRoutineRun["kind"],
    scheduledFor: string,
  ): OwnedRoutineRun {
    const { commandPrefix, eventPrefix, runAggregate } = this.tables;
    const commandId = triggerId
      ? `${commandPrefix}-run:scheduled:${triggerId}:${scheduledFor}`
      : `${commandPrefix}-run:manual:${routine.id}:${randomUUID()}`;
    const runId = randomUUID();
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
        this.#insertRun(db, runId, routine, triggerId, kind, scheduledFor, sequences[0] ?? 0);
        return this.#requireRun(runId);
      },
    );
  }

  #insertRun(
    db: OpenBotDatabase["connection"],
    runId: string,
    routine: RunSource,
    triggerId: string | null,
    kind: OwnedRoutineRun["kind"],
    scheduledFor: string,
    sequence: number,
  ): void {
    const { runTable, ownerColumn, handleColumn } = this.tables;
    const createdAt = new Date().toISOString();
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
      sequence,
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
          `SELECT ${this.routineColumns} FROM ${this.tables.routineTable} WHERE active = 1 AND ${this.#hasSchedule}`,
        )
        .all(),
    ).map((row) => this.#routine(row));
  }

  #routine(row: DynamicRecord): OwnedRoutine {
    const fields = this.#fields(row);
    return { ...fields, trigger: this.#scheduleTrigger(fields.id) };
  }

  #record(row: DynamicRecord): OwnedRoutineRecord {
    const fields = this.#fields(row);
    const webhook = this.database.connection
      .prepare(
        `SELECT route_id, url, event_type, filters_json, created_at, updated_at
         FROM ${this.tables.webhookTable} WHERE routine_id = ?`,
      )
      .get(fields.id);
    if (!isDynamicRecord(webhook))
      return { ...fields, trigger: { kind: "schedule", ...this.#scheduleTrigger(fields.id) } };
    return {
      ...fields,
      trigger: {
        kind: "webhook",
        routeId: requiredStringColumn(webhook, "route_id"),
        url: optionalStringColumn(webhook, "url"),
        eventType: optionalStringColumn(webhook, "event_type"),
        filters: parseEventFilters(requiredStringColumn(webhook, "filters_json")),
        createdAt: requiredStringColumn(webhook, "created_at"),
        updatedAt: requiredStringColumn(webhook, "updated_at"),
      },
    };
  }

  #fields(row: DynamicRecord): Omit<OwnedRoutine, "trigger"> {
    const limitPolicy = requiredStringColumn(row, "limit_policy");
    if (!isOneOf(ROUTINE_LIMIT_POLICIES, limitPolicy)) throw new Error("The stored routine limit policy is invalid.");
    const missedPolicy = requiredStringColumn(row, "missed_policy");
    if (!isOneOf(ROUTINE_MISSED_POLICIES, missedPolicy))
      throw new Error("The stored routine missed-run policy is invalid.");
    return {
      id: requiredStringColumn(row, "routine_id"),
      ownerId: requiredStringColumn(row, this.tables.ownerColumn),
      name: requiredStringColumn(row, "name"),
      instruction: requiredStringColumn(row, "instruction"),
      active: requiredNumberColumn(row, "active") === 1,
      timezone: requiredStringColumn(row, "timezone"),
      limitPolicy,
      missedPolicy,
      createdAt: requiredStringColumn(row, "created_at"),
      updatedAt: requiredStringColumn(row, "updated_at"),
    };
  }

  #scheduleTrigger(routineId: string): OwnedRoutine["trigger"] {
    const trigger = this.database.connection
      .prepare(
        `SELECT trigger_id, schedule_json, next_run_at, created_at, updated_at
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
  }

  /** The limit counts routines of every trigger kind. */
  #assertBelowLimit(ownerId: string): void {
    const row = this.database.connection
      .prepare(`SELECT COUNT(*) AS count FROM ${this.tables.routineTable} WHERE ${this.tables.ownerColumn} = ?`)
      .get(ownerId);
    if (isDynamicRecord(row) && requiredNumberColumn(row, "count") >= this.tables.limit) {
      throw new RoutineInputError(this.tables.limitMessage);
    }
  }

  #run(row: DynamicRecord): OwnedRoutineRun {
    const status = requiredStringColumn(row, "status");
    if (!isRoutineRunStatus(status)) throw new Error("The stored routine run status is invalid.");
    const kind = requiredStringColumn(row, "run_kind");
    if (kind !== "scheduled" && kind !== "manual") throw new Error("The stored routine run kind is invalid.");
    const missedCount = row.missed_count;
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
      ...(missedCount === null
        ? {}
        : {
            missed: {
              count: requiredNumberColumn(row, "missed_count"),
              until: optionalStringColumn(row, "missed_until"),
            },
          }),
      createdAt: requiredStringColumn(row, "created_at"),
      updatedAt: requiredStringColumn(row, "updated_at"),
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

  #validateInput(
    name: string,
    instruction: string,
    timezone: string,
    schedule: RoutineSchedule,
    stored: RoutineSchedule | null,
  ): void {
    this.#validateFields(name, instruction);
    this.#validateSchedule(schedule, timezone, stored);
  }

  /** A new or changed schedule gets the full check; an unchanged one stays editable, as an older version stored it. */
  #validateSchedule(schedule: RoutineSchedule, timezone: string, stored: RoutineSchedule | null): void {
    if (stored && JSON.stringify(stored) === JSON.stringify(schedule))
      validateStoredRoutineSchedule(schedule, timezone);
    else validateRoutineSchedule(schedule, timezone);
  }

  #validateFields(name: string, instruction: string): void {
    const normalizedName = name.trim();
    const normalizedInstruction = instruction.trim();
    if (!normalizedName) throw new RoutineInputError(sourceText("error.backend.routineNameRequired"));
    if (name.length > INPUT_LIMITS.routineName)
      throw new RoutineInputError(sourceText("error.backend.routineNameTooLong"));
    if (!normalizedInstruction) throw new RoutineInputError(sourceText("error.backend.routineInstructionRequired"));
    if (instruction.length > INPUT_LIMITS.routineInstruction)
      throw new RoutineInputError(sourceText("error.backend.routineInstructionTooLong"));
  }
}

type RunSource = Pick<OwnedRoutine, "id" | "ownerId" | "name" | "instruction">;

/** The walk counts at most one past the exact limit, which reads as "more than the limit". */
const MISSED_WALK_LIMIT = ROUTINE_MISSED_COUNT_LIMIT + 1;
const HOUR_MS = 3_600_000;
/** Windows before now that the walk searches, shortest first, once the count passes the limit. */
const MISSED_WINDOWS_MS = [HOUR_MS, 24 * HOUR_MS, 32 * 24 * HOUR_MS, 400 * 24 * HOUR_MS, Number.POSITIVE_INFINITY];

interface MissedOccurrences {
  /** Exact up to the limit, then `MISSED_WALK_LIMIT`. */
  count: number;
  /** The walk stopped at the limit, so `count` is a lower bound. */
  truncated: boolean;
  last: Date;
  previous: Date | null;
  next: Date;
}

/**
 * The occurrences from `first` through `now`. One step costs tens of microseconds, and a routine
 * every three minutes misses thousands in a week, so the walk stops counting at the limit. It then
 * finds the newest two in the shortest window before `now` that holds two.
 */
function missedOccurrences(schedule: RoutineSchedule, timezone: string, first: Date, now: Date): MissedOccurrences {
  validateStoredRoutineSchedule(schedule, timezone);
  const step = (after: Date) => nextValidRoutineOccurrence(schedule, timezone, after);
  let previous: Date | null = null;
  let last = first;
  let count = 1;
  let next = step(last);
  while (next.getTime() <= now.getTime() && count < MISSED_WALK_LIMIT) {
    previous = last;
    last = next;
    count += 1;
    next = step(last);
  }
  if (next.getTime() > now.getTime()) return { count, truncated: false, last, previous, next };
  for (const window of MISSED_WINDOWS_MS) {
    const start = Math.max(last.getTime(), now.getTime() - window);
    let newest: Date | null = start === last.getTime() ? last : null;
    let before: Date | null = start === last.getTime() ? previous : null;
    let cursor = step(new Date(start));
    while (cursor.getTime() <= now.getTime()) {
      before = newest;
      newest = cursor;
      cursor = step(cursor);
    }
    if (newest && before) return { count, truncated: true, last: newest, previous: before, next: cursor };
  }
  throw new Error("The missed routine occurrences could not be found.");
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
