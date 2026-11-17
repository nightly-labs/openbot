import type { QueueDeliveryStatus } from "@openbot/contracts/ipc";

interface IndexedMessage {
  id: string;
  createdAt: string;
  sender: { kind: string; agentId?: string };
  taskId?: string;
  channelId?: string | undefined;
  messaging?: object;
  messagingReturn?: object;
  senderTaskId?: string;
  welcome?: true;
}

interface IndexedDelivery {
  id: string;
  messageId: string;
  recipientAgentId: string;
  status: QueueDeliveryStatus;
  turnId: string | null;
  queueOrder: number;
  createdAt: string;
  planContinuation?: { queued?: true; turnIds: readonly string[] };
  resumeAfterUsageLimit?: { previousTurnIds: readonly string[] };
  steeredAt?: string;
}

interface DeliveryKeys {
  messageId: string;
  recipient: string;
  lane: string;
  queued: boolean;
  started: boolean;
  active: boolean;
  order: number;
  createdAt: string;
  continuation: boolean;
  steeredAt: string | undefined;
  providerIds: readonly string[];
  routineTurnIds: readonly string[];
}

export interface MailboxReadIndexOptions<M, D> {
  lane(message: M): string | null;
  execution(message: M): boolean;
  compare(left: D, right: D): number;
}

/**
 * Owns derived mailbox lookups, never persistence or retained history. Appends and changed row IDs
 * update only their memberships. Array replacement (reload, removal or rollback) rebuilds the
 * lookups. Values remain the store's own objects, so text, edits and delivery details stay current.
 * This module never imports MailboxStore.
 */
export class MailboxReadIndex<M extends IndexedMessage, D extends IndexedDelivery> {
  readonly #options: MailboxReadIndexOptions<M, D>;
  #sourceMessages: readonly M[] | null = null;
  #sourceDeliveries: readonly D[] | null = null;
  readonly messages = new Map<string, M>();
  readonly deliveries = new Map<string, D>();
  readonly executionMessages = new Set<string>();
  readonly #ordinals = new Map<string, number>();
  readonly #deliveryOrdinals = new Map<string, number>();
  readonly #messageKeys = new Map<string, string>();
  readonly #deliveryKeys = new Map<string, DeliveryKeys>();
  readonly #byMessage = new Map<string, Map<string, D>>();
  readonly #byRecipient = new Map<string, Map<string, D>>();
  readonly #activeRecipients = new Map<string, Set<D>>();
  readonly #sortedActiveRecipients = new Map<string, D[]>();
  readonly #providerMatches = new Map<string, Map<string, Set<D>>>();
  readonly #routineTurnMatches = new Map<string, Map<string, Set<D>>>();
  readonly #queued = new Map<string, Set<D>>();
  readonly #startedLanes = new Map<string, Set<D>>();
  readonly #activeLanes = new Map<string, Set<D>>();
  readonly #sortedQueues = new Map<string, D[]>();
  #sortedAllQueues: D[] | null = null;
  readonly #audiences = new Map<string, Set<string>>();
  readonly #activeAudiences = new Map<string, Set<string>>();
  readonly #conversation = new Map<string, M[]>();
  readonly #activeConversation = new Map<string, Set<M>>();
  readonly #conversationTimes = new Map<string, Array<{ message: M; time: string }>>();
  readonly #messageTimes = new Map<string, Map<string, string>>();
  #messageCount = 0;
  #deliveryCount = 0;

  constructor(options: MailboxReadIndexOptions<M, D>) {
    this.#options = options;
  }

