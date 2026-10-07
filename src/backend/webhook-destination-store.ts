import { randomUUID } from "node:crypto";
import type {
  EventActivity,
  EventJsonValue,
  EventRoutineOwner,
  RoutineRunEventType,
  RoutineRunNotification,
  WebhookDestination,
  WebhookMethod,
} from "@openbot/contracts/ipc-events";
import { isRoutineRunEventType } from "@openbot/contracts/ipc-events";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { RoutineInputError } from "@openbot/team-client/routine-schedule";
import {
  databaseRows,
  optionalNumberColumn,
  optionalStringColumn,
  requiredNumberColumn,
  requiredStringColumn,
} from "./database/database-rows";
import type { OpenBotDatabase } from "./openbot-database";
import { materializeTemplate, parseEventJson, ROUTINE_OWNER_TABLES, type RoutineOwnerKind } from "./webhook-trigger";

const TERMINAL_DELIVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DESTINATION_COLUMNS = `destination_id, routine_id, active, url, method, event_types_json, payload_template_json,
  secret_ciphertext, header_names_json, created_at, updated_at`;

export interface SaveWebhookDestinationRecord {
  id?: string;
  routineId: string;
  active: boolean;
  url: string;
  method: WebhookMethod;
  eventTypes: RoutineRunEventType[];
  payloadTemplate: EventJsonValue | null;
  /** `undefined` keeps the stored value; `null` removes it. */
  secretCiphertext?: string | null;
  headersCiphertext?: string | null;
  headerNames?: string[];
}

export interface ClaimedWebhookDelivery {
  id: string;
  destinationId: string;
  eventId: string;
  eventType: RoutineRunEventType;
  attempt: number;
  windowStartedAt: string;
  url: string;
  method: WebhookMethod;
  payload: EventJsonValue;
  secretCiphertext: string | null;
  headersCiphertext: string | null;
}

export interface WebhookDeliveryResult {
  status: "succeeded" | "failed" | "queued";
  statusCode?: number | null;
  error?: string | null;
  nextAttemptAt?: string;
}

/**
 * Owns the outbound webhooks of each routine: the destinations, the transactional outbox of run
 * notifications, and the delivery state that the main-process worker claims and settles.
 *
 * The store never decrypts a secret. Main gives it ciphertext from the host keychain and decrypts
 * only at the network adapter.
 */
export class WebhookDestinationStore {
  constructor(private readonly database: OpenBotDatabase) {}

  list(owner: EventRoutineOwner, routineId: string): WebhookDestination[] {
    this.#requireRoutine(owner, routineId);
    return databaseRows(
      this.database.connection
        .prepare(
          `SELECT ${DESTINATION_COLUMNS} FROM projection_webhook_destinations
           WHERE owner_kind = ? AND routine_id = ? ORDER BY created_at, destination_id`,
        )
        .all(owner.kind, routineId),
    ).map(destination);
  }

  save(owner: EventRoutineOwner, input: SaveWebhookDestinationRecord, now = new Date()): WebhookDestination {
    this.#requireRoutine(owner, input.routineId);
    validateDestination(input);
    const connection = this.database.connection;
    const timestamp = now.toISOString();
    const existing = input.id ? this.#row(owner.kind, input.routineId, input.id) : null;
    if (input.id && !existing) {
      throw new RoutineInputError(sourceText("error.backend.webhookDestinationMissing"));
    }
    const id = input.id ?? randomUUID();
    const secretCiphertext =
      input.secretCiphertext === undefined
        ? existing
          ? optionalStringColumn(existing, "secret_ciphertext")
          : null
        : input.secretCiphertext;
    const headersCiphertext =
      input.headersCiphertext === undefined
        ? existing
          ? optionalStringColumn(existing, "headers_ciphertext")
          : null
        : input.headersCiphertext;
    const headerNames = input.headerNames ?? (existing ? stringArray(existing, "header_names_json") : []);
    connection
      .prepare(
        `INSERT INTO projection_webhook_destinations (
           destination_id, owner_kind, routine_id, active, url, method, event_types_json, payload_template_json,
           secret_ciphertext, headers_ciphertext, header_names_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(destination_id) DO UPDATE SET
           active = excluded.active, url = excluded.url, method = excluded.method,
           event_types_json = excluded.event_types_json, payload_template_json = excluded.payload_template_json,
           secret_ciphertext = excluded.secret_ciphertext, headers_ciphertext = excluded.headers_ciphertext,
           header_names_json = excluded.header_names_json, updated_at = excluded.updated_at`,
      )
      .run(
        id,
        owner.kind,
        input.routineId,
        input.active ? 1 : 0,
        input.url,
        input.method,
        JSON.stringify([...new Set(input.eventTypes)]),
        input.payloadTemplate === null ? null : JSON.stringify(input.payloadTemplate),
        secretCiphertext,
        headersCiphertext,
        JSON.stringify(headerNames),
        timestamp,
        timestamp,
      );
    const saved = this.#row(owner.kind, input.routineId, id);
    if (!saved) throw new Error("The webhook destination was not saved.");
    return destination(saved);
  }

