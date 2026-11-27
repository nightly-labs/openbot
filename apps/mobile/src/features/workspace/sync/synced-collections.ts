import { isBoolean, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { toCurrentAgentKeys } from "@openbot/contracts/team-protocol/current-agent-keys";
import {
  AGENTS_SYNC_COLLECTION,
  CONVERSATION_READS_SYNC_COLLECTION,
  type SyncCollectionSpec,
} from "@openbot/contracts/team-protocol/sync-collections";
import type { TeamProtocolV1JsonValue } from "@openbot/contracts/team-protocol/v1";
import type { SyncCollection } from "@openbot/team-client/sync-client";
import { decodeAgent, type MobileConversationRead, type RemoteAgent } from "../model/workspace-records";
import type { MobileServerSync, SyncBinding } from "./server-sync";

export interface MobileConversationReadEntry extends MobileConversationRead {
  agentId: string;
}

function isWireJson(value: unknown): value is TeamProtocolV1JsonValue {
  if (value === null || isString(value) || isBoolean(value)) return true;
  if (isNumber(value)) return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isWireJson);
  return isDynamicRecord(value) && Object.values(value).every(isWireJson);
}

export const MOBILE_AGENTS_SYNC_COLLECTION: SyncCollectionSpec<RemoteAgent> = {
  name: AGENTS_SYNC_COLLECTION.name,
  key: (agent) => agent.id,
  decode: (value) => {
    if (!isWireJson(value)) throw new Error("Invalid agent list response.");
    return decodeAgent(toCurrentAgentKeys(value));
  },
};

export const MOBILE_CONVERSATION_READS_SYNC_COLLECTION: SyncCollectionSpec<MobileConversationReadEntry> = {
  name: CONVERSATION_READS_SYNC_COLLECTION.name,
  key: (entry) => entry.agentId,
  decode: (value) => {
    if (
      !isDynamicRecord(value) ||
      !isString(value.agentId) ||
      !value.agentId ||
      !isNumber(value.unreadCount) ||
      !Number.isSafeInteger(value.unreadCount) ||
      value.unreadCount < 0
    ) {
      throw new Error("The server returned an invalid read state.");
    }
    return {
      agentId: value.agentId,
      unreadCount: value.unreadCount,
      firstUnreadMessageId: isString(value.firstUnreadMessageId) ? value.firstUnreadMessageId : null,
    };
  },
};

export function conversationReadsOf(
  entries: readonly MobileConversationReadEntry[],
): Record<string, MobileConversationRead> {
  const reads: Record<string, MobileConversationRead> = {};
  for (const entry of entries)
    reads[entry.agentId] = { unreadCount: entry.unreadCount, firstUnreadMessageId: entry.firstUnreadMessageId };
  return reads;
}

export interface SharedSyncCollectionOptions<Entity> {
  requires?: readonly string[];
  changed(serverId: string, param: string | null, handle: SyncCollection<Entity>): void;
}

interface RetainedBinding<Entity> {
  binding: SyncBinding<SyncCollection<Entity>>;
  count: number;
  unsubscribe(): void;
}

function retainedId(serverId: string, param: string | null): string {
  return JSON.stringify([serverId, param]);
}

function syncedHandle<Entity>(handle: SyncCollection<Entity> | null): SyncCollection<Entity> | null {
  return handle?.status() === "synced" ? handle : null;
}

export class SharedSyncCollection<Entity> {
  readonly #sync: MobileServerSync;
  readonly #spec: SyncCollectionSpec<Entity>;
  readonly #options: SharedSyncCollectionOptions<Entity>;
  readonly #retained = new Map<string, RetainedBinding<Entity>>();

  constructor(sync: MobileServerSync, spec: SyncCollectionSpec<Entity>, options: SharedSyncCollectionOptions<Entity>) {
    this.#sync = sync;
    this.#spec = spec;
    this.#options = options;
  }

  retain(serverId: string, param: string | null = null): () => void {
    const id = retainedId(serverId, param);
    let entry = this.#retained.get(id);
    if (!entry) {
      const binding = this.#sync.bindCollection(serverId, this.#spec, { param, requires: this.#options.requires });
      const unsubscribe = binding.subscribe(() => {
        const handle = syncedHandle(binding.current());
        if (handle) this.#options.changed(serverId, param, handle);
      });
      entry = { binding, count: 0, unsubscribe };
      this.#retained.set(id, entry);
    }
    const retained = entry;
    retained.count += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      retained.count -= 1;
      if (retained.count > 0 || this.#retained.get(id) !== retained) return;
      this.#retained.delete(id);
      retained.unsubscribe();
      retained.binding.release();
    };
  }

  synced(serverId: string, param: string | null = null): SyncCollection<Entity> | null {
    return syncedHandle(this.#retained.get(retainedId(serverId, param))?.binding.current() ?? null);
  }

  async read<Value>(
    serverId: string,
    param: string | null,
    derive: (handle: SyncCollection<Entity>) => Value | undefined,
    fallback: () => Promise<Value>,
  ): Promise<Value> {
    const binding = this.#retained.get(retainedId(serverId, param))?.binding;
    if (binding && syncedHandle(binding.current())) {
      await this.#sync.settle(serverId);
      const handle = syncedHandle(binding.current());
      const value = handle ? derive(handle) : undefined;
      if (value !== undefined) return value;
    }
    return fallback();
  }
}
