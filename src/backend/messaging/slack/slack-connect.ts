import { randomBytes } from "node:crypto";
import {
  createSlackWorkspaceKeyPair,
  openSlackWorkspaceGrant,
  type SlackWorkspaceGrant,
} from "@openbot/contracts/slack-workspace-grant";

/** How long a connect link stays usable. */
const PENDING_TTL_MS = 15 * 60_000;

/** The account service half of the OpenBot Slack app: the Worker holds its client secret. */
export interface SlackAppPort {
  /** The Slack install URL for one connect of this host, which seals the bot token to `hostPublicKey`. */
  authorize(input: { hostNonce: string; hostPublicKey: string }): Promise<string>;
  /** Unlinks a workspace from this host in the account service, so Signal stops routing it here. */
  unlink(workspaceId: string): Promise<void>;
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

  /** Opens Slack's install page in the browser. The deep link to `complete` ends it. */
  async start(): Promise<void> {
    this.#prune();
    const nonce = randomBytes(24).toString("base64url");
    const { privateKey, publicKey } = await createSlackWorkspaceKeyPair();
    this.#pending.set(nonce, { privateKey, expiresAt: Date.now() + PENDING_TTL_MS });
    const url = await this.#port.authorize({ hostNonce: nonce, hostPublicKey: publicKey });
    await this.#port.openExternal(url);
  }

  /** Null for a nonce this run did not start: such a link does nothing. */
  async complete(nonce: string, grant: string): Promise<SlackWorkspaceGrant | null> {
    this.#prune();
    const pending = this.#pending.get(nonce);
    if (!pending) return null;
    this.#pending.delete(nonce);
    return openSlackWorkspaceGrant(pending.privateKey, nonce, grant);
  }

  unlink(workspaceId: string): Promise<void> {
    return this.#port.unlink(workspaceId);
  }

  #prune(): void {
    const now = Date.now();
    for (const [nonce, pending] of this.#pending) if (pending.expiresAt < now) this.#pending.delete(nonce);
  }
}