  /** Its deliveries go with it, through the foreign key. */
  delete(owner: EventRoutineOwner, routineId: string, destinationId: string): void {
    this.#requireRoutine(owner, routineId);
    const deleted = this.database.connection
      .prepare(
        "DELETE FROM projection_webhook_destinations WHERE destination_id = ? AND owner_kind = ? AND routine_id = ?",
      )
      .run(destinationId, owner.kind, routineId);
    if (deleted.changes === 0) throw new RoutineInputError(sourceText("error.backend.webhookDestinationMissing"));
  }

  listActivity(owner: EventRoutineOwner, routineId: string, limit: number): EventActivity[] {
    return databaseRows(
      this.database.connection
        .prepare(
          `SELECT delivery_id, destination_id, event_type, status, attempt, last_status_code, run_id, updated_at
           FROM projection_webhook_deliveries
           WHERE owner_kind = ? AND routine_id = ?
           ORDER BY updated_at DESC, delivery_id LIMIT ?`,
        )
        .all(owner.kind, routineId, limit),
    ).map((row) => ({
      kind: "delivery",
      id: requiredStringColumn(row, "delivery_id"),
      destinationId: requiredStringColumn(row, "destination_id"),
      eventType: runEventType(requiredStringColumn(row, "event_type")),
      status: deliveryStatus(requiredStringColumn(row, "status")),
      attempt: requiredNumberColumn(row, "attempt"),
      statusCode: optionalNumberColumn(row, "last_status_code"),
      runId: requiredStringColumn(row, "run_id"),
      occurredAt: requiredStringColumn(row, "updated_at"),
    }));
  }

  /** Marks due deliveries as sending in one statement, so two drains cannot claim one delivery. */
  claim(limit = 50, now = new Date()): ClaimedWebhookDelivery[] {
    const timestamp = now.toISOString();
    const claimed = databaseRows(
      this.database.connection
        .prepare(
          `UPDATE projection_webhook_deliveries SET status = 'sending', attempt = attempt + 1, updated_at = ?
           WHERE delivery_id IN (
             SELECT delivery.delivery_id FROM projection_webhook_deliveries delivery
             JOIN projection_webhook_destinations destination
               ON destination.destination_id = delivery.destination_id AND destination.active = 1
             WHERE delivery.status = 'queued' AND delivery.next_attempt_at <= ?
             ORDER BY delivery.next_attempt_at, delivery.delivery_id LIMIT ?
           )
           RETURNING delivery_id`,
        )
        .all(timestamp, timestamp, Math.max(1, Math.min(500, Math.floor(limit)))),
    ).map((row) => requiredStringColumn(row, "delivery_id"));
    if (!claimed.length) return [];
    return databaseRows(
      this.database.connection
        .prepare(
          `SELECT delivery.delivery_id, delivery.destination_id, delivery.event_id, delivery.event_type,
                  delivery.attempt, delivery.window_started_at, delivery.payload_json,
                  destination.url, destination.method, destination.secret_ciphertext, destination.headers_ciphertext
           FROM projection_webhook_deliveries delivery
           JOIN projection_webhook_destinations destination ON destination.destination_id = delivery.destination_id
           WHERE delivery.delivery_id IN (${claimed.map(() => "?").join(", ")})
           ORDER BY delivery.next_attempt_at, delivery.delivery_id`,
        )
        .all(...claimed),
    ).map((row) => ({
      id: requiredStringColumn(row, "delivery_id"),
      destinationId: requiredStringColumn(row, "destination_id"),
      eventId: requiredStringColumn(row, "event_id"),
      eventType: runEventType(requiredStringColumn(row, "event_type")),
      attempt: requiredNumberColumn(row, "attempt"),
      windowStartedAt: requiredStringColumn(row, "window_started_at"),
      url: requiredStringColumn(row, "url"),
      method: method(requiredStringColumn(row, "method")),
      payload: parseEventJson(requiredStringColumn(row, "payload_json")),
      secretCiphertext: optionalStringColumn(row, "secret_ciphertext"),
      headersCiphertext: optionalStringColumn(row, "headers_ciphertext"),
    }));
  }

