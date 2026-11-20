import { randomUUID } from "node:crypto";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  RoutineFields,
  RoutineLimitPolicy,
  RoutineMissedPolicy,
  RoutinePausedByRun,
  RoutineRunFields,
  RoutineRunPlace,
  RoutineRunSource,
  RoutineRunStatus,
  RoutineSchedule,
} from "@openbot/contracts/ipc";
import {
  isRoutinePausedByRun,
  isRoutineSchedule,
  ROUTINE_LIMIT_POLICIES,
  ROUTINE_MISSED_COUNT_LIMIT,
  ROUTINE_MISSED_POLICIES,
  ROUTINE_RUN_PLACES,
  ROUTINE_RUN_SOURCES,
} from "@openbot/contracts/ipc";
import type { EventFilter, EventJsonValue, EventRoutineOwner } from "@openbot/contracts/ipc-events";
import { type DynamicRecord, isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import {
  nextRoutineOccurrence,
  nextValidRoutineOccurrence,
  normalizeRoutineSchedule,
  RoutineInputError,
  routineOnceInstant,
  validateRoutineSchedule,
  validateStoredRoutineSchedule,
} from "@openbot/team-client/routine-schedule";
import {
  databaseRow,
  databaseRows,
  optionalStringColumn,
  requiredNumberColumn,
  requiredStringColumn,
} from "./database/database-rows";
import type { OpenBotDatabase } from "./openbot-database";
import { hasWebhookReceipt, insertWebhookReceipt, revokeRoutineWebhooks } from "./webhook-route-store";
import { parseEventFilters, validateWebhookTrigger, webhookMismatch, webhookRunInstruction } from "./webhook-trigger";

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
  runInColumn: boolean;
}

export interface OwnedRoutine extends RoutineFields {
  ownerId: string;
}

export type RoutineRunStart = "scheduled" | RoutineRunSource;

export interface ImportedRoutineRun {
  kind: "scheduled" | "manual";
  source?: RoutineRunSource;
  scheduledFor: string;
  routineName: string;
  instruction: string;
  status: RoutineRunStatus;
  error: string | null;
  missed?: { count: number; until: string | null };
  createdAt: string;
  updatedAt: string;
}

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
  runIn?: RoutineRunPlace;
}

export interface RoutineUpdateFields {
  routineId: string;
  name?: string;
  instruction?: string;
  active?: boolean;
  schedule?: RoutineSchedule;
  limitPolicy?: RoutineLimitPolicy;
  missedPolicy?: RoutineMissedPolicy;
  runIn?: RoutineRunPlace;
}

