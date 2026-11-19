import { randomBytes } from "node:crypto";
import { createDiscordGuildKeyPair, openDiscordGuildGrant } from "@openbot/contracts/discord-guild-grant";
import { Effect, Schema } from "effect";
import { causeHelpers } from "../../effect-boundary";

const PENDING_TTL_MS = 15 * 60_000;

export interface DiscordAppPort {
  authorize(input: { hostNonce: string; hostPublicKey: string }): Effect.Effect<string, DiscordConnectFailed>;
  unlink(guildId: string): Effect.Effect<void, DiscordConnectFailed>;
  openExternal(url: string): Promise<void>;
}

export class DiscordConnect {
  readonly #port: DiscordAppPort;
  readonly #pending = new Map<string, { privateKey: CryptoKey; expiresAt: number }>();

  constructor(port: DiscordAppPort) {
    this.#port = port;
  }

  readonly start = Effect.fnUntraced(function* (this: DiscordConnect, opensPage: boolean) {
    this.#prune();
    const nonce = randomBytes(24).toString("base64url");
    const { privateKey, publicKey } = yield* connectIo(() => createDiscordGuildKeyPair());
    this.#pending.set(nonce, { privateKey, expiresAt: Date.now() + PENDING_TTL_MS });
    const url = yield* this.#port.authorize({ hostNonce: nonce, hostPublicKey: publicKey });
    if (opensPage) yield* connectIo(() => this.#port.openExternal(url));
    return { url, nonce };
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

const { io: connectIo, rewrap: toDiscordConnectFailed } = causeHelpers(DiscordConnectFailed);

export { toDiscordConnectFailed };
