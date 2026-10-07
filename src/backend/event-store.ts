import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  EventActivity,
  EventActivityKind,
  EventActivityStatus,
  EventEnvelope,
  EventFilter,
  EventJsonValue,
  EventRoutine,
  EventRoutineOwner,
  EventRoutineTrigger,
  EventScalar,
  EventSource,
  RoutineRunNotification,
  SaveEventRoutineInput,
  SaveEventSourceInput,
  SaveWebhookDestinationInput,
  WebhookDelivery,
  WebhookDestination,
  WebhookMethod,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { redactText } from "@openbot/logging";
import { databaseRows, requiredNumberColumn, requiredStringColumn } from "./database/database-rows";
import type { OpenBotDatabase } from "./openbot-database";

export interface SaveEventSourceRecordInput extends Omit<SaveEventSourceInput, "secret"> {
  id?: string;
  url?: string | null;
  secretCiphertext?: string | null;
}

export interface SaveWebhookDestinationRecordInput extends Omit<SaveWebhookDestinationInput, "secret" | "headers"> {
  id?: string;
  secretCiphertext?: string | null;
  headersCiphertext?: string | null;
  headerNames?: string[];
}

export interface SaveEventRoutineTriggerInput {
  id?: string;
  routineId: string;
  owner: EventRoutineOwner;
  name: string;
  instruction: string;
  timezone: string;
  limitPolicy?: "wait" | "skip";
  sourceId: string;
  eventType: string;
  filters: EventFilter[];
  active: boolean;
}

export interface EventDispatch {
  id: string;
  eventId: string;
  triggerId: string;
  routineId: string;
  owner: EventRoutineOwner;
  status: "pending" | "claimed" | "completed" | "failed";
  runId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  envelope: EventEnvelope;
}

export interface ReceiveEventInput {
  deliveryId: string;
  envelope: EventEnvelope;
}

export interface ReceiveEventResult {
  accepted: boolean;
  duplicate: boolean;
  dispatchIds: string[];
}

export interface ClaimedWebhookDelivery extends WebhookDelivery {
  url: string;
  method: WebhookMethod;
  payload: EventJsonValue;
  secretCiphertext: string | null;
  headersCiphertext: string | null;
}

/**
 * Owns the local event receipt, dispatch and webhook outbox state.
 *
 * This store never decrypts or returns a secret. The main process supplies ciphertext produced by
 * the host keychain and decrypts it only at the network adapter boundary.
 */
export class EventStore {
  constructor(private readonly database: OpenBotDatabase) {}

