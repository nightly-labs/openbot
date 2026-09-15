import type { AgentEvent, ConversationMessage, ConversationPage } from "@openbot/contracts/ipc";

import { replaceEqualDeep } from "@tanstack/react-query";

type Delta = Extract<AgentEvent, { type: "conversation-delta" }>;
export interface MobileConversation extends ConversationPage {
  olderLoading: boolean;
  olderError: boolean;
}
type ReadPage = (cursor?: string) => Promise<ConversationPage>;

/** In-memory chat windows. Only subscribers to a changed agent are notified. */
export class MobileConversationStore {
  #entries = new Map<string, MobileConversation>();
  #listeners = new Map<string, Set<() => void>>();
  #indices = new Map<string, Map<string, number>>();
  #deltas = new Map<string, Delta[]>();
  #cancelFrame: (() => void) | null = null;
  #olderLoads = new Map<string, symbol>();
  #loads = new Map<string, { promise: Promise<ConversationPage>; dirty: boolean }>();

  constructor(private schedule: (flush: () => void) => () => void) {}

  get(agentId: string) {
    return this.#entries.get(agentId);
  }

  isObserved(agentId: string) {
    return Boolean(this.#listeners.get(agentId)?.size);
  }

  subscribe(agentId: string, listener: () => void) {
    let listeners = this.#listeners.get(agentId);
    if (!listeners) {
      listeners = new Set();
      this.#listeners.set(agentId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) {
        this.#listeners.delete(agentId);
        if ((this.get(agentId)?.messages.length ?? 0) > 50) this.remove(agentId);
      }
    };
  }

