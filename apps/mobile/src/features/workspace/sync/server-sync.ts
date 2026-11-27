import type { SyncCollectionSpec, SyncLogSpec } from "@openbot/contracts/team-protocol/sync-collections";
import {
  decodeSyncServerMessage,
  SYNC_CAPABILITY,
  type SyncClientMessage,
  syncName,
} from "@openbot/contracts/team-protocol/sync-v1";
import { sourceText } from "@openbot/i18n/source";
import type { RemoteTeamConnectionUpdate } from "@openbot/team-client/remote-peer";
import { createSyncClient, type SyncClient, type SyncCollection, type SyncLog } from "@openbot/team-client/sync-client";
import { supportLog, supportLogValue } from "@/features/support/model/support-log";

export interface SyncBinding<Handle> {
  current(): Handle | null;
  subscribe(listener: () => void): () => void;
  barrier(): Promise<void>;
  release(): void;
}

export interface SyncBindingOptions {
  param?: string | null;
  requires?: readonly string[];
}

type SendSync = (message: SyncClientMessage) => void;

export type ConfirmSync = (serverId: string) => Promise<readonly string[]>;

interface Binding {
  readonly requires: readonly string[];
  attach(client: SyncClient | null): void;
}

interface ServerSync {
  client: SyncClient | null;
  capabilities: ReadonlySet<string>;
  send: SendSync | null;
  confirmed: boolean;
  online: boolean;
  active: boolean;
  paused: boolean;
  epoch: number;
  writes: number;
  settled: number;
  bindings: Map<string, Binding>;
}

export class MobileServerSync {
  readonly #servers = new Map<string, ServerSync>();
  readonly #confirm: ConfirmSync | null;

  constructor(confirm: ConfirmSync | null = null) {
    this.#confirm = confirm;
  }

