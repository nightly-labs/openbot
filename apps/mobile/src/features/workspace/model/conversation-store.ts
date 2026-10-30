import type { AgentEvent, ConversationMessage, ConversationPage } from "@openbot/contracts/ipc";

import { replaceEqualDeep } from "@tanstack/react-query";

type Delta = Extract<AgentEvent, { type: "conversation-delta" }>;
export interface MobileConversation extends ConversationPage {
  olderLoading: boolean;
  olderError: boolean;
  /** The window was loaded around a searched message and does not reach the latest message. */
  detached: boolean;
}
type ReadPage = (cursor?: string) => Promise<ConversationPage>;
/** The size of the window that the store keeps for a chat that nobody reads. */
const KEPT_MESSAGES = 50;

/** In-memory chat windows. Only subscribers to a changed agent are notified. */
export class MobileConversationStore {
  #entries = new Map<string, MobileConversation>();
  #listeners = new Map<string, Set<() => void>>();
  #indices = new Map<string, Map<string, number>>();
  #deltas = new Map<string, Delta[]>();
  #cancelFrame: (() => void) | null = null;
  #olderLoads = new Map<string, symbol>();
  #loads = new Map<string, { promise: Promise<ConversationPage>; dirty: boolean; attach: boolean }>();
  /** The first message and the cursor of the last latest page, where a closed chat can be cut. */
  #latestPages = new Map<string, { firstId: string; pageInfo: ConversationPage["pageInfo"] }>();
  /** Chats whose latest page loaded on the current connection, so events keep them up to date. */
  #upToDate = new Set<string>();

  constructor(private schedule: (flush: () => void) => () => void) {}

  get(agentId: string) {
    return this.#entries.get(agentId);
  }

  isObserved(agentId: string) {
    return Boolean(this.#listeners.get(agentId)?.size);
  }

  /** True when the chat holds the latest messages and the connection has not stopped since they loaded. */
  isUpToDate(agentId: string) {
    return this.#upToDate.has(agentId) && this.get(agentId)?.detached === false;
  }

  /** True when the chat already holds `revision` of `threadId` (any thread when omitted), so a page read adds nothing. */
  holdsRevision(agentId: string, revision: number, threadId?: string | null) {
    const entry = this.get(agentId);
    return Boolean(entry && entry.revision >= revision && (threadId === undefined || entry.threadId === threadId));
  }

  /** A new connection can have missed events, so each chat loads again before it counts as current. */
  markStale() {
    this.#upToDate.clear();
  }

  /**
   * Keeps an event change for a chat that nobody reads: it loads when it opens, not on each change.
   * Returns true when the chat has a reader, so the caller reads its page now.
   */
  invalidate(agentId: string) {
    if (this.isObserved(agentId)) return true;
    this.#upToDate.delete(agentId);
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
        // A window around a searched message is not the chat that the next reader opens.
        if (entry?.detached) this.remove(agentId);
        else if (entry) this.#publish(agentId, entry);
      }
    };
  }

  remove(agentId: string) {
    this.#entries.delete(agentId);
    this.#latestPages.delete(agentId);
    this.#upToDate.delete(agentId);
    this.#indices.delete(agentId);
    this.#deltas.delete(agentId);
    this.#loads.delete(agentId);
    this.#olderLoads.delete(agentId);
    for (const listener of this.#listeners.get(agentId) ?? []) listener();
  }

  cancelRequests() {
    this.markStale();
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

  /**
   * Keeps a chat that nobody reads at its last latest page and the messages after it, so it opens
   * at once. The host cursor is opaque, so the store cuts only where a page started. Without that
   * point a long window is dropped and loads again when the chat opens.
   */
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

  /** `attach` lets a latest page replace a window around a searched message. */
  applyPage(page: ConversationPage, cursor?: string, attach = false) {
    this.flush();
    const current = this.get(page.agentId);
    if (cursor && (!current || current.threadId !== page.threadId || current.pageInfo.olderCursor !== cursor)) return;
    if (!cursor && current && page.revision < current.revision) return;
    const sameThread = current?.threadId === page.threadId;
    const indices = sameThread ? this.#indices.get(page.agentId) : undefined;
    const overlap = page.messages.find((message) => indices?.has(message.id));
    // A window around a searched message stays until a latest page meets it or the reader asks for the latest messages.
    if (!cursor && current?.detached && !overlap && !attach) return;
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
    this.#publish(page.agentId, next);
  }

  /**
   * Shows a page around a searched message. A page that meets the loaded window adds its older
   * messages to it. Another page replaces the window until the latest messages load again.
   */
  applyAround(page: ConversationPage) {
    // A reader who left the chat does not need it, and the next one opens at the latest message.
    if (!this.isObserved(page.agentId)) return;
    this.flush();
    const current = this.get(page.agentId);
    const indices =
      current && !current.detached && current.threadId === page.threadId ? this.#indices.get(page.agentId) : undefined;
    const overlap = indices ? page.messages.findIndex((message) => indices.has(message.id)) : -1;
    if (current && overlap >= 0) {
      // The window already starts at the page or before it.
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
    const load: { promise: Promise<ConversationPage>; dirty: boolean; attach: boolean } = {
      dirty: false,
      attach,
      promise: Promise.resolve()
        .then(async () => {
          let page: ConversationPage;
          do {
            load.dirty = false;
            page = await read();
            if (page.agentId !== agentId) throw new Error("The server returned a page for another conversation.");
            if (!isCurrent() || this.#loads.get(agentId) !== load) return page;
            this.applyPage(page, undefined, load.attach);
          } while (load.dirty);
          this.#upToDate.add(agentId);
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
          // A window around a searched message does not reach the newest messages.
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
      if (added) {
        this.#publish(agentId, { ...current, messages, revision, activeTurnId, threadId });
      } else {
        this.#publish(agentId, { ...current, messages, revision, activeTurnId, threadId }, false);
      }
    }
  }
}
