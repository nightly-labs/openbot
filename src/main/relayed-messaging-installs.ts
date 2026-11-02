// The Slack and Discord installs that this computer opened for a joined server (`connectors-v1`).
// Each install ends in an `openbot://` link to this computer. The link carries a grant that is sealed
// to a one-use key of the host, so this computer cannot open it and only sends it on.

import { decodeRecord, requiredBoolean } from "@openbot/contracts/ipc-decoding";
import { CONNECTORS_ROUTES } from "@openbot/contracts/team-protocol/connectors-v1";
import { Effect } from "effect";
import type { ResponseDecoder } from "./remote-host-decoding";
import type { RemoteRequestInit } from "./remote-server-client";
import type { RemoteWorkflowError } from "./remote-service-effects";

/** The same as the host's connect link: the host forgets the key after this time. */
const PENDING_TTL_MS = 15 * 60_000;

export type RelayedPlatform = "slack" | "discord";

export interface RelayedInstallsRemote {
  request<T>(
    serverId: string,
    path: string,
    decoder: ResponseDecoder<T>,
    init?: RemoteRequestInit,
  ): Effect.Effect<T, RemoteWorkflowError>;
}

export class RelayedMessagingInstalls {
  readonly #remote: RelayedInstallsRemote;
  readonly #pending = new Map<string, { serverId: string; platform: RelayedPlatform; expiresAt: number }>();

  constructor(remote: RelayedInstallsRemote) {
    this.#remote = remote;
  }

  remember(platform: RelayedPlatform, nonce: string, serverId: string): void {
    this.#prune();
    this.#pending.set(nonce, { serverId, platform, expiresAt: Date.now() + PENDING_TTL_MS });
  }

  /**
   * Sends a grant to the server whose install this computer opened. False when this computer opened
   * no install with this nonce for this platform: a link that this run did not start does nothing.
   */
  readonly forward = Effect.fn("RelayedMessagingInstalls.forward")(function* (
    this: RelayedMessagingInstalls,
    platform: RelayedPlatform,
    nonce: string,
    grant: string,
  ): Effect.fn.Return<boolean, RemoteWorkflowError> {
    this.#prune();
    const pending = this.#pending.get(nonce);
    if (pending?.platform !== platform) return false;
    this.#pending.delete(nonce);
    return yield* this.#remote.request(
      pending.serverId,
      CONNECTORS_ROUTES.messagingComplete,
      (value) => requiredBoolean(decodeRecord(value, "Messaging install"), "accepted"),
      { method: "POST", body: { platform, nonce, grant } },
    );
  });

  #prune(): void {
    const now = Date.now();
    for (const [nonce, pending] of this.#pending) if (pending.expiresAt < now) this.#pending.delete(nonce);
  }
}
