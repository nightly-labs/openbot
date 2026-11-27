import type { TeamPresenceSnapshot } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { RemoteWorkflowError } from "./remote-service-effects";

export interface RemotePresenceCacheOptions {
  fetchSnapshot: (serverId: string) => Effect.Effect<TeamPresenceSnapshot, RemoteWorkflowError>;
  onSnapshot: (serverId: string, snapshot: TeamPresenceSnapshot) => void;
}

export class RemotePresenceCache {
  readonly #fetchSnapshot: RemotePresenceCacheOptions["fetchSnapshot"];
  readonly #onSnapshot: RemotePresenceCacheOptions["onSnapshot"];
  readonly #snapshots = new Map<string, TeamPresenceSnapshot>();

  constructor(options: RemotePresenceCacheOptions) {
    this.#fetchSnapshot = options.fetchSnapshot;
    this.#onSnapshot = options.onSnapshot;
  }

  has(serverId: string): boolean {
    return this.#snapshots.has(serverId);
  }

  get(serverId: string): TeamPresenceSnapshot {
    const cached = this.#snapshots.get(serverId);
    if (cached) return structuredClone(cached);
    return { serverId, members: [], updatedAt: new Date().toISOString() };
  }

  readonly refresh = Effect.fn("RemotePresence.refresh")(function* (this: RemotePresenceCache, serverId: string) {
    return yield* this.#fetchSnapshot(serverId).pipe(
      Effect.map((snapshot) => {
        this.#snapshots.set(serverId, snapshot);
        return structuredClone(snapshot);
      }),
      Effect.catch((failure) => {
        const cached = this.#snapshots.get(serverId);
        return cached ? Effect.succeed(structuredClone(cached)) : Effect.fail(failure);
      }),
    );
  }).bind(this);

  accept(serverId: string, snapshot: TeamPresenceSnapshot): void {
    this.#snapshots.set(serverId, snapshot);
    this.#onSnapshot(serverId, structuredClone(snapshot));
  }

  markOffline(serverId: string): void {
    const current = this.#snapshots.get(serverId);
    if (!current) return;
    this.accept(serverId, {
      ...current,
      members: current.members.map((member) => ({
        ...member,
        online: false,
        typingAgentId: null,
      })),
      updatedAt: new Date().toISOString(),
    });
  }

  forget(serverId: string): void {
    this.#snapshots.delete(serverId);
  }
}