  /** Checks the destination again after a claim and before secret decryption or network I/O. */
  isSendable(deliveryId: string): boolean {
    return isDynamicRecord(
      this.database.connection
        .prepare(
          `SELECT 1 FROM projection_webhook_deliveries delivery
           JOIN projection_webhook_destinations destination
             ON destination.destination_id = delivery.destination_id AND destination.active = 1
           WHERE delivery.delivery_id = ? AND delivery.status = 'sending'`,
        )
        .get(deliveryId),
    );
  }

  /** Returns a claim to the queue, without counting an attempt, when its destination was disabled. */
  release(deliveryId: string, now = new Date()): void {
    this.database.connection
      .prepare(
        `UPDATE projection_webhook_deliveries
         SET status = 'queued', attempt = MAX(attempt - 1, 0), next_attempt_at = ?, updated_at = ?
         WHERE delivery_id = ? AND status = 'sending'`,
      )
      .run(now.toISOString(), now.toISOString(), deliveryId);
  }

  /** Requeues claims that a stopped process left in `sending`. */
  resumeSending(now = new Date()): number {
    return Number(
      this.database.connection
        .prepare(
          `UPDATE projection_webhook_deliveries SET status = 'queued', next_attempt_at = ?, updated_at = ?
           WHERE status = 'sending'`,
        )
        .run(now.toISOString(), now.toISOString()).changes,
    );
  }

  nextDeliveryAt(): string | null {
    const row = this.database.connection
      .prepare(
        `SELECT delivery.next_attempt_at FROM projection_webhook_deliveries delivery
         JOIN projection_webhook_destinations destination
           ON destination.destination_id = delivery.destination_id AND destination.active = 1
         WHERE delivery.status = 'queued'
         ORDER BY delivery.next_attempt_at, delivery.delivery_id LIMIT 1`,
      )
      .get();
    return isDynamicRecord(row) && isString(row.next_attempt_at) ? row.next_attempt_at : null;
  }

  settle(deliveryId: string, result: WebhookDeliveryResult, now = new Date()): void {
    this.database.connection
      .prepare(
        `UPDATE projection_webhook_deliveries
         SET status = ?, next_attempt_at = ?, last_status_code = ?, last_error = ?, updated_at = ?
         WHERE delivery_id = ? AND status = 'sending'`,
      )
      .run(
        result.status,
        result.nextAttemptAt ?? now.toISOString(),
        result.statusCode ?? null,
        result.error ? redactText(result.error) : null,
        now.toISOString(),
        deliveryId,
      );
  }

  /** Starts a new retry window for a failed delivery to an active destination. */
  retry(owner: EventRoutineOwner, routineId: string, deliveryId: string, now = new Date()): void {
    this.#requireRoutine(owner, routineId);
    const timestamp = now.toISOString();
    const retried = this.database.connection
      .prepare(
        `UPDATE projection_webhook_deliveries
         SET status = 'queued', attempt = 0, next_attempt_at = ?, window_started_at = ?, last_error = NULL,
             last_status_code = NULL, updated_at = ?
         WHERE delivery_id = ? AND owner_kind = ? AND routine_id = ? AND status = 'failed'
           AND destination_id IN (SELECT destination_id FROM projection_webhook_destinations WHERE active = 1)`,
      )
      .run(timestamp, timestamp, timestamp, deliveryId, owner.kind, routineId);
    if (retried.changes === 0) throw new RoutineInputError(sourceText("error.backend.webhookDeliveryNotRetryable"));
  }

  #row(ownerKind: RoutineOwnerKind, routineId: string, destinationId: string): DynamicRecord | null {
    const row = this.database.connection
      .prepare(
        `SELECT ${DESTINATION_COLUMNS}, headers_ciphertext FROM projection_webhook_destinations
         WHERE destination_id = ? AND owner_kind = ? AND routine_id = ?`,
      )
      .get(destinationId, ownerKind, routineId);
    return isDynamicRecord(row) ? row : null;
  }

  #requireRoutine(owner: EventRoutineOwner, routineId: string): void {
    const { routineTable, ownerColumn } = ROUTINE_OWNER_TABLES[owner.kind];
    const row = this.database.connection
      .prepare(`SELECT 1 FROM ${routineTable} WHERE routine_id = ? AND ${ownerColumn} = ?`)
      .get(routineId, owner.id);
    if (!isDynamicRecord(row)) throw new RoutineInputError(sourceText("error.backend.routineGone"));
  }
}

/**
 * Adds one delivery per matching destination to the outbox, in the caller's transaction, so a run
 * status change and its notifications commit together. The delivery ID is the transition ID plus
 * the destination, so a replayed transition cannot queue a second delivery.
 */
