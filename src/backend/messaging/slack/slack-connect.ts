import { randomBytes } from "node:crypto";
import { createSlackWorkspaceKeyPair, openSlackWorkspaceGrant } from "@openbot/contracts/slack-workspace-grant";
import { Effect, Schema } from "effect";
import { causeHelpers } from "../../effect-boundary";

/** How long a connect link stays usable. */
const PENDING_TTL_MS = 15 * 60_000;

/** The account service half of the OpenBot Slack app: the Worker holds its client secret. */
export interface SlackAppPort {
  /** The Slack install URL for one connect of this host, which seals the bot token to `hostPublicKey`. */
  authorize(input: { hostNonce: string; hostPublicKey: string }): Effect.Effect<string, SlackConnectFailed>;
  /** Unlinks a workspace from this host in the account service, so Signal stops routing it here. */
  unlink(workspaceId: string): Effect.Effect<void, SlackConnectFailed>;
  openExternal(url: string): Promise<void>;
}

/**
 * The install of the OpenBot Slack app in a workspace, started on this computer. Each connect has a
 * one-use key pair: the Worker seals the bot token to its public key, and only this run can open it.
 */
export class SlackConnect {
  readonly #port: SlackAppPort;
  /** The connects that are open, by nonce. */
  readonly #pending = new Map<string, { privateKey: CryptoKey; expiresAt: number }>();

  constructor(port: SlackAppPort) {
    this.#port = port;
  }

  readonly start = Effect.fnUntraced(function* (this: SlackConnect) {
    this.#prune();
    const nonce = randomBytes(24).toString("base64url");
    const { privateKey, publicKey } = yield* connectIo(() => createSlackWorkspaceKeyPair());
    this.#pending.set(nonce, { privateKey, expiresAt: Date.now() + PENDING_TTL_MS });
    const url = yield* this.#port.authorize({ hostNonce: nonce, hostPublicKey: publicKey });
    yield* connectIo(() => this.#port.openExternal(url));
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