  listSources(): EventSource[] {
    return databaseRows(
      this.database.connection
        .prepare(
          `SELECT source_id, name, active, url, secret_ciphertext, created_at, updated_at
           FROM projection_event_sources ORDER BY updated_at DESC, source_id`,
        )
        .all(),
    ).map((row) => this.#source(row));
  }

  getSourceSecretCiphertext(sourceId: string): string | null {
    const row = this.database.connection
      .prepare("SELECT secret_ciphertext FROM projection_event_sources WHERE source_id = ?")
      .get(sourceId);
    if (!isDynamicRecord(row)) return null;
    return nullableString(row.secret_ciphertext);
  }

  saveSource(input: SaveEventSourceRecordInput, now = new Date()): EventSource {
    const connection = this.database.connection;
    const updatedAt = now.toISOString();
    const id = input.id ?? randomUUID();
    const existing = connection
      .prepare("SELECT source_id, created_at, secret_ciphertext, url FROM projection_event_sources WHERE source_id = ?")
      .get(id);
    const createdAt = isDynamicRecord(existing) && isString(existing.created_at) ? existing.created_at : updatedAt;
    const previousSecret =
      isDynamicRecord(existing) && isString(existing.secret_ciphertext) ? existing.secret_ciphertext : null;
    const previousUrl =
      isDynamicRecord(existing) && (existing.url === null || isString(existing.url)) ? existing.url : null;
    const url = input.url === undefined ? previousUrl : input.url;
    const secretCiphertext = input.secretCiphertext === undefined ? previousSecret : input.secretCiphertext;
    this.#transaction(connection, () => {
      connection
        .prepare(
          `INSERT INTO projection_event_sources
             (source_id, name, active, url, secret_ciphertext, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(source_id) DO UPDATE SET
             name = excluded.name,
             active = excluded.active,
             url = excluded.url,
             secret_ciphertext = excluded.secret_ciphertext,
             updated_at = excluded.updated_at`,
        )
        .run(id, input.name.trim(), input.active ? 1 : 0, url, secretCiphertext, createdAt, updatedAt);
    });
    const saved = this.#getSource(id);
    if (!saved) throw new Error("The event source was not saved.");
    return saved;
  }

  deleteSource(sourceId: string): void {
    this.#transaction(this.database.connection, () => {
      this.database.connection
        .prepare("UPDATE projection_event_routine_triggers SET active = 0, updated_at = ? WHERE source_id = ?")
        .run(new Date().toISOString(), sourceId);
      this.database.connection.prepare("DELETE FROM projection_event_sources WHERE source_id = ?").run(sourceId);
    });
  }

  listEventTriggers(owner?: EventRoutineOwner): EventRoutineTrigger[] {
    const rows = owner
      ? this.database.connection
          .prepare(
            `SELECT source_id, event_type, filters_json
             FROM projection_event_routine_triggers
             WHERE owner_kind = ? AND owner_id = ? ORDER BY updated_at DESC, trigger_id`,
          )
          .all(owner.kind, owner.id)
      : this.database.connection
          .prepare(
            `SELECT source_id, event_type, filters_json
             FROM projection_event_routine_triggers ORDER BY updated_at DESC, trigger_id`,
          )
          .all();
    return databaseRows(rows).map((row) => ({
      kind: "event",
      sourceId: requiredStringColumn(row, "source_id"),
      eventType: requiredStringColumn(row, "event_type"),
      filters: parseFilters(requiredStringColumn(row, "filters_json")),
    }));
  }

  listEventRoutines(owner?: EventRoutineOwner): EventRoutine[] {
    const rows = owner
      ? this.database.connection
          .prepare(
            `SELECT trigger_id, routine_id, owner_kind, owner_id, name, instruction, timezone, limit_policy,
                    source_id, event_type, filters_json, active, created_at, updated_at
             FROM projection_event_routine_triggers
             WHERE owner_kind = ? AND owner_id = ? ORDER BY updated_at DESC, routine_id`,
          )
          .all(owner.kind, owner.id)
      : this.database.connection
          .prepare(
            `SELECT trigger_id, routine_id, owner_kind, owner_id, name, instruction, timezone, limit_policy,
                    source_id, event_type, filters_json, active, created_at, updated_at
             FROM projection_event_routine_triggers ORDER BY updated_at DESC, routine_id`,
          )
          .all();
    return databaseRows(rows).map((row) => this.#eventRoutine(row));
  }

  getEventRoutine(routineId: string): EventRoutine | null {
    const row = this.database.connection
      .prepare(
        `SELECT trigger_id, routine_id, owner_kind, owner_id, name, instruction, timezone, limit_policy,
                source_id, event_type, filters_json, active, created_at, updated_at
         FROM projection_event_routine_triggers WHERE routine_id = ?`,
      )
      .get(routineId);
    return isDynamicRecord(row) ? this.#eventRoutine(row) : null;
  }

  saveEventRoutine(input: SaveEventRoutineInput, now = new Date()): EventRoutine {
    if (input.trigger.kind !== "event") throw new Error("Event routines require an event trigger.");
    const routineId = input.id ?? randomUUID();
    const existing = input.id ? this.getEventRoutine(input.id) : null;
    if (existing && (existing.owner.kind !== input.owner.kind || existing.owner.id !== input.owner.id)) {
      throw new Error("The event routine owner cannot change.");
    }
    this.saveEventRoutineTrigger(
      {
        id: input.id,
        routineId,
        owner: input.owner,
        name: input.name,
        instruction: input.instruction,
        timezone: input.timezone,
        limitPolicy: input.limitPolicy,
        sourceId: input.trigger.sourceId,
        eventType: input.trigger.eventType,
        filters: input.trigger.filters,
        active: input.active,
      },
      now,
    );
    const saved = this.getEventRoutine(routineId);
    if (!saved) throw new Error("The event routine was not saved.");
    return saved;
  }

  deleteEventRoutine(routineId: string): void {
    this.deleteEventRoutineTrigger(routineId);
  }

  saveEventRoutineTrigger(input: SaveEventRoutineTriggerInput, now = new Date()): EventRoutineTrigger {
    assertFilters(input.filters);
    const connection = this.database.connection;
    const triggerId = input.id ?? randomUUID();
    const timestamp = now.toISOString();
    this.#transaction(connection, () => {
      connection
        .prepare(
          `INSERT INTO projection_event_routine_triggers
             (trigger_id, routine_id, owner_kind, owner_id, name, instruction, timezone, limit_policy,
              source_id, event_type, filters_json, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(routine_id) DO UPDATE SET
             trigger_id = excluded.trigger_id,
             owner_kind = excluded.owner_kind,
             owner_id = excluded.owner_id,
             name = excluded.name,
             instruction = excluded.instruction,
             timezone = excluded.timezone,
             limit_policy = excluded.limit_policy,
             source_id = excluded.source_id,
             event_type = excluded.event_type,
             filters_json = excluded.filters_json,
             active = excluded.active,
             updated_at = excluded.updated_at`,
        )
        .run(
          triggerId,
          input.routineId,
          input.owner.kind,
          input.owner.id,
          input.name.trim(),
          input.instruction.trim(),
          input.timezone,
          input.limitPolicy ?? "wait",
          input.sourceId,
          input.eventType,
          JSON.stringify(input.filters),
          input.active ? 1 : 0,
          timestamp,
          timestamp,
        );
    });
    const row = connection
      .prepare("SELECT source_id, event_type, filters_json FROM projection_event_routine_triggers WHERE routine_id = ?")
      .get(input.routineId);
    if (!isDynamicRecord(row)) throw new Error("The event routine trigger was not saved.");
    return {
      kind: "event",
      sourceId: requiredStringColumn(row, "source_id"),
      eventType: requiredStringColumn(row, "event_type"),
      filters: parseFilters(requiredStringColumn(row, "filters_json")),
    };
  }

  deleteEventRoutineTrigger(routineId: string): void {
    this.database.connection
      .prepare("DELETE FROM projection_event_routine_triggers WHERE routine_id = ?")
      .run(routineId);
  }

  receive(input: ReceiveEventInput, now = new Date()): ReceiveEventResult {
    const connection = this.database.connection;
    const source = connection
      .prepare("SELECT active FROM projection_event_sources WHERE source_id = ?")
      .get(input.envelope.sourceId);
    if (!isDynamicRecord(source) || source.active !== 1) return { accepted: false, duplicate: false, dispatchIds: [] };

    const timestamp = now.toISOString();
    const dispatchIds: string[] = [];
    let duplicate = false;
    this.#transaction(connection, () => {
      const existing = connection
        .prepare("SELECT event_id FROM projection_event_receipts WHERE source_id = ? AND delivery_id = ?")
        .get(input.envelope.sourceId, input.deliveryId);
      if (existing) {
        duplicate = true;
        this.#insertActivityInTransaction(connection, {
          kind: "received",
          status: "duplicate",
          eventId: isDynamicRecord(existing) && isString(existing.event_id) ? existing.event_id : null,
          sourceId: input.envelope.sourceId,
          occurredAt: timestamp,
          summary: "event.duplicate",
        });
        return;
      }
      connection
        .prepare(
          `INSERT INTO projection_event_receipts
             (event_id, source_id, delivery_id, event_type, occurred_at, received_at, data_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.envelope.id,
          input.envelope.sourceId,
          input.deliveryId,
          input.envelope.type,
          input.envelope.occurredAt,
          input.envelope.receivedAt,
          JSON.stringify(input.envelope.data),
          timestamp,
        );

      const triggers = databaseRows(
        connection
          .prepare(
            `SELECT trigger_id, routine_id, owner_kind, owner_id, filters_json
             FROM projection_event_routine_triggers
             WHERE source_id = ? AND event_type = ? AND active = 1
             ORDER BY trigger_id`,
          )
          .all(input.envelope.sourceId, input.envelope.type),
      );
      const insertDispatch = connection.prepare(
        `INSERT OR IGNORE INTO projection_event_dispatches
           (dispatch_id, event_id, trigger_id, routine_id, owner_kind, owner_id, status, run_id, error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)`,
      );
      for (const trigger of triggers) {
        if (!matchesFilters(input.envelope.data, parseFilters(requiredStringColumn(trigger, "filters_json")))) continue;
        const dispatchId = randomUUID();
        const result = insertDispatch.run(
          dispatchId,
          input.envelope.id,
          requiredStringColumn(trigger, "trigger_id"),
          requiredStringColumn(trigger, "routine_id"),
          requiredStringColumn(trigger, "owner_kind"),
          requiredStringColumn(trigger, "owner_id"),
          timestamp,
          timestamp,
        );
        if (result.changes > 0) dispatchIds.push(dispatchId);
      }
      this.#insertActivityInTransaction(connection, {
        kind: "received",
        status: "accepted",
        eventId: input.envelope.id,
        sourceId: input.envelope.sourceId,
        occurredAt: input.envelope.receivedAt,
        summary: "event.received",
      });
    });
    return { accepted: true, duplicate, dispatchIds };
  }

  claimDispatches(limit = 50, now = new Date()): EventDispatch[] {
    const connection = this.database.connection;
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const claimed: EventDispatch[] = [];
    this.#transaction(connection, () => {
      const rows = databaseRows(
        connection
          .prepare(
            `SELECT dispatch.dispatch_id, dispatch.event_id, dispatch.trigger_id, dispatch.routine_id,
                    dispatch.owner_kind, dispatch.owner_id, dispatch.status, dispatch.run_id, dispatch.error,
                    dispatch.created_at, dispatch.updated_at, receipt.event_id AS receipt_event_id, receipt.source_id, receipt.event_type,
                    receipt.occurred_at, receipt.received_at, receipt.data_json
             FROM projection_event_dispatches dispatch
             JOIN projection_event_receipts receipt ON receipt.event_id = dispatch.event_id
             WHERE dispatch.status = 'pending' ORDER BY dispatch.created_at, dispatch.dispatch_id LIMIT ?`,
          )
          .all(safeLimit),
      );
      const update = connection.prepare(
        `UPDATE projection_event_dispatches SET status = 'claimed', updated_at = ?
         WHERE dispatch_id = ? AND status = 'pending'`,
      );
      for (const row of rows) {
        const id = requiredStringColumn(row, "dispatch_id");
        if (update.run(now.toISOString(), id).changes !== 1) continue;
        claimed.push(this.#dispatch(row, "claimed"));
      }
    });
    return claimed;
  }

  markDispatch(
    dispatchId: string,
    status: EventDispatch["status"],
    runId: string | null = null,
    error: string | null = null,
  ): void {
    this.database.connection
      .prepare(
        "UPDATE projection_event_dispatches SET status = ?, run_id = COALESCE(?, run_id), error = ?, updated_at = ? WHERE dispatch_id = ?",
      )
      .run(status, runId, error === null ? null : redactText(error), new Date().toISOString(), dispatchId);
  }

  /** Persists the deterministic run id before the queue handoff, including a failed handoff. */
  assignDispatchRun(dispatchId: string, runId: string): void {
    this.database.connection
      .prepare(
        "UPDATE projection_event_dispatches SET run_id = ?, updated_at = ? WHERE dispatch_id = ? AND status = 'claimed'",
      )
      .run(runId, new Date().toISOString(), dispatchId);
  }

  /** Reopens dispatch claims left by a host shutdown before the queue handoff completed. */
  resumeClaimedDispatches(now = new Date()): number {
    return Number(
      this.database.connection
        .prepare(
          `UPDATE projection_event_dispatches
           SET status = 'pending', updated_at = ?
           WHERE status = 'claimed'`,
        )
        .run(now.toISOString()).changes,
    );
  }

  listDestinations(): WebhookDestination[] {
    return databaseRows(
      this.database.connection
        .prepare(
          `SELECT destination_id, name, active, url, method, event_types_json, routine_ids_json,
                  payload_template_json, secret_ciphertext, headers_ciphertext, header_names_json, created_at, updated_at
           FROM projection_webhook_destinations ORDER BY updated_at DESC, destination_id`,
        )
        .all(),
    ).map((row) => this.#destination(row));
  }

  getDestinationCredentials(
    destinationId: string,
  ): { secretCiphertext: string | null; headersCiphertext: string | null } | null {
    const row = this.database.connection
      .prepare(
        "SELECT secret_ciphertext, headers_ciphertext FROM projection_webhook_destinations WHERE destination_id = ?",
      )
      .get(destinationId);
    if (!isDynamicRecord(row)) return null;
    return {
      secretCiphertext: nullableString(row.secret_ciphertext),
      headersCiphertext: nullableString(row.headers_ciphertext),
    };
  }

  saveDestination(input: SaveWebhookDestinationRecordInput, now = new Date()): WebhookDestination {
    assertHttpsUrl(input.url);
    const connection = this.database.connection;
    const id = input.id ?? randomUUID();
    const updatedAt = now.toISOString();
    const existing = connection
      .prepare(
        "SELECT created_at, secret_ciphertext, headers_ciphertext, header_names_json FROM projection_webhook_destinations WHERE destination_id = ?",
      )
      .get(id);
    const createdAt = isDynamicRecord(existing) && isString(existing.created_at) ? existing.created_at : updatedAt;
    const secretCiphertext =
      input.secretCiphertext === undefined
        ? isDynamicRecord(existing) && isString(existing.secret_ciphertext)
          ? existing.secret_ciphertext
          : null
        : input.secretCiphertext;
    const headersCiphertext =
      input.headersCiphertext === undefined
        ? isDynamicRecord(existing) && isString(existing.headers_ciphertext)
          ? existing.headers_ciphertext
          : null
        : input.headersCiphertext;
    const headerNames =
      input.headerNames ?? (isDynamicRecord(existing) ? readStringArray(existing, "header_names_json") : null) ?? [];
    this.#transaction(connection, () => {
      connection
        .prepare(
          `INSERT INTO projection_webhook_destinations
             (destination_id, name, active, url, method, event_types_json, routine_ids_json,
              payload_template_json, secret_ciphertext, headers_ciphertext, header_names_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(destination_id) DO UPDATE SET
             name = excluded.name,
             active = excluded.active,
             url = excluded.url,
             method = excluded.method,
             event_types_json = excluded.event_types_json,
             routine_ids_json = excluded.routine_ids_json,
             payload_template_json = excluded.payload_template_json,
             secret_ciphertext = excluded.secret_ciphertext,
             headers_ciphertext = excluded.headers_ciphertext,
             header_names_json = excluded.header_names_json,
             updated_at = excluded.updated_at`,
        )
        .run(
          id,
          input.name.trim(),
          input.active ? 1 : 0,
          input.url,
          input.method,
          JSON.stringify(input.eventTypes),
          JSON.stringify(input.routineIds),
          input.payloadTemplate === null ? null : JSON.stringify(input.payloadTemplate),
          secretCiphertext,
          headersCiphertext,
          JSON.stringify(headerNames),
          createdAt,
          updatedAt,
        );
    });
    const saved = connection
      .prepare(
        `SELECT destination_id, name, active, url, method, event_types_json, routine_ids_json,
                payload_template_json, secret_ciphertext, headers_ciphertext, header_names_json, created_at, updated_at
         FROM projection_webhook_destinations WHERE destination_id = ?`,
      )
      .get(id);
    if (!isDynamicRecord(saved)) throw new Error("The webhook destination was not saved.");
    return this.#destination(saved);
  }

  deleteDestination(destinationId: string): void {
    this.database.connection
      .prepare("DELETE FROM projection_webhook_destinations WHERE destination_id = ?")
      .run(destinationId);
  }

  enqueueRunNotification(notification: RoutineRunNotification, now = new Date()): string[] {
    const connection = this.database.connection;
    return this.#transaction(connection, () => this.enqueueRunNotificationInTransaction(connection, notification, now));
  }

  /** Adds a notification to the transactional outbox while the caller owns the SQLite transaction. */
  enqueueRunNotificationInTransaction(
    connection: DatabaseSync,
    notification: RoutineRunNotification,
    now = new Date(),
  ): string[] {
    const eventId = notification.eventId ?? `${notification.runId}:${notification.eventType}`;
    const timestamp = now.toISOString();
    const payload: EventJsonValue = {
      eventId,
      eventType: notification.eventType,
      runId: notification.runId,
      occurredAt: notification.occurredAt,
      routineId: notification.routineId,
      routineName: redactText(notification.routineName),
      status: notification.status,
    };
    const deliveryIds: string[] = [];
    const destinations = databaseRows(
      connection
        .prepare(
          `SELECT destination_id, event_types_json, routine_ids_json, payload_template_json
           FROM projection_webhook_destinations WHERE active = 1 ORDER BY destination_id`,
        )
        .all(),
    );
    const insert = connection.prepare(
      `INSERT INTO projection_webhook_deliveries
         (delivery_id, destination_id, event_id, event_type, payload_json, attempt, next_attempt_at, status,
          last_status_code, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, 'queued', NULL, NULL, ?, ?)`,
    );
    for (const destination of destinations) {
      const eventTypes = readStringArray(destination, "event_types_json") ?? [];
      const routineIds = readStringArray(destination, "routine_ids_json") ?? [];
      if (
        !eventTypes.includes(notification.eventType) ||
        (routineIds.length > 0 && !routineIds.includes(notification.routineId))
      ) {
        continue;
      }
      const destinationId = requiredStringColumn(destination, "destination_id");
      const deliveryId = `${eventId}:${destinationId}`;
      const template =
        destination.payload_template_json === null
          ? payload
          : materializeTemplate(parseJson(requiredStringColumn(destination, "payload_template_json")), payload);
      const result = insert.run(
        deliveryId,
        destinationId,
        eventId,
        notification.eventType,
        JSON.stringify(template),
        timestamp,
        timestamp,
        timestamp,
      );
      if (result.changes > 0) {
        deliveryIds.push(deliveryId);
        this.#insertActivityInTransaction(connection, {
          kind: "delivery",
          status: "queued",
          eventId,
          routineId: notification.routineId,
          runId: notification.runId,
          destinationId,
          deliveryId,
          occurredAt: notification.occurredAt,
          summary: "webhook.queued",
        });
      }
    }
    return deliveryIds;
  }

  claimDeliveries(limit = 50, now = new Date()): ClaimedWebhookDelivery[] {
    const connection = this.database.connection;
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const claimed: ClaimedWebhookDelivery[] = [];
    this.#transaction(connection, () => {
      const rows = databaseRows(
        connection
          .prepare(
            `SELECT delivery.delivery_id, delivery.destination_id, delivery.event_id, delivery.event_type,
                    delivery.payload_json, delivery.attempt, delivery.next_attempt_at, delivery.status,
                    delivery.last_status_code, delivery.last_error, delivery.created_at, delivery.updated_at,
                    destination.url, destination.method, destination.secret_ciphertext, destination.headers_ciphertext
             FROM projection_webhook_deliveries delivery
             JOIN projection_webhook_destinations destination
               ON destination.destination_id = delivery.destination_id AND destination.active = 1
             WHERE delivery.status = 'queued' AND delivery.next_attempt_at <= ?
             ORDER BY delivery.next_attempt_at, delivery.delivery_id LIMIT ?`,
          )
          .all(now.toISOString(), safeLimit),
      );
      const update = connection.prepare(
        `UPDATE projection_webhook_deliveries SET status = 'sending', attempt = attempt + 1, updated_at = ?
         WHERE delivery_id = ? AND status = 'queued'`,
      );
      for (const row of rows) {
        const id = requiredStringColumn(row, "delivery_id");
        if (update.run(now.toISOString(), id).changes !== 1) continue;
        claimed.push({
          ...this.#delivery(row, "sending"),
          url: requiredStringColumn(row, "url"),
          method: readMethod(row.method),
          payload: parseJson(requiredStringColumn(row, "payload_json")),
          secretCiphertext: nullableString(row.secret_ciphertext),
          headersCiphertext: nullableString(row.headers_ciphertext),
        });
      }
    });
    return claimed;
  }

  /** Checks the destination again after a claim and before secret decryption or network I/O. */
  isDeliverySendable(deliveryId: string): boolean {
    const row = this.database.connection
      .prepare(
        `SELECT delivery.delivery_id
         FROM projection_webhook_deliveries delivery
         JOIN projection_webhook_destinations destination
           ON destination.destination_id = delivery.destination_id AND destination.active = 1
         WHERE delivery.delivery_id = ? AND delivery.status = 'sending'`,
      )
      .get(deliveryId);
    return isDynamicRecord(row);
  }

  /** Returns a claim to the queue when the destination was disabled before network I/O. */
  releaseDelivery(deliveryId: string, now = new Date()): void {
    this.database.connection
      .prepare(
        `UPDATE projection_webhook_deliveries
         SET status = 'queued', attempt = CASE WHEN attempt > 0 THEN attempt - 1 ELSE 0 END,
             next_attempt_at = ?, updated_at = ?
         WHERE delivery_id = ? AND status = 'sending'`,
      )
      .run(now.toISOString(), now.toISOString(), deliveryId);
  }

  /** Requeues claims left in `sending` after a process restart. */
  resumeSendingDeliveries(now = new Date()): number {
    return Number(
      this.database.connection
        .prepare(
          `UPDATE projection_webhook_deliveries
           SET status = 'queued',
               next_attempt_at = ?, updated_at = ?
           WHERE status = 'sending'`,
        )
        .run(now.toISOString(), now.toISOString()).changes,
    );
  }

  nextDeliveryAt(): string | null {
    const row = this.database.connection
      .prepare(
        `SELECT delivery.next_attempt_at
         FROM projection_webhook_deliveries delivery
         JOIN projection_webhook_destinations destination
           ON destination.destination_id = delivery.destination_id AND destination.active = 1
         WHERE delivery.status = 'queued'
         ORDER BY delivery.next_attempt_at, delivery.delivery_id LIMIT 1`,
      )
      .get();
    return isDynamicRecord(row) && isString(row.next_attempt_at) ? row.next_attempt_at : null;
  }

  markDelivery(
    deliveryId: string,
    result: {
      status: "succeeded" | "failed" | "queued";
      statusCode?: number | null;
      error?: string | null;
      nextAttemptAt?: string;
    },
    now = new Date(),
  ): void {
    const current = this.database.connection
      .prepare(
        `SELECT attempt, event_id, destination_id, event_type,
                (SELECT routine_id FROM projection_event_activity
                 WHERE delivery_id = projection_webhook_deliveries.delivery_id
                 ORDER BY occurred_at DESC, activity_id DESC LIMIT 1) AS routine_id,
                (SELECT run_id FROM projection_event_activity
                 WHERE delivery_id = projection_webhook_deliveries.delivery_id
                 ORDER BY occurred_at DESC, activity_id DESC LIMIT 1) AS run_id
         FROM projection_webhook_deliveries WHERE delivery_id = ?`,
      )
      .get(deliveryId);
    const attempt = isDynamicRecord(current) && typeof current.attempt === "number" ? current.attempt : 0;
    this.database.connection
      .prepare(
        `UPDATE projection_webhook_deliveries
         SET status = ?, attempt = ?, next_attempt_at = ?, last_status_code = ?, last_error = ?, updated_at = ?
         WHERE delivery_id = ?`,
      )
      .run(
        result.status,
        attempt,
        result.nextAttemptAt ?? now.toISOString(),
        result.statusCode ?? null,
        result.error === null || result.error === undefined ? null : redactText(result.error),
        now.toISOString(),
        deliveryId,
      );
    if (result.status === "succeeded" || result.status === "failed") {
      this.#insertActivity({
        kind: "delivery",
        status: result.status,
        eventId: isDynamicRecord(current) && isString(current.event_id) ? current.event_id : null,
        routineId: isDynamicRecord(current) ? nullableString(current.routine_id) : null,
        runId: isDynamicRecord(current) ? nullableString(current.run_id) : null,
        destinationId: isDynamicRecord(current) && isString(current.destination_id) ? current.destination_id : null,
        deliveryId,
        occurredAt: now.toISOString(),
        summary: result.status === "succeeded" ? "webhook.delivered" : "webhook.failed",
      });
    } else if (result.status === "queued") {
      this.#insertActivity({
        kind: "delivery",
        status: "queued",
        eventId: isDynamicRecord(current) && isString(current.event_id) ? current.event_id : null,
        routineId: isDynamicRecord(current) ? nullableString(current.routine_id) : null,
        runId: isDynamicRecord(current) ? nullableString(current.run_id) : null,
        destinationId: isDynamicRecord(current) && isString(current.destination_id) ? current.destination_id : null,
        deliveryId,
        occurredAt: now.toISOString(),
        summary: "webhook.retrying",
      });
    }
  }

  retryDelivery(deliveryId: string, now = new Date()): void {
    const timestamp = now.toISOString();
    this.#transaction(this.database.connection, () => {
      const row = this.database.connection
        .prepare(
          `SELECT delivery.status, delivery.event_id, delivery.destination_id, destination.active,
                  (SELECT routine_id FROM projection_event_activity
                   WHERE delivery_id = delivery.delivery_id
                   ORDER BY occurred_at DESC, activity_id DESC LIMIT 1) AS routine_id,
                  (SELECT run_id FROM projection_event_activity
                   WHERE delivery_id = delivery.delivery_id
                   ORDER BY occurred_at DESC, activity_id DESC LIMIT 1) AS run_id
           FROM projection_webhook_deliveries delivery
           JOIN projection_webhook_destinations destination ON destination.destination_id = delivery.destination_id
           WHERE delivery.delivery_id = ?`,
        )
        .get(deliveryId);
      if (!isDynamicRecord(row) || row.status !== "failed") throw new Error("Webhook delivery is not retryable.");
      if (row.active !== 1) throw new Error("Webhook destination is disabled.");
      this.database.connection
        .prepare(
          `UPDATE projection_webhook_deliveries
           SET status = 'queued', attempt = 0, next_attempt_at = ?, last_error = NULL,
               created_at = ?, updated_at = ?
           WHERE delivery_id = ? AND status = 'failed'`,
        )
        .run(timestamp, timestamp, timestamp, deliveryId);
      this.#insertActivityInTransaction(this.database.connection, {
        kind: "delivery",
        status: "queued",
        eventId: isString(row.event_id) ? row.event_id : null,
        routineId: nullableString(row.routine_id),
        runId: nullableString(row.run_id),
        destinationId: isString(row.destination_id) ? row.destination_id : null,
        deliveryId,
        occurredAt: timestamp,
        summary: "webhook.retry",
      });
    });
  }

  recordRoutineRunActivity(input: {
    eventId?: string | null;
    routineId: string;
    runId: string;
    status: Extract<EventActivityStatus, "running" | "succeeded" | "failed">;
    occurredAt: string;
  }): void {
    this.#insertActivity({
      kind: "routine-run",
      status: input.status,
      eventId: input.eventId ?? null,
      routineId: input.routineId,
      runId: input.runId,
      occurredAt: input.occurredAt,
      summary: `routine.run.${input.status}`,
    });
  }

  /** Records the run activity and outbox entry in the caller's transaction. */
  recordRoutineRunTransitionInTransaction(
    connection: DatabaseSync,
    notification: RoutineRunNotification,
    sourceEventId: string | null = null,
  ): void {
    const status: EventActivityStatus =
      notification.status === "started"
        ? "running"
        : notification.status === "needs-attention"
          ? "needs-attention"
          : notification.status;
    this.#insertActivityInTransaction(connection, {
      kind: "routine-run",
      status,
      eventId: sourceEventId,
      routineId: notification.routineId,
      runId: notification.runId,
      occurredAt: notification.occurredAt,
      summary: `routine.run.${notification.status}`,
    });
    this.enqueueRunNotificationInTransaction(connection, notification, new Date(notification.occurredAt));
  }

  listActivity(limit = 100): EventActivity[] {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    return databaseRows(
      this.database.connection
        .prepare(
          `SELECT activity_id, kind, status, event_id, source_id, routine_id, run_id, destination_id,
                  delivery_id, occurred_at, summary
           FROM projection_event_activity ORDER BY created_at DESC, activity_id DESC LIMIT ?`,
        )
        .all(safeLimit),
    ).map((row) => ({
      id: requiredStringColumn(row, "activity_id"),
      kind: readActivityKind(requiredStringColumn(row, "kind")),
      status: readActivityStatus(requiredStringColumn(row, "status")),
      eventId: nullableString(row.event_id),
      sourceId: nullableString(row.source_id),
      routineId: nullableString(row.routine_id),
      runId: nullableString(row.run_id),
      destinationId: nullableString(row.destination_id),
      deliveryId: nullableString(row.delivery_id),
      occurredAt: requiredStringColumn(row, "occurred_at"),
      summary: requiredStringColumn(row, "summary"),
    }));
  }

  #getSource(id: string): EventSource | null {
    const row = this.database.connection
      .prepare(
        `SELECT source_id, name, active, url, secret_ciphertext, created_at, updated_at
         FROM projection_event_sources WHERE source_id = ?`,
      )
      .get(id);
    return isDynamicRecord(row) ? this.#source(row) : null;
  }

  #source(row: DynamicRecord): EventSource {
    return {
      id: requiredStringColumn(row, "source_id"),
      name: requiredStringColumn(row, "name"),
      active: row.active === 1,
      url: nullableString(row.url),
      createdAt: requiredStringColumn(row, "created_at"),
      updatedAt: requiredStringColumn(row, "updated_at"),
    };
  }

  #destination(row: DynamicRecord): WebhookDestination {
    return {
      id: requiredStringColumn(row, "destination_id"),
      name: requiredStringColumn(row, "name"),
      active: row.active === 1,
      url: requiredStringColumn(row, "url"),
      method: readMethod(row.method),
      eventTypes: readStringArray(row, "event_types_json") ?? [],
      routineIds: readStringArray(row, "routine_ids_json") ?? [],
      payloadTemplate:
        row.payload_template_json === null ? null : parseJson(requiredStringColumn(row, "payload_template_json")),
      hasSecret: typeof row.secret_ciphertext === "string" && row.secret_ciphertext.length > 0,
      headerNames: readStringArray(row, "header_names_json") ?? [],
      createdAt: requiredStringColumn(row, "created_at"),
      updatedAt: requiredStringColumn(row, "updated_at"),
    };
  }

  #dispatch(row: DynamicRecord, status: EventDispatch["status"]): EventDispatch {
    return {
      id: requiredStringColumn(row, "dispatch_id"),
      eventId: requiredStringColumn(row, "event_id"),
      triggerId: requiredStringColumn(row, "trigger_id"),
      routineId: requiredStringColumn(row, "routine_id"),
      owner: {
        kind: readOwnerKind(requiredStringColumn(row, "owner_kind")),
        id: requiredStringColumn(row, "owner_id"),
      },
      status,
      runId: nullableString(row.run_id),
      error: nullableString(row.error),
      createdAt: requiredStringColumn(row, "created_at"),
      updatedAt: requiredStringColumn(row, "updated_at"),
      envelope: {
        version: 1,
        id: requiredStringColumn(row, "receipt_event_id"),
        sourceId: requiredStringColumn(row, "source_id"),
        type: requiredStringColumn(row, "event_type"),
        occurredAt: requiredStringColumn(row, "occurred_at"),
        receivedAt: requiredStringColumn(row, "received_at"),
        data: parseJson(requiredStringColumn(row, "data_json")),
      },
    };
  }

  #eventRoutine(row: DynamicRecord): EventRoutine {
    const ownerKind = readOwnerKind(requiredStringColumn(row, "owner_kind"));
    const limitPolicy = requiredStringColumn(row, "limit_policy");
    if (limitPolicy !== "wait" && limitPolicy !== "skip")
      throw new Error("Stored event routine limit policy is invalid.");
    return {
      id: requiredStringColumn(row, "routine_id"),
      owner: { kind: ownerKind, id: requiredStringColumn(row, "owner_id") },
      name: requiredStringColumn(row, "name"),
      instruction: requiredStringColumn(row, "instruction"),
      active: row.active === 1,
      timezone: requiredStringColumn(row, "timezone"),
      trigger: {
        kind: "event",
        sourceId: requiredStringColumn(row, "source_id"),
        eventType: requiredStringColumn(row, "event_type"),
        filters: parseFilters(requiredStringColumn(row, "filters_json")),
      },
      limitPolicy,
      createdAt: requiredStringColumn(row, "created_at"),
      updatedAt: requiredStringColumn(row, "updated_at"),
    };
  }

  #delivery(row: DynamicRecord, status: WebhookDelivery["status"]): WebhookDelivery {
    return {
      id: requiredStringColumn(row, "delivery_id"),
      destinationId: requiredStringColumn(row, "destination_id"),
      eventId: requiredStringColumn(row, "event_id"),
      eventType: requiredStringColumn(row, "event_type"),
      attempt: requiredNumberColumn(row, "attempt"),
      nextAttemptAt: requiredStringColumn(row, "next_attempt_at"),
      status,
      lastStatusCode: row.last_status_code === null ? null : requiredNumberColumn(row, "last_status_code"),
      lastError: nullableString(row.last_error),
      createdAt: requiredStringColumn(row, "created_at"),
      updatedAt: requiredStringColumn(row, "updated_at"),
    };
  }

  #insertActivity(activity: {
    kind: EventActivityKind;
    status: EventActivityStatus;
    eventId?: string | null;
    sourceId?: string | null;
    routineId?: string | null;
    runId?: string | null;
    destinationId?: string | null;
    deliveryId?: string | null;
    occurredAt: string;
    summary: string;
  }): void {
    this.#transaction(this.database.connection, () =>
      this.#insertActivityInTransaction(this.database.connection, activity),
    );
  }

  #insertActivityInTransaction(
    connection: DatabaseSync,
    activity: {
      kind: EventActivityKind;
      status: EventActivityStatus;
      eventId?: string | null;
      sourceId?: string | null;
      routineId?: string | null;
      runId?: string | null;
      destinationId?: string | null;
      deliveryId?: string | null;
      occurredAt: string;
      summary: string;
    },
  ): void {
    connection
      .prepare(
        `INSERT INTO projection_event_activity
           (activity_id, kind, status, event_id, source_id, routine_id, run_id, destination_id, delivery_id, occurred_at, summary, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        activity.kind,
        activity.status,
        activity.eventId ?? null,
        activity.sourceId ?? null,
        activity.routineId ?? null,
        activity.runId ?? null,
        activity.destinationId ?? null,
        activity.deliveryId ?? null,
        activity.occurredAt,
        activity.summary,
        new Date().toISOString(),
      );
  }

  #transaction<T>(connection: DatabaseSync, callback: () => T): T {
    const nested = connection.isTransaction;
    if (nested) return callback();
    connection.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      connection.exec("COMMIT");
      return result;
    } catch (error) {
      if (connection.isTransaction) connection.exec("ROLLBACK");
      throw error;
    }
  }
}

