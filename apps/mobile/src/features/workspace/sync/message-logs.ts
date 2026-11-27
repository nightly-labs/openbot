import {
  CHANNEL_CHATS_CAPABILITY,
  type ChannelMessage,
  type ChannelPage,
  type ConversationMessage,
  type ConversationPage,
} from "@openbot/contracts/ipc";
import { SYNC_SNAPSHOT_KEY } from "@openbot/contracts/team-protocol/sync-collections";
import {
  AGENT_MESSAGES_SYNC_LOG,
  CHANNEL_MESSAGES_SYNC_LOG,
  CHANNEL_PAGE_META_SYNC_COLLECTION,
  type ChannelPageMeta,
  CONVERSATION_PAGE_META_SYNC_COLLECTION,
  type ConversationPageMeta,
} from "@openbot/contracts/team-protocol/sync-logs";
import type { SyncCollection, SyncLog } from "@openbot/team-client/sync-client";
import { channelPageFromSync, conversationPageFromSync } from "@openbot/team-client/sync-pages";
import type { MobileServerSync, SyncBinding } from "./server-sync";

const CONVERSATION_SYNC_LOG_LIMIT = 50;
const CHANNEL_SYNC_LOG_LIMIT = 100;

interface LogBindings<Entity, Meta> {
  log: SyncBinding<SyncLog<Entity>>;
  meta: SyncBinding<SyncCollection<Meta>>;
}

interface RetainedLog<Entity, Meta> extends LogBindings<Entity, Meta> {
  count: number;
  unsubscribe(): void;
}

interface MessageLogOptions<Entity, Meta, Page> {
  open(sync: MobileServerSync, serverId: string, id: string): LogBindings<Entity, Meta>;
  build(log: SyncLog<Entity>, meta: Meta): Page | null;
  changed(serverId: string, id: string, page: Page): void;
}

function retainedId(serverId: string, id: string): string {
  return JSON.stringify([serverId, id]);
}

class SyncedMessageLogs<Entity, Meta, Page> {
  readonly #sync: MobileServerSync;
  readonly #options: MessageLogOptions<Entity, Meta, Page>;
  readonly #retained = new Map<string, RetainedLog<Entity, Meta>>();

  constructor(sync: MobileServerSync, options: MessageLogOptions<Entity, Meta, Page>) {
    this.#sync = sync;
    this.#options = options;
  }

  retain(serverId: string, id: string): () => void {
    const key = retainedId(serverId, id);
    let entry = this.#retained.get(key);
    if (!entry) {
      const bindings = this.#options.open(this.#sync, serverId, id);
      const notify = () => {
        const page = this.page(serverId, id);
        if (page) this.#options.changed(serverId, id, page);
      };
      const stopLog = bindings.log.subscribe(notify);
      const stopMeta = bindings.meta.subscribe(notify);
      entry = {
        ...bindings,
        count: 0,
        unsubscribe: () => {
          stopLog();
          stopMeta();
        },
      };
      this.#retained.set(key, entry);
    }
    const retained = entry;
    retained.count += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      retained.count -= 1;
      if (retained.count > 0 || this.#retained.get(key) !== retained) return;
      this.#retained.delete(key);
      retained.unsubscribe();
      retained.log.release();
      retained.meta.release();
    };
  }

  page(serverId: string, id: string): Page | null | undefined {
    const entry = this.#retained.get(retainedId(serverId, id));
    const log = entry?.log.current();
    const meta = entry?.meta.current();
    if (log?.status() !== "synced" || meta?.status() !== "synced") return undefined;
    const snapshot = meta.get(SYNC_SNAPSHOT_KEY);
    return snapshot ? this.#options.build(log, snapshot) : undefined;
  }

  async read(serverId: string, id: string): Promise<Page | null> {
    if (this.page(serverId, id) === undefined) return null;
    await this.#sync.settle(serverId);
    return this.page(serverId, id) ?? null;
  }
}

function mobileConversationPage(page: ConversationPage): ConversationPage {
  return {
    agentId: page.agentId,
    threadId: page.threadId,
    activeTurnId: page.activeTurnId,
    revision: page.revision,
    messages: page.messages,
    pageInfo: { hasOlder: page.pageInfo.hasOlder, olderCursor: page.pageInfo.olderCursor },
    references: page.references,
  };
}

export type ConversationLogs = SyncedMessageLogs<ConversationMessage, ConversationPageMeta, ConversationPage>;

export function createConversationLogs(
  sync: MobileServerSync,
  changed: (serverId: string, agentId: string, page: ConversationPage) => void,
): ConversationLogs {
  return new SyncedMessageLogs(sync, {
    open: (server, serverId, agentId) => ({
      log: server.bindLog(serverId, AGENT_MESSAGES_SYNC_LOG, agentId, { limit: CONVERSATION_SYNC_LOG_LIMIT }),
      meta: server.bindCollection(serverId, CONVERSATION_PAGE_META_SYNC_COLLECTION, { param: agentId }),
    }),
    build: (log, meta) => {
      const page = conversationPageFromSync(
        log.rows().map((row) => row.entity),
        meta,
        log.references(),
        { olderCursor: log.olderCursor() },
      );
      return page ? mobileConversationPage(page) : null;
    },
    changed,
  });
}

export type ChannelLogs = SyncedMessageLogs<ChannelMessage, ChannelPageMeta, ChannelPage>;

export function createChannelLogs(
  sync: MobileServerSync,
  changed: (serverId: string, channelId: string, page: ChannelPage) => void,
): ChannelLogs {
  return new SyncedMessageLogs(sync, {
    open: (server, serverId, channelId) => ({
      log: server.bindLog(serverId, CHANNEL_MESSAGES_SYNC_LOG, channelId, {
        limit: CHANNEL_SYNC_LOG_LIMIT,
        requires: [CHANNEL_CHATS_CAPABILITY],
      }),
      meta: server.bindCollection(serverId, CHANNEL_PAGE_META_SYNC_COLLECTION, {
        param: channelId,
        requires: [CHANNEL_CHATS_CAPABILITY],
      }),
    }),
    build: (log, meta) =>
      channelPageFromSync(
        log.rows().map((row) => row.entity),
        meta,
        { olderCursor: log.olderCursor() },
      ),
    changed,
  });
}
