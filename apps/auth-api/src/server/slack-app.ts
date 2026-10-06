// The OpenBot Slack app's OAuth install. One app serves every workspace: a workspace member installs
// it once, and the workspace is linked to one OpenBot host, which answers all of its messages. The
// Worker exchanges the code because the client secret lives here, records only which host answers
// the workspace, and seals the bot token to the host's key. It keeps no token. The sealed grant goes
// back to the desktop in the URL fragment of `/slack/connect`.

import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { SLACK_BOT_SCOPES } from "@openbot/contracts/slack-app";
import { isRawP256PublicKey, sealSlackWorkspaceGrant } from "@openbot/contracts/slack-workspace-grant";
import { hmacSha256 } from "./crypto";
import { authEventStatement } from "./remote-control-plane";
import type { AuthUser, WorkerBindings } from "./types";

const STATE_TTL_MS = 10 * 60_000;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const SLACK_ID_PATTERN = /^[A-Z0-9]{1,32}$/u;
/** Development only: the dev app's listener on the same computer as the browser. */
const DEVELOPMENT_RETURN_PATTERN = /^http:\/\/127\.0\.0\.1:[0-9]{2,5}\/slack-workspace$/u;

export class SlackAppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface StatePayload {
  // The account and the host that asked.
  u: string;
  h: string;
  // The host's nonce and one-use public key.
  n: string;
  k: string;
  e: number;
  // Development only: where the grant goes instead of `/slack/connect`.
  r?: string;
}

export class SlackAppService {
  readonly #database: D1Database;
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #stateSecret: string;
  readonly #fetch: Fetch;
  readonly #now: () => number;
  readonly #developmentOrigin: string | null;
  readonly #flushAuthEvents: () => Promise<void>;

  constructor(
    bindings: Pick<
      WorkerBindings,
      "DB" | "SLACK_CLIENT_ID" | "SLACK_CLIENT_SECRET" | "SLACK_STATE_SECRET" | "SLACK_DEV_PUBLIC_ORIGIN"
    >,
    // Sends the queued Signal events. The Worker passes its delivery; the cron sends them otherwise.
    options: { fetch?: Fetch; now?: () => number; flushAuthEvents?: () => Promise<void> } = {},
  ) {
    const clientId = bindings.SLACK_CLIENT_ID?.trim();
    const clientSecret = bindings.SLACK_CLIENT_SECRET?.trim();
    const stateSecret = bindings.SLACK_STATE_SECRET?.trim();
    if (!clientId || !clientSecret || !stateSecret || new TextEncoder().encode(stateSecret).byteLength < 32) {
      throw new SlackAppError(503, "slack_not_configured", "The OpenBot Slack app is not configured.");
    }
    this.#database = bindings.DB;
    this.#clientId = clientId;
    this.#clientSecret = clientSecret;
    this.#stateSecret = stateSecret;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#now = options.now ?? Date.now;
    this.#developmentOrigin = bindings.SLACK_DEV_PUBLIC_ORIGIN?.trim() || null;
    this.#flushAuthEvents = options.flushAuthEvents ?? (async () => undefined);
  }

