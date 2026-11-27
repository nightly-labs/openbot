import type { QueueDelivery, QueueSnapshot } from "@openbot/contracts/ipc";
import { queuedDeliveriesInOrder } from "./queue-reconciliation";

const QUEUE_STATE_KEYS = ["status", "position", "turnId", "error"] as const satisfies readonly (keyof QueueDelivery)[];

export interface QueueEdit {
  before: ReadonlyMap<string, QueueDelivery>;
  after: ReadonlyMap<string, QueueDelivery>;
}

export type QueueEditDirection = "apply" | "roll-back";

function copyState<K extends keyof QueueDelivery>(target: QueueDelivery, key: K, source: QueueDelivery): void {
  target[key] = source[key];
}

function sameQueueState(left: QueueDelivery, right: QueueDelivery): boolean {
  return QUEUE_STATE_KEYS.every((key) => left[key] === right[key]);
}

function writeQueueState(target: QueueDelivery, source: QueueDelivery): void {
  for (const key of QUEUE_STATE_KEYS) copyState(target, key, source);
}

function queueEdit(snapshot: QueueSnapshot, edited: readonly QueueDelivery[]): QueueEdit | null {
  const before = new Map<string, QueueDelivery>();
  const after = new Map<string, QueueDelivery>();
  for (const delivery of edited) {
    const current = snapshot.deliveries.find((item) => item.id === delivery.id);
    if (current === undefined || sameQueueState(current, delivery)) continue;
    before.set(delivery.id, { ...current });
    after.set(delivery.id, delivery);
  }
  return after.size === 0 ? null : { before, after };
}

function queuedDelivery(snapshot: QueueSnapshot | undefined, deliveryId: string): QueueDelivery | undefined {
  return snapshot?.deliveries.find((item) => item.id === deliveryId && item.status === "queued");
}

export function cancelQueueEdit(snapshot: QueueSnapshot | undefined, deliveryId: string): QueueEdit | null {
  const delivery = queuedDelivery(snapshot, deliveryId);
  if (snapshot === undefined || delivery === undefined) return null;
  return queueEdit(snapshot, [{ ...delivery, status: "cancelled" }]);
}

export function steerQueueEdit(
  snapshot: QueueSnapshot | undefined,
  deliveryId: string,
  turnId: string,
): QueueEdit | null {
  const delivery = queuedDelivery(snapshot, deliveryId);
  if (snapshot === undefined || delivery === undefined) return null;
  return queueEdit(snapshot, [{ ...delivery, status: "starting", turnId, error: null }]);
}

export function reorderQueueEdit(
  snapshot: QueueSnapshot | undefined,
  deliveryIds: readonly string[],
): QueueEdit | null {
  if (snapshot === undefined) return null;
  const ordered = queuedDeliveriesInOrder(snapshot);
  const byId = new Map(ordered.map((delivery) => [delivery.id, delivery]));
  const moved = deliveryIds.flatMap((deliveryId) => byId.get(deliveryId) ?? []);
  const requested = new Set(deliveryIds);
  if (moved.length !== deliveryIds.length || requested.size !== deliveryIds.length) return null;
  let next = 0;
  const sequence = ordered.map((delivery) => (requested.has(delivery.id) ? (moved[next++] ?? delivery) : delivery));
  return queueEdit(
    snapshot,
    sequence.map((delivery, position) => ({ ...delivery, position })),
  );
}

function editSource(delivery: QueueDelivery, edit: QueueEdit, direction: QueueEditDirection): QueueDelivery | null {
  const before = edit.before.get(delivery.id);
  const after = edit.after.get(delivery.id);
  if (before === undefined || after === undefined) return null;
  if (direction === "apply") return sameQueueState(delivery, before) ? after : null;
  return sameQueueState(delivery, after) ? before : null;
}

export function patchQueueDeliveries(
  deliveries: QueueDelivery[],
  edit: QueueEdit,
  direction: QueueEditDirection,
): void {
  for (const delivery of deliveries) {
    const source = editSource(delivery, edit, direction);
    if (source !== null) writeQueueState(delivery, source);
  }
}

export function queueWithEdit(snapshot: QueueSnapshot, edit: QueueEdit, direction: QueueEditDirection): QueueSnapshot {
  let changed = false;
  const deliveries = snapshot.deliveries.map((delivery) => {
    const source = editSource(delivery, edit, direction);
    if (source === null) return delivery;
    changed = true;
    const copy = { ...delivery };
    writeQueueState(copy, source);
    return copy;
  });
  return changed ? { ...snapshot, deliveries } : snapshot;
}
