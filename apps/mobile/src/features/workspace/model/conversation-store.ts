import {
  type AgentEvent,
  type ConversationMessage,
  type ConversationPage,
  openExchangesOutside,
} from "@openbot/contracts/ipc";

import { replaceEqualDeep } from "@tanstack/react-query";

type Delta = Extract<AgentEvent, { type: "conversation-delta" }>;
export interface MobileConversation extends ConversationPage {
  olderLoading: boolean;
  olderError: boolean;
  detached: boolean;
}
type ReadPage = (cursor?: string) => Promise<ConversationPage>;
const KEPT_MESSAGES = 50;

export class MobileConversationStore {
  #entries = new Map<string, MobileConversation>();
  #listeners = new Map<string, Set<() => void>>();
  #indices = new Map<string, Map<string, number>>();
  #deltas = new Map<string, Delta[]>();
  #cancelFrame: (() => void) | null = null;
  #olderLoads = new Map<string, symbol>();
  #loads = new Map<string, { promise: Promise<ConversationPage>; dirty: boolean; stale: boolean; attach: boolean }>();
  #latestPages = new Map<string, { firstId: string; pageInfo: ConversationPage["pageInfo"] }>();
  #upToDate = new Set<string>();
  #missedLatest = new Set<string>();
  #latestReads = new Map<string, number>();
  #latestLoads = 0;
  #cached = new Set<string>();
  #journals = new Map<string, { base: number; deltas: Delta[] }>();

  constructor(private schedule: (flush: () => void) => () => void) {}

  get(agentId: string) {
    return this.#entries.get(agentId);
  }

  isObserved(agentId: string) {
    return Boolean(this.#listeners.get(agentId)?.size);
  }

  isUpToDate(agentId: string) {
    return this.#upToDate.has(agentId) && this.get(agentId)?.detached === false;
  }

  holdsRevision(agentId: string, revision: number, threadId?: string | null) {
    const entry = this.get(agentId);
    if (!entry || (threadId !== undefined && entry.threadId !== threadId)) return false;
    return entry.revision >= revision || this.#queuedRevision(agentId, entry.threadId) >= revision;
  }

  #queuedRevision(agentId: string, threadId: string | null) {
    let revision = 0;
    for (const delta of this.#deltas.get(agentId) ?? []) {
      if ((threadId === null || delta.threadId === threadId) && delta.revision > revision) revision = delta.revision;
    }
    return revision;
  }

  missedLatest(agentId: string) {
    return this.#missedLatest.has(agentId);
  }

