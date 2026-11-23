import { type AgentTask, isQueuedAgentReply, type QueueDelivery, type QueueSnapshot } from "@openbot/contracts/ipc";

export function withoutSideThreadTurns(queue: QueueSnapshot, tasks: readonly AgentTask[]): QueueSnapshot {
  const sideTurns = new Set(tasks.flatMap((task) => (task.activeTurnId ? [task.activeTurnId] : [])));
  if (sideTurns.size === 0) return queue;
  const deliveries = queue.deliveries.filter((delivery) => delivery.turnId === null || !sideTurns.has(delivery.turnId));
  return deliveries.length === queue.deliveries.length ? queue : { ...queue, deliveries };
}

export function activeQueueDeliveries(
  snapshot: QueueSnapshot | undefined,
  activeTurnId: string | null | undefined,
): QueueDelivery[] {
  const running = (snapshot?.deliveries ?? []).filter(
    (delivery) => delivery.status === "starting" || delivery.status === "running",
  );
  if (!activeTurnId) return running;
  const matching = running.filter((delivery) => delivery.turnId === activeTurnId || delivery.turnId === null);
  return matching.length > 0 ? matching : running;
}

export function queuedDeliveriesInOrder(snapshot: QueueSnapshot | undefined): QueueDelivery[] {
  return [...(snapshot?.deliveries ?? [])]
    .filter((delivery) => delivery.status === "queued")
    .sort((left, right) => {
      const leftPosition = left.position ?? Number.MAX_SAFE_INTEGER;
      const rightPosition = right.position ?? Number.MAX_SAFE_INTEGER;
      return leftPosition - rightPosition || left.createdAt.localeCompare(right.createdAt);
    });
}

export function presentQueueDeliveries(input: {
  snapshot: QueueSnapshot | undefined;
  activeTurnId: string | null | undefined;
  renderedMessageIds: ReadonlySet<string>;
}): QueueDelivery[] {
  const snapshot = input.snapshot;
  if (!snapshot) return [];
  const queued = queuedDeliveriesInOrder(snapshot).filter(
    (delivery) =>
      (!input.activeTurnId || delivery.turnId !== input.activeTurnId) &&
      !input.renderedMessageIds.has(delivery.id) &&
      !isQueuedAgentReply(delivery),
  );
  const steering = snapshot.deliveries.filter(
    (delivery) =>
      delivery.status === "starting" &&
      Boolean(input.activeTurnId) &&
      delivery.turnId === input.activeTurnId &&
      !input.renderedMessageIds.has(delivery.id),
  );
  return [...queued, ...steering];
}

export function queueAfterTurnCompleted(snapshot: QueueSnapshot, turnId: string): QueueSnapshot {
  const deliveries = snapshot.deliveries.filter(
    (delivery) =>
      !(
        (delivery.status === "starting" || delivery.status === "running") &&
        (delivery.turnId === null || delivery.turnId === turnId)
      ),
  );
  return deliveries.length === snapshot.deliveries.length ? snapshot : { ...snapshot, deliveries };
}
