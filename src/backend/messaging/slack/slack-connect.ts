import { randomBytes } from "node:crypto";
import { createSlackWorkspaceKeyPair, openSlackWorkspaceGrant } from "@openbot/contracts/slack-workspace-grant";
import { Effect, Schema } from "effect";
import { causeHelpers } from "../../effect-boundary";

const PENDING_TTL_MS = 15 * 60_000;

export interface SlackAppPort {
  authorize(input: { hostNonce: string; hostPublicKey: string }): Effect.Effect<string, SlackConnectFailed>;
  unlink(workspaceId: string): Effect.Effect<void, SlackConnectFailed>;
  openExternal(url: string): Promise<void>;
}

export class SlackConnect {
  readonly #port: SlackAppPort;
  readonly #pending = new Map<string, { privateKey: CryptoKey; expiresAt: number }>();

  constructor(port: SlackAppPort) {
    this.#port = port;
  }

  readonly start = Effect.fnUntraced(function* (this: SlackConnect, opensPage: boolean) {
    this.#prune();
    const nonce = randomBytes(24).toString("base64url");
    const { privateKey, publicKey } = yield* connectIo(() => createSlackWorkspaceKeyPair());
    this.#pending.set(nonce, { privateKey, expiresAt: Date.now() + PENDING_TTL_MS });
    const url = yield* this.#port.authorize({ hostNonce: nonce, hostPublicKey: publicKey });
    if (opensPage) yield* connectIo(() => this.#port.openExternal(url));
    return { url, nonce };
  });

  readonly complete = Effect.fnUntraced(function* (this: SlackConnect, nonce: string, grant: string) {
    this.#prune();
    const pending = this.#pending.get(nonce);
    if (!pending) return null;
    this.#pending.delete(nonce);
    return yield* connectIo(() => openSlackWorkspaceGrant(pending.privateKey, nonce, grant));
  });

  readonly unlink = Effect.fnUntraced(function* (this: SlackConnect, workspaceId: string) {
    yield* this.#port.unlink(workspaceId);
  });

  #prune(): void {
    const now = Date.now();
    for (const [nonce, pending] of this.#pending) if (pending.expiresAt < now) this.#pending.delete(nonce);
  }
}

export class SlackConnectFailed extends Schema.TaggedError<SlackConnectFailed>()("SlackConnectFailed", {
  cause: Schema.Defect(),
}) {}

const { io: connectIo, rewrap: toSlackConnectFailed } = causeHelpers(SlackConnectFailed);

export { toSlackConnectFailed };