  synchronize(
    messages: readonly M[],
    deliveries: readonly D[],
    changedMessages: ReadonlySet<string>,
    changedDeliveries: ReadonlySet<string>,
  ): this {
    if (
      messages !== this.#sourceMessages ||
      deliveries !== this.#sourceDeliveries ||
      messages.length < this.#messageCount ||
      deliveries.length < this.#deliveryCount
    ) {
      this.#reset();
      this.#sourceMessages = messages;
      this.#sourceDeliveries = deliveries;
    }
    const addedMessages = messages.slice(this.#messageCount);
    for (const message of addedMessages) {
      this.#ordinals.set(message.id, this.#messageCount++);
      this.messages.set(message.id, message);
    }
    const addedDeliveries = deliveries.slice(this.#deliveryCount);
    let deliveryOrdinal = this.#deliveryCount;
    this.#deliveryCount = deliveries.length;
    for (const delivery of addedDeliveries) {
      this.#deliveryOrdinals.set(delivery.id, deliveryOrdinal++);
      this.deliveries.set(delivery.id, delivery);
      this.#refreshDelivery(delivery);
    }
    for (const message of addedMessages) this.#refreshMessage(message);
    for (const id of changedMessages) {
      const message = this.messages.get(id);
      if (message) this.#refreshMessage(message);
    }
    for (const id of changedDeliveries) {
      const delivery = this.deliveries.get(id);
      if (delivery) this.#refreshDelivery(delivery);
    }
    return this;
  }

  forMessage(id: string): readonly D[] {
    return [...(this.#byMessage.get(id)?.values() ?? [])];
  }

  forRecipient(agentId: string): readonly D[] {
    return [...(this.#byRecipient.get(agentId)?.values() ?? [])];
  }

  /** Active rows in original storage order, which the non-queued channel reader preserves. */
  activeForRecipient(agentId: string): readonly D[] {
    let rows = this.#sortedActiveRecipients.get(agentId);
    if (!rows) {
      rows = [...(this.#activeRecipients.get(agentId) ?? [])].sort(
        (left, right) => this.#deliveryOrdinal(left) - this.#deliveryOrdinal(right),
      );
      this.#sortedActiveRecipients.set(agentId, rows);
    }
    return rows;
  }

  /** A continuation match can precede an exact delivery ID, so all matches keep storage precedence. */
  providerDelivery(agentId: string, messageId: string): D | undefined {
    const exact = this.deliveries.get(messageId);
    return this.#first(
      this.#providerMatches.get(agentId)?.get(messageId),
      exact?.recipientAgentId === agentId ? exact : undefined,
    );
  }

  routineDelivery(agentId: string, turnId: string): D | undefined {
    return this.#first(this.#routineTurnMatches.get(agentId)?.get(turnId));
  }

  queued(agentId: string): D[] {
    let sorted = this.#sortedQueues.get(agentId);
    if (!sorted) {
      sorted = [...(this.#queued.get(agentId) ?? [])].sort(this.#options.compare);
      this.#sortedQueues.set(agentId, sorted);
    }
    return sorted.slice();
  }

  queuedRecipients(): Iterable<string> {
    return this.#queued.keys();
  }

  allQueued(): readonly D[] {
    this.#sortedAllQueues ??= [...this.#queued.values()].flatMap((entries) => [...entries]).sort(this.#options.compare);
    return this.#sortedAllQueues;
  }

  laneStarted(agentId: string, lane: string | null): boolean {
    return (this.#startedLanes.get(laneKey(agentId, lane))?.size ?? 0) > 0;
  }

  laneBusy(agentId: string, lane: string | null): boolean {
    return (this.#activeLanes.get(laneKey(agentId, lane))?.size ?? 0) > 0;
  }

  conversation(agentId: string, fromCreatedAt?: string): readonly M[] {
    const ordered = this.#conversation.get(agentId) ?? [];
    if (!fromCreatedAt) return ordered;
    const byTime = this.#conversationTimes.get(agentId) ?? [];
    let left = 0;
    let right = byTime.length;
    while (left < right) {
      const middle = (left + right) >>> 1;
      if ((byTime[middle]?.time ?? "") < fromCreatedAt) left = middle + 1;
      else right = middle;
    }
    if (left === 0) return ordered;
    return byTime
      .slice(left)
      .map((entry) => entry.message)
      .sort((first, second) => this.ordinal(first.id) - this.ordinal(second.id));
  }

  activeConversation(agentId: string): readonly M[] {
    return [...(this.#activeConversation.get(agentId) ?? [])];
  }

  ordinal(id: string): number {
    return this.#ordinals.get(id) ?? -1;
  }

  #refreshDelivery(delivery: D): void {
    const message = this.messages.get(delivery.messageId);
    const next: DeliveryKeys = {
      messageId: delivery.messageId,
      recipient: delivery.recipientAgentId,
      lane: laneKey(delivery.recipientAgentId, message ? this.#options.lane(message) : null),
      queued: delivery.status === "queued",
      started: delivery.status === "starting" || delivery.status === "running",
      active: active(delivery),
      order: delivery.queueOrder,
      createdAt: delivery.createdAt,
      continuation: delivery.planContinuation?.queued === true,
      steeredAt: delivery.steeredAt,
      providerIds: [
        ...new Set([
          ...(delivery.resumeAfterUsageLimit
            ? [
                ...(delivery.turnId === null ? [] : [delivery.turnId]),
                ...delivery.resumeAfterUsageLimit.previousTurnIds,
              ]
            : []),
          ...(delivery.planContinuation?.turnIds ?? []),
        ]),
      ],
      routineTurnIds:
        message?.sender.kind === "routine"
          ? [
              ...new Set([
                ...(delivery.turnId === null ? [] : [delivery.turnId]),
                ...(delivery.resumeAfterUsageLimit?.previousTurnIds ?? []),
              ]),
            ]
          : [],
    };
    const previous = this.#deliveryKeys.get(delivery.id);
    if (previous && sameKeys(previous, next)) return;
    if (previous) {
      if (previous.messageId !== next.messageId) this.#byMessage.get(previous.messageId)?.delete(delivery.id);
      if (previous.recipient !== next.recipient) this.#byRecipient.get(previous.recipient)?.delete(delivery.id);
      remove(this.#queued, previous.recipient, delivery);
      remove(this.#startedLanes, previous.lane, delivery);
      remove(this.#activeLanes, previous.lane, delivery);
      remove(this.#activeRecipients, previous.recipient, delivery);
      this.#sortedActiveRecipients.delete(previous.recipient);
      this.#sortedQueues.delete(previous.recipient);
    }
    map(this.#byMessage, next.messageId).set(delivery.id, delivery);
    map(this.#byRecipient, next.recipient).set(delivery.id, delivery);
    if (next.queued) set(this.#queued, next.recipient).add(delivery);
    if (next.started) set(this.#startedLanes, next.lane).add(delivery);
    if (next.active) set(this.#activeLanes, next.lane).add(delivery);
    if (next.active) set(this.#activeRecipients, next.recipient).add(delivery);
    this.#sortedActiveRecipients.delete(next.recipient);
    this.#replaceMatches(
      this.#providerMatches,
      delivery,
      previous?.recipient,
      previous?.providerIds ?? [],
      next.recipient,
      next.providerIds,
    );
    this.#replaceMatches(
      this.#routineTurnMatches,
      delivery,
      previous?.recipient,
      previous?.routineTurnIds ?? [],
      next.recipient,
      next.routineTurnIds,
    );
    this.#sortedQueues.delete(next.recipient);
    this.#sortedAllQueues = null;
    this.#deliveryKeys.set(delivery.id, next);
    if (previous && previous.messageId !== next.messageId) {
      const oldMessage = this.messages.get(previous.messageId);
      if (oldMessage) this.#refreshAudience(oldMessage);
    }
    if (message) this.#refreshAudience(message);
  }

  #refreshMessage(message: M): void {
    const key = JSON.stringify([
      message.sender.kind,
      message.sender.agentId,
      message.taskId,
      message.channelId,
      Boolean(message.messaging),
      Boolean(message.messagingReturn),
      message.senderTaskId,
      message.welcome,
      message.createdAt,
    ]);
    if (this.#messageKeys.get(message.id) === key) return;
    this.#messageKeys.set(message.id, key);
    if (this.#options.execution(message)) this.executionMessages.add(message.id);
    else this.executionMessages.delete(message.id);
    for (const delivery of this.#byMessage.get(message.id)?.values() ?? []) this.#refreshDelivery(delivery);
    this.#refreshAudience(message);
  }

  #refreshAudience(message: M): void {
    const audience = new Set<string>();
    const activeAudience = new Set<string>();
    const sender = message.sender.kind === "agent" ? message.sender.agentId : undefined;
    const deliveries = this.#byMessage.get(message.id);
    const visible = !message.channelId && !message.messaging;
    const visibleSender =
      sender &&
      visible &&
      !message.messagingReturn &&
      !message.senderTaskId &&
      (!message.taskId || [...(deliveries?.values() ?? [])].some((delivery) => delivery.recipientAgentId !== sender));
    if (sender && visibleSender) audience.add(sender);
    const times = new Map<string, string>();
    if (sender && visibleSender) times.set(sender, message.createdAt);
    for (const delivery of deliveries?.values() ?? []) {
      const recipient = delivery.recipientAgentId;
      if (visible && !message.taskId && recipient !== sender) {
        audience.add(recipient);
        if (!times.has(recipient)) times.set(recipient, delivery.steeredAt ?? message.createdAt);
      }
      if (active(delivery)) {
        if (audience.has(recipient)) activeAudience.add(recipient);
        if (sender && visibleSender) activeAudience.add(sender);
      }
    }
    const previous = this.#audiences.get(message.id) ?? new Set<string>();
    for (const agent of previous) {
      if (audience.has(agent)) continue;
      const entries = this.#conversation.get(agent);
      const index = entries?.indexOf(message) ?? -1;
      if (index >= 0) entries?.splice(index, 1);
    }
    for (const agent of audience) {
      if (previous.has(agent)) continue;
      let entries = this.#conversation.get(agent);
      if (!entries) {
        entries = [];
        this.#conversation.set(agent, entries);
      }
      const ordinal = this.ordinal(message.id);
      let left = 0;
      let right = entries.length;
      while (left < right) {
        const middle = (left + right) >>> 1;
        const item = entries[middle];
        if (item && this.ordinal(item.id) < ordinal) left = middle + 1;
        else right = middle;
      }
      entries.splice(left, 0, message);
    }
    for (const agent of this.#activeAudiences.get(message.id) ?? []) {
      if (!activeAudience.has(agent)) remove(this.#activeConversation, agent, message);
    }
    for (const agent of activeAudience) set(this.#activeConversation, agent).add(message);
    const previousTimes = this.#messageTimes.get(message.id) ?? new Map<string, string>();
    for (const [agent, time] of previousTimes) {
      if (times.get(agent) === time) continue;
      const entries = this.#conversationTimes.get(agent);
      if (entries) entries.splice(this.#timePosition(entries, message, time), 1);
    }
    for (const [agent, time] of times) {
      if (previousTimes.get(agent) === time) continue;
      let entries = this.#conversationTimes.get(agent);
      if (!entries) {
        entries = [];
        this.#conversationTimes.set(agent, entries);
      }
      entries.splice(this.#timePosition(entries, message, time), 0, { message, time });
    }
    this.#messageTimes.set(message.id, times);
    this.#audiences.set(message.id, audience);
    this.#activeAudiences.set(message.id, activeAudience);
  }

  #reset(): void {
    this.#messageCount = 0;
    this.#deliveryCount = 0;
    this.messages.clear();
    this.deliveries.clear();
    this.executionMessages.clear();
    this.#ordinals.clear();
    this.#deliveryOrdinals.clear();
    this.#messageKeys.clear();
    this.#deliveryKeys.clear();
    this.#byMessage.clear();
    this.#byRecipient.clear();
    this.#activeRecipients.clear();
    this.#sortedActiveRecipients.clear();
    this.#providerMatches.clear();
    this.#routineTurnMatches.clear();
    this.#queued.clear();
    this.#startedLanes.clear();
    this.#activeLanes.clear();
    this.#sortedQueues.clear();
    this.#sortedAllQueues = null;
    this.#audiences.clear();
    this.#activeAudiences.clear();
    this.#conversation.clear();
    this.#activeConversation.clear();
    this.#conversationTimes.clear();
    this.#messageTimes.clear();
  }

  #deliveryOrdinal(delivery: D): number {
    return this.#deliveryOrdinals.get(delivery.id) ?? -1;
  }

  #first(matches: ReadonlySet<D> | undefined, first?: D): D | undefined {
    let selected = first;
    for (const delivery of matches ?? []) {
      if (!selected || this.#deliveryOrdinal(delivery) < this.#deliveryOrdinal(selected)) selected = delivery;
    }
    return selected;
  }

  #replaceMatches(
    index: Map<string, Map<string, Set<D>>>,
    delivery: D,
    previousRecipient: string | undefined,
    previousIds: readonly string[],
    recipient: string,
    ids: readonly string[],
  ): void {
    if (previousRecipient === recipient && sameIds(previousIds, ids)) return;
    if (previousRecipient !== undefined) {
      const previous = index.get(previousRecipient);
      if (previous) {
        for (const id of previousIds) remove(previous, id, delivery);
        if (previous.size === 0) index.delete(previousRecipient);
      }
    }
    if (ids.length > 0) {
      const next = map(index, recipient);
      for (const id of ids) set(next, id).add(delivery);
    }
  }

  #timePosition(entries: readonly { message: M; time: string }[], message: M, time: string): number {
    let left = 0;
    let right = entries.length;
    const ordinal = this.ordinal(message.id);
    while (left < right) {
      const middle = (left + right) >>> 1;
      const entry = entries[middle];
      if (entry && (entry.time < time || (entry.time === time && this.ordinal(entry.message.id) < ordinal)))
        left = middle + 1;
      else right = middle;
    }
    return left;
  }
}

function active(delivery: IndexedDelivery): boolean {
  return delivery.status === "queued" || delivery.status === "starting" || delivery.status === "running";
}

function laneKey(agent: string, lane: string | null): string {
  return `${agent}\0${lane ?? ""}`;
}

function sameKeys(left: DeliveryKeys, right: DeliveryKeys): boolean {
  return (
    left.messageId === right.messageId &&
    left.recipient === right.recipient &&
    left.lane === right.lane &&
    left.queued === right.queued &&
    left.started === right.started &&
    left.active === right.active &&
    left.order === right.order &&
    left.createdAt === right.createdAt &&
    left.continuation === right.continuation &&
    left.steeredAt === right.steeredAt &&
    sameIds(left.providerIds, right.providerIds) &&
    sameIds(left.routineTurnIds, right.routineTurnIds)
  );
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function map<V>(values: Map<string, Map<string, V>>, key: string): Map<string, V> {
  let entries = values.get(key);
  if (!entries) {
    entries = new Map();
    values.set(key, entries);
  }
  return entries;
}

function set<V>(values: Map<string, Set<V>>, key: string): Set<V> {
  let entries = values.get(key);
  if (!entries) {
    entries = new Set();
    values.set(key, entries);
  }
  return entries;
}

function remove<V>(values: Map<string, Set<V>>, key: string, value: V): void {
  const entries = values.get(key);
  entries?.delete(value);
  if (entries?.size === 0) values.delete(key);
}