  #markMissedLatest(agentId: string, load: number) {
    if ((this.#latestReads.get(agentId) ?? 0) > load) return;
    this.#upToDate.delete(agentId);
    this.#missedLatest.add(agentId);
  }

  markStale() {
    this.#upToDate.clear();
  }

  invalidate(agentId: string) {
    if (this.isObserved(agentId)) return true;
    this.#upToDate.delete(agentId);
    const pending = this.#loads.get(agentId);
    if (pending) pending.stale = true;
    return false;
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
        const entry = this.get(agentId);
        if (entry?.detached) this.remove(agentId);
        else if (entry) this.#publish(agentId, entry);
      }
    };
  }

  remove(agentId: string) {
    this.#entries.delete(agentId);
    this.#latestPages.delete(agentId);
    this.#upToDate.delete(agentId);
    this.#missedLatest.delete(agentId);
    this.#latestReads.delete(agentId);
    this.#cached.delete(agentId);
    this.#indices.delete(agentId);
    this.#deltas.delete(agentId);
    this.#loads.delete(agentId);
    this.#journals.delete(agentId);
    this.#olderLoads.delete(agentId);
    for (const listener of this.#listeners.get(agentId) ?? []) listener();
  }

  removeMessage(agentId: string, messageId: string) {
    this.flush();
    const current = this.get(agentId);
    if (!current) return;
    const messages = current.messages.filter((message) => message.id !== messageId);
    if (messages.length === current.messages.length && !(messageId in current.references)) return;
    const { [messageId]: _removed, ...references } = current.references;
    this.#publish(agentId, { ...current, messages, references });
  }

  cancelRequests() {
    this.markStale();
    for (const agentId of this.#loads.keys()) this.#missedLatest.add(agentId);
    this.#loads.clear();
    this.#journals.clear();
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

  #publish(agentId: string, next: MobileConversation, reindex = true) {
    const entry = this.isObserved(agentId) ? next : this.#trim(agentId, next);
    if (!entry) {
      this.remove(agentId);
      return;
    }
    const current = this.get(agentId);
    if (entry === current) return;
    this.#entries.set(agentId, entry);
    if (reindex || entry !== next)
      this.#indices.set(agentId, new Map(entry.messages.map((message, index) => [message.id, index])));
    for (const listener of this.#listeners.get(agentId) ?? []) listener();
  }

  #trim(agentId: string, entry: MobileConversation): MobileConversation | undefined {
    if (entry.messages.length <= KEPT_MESSAGES) return entry;
    const latest = this.#latestPages.get(agentId);
    const first = latest ? entry.messages.findIndex((message) => message.id === latest.firstId) : -1;
    if (!latest || first < 0) return undefined;
    if (first === 0) return entry;
    return {
      ...entry,
      messages: entry.messages.slice(first),
      pageInfo: latest.pageInfo,
      olderLoading: false,
      olderError: false,
    };
  }

  restore(page: ConversationPage) {
    if (this.get(page.agentId)) return;
    this.applyPage(page);
    this.#cached.add(page.agentId);
  }

  cachedPage(agentId: string): ConversationPage | undefined {
    const current = this.get(agentId);
    const entry = current && !current.detached ? this.#trim(agentId, current) : undefined;
    if (!entry) return undefined;
    const { olderLoading: _loading, olderError: _error, detached: _detached, ...page } = entry;
    return page;
  }

  applyPage(page: ConversationPage, cursor?: string, attach = false) {
    if (cursor) this.flush();
    const current = this.get(page.agentId);
    if (cursor && (!current || current.threadId !== page.threadId || current.pageInfo.olderCursor !== cursor)) return;
    const journal = cursor ? undefined : this.#journals.get(page.agentId);
    const heldRevision = journal ? journal.base : current?.revision;
    if (
      !cursor &&
      current &&
      heldRevision !== undefined &&
      page.revision < heldRevision &&
      !this.#cached.has(page.agentId)
    )
      return;
    if (!cursor) this.#cached.delete(page.agentId);
    const sameThread = current?.threadId === page.threadId;
    const indices = sameThread ? this.#indices.get(page.agentId) : undefined;
    const overlap = page.messages.find((message) => indices?.has(message.id));
    if (!cursor && current?.detached && !overlap && !attach) return;
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
    const next = replaceEqualDeep(current, {
      ...page,
      ...(cursor && current ? { revision: current.revision, activeTurnId: current.activeTurnId } : {}),
      messages,
      references: { ...(retain ? current?.references : {}), ...page.references },
      pageInfo: !cursor && retain && current && first > 0 ? current.pageInfo : page.pageInfo,
      olderLoading: current?.olderLoading ?? false,
      olderError: false,
      detached: cursor ? (current?.detached ?? false) : false,
    });
    const firstId = page.messages[0]?.id;
    if (!cursor && firstId) this.#latestPages.set(page.agentId, { firstId, pageInfo: page.pageInfo });
    if (!journal) {
      this.#publish(page.agentId, next);
      return;
    }
    journal.deltas = journal.deltas.filter((delta) => delta.revision > page.revision);
    journal.base = page.revision;
    const replayed = streamDeltas(next, indexOf(next.messages), journal.deltas);
    this.#publish(page.agentId, replayed?.entry ?? next);
  }

  openExchangesBeforeLatest(agentId: string): string[] {
    const current = this.get(agentId);
    const firstId = this.#latestPages.get(agentId)?.firstId;
    const first = current && firstId ? current.messages.findIndex((message) => message.id === firstId) : -1;
    return current && first > 0 ? openExchangesOutside(current.messages.slice(0, first), []) : [];
  }

  replaceMessage(page: ConversationPage, messageId: string) {
    this.flush();
    const current = this.get(page.agentId);
    const message = page.messages.find((candidate) => candidate.id === messageId);
    if (!current || !message || current.threadId !== page.threadId || page.revision < current.revision) return;
    const index = current.messages.findIndex((candidate) => candidate.id === messageId);
    if (index < 0) return;
    const messages = [...current.messages];
    messages[index] = replaceEqualDeep(current.messages[index], message);
    if (messages[index] !== current.messages[index]) this.#publish(page.agentId, { ...current, messages });
  }

  applyAround(page: ConversationPage) {
    if (!this.isObserved(page.agentId)) return;
    this.flush();
    const current = this.get(page.agentId);
    const indices =
      current && !current.detached && current.threadId === page.threadId ? this.#indices.get(page.agentId) : undefined;
    const overlap = indices ? page.messages.findIndex((message) => indices.has(message.id)) : -1;
    if (current && overlap >= 0) {
      if (overlap === 0) return;
      this.#publish(page.agentId, {
        ...current,
        messages: [...page.messages.slice(0, overlap), ...current.messages],
        references: { ...current.references, ...page.references },
        pageInfo: page.pageInfo,
        olderError: false,
      });
      return;
    }
    this.#latestPages.delete(page.agentId);
    this.#upToDate.delete(page.agentId);
    this.#publish(page.agentId, { ...page, olderLoading: false, olderError: false, detached: true });
  }

  loadLatest(
    agentId: string,
    read: ReadPage,
    isCurrent: () => boolean,
    refresh = false,
    attach = false,
  ): Promise<ConversationPage> {
    const pending = this.#loads.get(agentId);
    if (pending) {
      if (refresh) pending.dirty = true;
      if (attach) pending.attach = true;
      return pending.promise;
    }
    const serial = ++this.#latestLoads;
    const load: { promise: Promise<ConversationPage>; dirty: boolean; stale: boolean; attach: boolean } = {
      dirty: false,
      stale: false,
      attach,
      promise: Promise.resolve()
        .then(async () => {
          let page: ConversationPage;
          do {
            load.dirty = false;
            load.stale = false;
            page = await read();
            if (page.agentId !== agentId) throw new Error("The server returned a page for another conversation.");
            if (!isCurrent() || this.#loads.get(agentId) !== load) {
              this.#markMissedLatest(agentId, serial);
              return page;
            }
            this.applyPage(page, undefined, load.attach);
          } while (load.dirty || (load.stale && this.isObserved(agentId)));
          if (load.stale) return page;
          this.#upToDate.add(agentId);
          this.#missedLatest.delete(agentId);
          this.#latestReads.set(agentId, serial);
          return page;
        })
        .catch((error: unknown) => {
          this.#markMissedLatest(agentId, serial);
          throw error;
        })
        .finally(() => {
          if (this.#loads.get(agentId) === load) {
            this.#loads.delete(agentId);
            this.#journals.delete(agentId);
            if (this.#deltas.has(agentId)) this.flush();
          }
        }),
    };
    this.#loads.set(agentId, load);
    this.#journals.set(agentId, { base: this.get(agentId)?.revision ?? 0, deltas: [] });
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
    if (!this.isObserved(delta.agentId) && !this.#upToDate.has(delta.agentId) && !this.#loads.has(delta.agentId))
      return;
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
      const streamed = streamDeltas(current, indices, deltas);
      if (!streamed) continue;
      this.#journals.get(agentId)?.deltas.push(...streamed.applied);
      this.#publish(agentId, streamed.entry, streamed.added);
    }
  }
}

