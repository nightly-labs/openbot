import { readFile } from "node:fs/promises";
import type { ServerNotificationLevel, TeamRole } from "@openbot/contracts/ipc";
import { LOCAL_SERVER_ID } from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import type { ServerAppearance } from "@openbot/contracts/team-protocol/host-appearance-v1";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Semaphore } from "effect";
import {
  isEmptyStoredFile,
  parseStoredJson,
  setAsideDamagedFile,
  writeJsonFileAtomically,
} from "../backend/atomic-json-file";
import {
  emptyStoredRemoteServers,
  readStoredRemoteServers,
  type StoredRemoteServer,
  type StoredRemoteServers,
  type StoredServerNotifications,
  serializeStoredRemoteServers,
} from "./remote-server-stored-shape";
import { RemoteWorkflowError, remoteCall, remoteDecode, toRemoteWorkflowError } from "./remote-service-effects";

export interface TokenCipher {
  encrypt: (value: string) => Buffer;
  decrypt: (value: Buffer) => string;
}

export type StoredRemoteServerView = Readonly<StoredRemoteServer>;

export interface PreservedHostIdentity {
  readonly hostId: string;
  readonly publicKey: string | null;
  readonly fingerprint: string;
}

export interface ActiveSelection {
  readonly activeServerId: string;
  readonly unreadableActiveServerId: string | null;
}

export interface RemoteServerPatch {
  name?: string;
  username?: string;
  role?: TeamRole;
  encryptedToken?: string;
  logoVersion?: string | null;
  appearance?: ServerAppearance | null;
  remoteDesktopAvailable?: boolean;
}

export interface RemoteServerDirectory {
  readonly activeServerId: string;
  readonly servers: readonly StoredRemoteServerView[];
  require(serverId: string): StoredRemoteServerView;
  find(serverId: string): StoredRemoteServerView | null;
  has(serverId: string): boolean;
  token(server: StoredRemoteServerView): string;
}

export class RemoteServerStore implements RemoteServerDirectory {
  readonly #path: string;
  readonly #cipher: TokenCipher;
  #state: StoredRemoteServers = emptyStoredRemoteServers();
  #writes = Semaphore.makeUnsafe(1);
  #activeServerRevision = 0;

  constructor(options: { path: string; cipher: TokenCipher }) {
    this.#path = options.path;
    this.#cipher = options.cipher;
  }