function parseJson(value: string): EventJsonValue {
  const parsed = JSON.parse(value);
  if (!isJsonValue(parsed)) throw new Error("Stored event JSON is invalid.");
  return parsed;
}

function parseFilters(value: string): EventFilter[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) throw new Error("Stored event filters are invalid.");
  return parsed.map((item) => {
    if (!isDynamicRecord(item) || !isString(item.pointer) || !isScalar(item.value)) {
      throw new Error("Stored event filters are invalid.");
    }
    return { pointer: item.pointer, value: item.value };
  });
}

function assertFilters(filters: readonly EventFilter[]): void {
  for (const filter of filters) {
    if (
      filter.pointer.length > 2_048 ||
      (filter.pointer !== "" && !filter.pointer.startsWith("/")) ||
      /~(?![01])/u.test(filter.pointer) ||
      !isScalar(filter.value)
    ) {
      throw new Error("Event filters are invalid.");
    }
  }
}

function matchesFilters(data: EventJsonValue, filters: readonly EventFilter[]): boolean {
  return filters.every((filter) => scalarEqual(readPointer(data, filter.pointer), filter.value));
}

function readPointer(value: EventJsonValue, pointer: string): EventJsonValue | undefined {
  if (pointer === "") return value;
  let current: EventJsonValue | undefined = value;
  for (const token of pointer
    .slice(1)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))) {
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/u.test(token)) return undefined;
      const index = Number(token);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
    } else if (isDynamicRecord(current) && Object.hasOwn(current, token)) {
      current = current[token];
    } else {
      return undefined;
    }
  }
  return current;
}