export function enqueueRunNotification(
  db: OpenBotDatabase["connection"],
  ownerKind: RoutineOwnerKind,
  notification: RoutineRunNotification,
  now = new Date(),
): void {
  const timestamp = now.toISOString();
  db.prepare(
    `DELETE FROM projection_webhook_deliveries
     WHERE status IN ('succeeded', 'failed') AND updated_at < ?`,
  ).run(new Date(now.getTime() - TERMINAL_DELIVERY_RETENTION_MS).toISOString());
  const payload: EventJsonValue = {
    eventId: notification.eventId,
    eventType: notification.eventType,
    runId: notification.runId,
    occurredAt: notification.occurredAt,
    routineId: notification.routineId,
    routineName: redactText(notification.routineName),
    status: notification.status,
  };
  const insert = db.prepare(
    `INSERT OR IGNORE INTO projection_webhook_deliveries (
       delivery_id, destination_id, owner_kind, routine_id, run_id, event_id, event_type, payload_json, attempt,
       next_attempt_at, window_started_at, status, last_status_code, last_error, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'queued', NULL, NULL, ?, ?)`,
  );
  for (const row of databaseRows(
    db
      .prepare(
        `SELECT destination_id, event_types_json, payload_template_json FROM projection_webhook_destinations
         WHERE owner_kind = ? AND routine_id = ? AND active = 1 ORDER BY destination_id`,
      )
      .all(ownerKind, notification.routineId),
  )) {
    if (!stringArray(row, "event_types_json").includes(notification.eventType)) continue;
    const destinationId = requiredStringColumn(row, "destination_id");
    const template = optionalStringColumn(row, "payload_template_json");
    const body = template === null ? payload : materializeTemplate(parseEventJson(template), payload);
    insert.run(
      `${notification.eventId}:${destinationId}`,
      destinationId,
      ownerKind,
      notification.routineId,
      notification.runId,
      notification.eventId,
      notification.eventType,
      JSON.stringify(body),
      timestamp,
      timestamp,
      timestamp,
      timestamp,
    );
  }
}

/** Removes the destinations of deleted routines in the caller's transaction. Deliveries cascade. */
export function deleteRoutineDestinations(
  db: OpenBotDatabase["connection"],
  ownerKind: RoutineOwnerKind,
  routineIds: readonly string[],
): void {
  const remove = db.prepare("DELETE FROM projection_webhook_destinations WHERE owner_kind = ? AND routine_id = ?");
  for (const routineId of routineIds) remove.run(ownerKind, routineId);
}

function validateDestination(input: SaveWebhookDestinationRecord): void {
  let https = false;
  try {
    https = new URL(input.url).protocol === "https:";
  } catch {
    https = false;
  }
  if (
    !https ||
    input.url.length > 2_048 ||
    !input.eventTypes.length ||
    !input.eventTypes.every(isRoutineRunEventType)
  ) {
    throw new RoutineInputError(sourceText("error.backend.webhookSettingsInvalid"));
  }
}

function destination(row: DynamicRecord): WebhookDestination {
  const template = optionalStringColumn(row, "payload_template_json");
  return {
    id: requiredStringColumn(row, "destination_id"),
    routineId: requiredStringColumn(row, "routine_id"),
    active: requiredNumberColumn(row, "active") === 1,
    url: requiredStringColumn(row, "url"),
    method: method(requiredStringColumn(row, "method")),
    eventTypes: stringArray(row, "event_types_json").map(runEventType),
    payloadTemplate: template === null ? null : parseEventJson(template),
    hasSecret: Boolean(optionalStringColumn(row, "secret_ciphertext")),
    headerNames: stringArray(row, "header_names_json"),
    createdAt: requiredStringColumn(row, "created_at"),
    updatedAt: requiredStringColumn(row, "updated_at"),
  };
}

function stringArray(row: DynamicRecord, column: string): string[] {
  const parsed = JSON.parse(requiredStringColumn(row, column));
  if (!Array.isArray(parsed) || !parsed.every(isString)) throw new Error(`Invalid SQLite column ${column}.`);
  return parsed;
}

function runEventType(value: string): RoutineRunEventType {
  if (!isRoutineRunEventType(value)) throw new Error("The stored routine run event type is invalid.");
  return value;
}

function method(value: string): WebhookMethod {
  if (value === "POST" || value === "PUT" || value === "PATCH") return value;
  throw new Error("The stored webhook method is invalid.");
}

function deliveryStatus(value: string): "queued" | "sending" | "succeeded" | "failed" {
  if (value === "queued" || value === "sending" || value === "succeeded" || value === "failed") return value;
  throw new Error("The stored webhook delivery status is invalid.");
}
