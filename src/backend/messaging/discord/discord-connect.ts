import { randomBytes } from "node:crypto";
import { createDiscordGuildKeyPair, openDiscordGuildGrant } from "@openbot/contracts/discord-guild-grant";
import { Effect, Schema } from "effect";

/** How long a connect link stays usable. */
const PENDING_TTL_MS = 15 * 60_000;

/** The account service half of the OpenBot Discord app: the Worker holds its client secret. */
export interface DiscordAppPort {
  /** The Discord install URL for one connect of this host. The Worker seals the guild link to `hostPublicKey`. */
  authorize(input: { hostNonce: string; hostPublicKey: string }): Effect.Effect<string, DiscordConnectFailed>;
  /** Unlinks a guild from this host in the account service, so Signal stops routing it here. */
  unlink(guildId: string): Effect.Effect<void, DiscordConnectFailed>;
  openExternal(url: string): Promise<void>;
}

/**
 * The install of the OpenBot Discord app in a guild, started on this computer. Each connect has a
 * one-use key pair, as a Slack connect has: only this run can open the grant that names the guild.
 */
export class DiscordConnect {
  readonly #port: DiscordAppPort;
  /** The connects that are open, by nonce. */
  readonly #pending = new Map<string, { privateKey: CryptoKey; expiresAt: number }>();

  constructor(port: DiscordAppPort) {
    this.#port = port;
  }

  readonly start = Effect.fnUntraced(function* (this: DiscordConnect) {
    this.#prune();
    const nonce = randomBytes(24).toString("base64url");
    const { privateKey, publicKey } = yield* connectIo(() => createDiscordGuildKeyPair());
    this.#pending.set(nonce, { privateKey, expiresAt: Date.now() + PENDING_TTL_MS });
    const url = yield* this.#port.authorize({ hostNonce: nonce, hostPublicKey: publicKey });
    yield* connectIo(() => this.#port.openExternal(url));
  });

  readonly complete = Effect.fnUntraced(function* (this: DiscordConnect, nonce: string, grant: string) {
    this.#prune();
    const pending = this.#pending.get(nonce);
    if (!pending) return null;
    this.#pending.delete(nonce);
    return yield* connectIo(() => openDiscordGuildGrant(pending.privateKey, nonce, grant));
  });

  readonly unlink = Effect.fnUntraced(function* (this: DiscordConnect, guildId: string) {
    yield* this.#port.unlink(guildId);
  });

  #prune(): void {
    const now = Date.now();
    for (const [nonce, pending] of this.#pending) if (pending.expiresAt < now) this.#pending.delete(nonce);
  }
}

export class DiscordConnectFailed extends Schema.TaggedError<DiscordConnectFailed>()("DiscordConnectFailed", {
  cause: Schema.Defect(),
}) {}

function connectIo<A>(run: () => Promise<A>): Effect.Effect<A, DiscordConnectFailed> {
  return Effect.tryPromise({ try: run, catch: (cause) => new DiscordConnectFailed({ cause }) });
}