function scalarEqual(left: unknown, right: EventScalar): boolean {
  return (
    (left === null ||
      typeof left === "string" ||
      typeof left === "boolean" ||
      (typeof left === "number" && Number.isFinite(left))) &&
    left === right
  );
}

function materializeTemplate(template: EventJsonValue, payload: EventJsonValue): EventJsonValue {
  if (typeof template === "string") {
    const exact = /^\{\{\s*([A-Za-z][A-Za-z0-9_.-]*)\s*\}\}$/.exec(template);
    if (exact?.[1]) return readTemplateField(payload, exact[1]) ?? null;
    return template.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_.-]*)\s*\}\}/g, (_match, path: string) => {
      const value = readTemplateField(payload, path);
      return value === undefined || value === null ? "" : typeof value === "string" ? value : JSON.stringify(value);
    });
  }
  if (Array.isArray(template)) return template.map((value) => materializeTemplate(value, payload));
  if (template === null || typeof template !== "object") return template;
  return Object.fromEntries(Object.entries(template).map(([key, value]) => [key, materializeTemplate(value, payload)]));
}

function readTemplateField(payload: EventJsonValue, path: string): EventJsonValue | undefined {
  const normalizedPath = path.startsWith("event.") ? path.slice("event.".length) : path;
  const payloadPath = normalizedPath === "id" ? "eventId" : normalizedPath === "type" ? "eventType" : normalizedPath;
  let current: EventJsonValue | undefined = payload;
  for (const part of payloadPath.split(".")) {
    if (current === null || typeof current !== "object" || Array.isArray(current) || !Object.hasOwn(current, part))
      return undefined;
    current = current[part];
  }
  return current;
}