function indexOf(messages: ConversationMessage[]) {
  return new Map(messages.map((message, index) => [message.id, index]));
}

function streamDeltas(current: MobileConversation, indices: Map<string, number>, deltas: Delta[]) {
  let revision = current.revision;
  let threadId = current.threadId;
  let activeTurnId = current.activeTurnId;
  const applied: Delta[] = [];
  const updates = new Map<string, { event: Delta; parts: string[] }>();
  for (const event of deltas) {
    if (event.revision <= revision || (threadId !== null && event.threadId !== threadId)) continue;
    threadId = event.threadId;
    const update = updates.get(event.messageId);
    if (update) update.parts.push(event.delta);
    else updates.set(event.messageId, { event, parts: [event.delta] });
    revision = event.revision;
    activeTurnId = event.turnId;
    applied.push(event);
  }
  if (!updates.size) return undefined;
  const messages = [...current.messages];
  let added = false;
  for (const [messageId, { event, parts }] of updates) {
    const text = parts.join("");
    const index = indices.get(messageId);
    if (index === undefined) {
      if (current.detached) continue;
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
      if (!message) throw new Error("The streamed message is missing.");
      messages[index] = { ...message, text: message.text + text, status: "streaming" };
    }
  }
  return { entry: { ...current, messages, revision, activeTurnId, threadId }, added, applied };
}