  remove(agentId: string) {
    this.#entries.delete(agentId);
    this.#indices.delete(agentId);
    this.#deltas.delete(agentId);
    this.#loads.delete(agentId);
    this.#olderLoads.delete(agentId);
    for (const listener of this.#listeners.get(agentId) ?? []) listener();
  }

  cancelRequests() {
    this.#loads.clear();
    this.#olderLoads.clear();
    for (const [id, entry] of this.#entries) {
      if (entry.olderLoading) this.#publish(id, { ...entry, olderLoading: false }, false);
    }
  }

  dispose() {
    this.#cancelFrame?.();
    this.#cancelFrame = null;
    this.#deltas.clear();
    this.cancelRequests();
  }

  #publish(agentId: string, entry: MobileConversation, reindex = true) {
    if (!this.isObserved(agentId) && entry.messages.length > 50) {
      this.remove(agentId);
      return;
    }
    const current = this.get(agentId);
    if (entry === current) return;
    this.#entries.set(agentId, entry);
    if (reindex) this.#indices.set(agentId, new Map(entry.messages.map((message, index) => [message.id, index])));
    for (const listener of this.#listeners.get(agentId) ?? []) listener();
  }

  applyPage(page: ConversationPage, cursor?: string) {
    this.flush();
    const current = this.get(page.agentId);
    if (cursor && (!current || current.threadId !== page.threadId || current.pageInfo.olderCursor !== cursor)) return;
    if (!cursor && current && page.revision < current.revision) return;
    const sameThread = current?.threadId === page.threadId;
    const indices = sameThread ? this.#indices.get(page.agentId) : undefined;
    const overlap = page.messages.find((message) => indices?.has(message.id));
    // A disconnected latest page must not leave an invisible gap in the history.
    const retain = Boolean(sameThread && (cursor || overlap));
    const oldMessages = retain && current ? current.messages : [];
    const oldById = new Map(oldMessages.map((message) => [message.id, message]));
    const fetched = page.messages.map((message) => {
      const old = oldById.get(message.id);
      if (!old) return message;
      if (cursor) return old;
      return replaceEqualDeep(old, message);
    });
    const fetchedById = new Map(fetched.map((message) => [message.id, message]));
    const fetchedIds = new Set(fetchedById.keys());
    const first = overlap ? (indices?.get(overlap.id) ?? 0) : 0;
    let messages: ConversationMessage[];
    if (cursor)
      messages = [
        ...fetched.filter((message) => !oldById.has(message.id)),
        ...oldMessages.map((message) =>
          fetchedIds.has(message.id) ? (fetchedById.get(message.id) ?? message) : message,
        ),
      ];
    else {
      messages = [...oldMessages.slice(0, first).filter((message) => !fetchedIds.has(message.id)), ...fetched];
    }
    // History pages arrive in storage order, while the chat reads turns: an
    // answer streamed after later queued questions still belongs to its turn.
    // Sort the merged window the same way live updates are sorted.
    sortConversationMessages(messages);
    const next = replaceEqualDeep(current, {
      ...page,
      ...(cursor && current ? { revision: current.revision, activeTurnId: current.activeTurnId } : {}),
      messages,
      references: { ...(retain ? current?.references : {}), ...page.references },
      pageInfo: !cursor && retain && current && first > 0 ? current.pageInfo : page.pageInfo,
      olderLoading: current?.olderLoading ?? false,
      olderError: false,
    });
    this.#publish(page.agentId, next);
  }

  loadLatest(agentId: string, read: ReadPage, isCurrent: () => boolean, refresh = false): Promise<ConversationPage> {
    const pending = this.#loads.get(agentId);
    if (pending) {
      if (refresh) pending.dirty = true;
      return pending.promise;
    }
    const load: { promise: Promise<ConversationPage>; dirty: boolean } = {
      dirty: false,
      promise: Promise.resolve()
        .then(async () => {
          let page: ConversationPage;
          do {
            load.dirty = false;
            page = await read();
            if (page.agentId !== agentId) throw new Error("The server returned a page for another conversation.");
            if (!isCurrent() || this.#loads.get(agentId) !== load) return page;
            this.applyPage(page);
          } while (load.dirty);
          return page;
        })
        .finally(() => {
          if (this.#loads.get(agentId) === load) this.#loads.delete(agentId);
        }),
    };
    this.#loads.set(agentId, load);
    return load.promise;
  }

  async loadOlder(agentId: string, read: ReadPage, isCurrent: () => boolean) {
    const current = this.get(agentId);
    const cursor = current?.pageInfo.olderCursor;
    if (!current || current.olderLoading || !current.pageInfo.hasOlder || !cursor) return;
    const token = Symbol();
    this.#olderLoads.set(agentId, token);
    const valid = () => isCurrent() && this.#olderLoads.get(agentId) === token;
    this.#publish(agentId, { ...current, olderLoading: true, olderError: false }, false);
    try {
      const page = await read(cursor);
      if (page.agentId !== agentId) throw new Error("The server returned a page for another conversation.");
      if (valid()) this.applyPage(page, cursor);
    } catch {
      const latest = this.get(agentId);
      if (valid() && latest?.pageInfo.olderCursor === cursor)
        this.#publish(agentId, { ...latest, olderError: true }, false);
    } finally {
      const latest = this.get(agentId);
      if (this.#olderLoads.get(agentId) === token) {
        this.#olderLoads.delete(agentId);
        if (latest) this.#publish(agentId, { ...latest, olderLoading: false }, false);
      }
    }
  }

  enqueue(delta: Delta) {
    if (!this.get(delta.agentId)) return;
    const pending = this.#deltas.get(delta.agentId) ?? [];
    pending.push(delta);
    this.#deltas.set(delta.agentId, pending);
    this.#cancelFrame ??= this.schedule(() => this.flush());
  }

  flush() {
    this.#cancelFrame?.();
    this.#cancelFrame = null;
    const pending = this.#deltas;
    this.#deltas = new Map();
    for (const [agentId, deltas] of pending) {
      const current = this.get(agentId);
      const indices = this.#indices.get(agentId);
      if (!current || !indices) continue;
      let revision = current.revision;
      let threadId = current.threadId;
      let activeTurnId = current.activeTurnId;
      const updates = new Map<string, { event: Delta; parts: string[] }>();
      for (const event of deltas) {
        if (event.revision <= revision || (threadId !== null && event.threadId !== threadId)) continue;
        threadId = event.threadId;
        const update = updates.get(event.messageId);
        if (update) update.parts.push(event.delta);
        else updates.set(event.messageId, { event, parts: [event.delta] });
        revision = event.revision;
        activeTurnId = event.turnId;
      }
      if (!updates.size) continue;
      const messages = [...current.messages];
      let added = false;
      for (const [messageId, { event, parts }] of updates) {
        const text = parts.join("");
        const index = indices.get(messageId);
        if (index === undefined) {
          added = true;
          messages.push({
            id: messageId,
            turnId: event.turnId,
            author: "assistant",
            source: "assistant",
            text,
            createdAt: event.createdAt,
            status: "streaming",
          });
        } else {
          const message = messages[index];
          messages[index] = { ...message, text: message.text + text, status: "streaming" };
        }
      }
      // A streamed reply belongs to its turn, ahead of messages queued behind
      // it. Appending would group every answer after every question, so keep
      // the host order: turns by their first message, then user before answer.
      // Matches `sortConversationMessages` in `src/backend/conversation-snapshots.ts`.
      if (added) {
        sortConversationMessages(messages);
        this.#publish(agentId, { ...current, messages, revision, activeTurnId, threadId });
      } else {
        this.#publish(agentId, { ...current, messages, revision, activeTurnId, threadId }, false);
      }
    }
  }
}

/** Host order for one chat window. Keep in sync with the backend sorter. */
function sortConversationMessages(messages: ConversationMessage[]): void {
  const originalIndexes = new Map(messages.map((message, index) => [message, index]));
  const groupKeys = new Map<ConversationMessage, string>();
  const groups = new Map<string, { startedAt: number; firstIndex: number }>();
  for (const [index, message] of messages.entries()) {
    const groupKey = message.turnId ? `turn:${message.turnId}` : `message:${index}`;
    const createdAt = messageTime(message);
    groupKeys.set(message, groupKey);
    const group = groups.get(groupKey);
    if (group) {
      group.startedAt = Math.min(group.startedAt, createdAt);
      group.firstIndex = Math.min(group.firstIndex, index);
    } else {
      groups.set(groupKey, { startedAt: createdAt, firstIndex: index });
    }
  }
  messages.sort((left, right) => {
    const leftGroup = groups.get(groupKeys.get(left) ?? "");
    const rightGroup = groups.get(groupKeys.get(right) ?? "");
    if (leftGroup && rightGroup && leftGroup !== rightGroup) {
      if (leftGroup.startedAt !== rightGroup.startedAt) return leftGroup.startedAt - rightGroup.startedAt;
      if (leftGroup.firstIndex !== rightGroup.firstIndex) return leftGroup.firstIndex - rightGroup.firstIndex;
    }
    if (left.turnId && left.turnId === right.turnId) {
      const rankDifference = turnMessageRank(left) - turnMessageRank(right);
      if (rankDifference !== 0) return rankDifference;
    }
    const timeDifference = messageTime(left) - messageTime(right);
    if (timeDifference !== 0) return timeDifference;
    return (originalIndexes.get(left) ?? 0) - (originalIndexes.get(right) ?? 0);
  });
}

function messageTime(message: ConversationMessage): number {
  const timestamp = Date.parse(message.createdAt);
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

function turnMessageRank(message: ConversationMessage): 0 | 1 | 2 | 3 {
  if (message.exchange?.direction === "incoming" || message.author === "user") return 0;
  if (message.author === "assistant" && message.itemType === "commentary") return 1;
  if (message.exchange?.direction === "outgoing") return 2;
  if (message.author === "assistant") return 3;
  return 2;
}