  /**
   * Where Slack sends the browser back. A local development API is plain HTTP, which Slack refuses,
   * so `bun run dev:slack` gives it a public HTTPS tunnel origin.
   */
  redirectUri(requestUrl: string): string {
    return new URL("/v2/slack/callback", this.#developmentOrigin ?? requestUrl).toString();
  }

  /** The Slack install URL for one connect of one host that the account owns. */
  async authorizeUrl(
    user: AuthUser,
    input: { hostId: string; hostNonce: string; hostPublicKey: string; redirectUri: string; returnUrl?: string },
  ): Promise<string> {
    if (!NONCE_PATTERN.test(input.hostNonce) || !isRawP256PublicKey(input.hostPublicKey)) {
      throw new SlackAppError(400, "invalid_slack_request", "The Slack sign-in request is invalid.");
    }
    // Only a development API takes a return address, and only one on this computer's loopback.
    if (
      input.returnUrl !== undefined &&
      (!this.#developmentOrigin || !DEVELOPMENT_RETURN_PATTERN.test(input.returnUrl))
    ) {
      throw new SlackAppError(400, "invalid_slack_request", "The Slack sign-in request is invalid.");
    }
    const host = await this.#database
      .prepare("SELECT owner_user_id FROM remote_hosts WHERE host_id = ? LIMIT 1")
      .bind(input.hostId)
      .first<{ owner_user_id: string }>();
    if (host?.owner_user_id !== user.id) {
      throw new SlackAppError(403, "forbidden", "Only the owner of this server can connect Slack.");
    }
    const state = await this.#signState({
      u: user.id,
      h: input.hostId,
      n: input.hostNonce,
      k: input.hostPublicKey,
      e: this.#now() + STATE_TTL_MS,
      ...(input.returnUrl ? { r: input.returnUrl } : {}),
    });
    const url = new URL("https://slack.com/oauth/v2/authorize");
    url.searchParams.set("client_id", this.#clientId);
    url.searchParams.set("scope", SLACK_BOT_SCOPES.join(","));
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("state", state);
    return url.toString();
  }

  /**
   * Exchanges the code, links the workspace to the host in `state`, and seals the bot token to the
   * host key. Returns what the desktop needs: the nonce, to find its connect, and the sealed grant.
   *
   * A workspace answers to one host. The account that connected it can move it to another of its
   * hosts; another account gets `slack_workspace_taken` until the first host disconnects.
   */
  async complete(input: {
    code: string;
    state: string;
    redirectUri: string;
  }): Promise<{ nonce: string; grant: string; returnUrl?: string }> {
    const state = await this.#verifyState(input.state);
    const response = await this.#fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${this.#clientId}:${this.#clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ code: input.code, redirect_uri: input.redirectUri }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json().catch(() => null);
    if (!isDynamicRecord(body) || body.ok !== true) {
      throw new SlackAppError(502, "slack_exchange_failed", "Slack did not accept the install.");
    }
    if (body.is_enterprise_install === true) {
      throw new SlackAppError(400, "slack_enterprise_install", "Connect one workspace, not a whole organization.");
    }
    const team = body.team;
    if (
      body.token_type !== "bot" ||
      !isString(body.access_token) ||
      !isString(body.bot_user_id) ||
      !isString(body.app_id) ||
      !isDynamicRecord(team) ||
      !isString(team.id) ||
      !SLACK_ID_PATTERN.test(team.id)
    ) {
      throw new SlackAppError(502, "slack_exchange_failed", "Slack did not accept the install.");
    }
    // One statement, so two connects at once cannot both win. Another account's row stays as it is.
    // When the link is made, Signal drops any older route of the workspace: a host that the workspace
    // moved away from cannot keep it with the ticket it holds.
    const now = this.#now();
    const [linked] = await this.#database.batch([
      this.#database
        .prepare(
          `INSERT INTO slack_workspace_routes (team_id, host_id, account_id, app_id, bot_user_id, connected_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(team_id) DO UPDATE SET host_id = excluded.host_id, app_id = excluded.app_id,
             bot_user_id = excluded.bot_user_id, connected_at = excluded.connected_at
           WHERE slack_workspace_routes.account_id = excluded.account_id`,
        )
        .bind(team.id, state.h, state.u, body.app_id, body.bot_user_id, now),
      authEventStatement(
        this.#database,
        { type: "slack-route-revoked", appId: body.app_id, teamId: team.id, through: now - 1 },
        now,
        {
          sql: "EXISTS (SELECT 1 FROM slack_workspace_routes WHERE team_id = ? AND account_id = ? AND connected_at = ?)",
          binds: [team.id, state.u, now],
        },
      ),
    ]);
    await this.#flushAuthEvents();
    if (!linked || linked.meta.changes === 0) {
      throw new SlackAppError(
        409,
        "slack_workspace_taken",
        "Another OpenBot server answers this Slack workspace. Disconnect it there first.",
      );
    }
    return {
      ...(state.r ? { returnUrl: state.r } : {}),
      nonce: state.n,
      grant: await sealSlackWorkspaceGrant(state.k, state.n, {
        botToken: body.access_token,
        botUserId: body.bot_user_id,
        appId: body.app_id,
        workspaceId: team.id,
        workspaceName: isString(team.name) ? team.name : team.id,
      }),
    };
  }

  async #signState(payload: StatePayload): Promise<string> {
    const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
    return `${body}.${await hmacSha256(this.#stateSecret, body)}`;
  }

  async #verifyState(state: string): Promise<StatePayload> {
    const [body, signature, extra] = state.split(".");
    if (!body || !signature || extra !== undefined) throw invalidState();
    let payload: unknown;
    try {
      // `verify` compares in constant time.
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(this.#stateSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
      );
      if (!(await crypto.subtle.verify("HMAC", key, fromBase64Url(signature), new TextEncoder().encode(body)))) {
        throw invalidState();
      }
      payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
    } catch {
      throw invalidState();
    }
    if (
      !isDynamicRecord(payload) ||
      !isString(payload.u) ||
      !isString(payload.h) ||
      !isString(payload.n) ||
      !isString(payload.k) ||
      typeof payload.e !== "number" ||
      payload.e < this.#now() ||
      (payload.r !== undefined && (!isString(payload.r) || !DEVELOPMENT_RETURN_PATTERN.test(payload.r)))
    ) {
      throw invalidState();
    }
    return {
      u: payload.u,
      h: payload.h,
      n: payload.n,
      k: payload.k,
      e: payload.e,
      ...(isString(payload.r) ? { r: payload.r } : {}),
    };
  }
}

function invalidState(): SlackAppError {
  return new SlackAppError(400, "slack_state_invalid", "The Slack sign-in expired. Start it again.");
}

function toBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}
