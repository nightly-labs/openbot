import { randomUUID } from "node:crypto";
import type { EventActivity, EventRoutineOwner, WebhookReceiptReason } from "@openbot/contracts/ipc-events";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { RoutineInputError } from "@openbot/team-client/routine-schedule";
import {
  databaseRows,
  optionalStringColumn,
  requiredNumberColumn,
  requiredStringColumn,
} from "./database/database-rows";
import type { OpenBotDatabase } from "./openbot-database";
import { deleteRoutineDestinations } from "./webhook-destination-store";
import { ROUTINE_OWNER_TABLES, type RoutineOwnerKind } from "./webhook-trigger";

const RECEIPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** What the main process needs to verify and route one inbound request. */
export interface WebhookRoute {
  routeId: string;
  owner: EventRoutineOwner;
  routineId: string;
  active: boolean;
  url: string | null;
  secretCiphertext: string;
}

export interface WebhookReceipt {
  ownerKind: RoutineOwnerKind;
  routineId: string;
  deliveryId: string;
  eventType: string;
  status: "started" | "ignored";
  reason: WebhookReceiptReason | null;
  runId: string | null;
  receivedAt: string;
}

const ROUTE_SELECT = Object.entries(ROUTINE_OWNER_TABLES)
  .map(([kind, { routineTable, ownerColumn, webhookTable }]) => {
    return `SELECT webhook.route_id, '${kind}' AS owner_kind, routine.${ownerColumn} AS owner_id, routine.routine_id,
                   routine.active, webhook.url, webhook.secret_ciphertext
            FROM ${webhookTable} webhook JOIN ${routineTable} routine ON routine.routine_id = webhook.routine_id`;
  })
  .join(" UNION ALL ");

/**
 * Owns the public side of webhook triggers: the route that the relay forwards, its secret, the
 * revocations that the relay still has to drain, and the receipts that make a redelivery a no-op.
 * The trigger row itself belongs to the routine, and `RoutineStore` writes it.
 */
export class WebhookRouteStore {
  constructor(private readonly database: OpenBotDatabase) {}

  find(routeId: string): WebhookRoute | null {
    const row = this.database.connection.prepare(`SELECT * FROM (${ROUTE_SELECT}) WHERE route_id = ?`).get(routeId);
    return isDynamicRecord(row) ? route(row) : null;
  }

  list(): WebhookRoute[] {
    return databaseRows(this.database.connection.prepare(`${ROUTE_SELECT} ORDER BY route_id`).all()).map(route);
  }

  /** Saves the relay URL only while the route is still the routine's, so a late registration cannot win. */
  setUrl(routeId: string, url: string | null): void {
    for (const { webhookTable } of Object.values(ROUTINE_OWNER_TABLES)) {
      this.database.connection.prepare(`UPDATE ${webhookTable} SET url = ? WHERE route_id = ?`).run(url, routeId);
    }
  }

  rotateSecret(owner: EventRoutineOwner, routineId: string, secretCiphertext: string, now = new Date()): void {
    const { routineTable, ownerColumn, webhookTable } = ROUTINE_OWNER_TABLES[owner.kind];
    const rotated = this.database.connection
      .prepare(
        `UPDATE ${webhookTable} SET secret_ciphertext = ?, updated_at = ?
         WHERE routine_id = ? AND routine_id IN (SELECT routine_id FROM ${routineTable} WHERE ${ownerColumn} = ?)`,
      )
      .run(secretCiphertext, now.toISOString(), routineId, owner.id);
    if (rotated.changes === 0) throw new RoutineInputError(sourceText("error.backend.routineGone"));
  }

  pendingRevocations(): string[] {
    return databaseRows(
      this.database.connection
        .prepare("SELECT route_id FROM projection_webhook_route_revocations ORDER BY created_at, route_id")
        .all(),
    ).map((row) => requiredStringColumn(row, "route_id"));
  }

  clearRevocation(routeId: string): void {
    this.database.connection
      .prepare("DELETE FROM projection_webhook_route_revocations WHERE route_id = ?")
      .run(routeId);
  }