interface RoutineWebhookFields {
  routeId: string;
  url: string | null;
  eventType: string | null;
  filters: EventFilter[];
  createdAt: string;
  updatedAt: string;
}

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
  runIn?: RoutineRunPlace;
  trigger:
    | { kind: "schedule"; schedule: RoutineSchedule }
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
    const { routineTable, eventPrefix, ownerColumn, runInColumn } = this.tables;
    return `routine_id, ${ownerColumn}, name, instruction, active, timezone, limit_policy, missed_policy,
            ${runInColumn ? "run_in, " : ""}created_at, updated_at,
            (SELECT payload_json FROM orchestration_events
             WHERE sequence = ${routineTable}.last_event_sequence AND event_type = '${eventPrefix}.paused-by-run')
              AS paused_by_run`;
  }

  protected get runColumns(): string {
    return `run_id, routine_id, ${this.tables.ownerColumn}, trigger_id, run_kind, scheduled_for, routine_name,
            instruction, ${this.tables.handleColumn}, status, error, missed_count, missed_until, run_source, created_at,
            updated_at`;
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

  listRecords(ownerId: string): OwnedRoutineRecord[] {
    return databaseRows(
      this.database.connection
        .prepare(
          `SELECT ${this.routineColumns}
           FROM ${this.tables.routineTable} WHERE ${this.tables.ownerColumn} = ? AND ${this.#hasTrigger}
           ORDER BY updated_at DESC, routine_id`,
        )
        .all(ownerId),
    ).map((row) => this.#record(row));
  }

  getRecord(ownerId: string, routineId: string): OwnedRoutineRecord | null {
    const row = this.database.connection
      .prepare(
        `SELECT ${this.routineColumns}
         FROM ${this.tables.routineTable}
         WHERE routine_id = ? AND ${this.tables.ownerColumn} = ? AND ${this.#hasTrigger}`,
      )
      .get(routineId, ownerId);
    return isDynamicRecord(row) ? this.#record(row) : null;
  }

  get #hasSchedule(): string {
    return `EXISTS (SELECT 1 FROM ${this.tables.triggerTable} WHERE routine_id = ${this.tables.routineTable}.routine_id)`;
  }

  get #hasTrigger(): string {
    return `(${this.#hasSchedule} OR EXISTS (SELECT 1 FROM ${this.tables.webhookTable}
             WHERE routine_id = ${this.tables.routineTable}.routine_id))`;
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
    if (input.active) assertOnceAhead(schedule, input.timezone, now);
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
          limitPolicyFor(schedule, input.limitPolicy),
          input.missedPolicy ?? defaultMissedPolicy(schedule),
          createdAt,
          createdAt,
          sequence,
        );
        this.#writeRunIn(db, routineId, input.runIn ?? "chat");
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
    const limitPolicy = limitPolicyFor(schedule, input.limitPolicy ?? current.limitPolicy);
    const missedPolicy = input.missedPolicy ?? current.missedPolicy ?? "skip";
    const reactivating = !current.active && active;
    if (active && (input.schedule || reactivating)) assertOnceAhead(schedule, current.timezone, now);
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
        if (input.runIn) this.#writeRunIn(db, input.routineId, input.runIn);
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
    const limitPolicy = schedule
      ? limitPolicyFor(schedule, input.limitPolicy ?? current?.limitPolicy)
      : (input.limitPolicy ?? current?.limitPolicy ?? "wait");
    const missedPolicy =
      input.missedPolicy ?? current?.missedPolicy ?? (schedule ? defaultMissedPolicy(schedule) : "skip");
    const runIn = this.tables.runInColumn ? (input.runIn ?? current?.runIn ?? "chat") : undefined;
    const timestamp = now.toISOString();
    const running =
      current?.active &&
      current.trigger.kind === "schedule" &&
      current.timezone === input.timezone &&
      JSON.stringify(current.trigger.schedule) === JSON.stringify(schedule);
    if (schedule && input.active && !running) assertOnceAhead(schedule, input.timezone, now);
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
            ...(runIn ? { runIn } : {}),
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
        if (runIn) this.#writeRunIn(db, id, runIn);
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
    if (instruction.length > INPUT_LIMITS.messageText) return { kind: "too-large" };
    const { commandPrefix, eventPrefix, runAggregate } = this.tables;
    return this.database.dispatch(
      `${commandPrefix}-run:webhook:${routineId}:${randomUUID()}`,
      [
        {
          aggregateType: runAggregate,
          aggregateId: routineId,
          eventType: `${eventPrefix}.run-created`,
          payload: { runId, triggerId: null, kind: "manual", source: "webhook", scheduledFor: event.receivedAt },
        },
      ],
      (db, sequences): WebhookReceiveResult => {
        insertWebhookReceipt(db, { ...receipt, status: "started", reason: null, runId });
        this.#insertRun(db, runId, { ...routine, instruction }, null, "webhook", event.receivedAt, sequences[0] ?? 0);
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

  protected pendingRunRows(): OwnedRoutineRun[] {
    return this.#queuedRunRows(`AND ${this.tables.handleColumn} IS NULL`);
  }

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
                  routine.limit_policy, routine.missed_policy, ${this.tables.runInColumn ? "routine.run_in, " : ""}
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
    const current = databaseRow(
      this.database.connection
        .prepare(`SELECT next_run_at, last_event_sequence FROM ${triggerTable} WHERE trigger_id = ? AND routine_id = ?`)
        .get(triggerId, routineId),
    );
    if (!current || current.next_run_at === nextRunAt) return;
    this.database.dispatch(
      `${commandPrefix}-trigger:advance:${triggerId}:${requiredNumberColumn(current, "last_event_sequence")}:${nextRunAt}`,
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

  skipMissed(now = new Date(), held?: RoutineHoldWindow): void {
    for (const routine of this.#allActive()) {
      const { missedPolicy, trigger } = routine;
      const due = Date.parse(trigger.nextRunAt);
      if (held && due >= held.since.getTime() && due <= held.until.getTime()) continue;
      if (trigger.schedule.kind === "once") {
        if (due <= now.getTime()) this.#settleMissedOnce(routine, now, missedPolicy);
        continue;
      }
      if (due > now.getTime()) {
        this.advanceTrigger(
          routine.id,
          trigger.id,
          nextRoutineOccurrence(trigger.schedule, routine.timezone, now).toISOString(),
        );
        continue;
      }
      const ran = this.#latestScheduledRun(trigger.id, trigger.nextRunAt);
      const first = ran ? nextRoutineOccurrence(trigger.schedule, routine.timezone, new Date(ran)) : new Date(due);
      if (first.getTime() > now.getTime()) {
        this.advanceTrigger(routine.id, trigger.id, first.toISOString());
        continue;
      }
      const missed = missedOccurrences(trigger.schedule, routine.timezone, first, now);
      if (missedPolicy === "run-once") {
        if (!missed.previous) continue;
        const count = missed.truncated ? missed.count : missed.count - 1;
        this.#recordMissed(routine, { first, until: missed.previous, count }, missed.last);
      } else {
        this.#recordMissed(routine, { first, until: missed.last, count: missed.count }, missed.next);
      }
    }
  }

  #settleMissedOnce(routine: OwnedRoutine, now: Date, missedPolicy: RoutineMissedPolicy | undefined): void {
    const { trigger } = routine;
    if (this.#latestScheduledRun(trigger.id, trigger.nextRunAt)) {
      this.completeTrigger(routine.id, trigger.id, now);
      return;
    }
    if (missedPolicy === "run-once") return;
    const at = new Date(trigger.nextRunAt);
    this.#recordMissed(routine, { first: at, until: at, count: 1 }, null);
  }

  markPausedByRun(routineId: string, pausedByRun: RoutinePausedByRun): void {
    const { commandPrefix, eventPrefix, routineAggregate, routineTable } = this.tables;
    this.database.dispatch(
      `${commandPrefix}:paused-by-run:${routineId}:${randomUUID()}`,
      [
        {
          aggregateType: routineAggregate,
          aggregateId: routineId,
          eventType: `${eventPrefix}.paused-by-run`,
          payload: { scheduledFor: pausedByRun.scheduledFor },
        },
      ],
      (db, sequences) => {
        db.prepare(`UPDATE ${routineTable} SET last_event_sequence = ? WHERE routine_id = ? AND active = 0`).run(
          sequences[0] ?? 0,
          routineId,
        );
        return null;
      },
    );
  }

  completeTrigger(routineId: string, triggerId: string, now = new Date()): void {
    const { commandPrefix, eventPrefix, routineAggregate, routineTable } = this.tables;
    this.database.dispatch(
      `${commandPrefix}-trigger:complete:${triggerId}`,
      [
        {
          aggregateType: routineAggregate,
          aggregateId: routineId,
          eventType: `${eventPrefix}.trigger-completed`,
          payload: { triggerId },
        },
      ],
      (db, sequences) => {
        db.prepare(
          `UPDATE ${routineTable} SET active = 0, updated_at = ?, last_event_sequence = ? WHERE routine_id = ?`,
        ).run(now.toISOString(), sequences[0] ?? 0, routineId);
        return null;
      },
    );
  }

  #latestScheduledRun(triggerId: string, from: string): string | null {
    const row = this.database.connection
      .prepare(
        `SELECT MAX(scheduled_for) AS scheduled_for FROM ${this.tables.runTable}
         WHERE trigger_id = ? AND run_kind = 'scheduled' AND scheduled_for >= ?`,
      )
      .get(triggerId, from);
    return isDynamicRecord(row) && typeof row.scheduled_for === "string" ? row.scheduled_for : null;
  }

  protected skipOccurrenceRow(
    routine: OwnedRoutine,
    due: Date,
    scheduledFor: Date,
    nextRunAt: Date,
    reason: string,
  ): void {
    const { runTable, ownerColumn } = this.tables;
    const { schedule } = routine.trigger;
    const { count } = missedOccurrences(schedule, routine.timezone, due, scheduledFor);
    const latest = this.database.connection
      .prepare(
        `SELECT run_id, trigger_id, status, error, missed_count, scheduled_for, missed_until FROM ${runTable}
         WHERE routine_id = ? AND ${ownerColumn} = ? ORDER BY created_at DESC, run_id DESC LIMIT 1`,
      )
      .get(routine.id, routine.ownerId);
    if (
      isDynamicRecord(latest) &&
      isString(latest.run_id) &&
      latest.trigger_id === routine.trigger.id &&
      latest.status === "cancelled" &&
      latest.error === reason &&
      typeof latest.missed_count === "number" &&
      isString(latest.scheduled_for) &&
      nextRoutineOccurrence(
        schedule,
        routine.timezone,
        new Date(isString(latest.missed_until) ? latest.missed_until : latest.scheduled_for),
      ).getTime() === due.getTime()
    ) {
      this.#extendSkipped(routine, latest.run_id, latest.missed_count + count, scheduledFor, nextRunAt);
      return;
    }
    this.#recordMissed(routine, { first: due, until: scheduledFor, count }, nextRunAt, reason);
  }

  #extendSkipped(routine: OwnedRoutine, runId: string, count: number, until: Date, nextRunAt: Date): void {
    const { commandPrefix, eventPrefix, routineAggregate, runAggregate, triggerTable, runTable } = this.tables;
    const triggerId = routine.trigger.id;
    const missedCount = Math.min(count, MISSED_WALK_LIMIT);
    const missedUntil = until.toISOString();
    const next = nextRunAt.toISOString();
    this.database.dispatch(
      `${commandPrefix}-trigger:skipped:${triggerId}:${missedUntil}`,
      [
        {
          aggregateType: runAggregate,
          aggregateId: routine.id,
          eventType: `${eventPrefix}.run-missed`,
          payload: { runId, triggerId, until: missedUntil, count: missedCount },
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
          `UPDATE ${runTable} SET missed_count = ?, missed_until = ?, updated_at = ?, last_event_sequence = ?
           WHERE run_id = ?`,
        ).run(missedCount, missedUntil, timestamp, sequences[0] ?? 0, runId);
        db.prepare(
          `UPDATE ${triggerTable} SET next_run_at = ?, updated_at = ?, last_event_sequence = ?
           WHERE trigger_id = ? AND routine_id = ?`,
        ).run(next, timestamp, sequences[1] ?? 0, triggerId, routine.id);
        return null;
      },
    );
  }

  #recordMissed(
    routine: OwnedRoutine,
    skipped: { first: Date; until: Date; count: number },
    nextRunAt: Date | null,
    reason: string | null = null,
  ): void {
    const {
      commandPrefix,
      eventPrefix,
      routineAggregate,
      runAggregate,
      triggerTable,
      runTable,
      routineTable,
      ownerColumn,
    } = this.tables;
    const triggerId = routine.trigger.id;
    const runId = randomUUID();
    const scheduledFor = skipped.first.toISOString();
    const until = skipped.count > 1 ? skipped.until.toISOString() : null;
    const next = nextRunAt?.toISOString() ?? null;
    this.database.dispatch(
      `${commandPrefix}-trigger:${reason ? "skipped" : "missed"}:${triggerId}:${scheduledFor}`,
      [
        {
          aggregateType: runAggregate,
          aggregateId: routine.id,
          eventType: `${eventPrefix}.run-missed`,
          payload: { runId, triggerId, scheduledFor, until, count: skipped.count },
        },
        next
          ? {
              aggregateType: routineAggregate,
              aggregateId: routine.id,
              eventType: `${eventPrefix}.trigger-advanced`,
              payload: { triggerId, nextRunAt: next },
            }
          : {
              aggregateType: routineAggregate,
              aggregateId: routine.id,
              eventType: `${eventPrefix}.trigger-completed`,
              payload: { triggerId },
            },
      ],
      (db, sequences) => {
        const timestamp = new Date().toISOString();
        db.prepare(
          `INSERT INTO ${runTable} (
             run_id, routine_id, ${ownerColumn}, trigger_id, run_kind, scheduled_for, routine_name, instruction,
             status, error, missed_count, missed_until, created_at, updated_at, last_event_sequence
           ) VALUES (?, ?, ?, ?, 'scheduled', ?, ?, ?, 'cancelled', ?, ?, ?, ?, ?, ?)`,
        ).run(
          runId,
          routine.id,
          routine.ownerId,
          triggerId,
          scheduledFor,
          routine.name,
          routine.instruction,
          reason,
          skipped.count,
          until,
          timestamp,
          timestamp,
          sequences[0] ?? 0,
        );
        if (next) {
          db.prepare(
            `UPDATE ${triggerTable} SET next_run_at = ?, updated_at = ?, last_event_sequence = ?
             WHERE trigger_id = ? AND routine_id = ?`,
          ).run(next, timestamp, sequences[1] ?? 0, triggerId, routine.id);
        } else {
          db.prepare(
            `UPDATE ${routineTable} SET active = 0, updated_at = ?, last_event_sequence = ? WHERE routine_id = ?`,
          ).run(timestamp, sequences[1] ?? 0, routine.id);
        }
        return null;
      },
    );
  }

  protected importRunRows(routineId: string, ownerId: string, runs: readonly ImportedRoutineRun[]): string[] {
    if (runs.length === 0) return [];
    const { commandPrefix, eventPrefix, runAggregate, runTable, ownerColumn } = this.tables;
    const runIds = runs.map(() => randomUUID());
    return this.database.dispatch(
      `${commandPrefix}-run:import:${routineId}:${randomUUID()}`,
      runs.map((run, index) => ({
        aggregateType: runAggregate,
        aggregateId: routineId,
        eventType: `${eventPrefix}.run-imported`,
        payload: { runId: runIds[index], status: run.status, scheduledFor: run.scheduledFor },
      })),
      (db, sequences) => {
        const insert = db.prepare(
          `INSERT INTO ${runTable} (
             run_id, routine_id, ${ownerColumn}, trigger_id, run_kind, run_source, scheduled_for, routine_name,
             instruction, status, error, missed_count, missed_until, created_at, updated_at, last_event_sequence
           ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const [index, run] of runs.entries())
          insert.run(
            runIds[index] ?? randomUUID(),
            routineId,
            ownerId,
            run.kind,
            run.source ?? null,
            run.scheduledFor,
            run.routineName,
            run.instruction,
            run.status,
            run.error,
            run.missed?.count ?? null,
            run.missed?.until ?? null,
            run.createdAt,
            run.updatedAt,
            sequences[index] ?? 0,
          );
        return runIds;
      },
    );
  }

  protected createRunRow(
    routine: RunSource,
    triggerId: string | null,
    start: RoutineRunStart,
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
          payload: { runId, triggerId, ...runStartColumns(start), scheduledFor },
        },
      ],
      (db, sequences) => {
        this.#insertRun(db, runId, routine, triggerId, start, scheduledFor, sequences[0] ?? 0);
        return this.#requireRun(runId);
      },
    );
  }

  #insertRun(
    db: OpenBotDatabase["connection"],
    runId: string,
    routine: RunSource,
    triggerId: string | null,
    start: RoutineRunStart,
    scheduledFor: string,
    sequence: number,
  ): void {
    const { runTable, ownerColumn, handleColumn } = this.tables;
    const createdAt = new Date().toISOString();
    const { kind, source } = runStartColumns(start);
    db.prepare(
      `INSERT INTO ${runTable} (
         run_id, routine_id, ${ownerColumn}, trigger_id, run_kind, run_source, scheduled_for, routine_name,
         instruction, ${handleColumn}, status, error, created_at, updated_at, last_event_sequence
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'queued', NULL, ?, ?, ?)`,
    ).run(
      runId,
      routine.id,
      routine.ownerId,
      triggerId,
      kind,
      source ?? null,
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
    const active = requiredNumberColumn(row, "active") === 1;
    return {
      id: requiredStringColumn(row, "routine_id"),
      ownerId: requiredStringColumn(row, this.tables.ownerColumn),
      name: requiredStringColumn(row, "name"),
      instruction: requiredStringColumn(row, "instruction"),
      active,
      timezone: requiredStringColumn(row, "timezone"),
      limitPolicy,
      missedPolicy,
      ...this.#runIn(row),
      ...(active ? {} : pausedByRunColumn(row)),
      createdAt: requiredStringColumn(row, "created_at"),
      updatedAt: requiredStringColumn(row, "updated_at"),
    };
  }

  #runIn(row: DynamicRecord): { runIn?: RoutineRunPlace } {
    if (!this.tables.runInColumn) return {};
    const runIn = requiredStringColumn(row, "run_in");
    if (!isOneOf(ROUTINE_RUN_PLACES, runIn)) throw new Error("The stored routine run place is invalid.");
    return { runIn };
  }

  #writeRunIn(db: OpenBotDatabase["connection"], routineId: string, runIn: RoutineRunPlace): void {
    if (!this.tables.runInColumn) return;
    db.prepare(`UPDATE ${this.tables.routineTable} SET run_in = ? WHERE routine_id = ?`).run(runIn, routineId);
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

  #assertBelowLimit(ownerId: string): void {
    const row = this.database.connection
      .prepare(
        `SELECT COUNT(*) AS count FROM ${this.tables.routineTable}
         WHERE ${this.tables.ownerColumn} = ? AND ${this.#hasTrigger}`,
      )
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
    const source = optionalStringColumn(row, "run_source");
    if (source !== null && !isOneOf(ROUTINE_RUN_SOURCES, source)) {
      throw new Error("The stored routine run source is invalid.");
    }
    const missedCount = row.missed_count;
    return {
      id: requiredStringColumn(row, "run_id"),
      routineId: requiredStringColumn(row, "routine_id"),
      ownerId: requiredStringColumn(row, this.tables.ownerColumn),
      triggerId: optionalStringColumn(row, "trigger_id"),
      kind,
      ...(source === null ? {} : { source }),
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
      (schedule.kind === "once"
        ? routineOnceInstant(schedule, timezone)
        : nextRoutineOccurrence(schedule, timezone, now)
      ).toISOString(),
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

const MISSED_WALK_LIMIT = ROUTINE_MISSED_COUNT_LIMIT + 1;
const HOUR_MS = 3_600_000;
const MISSED_WINDOWS_MS = [HOUR_MS, 24 * HOUR_MS, 32 * 24 * HOUR_MS, 400 * 24 * HOUR_MS, Number.POSITIVE_INFINITY];

interface MissedOccurrences {
  count: number;
  truncated: boolean;
  last: Date;
  previous: Date | null;
  next: Date;
}

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

function assertOnceAhead(schedule: RoutineSchedule, timezone: string, now: Date): void {
  if (schedule.kind === "once") nextRoutineOccurrence(schedule, timezone, now);
}

function limitPolicyFor(schedule: RoutineSchedule, requested: RoutineLimitPolicy | undefined): RoutineLimitPolicy {
  return schedule.kind === "once" ? "wait" : (requested ?? "wait");
}

function defaultMissedPolicy(schedule: RoutineSchedule): RoutineMissedPolicy {
  return schedule.kind === "once" ? "run-once" : "skip";
}

function scheduleColumn(row: DynamicRecord): RoutineSchedule {
  const value = JSON.parse(requiredStringColumn(row, "schedule_json"));
  if (!isRoutineSchedule(value)) throw new Error("The stored routine schedule is invalid.");
  return value;
}

function runStartColumns(start: RoutineRunStart): Pick<RoutineRunFields, "kind" | "source"> {
  return start === "scheduled" ? { kind: "scheduled" } : { kind: "manual", source: start };
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

function pausedByRunColumn(row: DynamicRecord): { pausedByRun?: RoutinePausedByRun } {
  const payload = row.paused_by_run;
  if (typeof payload !== "string") return {};
  try {
    const value = JSON.parse(payload);
    return isRoutinePausedByRun(value) ? { pausedByRun: { scheduledFor: value.scheduledFor } } : {};
  } catch {
    return {};
  }
}