  bindCollection<Entity>(
    serverId: string,
    spec: SyncCollectionSpec<Entity>,
    options: SyncBindingOptions = {},
  ): SyncBinding<SyncCollection<Entity>> {
    const param = options.param ?? null;
    return this.#bind(serverId, syncName(spec.name, param), options.requires ?? [], (client) =>
      client.collection(spec, param),
    );
  }

  bindLog<Entity>(
    serverId: string,
    spec: SyncLogSpec<Entity>,
    param: string,
    options: { limit?: number; requires?: readonly string[] } = {},
  ): SyncBinding<SyncLog<Entity>> {
    return this.#bind(serverId, syncName(spec.name, param), options.requires ?? [], (client) =>
      client.log(spec, param, { limit: options.limit }),
    );
  }

  noteWrite(serverId: string): void {
    const server = this.#servers.get(serverId);
    if (server) server.writes += 1;
  }

  async settle(serverId: string): Promise<void> {
    const server = this.#servers.get(serverId);
    const client = server?.client;
    if (!server || !client || server.settled >= server.writes) return;
    const target = server.writes;
    await client.barrier();
    server.settled = Math.max(server.settled, target);
  }

  configure(serverId: string, capabilities: readonly string[], send: SendSync): void {
    const server = this.#server(serverId);
    server.send = send;
    server.online = true;
    if (!capabilities.includes(SYNC_CAPABILITY)) {
      server.confirmed = false;
      server.capabilities = new Set();
      this.#close(serverId, server);
      return;
    }
    server.capabilities = new Set(capabilities);
    server.confirmed = true;
    if (!server.client) {
      server.client = createSyncClient({
        send: (message) => this.#send(server, message),
        onError: (error) => supportLog.add("warn", "connection", `${serverId} sync: ${supportLogValue(error)}`),
      });
      server.paused = true;
    }
    for (const binding of server.bindings.values())
      binding.attach(this.#allows(server, binding) ? server.client : null);
    this.#resume(server);
  }

  connection(serverId: string, update: Pick<RemoteTeamConnectionUpdate, "state" | "resync" | "hostOffline">): void {
    const server = this.#servers.get(serverId);
    if (!server) return;
    if (update.state !== "online") {
      this.#unconfirm(server);
      return;
    }
    server.online = true;
    if (update.resync) {
      server.paused = true;
      return;
    }
    if (server.confirmed) this.#resume(server);
    else this.#reconfirm(serverId, server);
  }

  setActive(serverId: string, active: boolean): void {
    const server = this.#server(serverId);
    if (server.active === active) return;
    server.active = active;
    if (active) this.#resume(server);
    else this.#pause(server);
  }

  transportReset(serverId: string): void {
    const server = this.#servers.get(serverId);
    if (!server) return;
    this.#unconfirm(server);
  }

  receive(serverId: string, value: unknown): void {
    const client = this.#servers.get(serverId)?.client;
    if (!client) return;
    let message: ReturnType<typeof decodeSyncServerMessage>;
    try {
      message = decodeSyncServerMessage(value);
    } catch {
      message = null;
    }
    if (!message) {
      supportLog.add("warn", "connection", `${serverId} sync message refused`);
      return;
    }
    client.receive(message);
  }

  remove(serverId: string): void {
    const server = this.#servers.get(serverId);
    if (!server) return;
    this.#disconnect(serverId, server);
    if (server.bindings.size === 0) this.#servers.delete(serverId);
  }

  retainServers(ids: readonly string[]): void {
    const kept = new Set(ids);
    for (const serverId of [...this.#servers.keys()]) if (!kept.has(serverId)) this.remove(serverId);
  }

  dispose(): void {
    for (const [serverId, server] of this.#servers) this.#disconnect(serverId, server);
  }

  #disconnect(serverId: string, server: ServerSync): void {
    this.#close(serverId, server);
    server.send = null;
    server.online = false;
    server.confirmed = false;
    server.epoch += 1;
    server.capabilities = new Set();
  }

  #unconfirm(server: ServerSync): void {
    server.online = false;
    server.confirmed = false;
    server.epoch += 1;
    this.#pause(server);
  }

  #reconfirm(serverId: string, server: ServerSync): void {
    const confirm = this.#confirm;
    const send = server.send;
    if (!confirm || !send || !server.client) return;
    const epoch = server.epoch;
    void confirm(serverId).then(
      (capabilities) => {
        if (this.#servers.get(serverId) !== server || server.epoch !== epoch || !server.online) return;
        if (server.send !== send) return;
        this.configure(serverId, capabilities, send);
      },
      (error: unknown) => supportLog.add("warn", "connection", `${serverId} sync confirm: ${supportLogValue(error)}`),
    );
  }

  #server(serverId: string): ServerSync {
    let server = this.#servers.get(serverId);
    if (!server) {
      server = {
        client: null,
        capabilities: new Set(),
        send: null,
        confirmed: false,
        online: false,
        active: true,
        paused: true,
        epoch: 0,
        writes: 0,
        settled: 0,
        bindings: new Map(),
      };
      this.#servers.set(serverId, server);
    }
    return server;
  }

  #bind<Handle extends { subscribe(listener: () => void): () => void }>(
    serverId: string,
    name: string,
    requires: readonly string[],
    open: (client: SyncClient) => Handle,
  ): SyncBinding<Handle> {
    const listeners = new Set<() => void>();
    let owner: SyncClient | null = null;
    let handle: Handle | null = null;
    let unsubscribe: (() => void) | null = null;
    let released = false;
    const notify = () => {
      for (const listener of [...listeners]) listener();
    };
    const binding: Binding = {
      requires,
      attach(client) {
        if (client === owner) return;
        unsubscribe?.();
        unsubscribe = null;
        owner?.release(name);
        owner = client;
        handle = client ? open(client) : null;
        if (handle) unsubscribe = handle.subscribe(notify);
        notify();
      },
    };
    const server = this.#server(serverId);
    server.bindings.get(name)?.attach(null);
    server.bindings.set(name, binding);
    if (server.client && this.#allows(server, binding)) binding.attach(server.client);
    return {
      current: () => handle,
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      barrier: () => owner?.barrier() ?? Promise.resolve(),
      release: () => {
        if (released) return;
        released = true;
        binding.attach(null);
        listeners.clear();
        const server = this.#servers.get(serverId);
        if (server?.bindings.get(name) !== binding) return;
        server.bindings.delete(name);
        if (!server.client && !server.send && server.bindings.size === 0) this.#servers.delete(serverId);
      },
    };
  }

  #allows(server: ServerSync, binding: Binding): boolean {
    return binding.requires.every((capability) => server.capabilities.has(capability));
  }

  #send(server: ServerSync, message: SyncClientMessage): Promise<void> {
    const send = server.send;
    if (!send || !server.online) return Promise.reject(new Error(sourceText("error.remote.hostConnectionOffline")));
    try {
      send(message);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  #pause(server: ServerSync): void {
    server.paused = true;
    server.client?.pause();
  }

  #resume(server: ServerSync): void {
    if (!server.client || !server.paused || !server.confirmed || !server.online || !server.active) return;
    server.paused = false;
    server.client.resubscribe();
  }

  #close(serverId: string, server: ServerSync): void {
    const client = server.client;
    if (!client) return;
    server.client = null;
    server.paused = true;
    for (const binding of server.bindings.values()) binding.attach(null);
    client.dispose();
    supportLog.add("info", "connection", `${serverId} sync closed`);
  }
}