  listReceipts(ownerKind: RoutineOwnerKind, routineId: string, limit: number): EventActivity[] {
    return databaseRows(
      this.database.connection
        .prepare(
          `SELECT receipt_id, delivery_id, event_type, status, reason, run_id, received_at
           FROM projection_webhook_receipts WHERE owner_kind = ? AND routine_id = ?
           ORDER BY received_at DESC, receipt_id LIMIT ?`,
        )
        .all(ownerKind, routineId, limit),
    ).map((row) => {
      const status = requiredStringColumn(row, "status");
      const reason = optionalStringColumn(row, "reason");
      if (status !== "started" && status !== "ignored") throw new Error("The stored webhook receipt is invalid.");
      if (reason !== null && reason !== "event-type" && reason !== "filter" && reason !== "inactive") {
        throw new Error("The stored webhook receipt is invalid.");
      }
      return {
        kind: "received",
        id: requiredStringColumn(row, "receipt_id"),
        deliveryId: requiredStringColumn(row, "delivery_id"),
        eventType: requiredStringColumn(row, "event_type"),
        status,
        reason,
        runId: optionalStringColumn(row, "run_id"),
        occurredAt: requiredStringColumn(row, "received_at"),
      };
    });
  }
}

export function hasWebhookReceipt(
  db: OpenBotDatabase["connection"],
  ownerKind: RoutineOwnerKind,
  routineId: string,
  deliveryId: string,
): boolean {
  return isDynamicRecord(
    db
      .prepare("SELECT 1 FROM projection_webhook_receipts WHERE owner_kind = ? AND routine_id = ? AND delivery_id = ?")
      .get(ownerKind, routineId, deliveryId),
  );
}

/**
 * Records one verified request in the caller's transaction. Returns false when the sender already
 * delivered this ID to this routine.
 */
export function insertWebhookReceipt(db: OpenBotDatabase["connection"], receipt: WebhookReceipt): boolean {
  db.prepare("DELETE FROM projection_webhook_receipts WHERE received_at < ?").run(
    new Date(Date.parse(receipt.receivedAt) - RECEIPT_RETENTION_MS).toISOString(),
  );
  return (
    db
      .prepare(
        `INSERT OR IGNORE INTO projection_webhook_receipts (
           receipt_id, owner_kind, routine_id, delivery_id, event_type, status, reason, run_id, received_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        receipt.ownerKind,
        receipt.routineId,
        receipt.deliveryId,
        receipt.eventType,
        receipt.status,
        receipt.reason,
        receipt.runId,
        receipt.receivedAt,
      ).changes > 0
  );
}

/**
 * Queues the relay revocation of each webhook route of these routines, in the caller's transaction,
 * before their trigger rows go. A routine delete, a switch to a schedule and an owner delete all
 * pass through here, so the public URL stops working with the trigger that it named.
 */
export function revokeRoutineWebhooks(
  db: OpenBotDatabase["connection"],
  ownerKind: RoutineOwnerKind,
  routineIds: readonly string[],
  options: { forget: boolean },
  now = new Date(),
): void {
  const { webhookTable } = ROUTINE_OWNER_TABLES[ownerKind];
  const revoke = db.prepare(
    `INSERT OR IGNORE INTO projection_webhook_route_revocations (route_id, created_at)
     SELECT route_id, ? FROM ${webhookTable} WHERE routine_id = ?`,
  );
  const remove = db.prepare(`DELETE FROM ${webhookTable} WHERE routine_id = ?`);
  for (const routineId of routineIds) {
    revoke.run(now.toISOString(), routineId);
    remove.run(routineId);
  }
  if (!options.forget) return;
  const receipts = db.prepare("DELETE FROM projection_webhook_receipts WHERE owner_kind = ? AND routine_id = ?");
  for (const routineId of routineIds) receipts.run(ownerKind, routineId);
  deleteRoutineDestinations(db, ownerKind, routineIds);
}

function route(row: DynamicRecord): WebhookRoute {
  const kind = requiredStringColumn(row, "owner_kind");
  if (kind !== "agent" && kind !== "channel") throw new Error("The stored webhook route is invalid.");
  return {
    routeId: requiredStringColumn(row, "route_id"),
    owner: { kind, id: requiredStringColumn(row, "owner_id") },
    routineId: requiredStringColumn(row, "routine_id"),
    active: requiredNumberColumn(row, "active") === 1,
    url: optionalStringColumn(row, "url"),
    secretCiphertext: requiredStringColumn(row, "secret_ciphertext"),
  };
}