  readonly load = Effect.fn("RemoteStore.load")(function* (
    this: RemoteServerStore,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    const attempt0 = yield* Effect.gen({ self: this }, function* () {
      return yield* remoteCall(() => readFile(this.#path, "utf8"));
    }).pipe(Effect.result);
    if (Result.isFailure(attempt0)) {
      const error = attempt0.failure.cause;
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
        return yield* new RemoteWorkflowError({ cause: error });
      return;
    }
    if (isEmptyStoredFile(attempt0.success)) return yield* setAsideDamagedFile(this.#path);
    const stored = yield* remoteDecode(() => parseStoredJson(this.#path, attempt0.success, readStoredRemoteServers));
    if (!stored)
      return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.serverListUnreadable")) });
    this.#state = stored;
  });

  get activeServerId(): string {
    return this.#state.activeServerId;
  }

  get activeServerRevision(): number {
    return this.#activeServerRevision;
  }

  get selection(): ActiveSelection {
    return {
      activeServerId: this.#state.activeServerId,
      unreadableActiveServerId: this.#state.unreadableActiveServerId,
    };
  }

  get preservedIdentities(): readonly PreservedHostIdentity[] {
    return this.#state.unreadableServers.flatMap((preserved) =>
      isString(preserved.entry.id)
        ? [
            {
              hostId: preserved.entry.id,
              publicKey: isString(preserved.entry.publicKey) ? preserved.entry.publicKey : null,
              fingerprint: isString(preserved.entry.fingerprint) ? preserved.entry.fingerprint : "",
            },
          ]
        : [],
    );
  }

  get servers(): readonly StoredRemoteServerView[] {
    return this.#state.servers;
  }

  require(serverId: string): StoredRemoteServerView {
    const server = this.find(serverId);
    if (!server) throw new Error(sourceText("error.remote.serverNotFound"));
    return server;
  }

  find(serverId: string): StoredRemoteServerView | null {
    return this.#state.servers.find((candidate) => candidate.id === serverId) ?? null;
  }

  has(serverId: string): boolean {
    return this.#state.servers.some((candidate) => candidate.id === serverId);
  }

  isHiddenHost(hostId: string): boolean {
    return this.#state.hiddenHostIds.includes(hostId);
  }

  token(server: StoredRemoteServerView): string {
    return this.#cipher.decrypt(Buffer.from(server.encryptedToken, "base64"));
  }

  sealToken(sessionToken: string): string {
    return this.#cipher.encrypt(sessionToken).toString("base64");
  }

  setActiveServerId(serverId: string): number {
    this.#state.unreadableActiveServerId = null;
    this.#state.activeServerId = serverId;
    this.#activeServerRevision += 1;
    return this.#activeServerRevision;
  }

  restoreSelection(selection: ActiveSelection): number {
    this.#state.activeServerId = selection.activeServerId;
    this.#state.unreadableActiveServerId = selection.unreadableActiveServerId;
    this.#activeServerRevision += 1;
    return this.#activeServerRevision;
  }

  readonly retireUnreadable = Effect.fn("RemoteStore.retireUnreadable")(function* (
    this: RemoteServerStore,
    serverId: string,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    if (!this.#state.unreadableServers.some((preserved) => preserved.entry.id === serverId)) return;
    this.#forgetUnreadable(serverId);
    yield* this.persist();
  });

  readonly adopt = Effect.fn("RemoteStore.adopt")(function* (
    this: RemoteServerStore,
    server: StoredRemoteServer,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    this.#forgetUnreadable(server.id);
    this.#state.servers = [...this.#state.servers.filter((candidate) => candidate.id !== server.id), server];
    this.setActiveServerId(server.id);
    yield* this.persist();
  });

  readonly attachLocal = Effect.fn("RemoteStore.attachLocal")(function* (
    this: RemoteServerStore,
    server: StoredRemoteServer,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    this.#forgetUnreadable(server.id);
    this.#state.servers = this.has(server.id)
      ? this.#state.servers.map((candidate) => (candidate.id === server.id ? server : candidate))
      : [...this.#state.servers, server];
    yield* this.persist();
  });

  readonly update = Effect.fn("RemoteStore.update")(function* (
    this: RemoteServerStore,
    serverId: string,
    patch: RemoteServerPatch,
  ): Effect.fn.Return<StoredRemoteServerView | null, RemoteWorkflowError> {
    const current = this.find(serverId);
    if (!current) return null;
    const updated: StoredRemoteServer = { ...current, ...patch };
    this.#state.servers = this.#state.servers.map((candidate) => (candidate.id === serverId ? updated : candidate));
    yield* this.persist();
    return updated;
  });

  readonly remove = Effect.fn("RemoteStore.remove")(function* (
    this: RemoteServerStore,
    serverId: string,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    this.#forgetUnreadable(serverId);
    this.#state.servers = this.#state.servers.filter((server) => server.id !== serverId);
    this.#state.browserEgressServerIds = this.#state.browserEgressServerIds.filter((id) => id !== serverId);
    if (this.#state.activeServerId === serverId) this.setActiveServerId(LOCAL_SERVER_ID);
    yield* this.persist();
  });

  #forgetUnreadable(serverId: string): void {
    this.#state.unreadableServers = this.#state.unreadableServers.filter(
      (preserved) => preserved.entry.id !== serverId,
    );
    if (this.#state.unreadableActiveServerId === serverId) this.#state.unreadableActiveServerId = null;
  }

  readonly unhideHost = Effect.fn("RemoteStore.unhideHost")(function* (
    this: RemoteServerStore,
    hostId: string,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    if (!this.isHiddenHost(hostId)) return;
    this.#state.hiddenHostIds = this.#state.hiddenHostIds.filter((candidate) => candidate !== hostId);
    yield* this.persist();
  });

  readonly reorder = Effect.fn("RemoteStore.reorder")(function* (
    this: RemoteServerStore,
    serverIds: readonly string[],
  ): Effect.fn.Return<boolean, RemoteWorkflowError> {
    if (serverIds.length !== this.#state.servers.length)
      return yield* new RemoteWorkflowError({ cause: new Error("The server order is incomplete.") });
    const serversById = new Map(this.#state.servers.map((server) => [server.id, server]));
    if (new Set(serverIds).size !== serverIds.length)
      return yield* new RemoteWorkflowError({ cause: new Error("The server order contains an unknown server.") });
    const reordered: StoredRemoteServer[] = [];
    for (const serverId of serverIds) {
      const server = serversById.get(serverId);
      if (!server)
        return yield* new RemoteWorkflowError({ cause: new Error("The server order contains an unknown server.") });
      reordered.push(server);
    }
    if (serverIds.every((serverId, index) => this.#state.servers[index]?.id === serverId)) return false;
    this.#state.servers = reordered;
    yield* this.persist();
    return true;
  });

  readonly replaceServers = Effect.fn("RemoteStore.replaceServers")(function* (
    this: RemoteServerStore,
    servers: readonly StoredRemoteServerView[],
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    this.#state.servers = [...servers];
    if (this.#state.activeServerId !== LOCAL_SERVER_ID && !this.has(this.#state.activeServerId)) {
      this.setActiveServerId(LOCAL_SERVER_ID);
    }
    yield* this.persist();
  });

  muteState(serverId: string, now = Date.now()): { muted: boolean; mutedUntil: number | null } {
    if (this.#state.mutedServerIds.includes(serverId)) return { muted: true, mutedUntil: null };
    const mutedUntil = this.#state.serverNotifications[serverId]?.mutedUntil;
    return mutedUntil !== undefined && mutedUntil > now
      ? { muted: true, mutedUntil }
      : { muted: false, mutedUntil: null };
  }

  isMuted(serverId: string, now = Date.now()): boolean {
    return this.muteState(serverId, now).muted;
  }

  notificationLevel(serverId: string): ServerNotificationLevel {
    return this.#state.serverNotifications[serverId]?.level ?? "all";
  }

  nextMuteExpiry(now = Date.now()): number | null {
    const ends = Object.values(this.#state.serverNotifications)
      .map((entry) => entry.mutedUntil)
      .filter((mutedUntil): mutedUntil is number => mutedUntil !== undefined && mutedUntil > now);
    return ends.length ? Math.min(...ends) : null;
  }

  readonly setMuted = Effect.fn("RemoteStore.setMuted")(function* (
    this: RemoteServerStore,
    serverId: string,
    muted: boolean,
    until: number | null = null,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    yield* this.#writeNotificationsEffect(serverId, (state) => {
      const mutedServerIds = state.mutedServerIds.filter((id) => id !== serverId);
      if (muted && until === null) mutedServerIds.push(serverId);
      const { mutedUntil: _previous, ...entry } = state.serverNotifications[serverId] ?? {};
      return {
        mutedServerIds,
        serverNotifications: withServerEntry(
          state.serverNotifications,
          serverId,
          muted && until !== null ? { ...entry, mutedUntil: until } : entry,
        ),
      };
    });
  });

  readonly setNotificationLevel = Effect.fn("RemoteStore.setNotificationLevel")(function* (
    this: RemoteServerStore,
    serverId: string,
    level: ServerNotificationLevel,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    yield* this.#writeNotificationsEffect(serverId, (state) => {
      const { level: _previous, ...entry } = state.serverNotifications[serverId] ?? {};
      return {
        mutedServerIds: state.mutedServerIds,
        serverNotifications: withServerEntry(
          state.serverNotifications,
          serverId,
          level === "all" ? entry : { ...entry, level },
        ),
      };
    });
  });

  sharesBrowserEgress(serverId: string): boolean {
    return this.#state.browserEgressServerIds.includes(serverId);
  }

  readonly setBrowserEgress = Effect.fn("RemoteStore.setBrowserEgress")(function* (
    this: RemoteServerStore,
    serverId: string,
    sharing: boolean,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    yield* this.#writes.withPermit(
      Effect.uninterruptible(
        Effect.gen({ self: this }, function* () {
          if (!this.has(serverId))
            return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.serverNotFound")) });
          const browserEgressServerIds = this.#state.browserEgressServerIds.filter((id) => id !== serverId);
          if (sharing) browserEgressServerIds.push(serverId);
          yield* this.#writeSnapshot({ ...structuredClone(this.#state), browserEgressServerIds });
          this.#state.browserEgressServerIds = browserEgressServerIds;
        }),
      ),
    );
  });

  readonly #writeNotificationsEffect = Effect.fn("RemoteStore.writeNotifications")(function* (
    this: RemoteServerStore,
    serverId: string,
    change: (state: StoredRemoteServers) => Pick<StoredRemoteServers, "mutedServerIds" | "serverNotifications">,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    yield* this.#writes.withPermit(
      Effect.uninterruptible(
        Effect.gen({ self: this }, function* () {
          if (serverId !== LOCAL_SERVER_ID && !this.has(serverId))
            return yield* new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.serverNotFound")) });
          const next = change(this.#state);
          yield* this.#writeSnapshot({ ...structuredClone(this.#state), ...next });
          this.#state.mutedServerIds = next.mutedServerIds;
          this.#state.serverNotifications = next.serverNotifications;
        }),
      ),
    );
  });

  readonly persist = Effect.fn("RemoteStore.persist")(function* (
    this: RemoteServerStore,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    const snapshot = structuredClone(this.#state);
    yield* this.#writes.withPermit(
      Effect.uninterruptible(
        Effect.suspend(() =>
          this.#writeSnapshot({
            ...snapshot,
            mutedServerIds: [...this.#state.mutedServerIds],
            serverNotifications: structuredClone(this.#state.serverNotifications),
            browserEgressServerIds: [...this.#state.browserEgressServerIds],
          }),
        ),
      ),
    );
  });

  readonly #writeSnapshot = Effect.fn("RemoteStore.writeSnapshot")(function* (
    this: RemoteServerStore,
    snapshot: StoredRemoteServers,
  ): Effect.fn.Return<void, RemoteWorkflowError> {
    yield* writeJsonFileAtomically(this.#path, serializeStoredRemoteServers(snapshot)).pipe(toRemoteWorkflowError);
  });
}

function withServerEntry(
  entries: Record<string, StoredServerNotifications>,
  serverId: string,
  entry: StoredServerNotifications,
): Record<string, StoredServerNotifications> {
  const { [serverId]: _previous, ...rest } = entries;
  return entry.level === undefined && entry.mutedUntil === undefined ? rest : { ...rest, [serverId]: entry };
}