function isJsonValue(value: unknown): value is EventJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isDynamicRecord(value) && Object.values(value).every(isJsonValue);
}

function isScalar(value: unknown): value is EventScalar {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function readOwnerKind(value: string): EventRoutineOwner["kind"] {
  if (value === "agent" || value === "channel") return value;
  throw new Error("Stored event routine owner is invalid.");
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : isString(value) ? value : null;
}

function assertHttpsUrl(value: string): void {
  try {
    if (new URL(value).protocol === "https:") return;
  } catch {
    // Fall through to the same safe validation error.
  }
  throw new Error("Webhook destinations must use HTTPS.");
}

function readStringArray(row: DynamicRecord | null | undefined, column: string): string[] | null {
  if (!row || !isString(row[column])) return null;
  try {
    const parsed = JSON.parse(row[column]);
    return Array.isArray(parsed) && parsed.every(isString) ? parsed : null;
  } catch {
    return null;
  }
}

function readMethod(value: unknown): WebhookMethod {
  if (value === "POST" || value === "PUT" || value === "PATCH") return value;
  throw new Error("Stored webhook method is invalid.");
}

function readActivityKind(value: string): EventActivityKind {
  if (value === "received" || value === "routine-run" || value === "delivery") return value;
  throw new Error("Stored event activity kind is invalid.");
}

function readActivityStatus(value: string): EventActivityStatus {
  if (
    value === "accepted" ||
    value === "duplicate" ||
    value === "queued" ||
    value === "running" ||
    value === "needs-attention" ||
    value === "succeeded" ||
    value === "failed"
  )
    return value;
  throw new Error("Stored event activity status is invalid.");
}
