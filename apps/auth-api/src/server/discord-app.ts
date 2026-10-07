import type { RemoteFailure } from "./remote-control-plane";
// The OpenBot Discord app's OAuth install. One bot serves every Discord server (guild): a member who
// can manage the server adds it once, and the server is linked to one OpenBot host, which answers all
// of its messages. The Worker exchanges the code because the client secret lives here, and records
// only which host answers the server. The bot token stays in Signal: this Worker does not get it, and
// it revokes the user token that the exchange gives. The sealed grant goes back to the desktop in the
// URL fragment of `/discord/connect`.

import { DISCORD_BOT_PERMISSIONS } from "@openbot/contracts/discord-app";
import { sealDiscordGuildGrant } from "@openbot/contracts/discord-guild-grant";
import { isRawP256PublicKey } from "@openbot/contracts/host-grant";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Effect, Schema } from "effect";
import { hmacSha256 } from "./crypto";
import { authEventStatement } from "./remote-control-plane";
import type { AuthUser, WorkerBindings } from "./types";

const STATE_TTL_MS = 10 * 60_000;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const DISCORD_API = "https://discord.com/api/v10";

export class DiscordAppError extends Schema.TaggedError<DiscordAppError>()("DiscordAppError", {
  status: Schema.Number,
  code: Schema.String,
  message: Schema.String,
}) {
  constructor(status: number, code: string, message: string) {
    super({ status, code, message });
  }
}

class DiscordOperationError extends Schema.TaggedError<DiscordOperationError>()("DiscordOperationError", {}) {}

function discordCall<A>(operation: () => Promise<A>): Effect.Effect<A, DiscordAppError | DiscordOperationError> {
  return Effect.tryPromise({
    try: operation,
    catch: (error) => (error instanceof DiscordAppError ? error : new DiscordOperationError({})),
  });
}

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const StatePayload = Schema.Struct({
  u: Schema.String,
  h: Schema.String,
  n: Schema.String,
  k: Schema.String,
  e: Schema.Number,
});
type StatePayload = typeof StatePayload.Type;
// The token response of the `bot` scope names the guild that added the bot.
const DiscordGrant = Schema.Struct({
  guild: Schema.Struct({
    id: Schema.String.check(Schema.isPattern(/^[0-9]{1,24}$/u)),
    name: Schema.String,
  }),
});

export class DiscordAppService {
  readonly #database: D1Database;
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #stateSecret: string;
  readonly #fetch: Fetch;
  readonly #now: () => number;
  readonly #developmentOrigin: string | null;
  readonly #flushAuthEvents: () => Effect.Effect<void, RemoteFailure>;

  constructor(
    bindings: Pick<
      WorkerBindings,
      "DB" | "DISCORD_CLIENT_ID" | "DISCORD_CLIENT_SECRET" | "DISCORD_STATE_SECRET" | "DISCORD_DEV_PUBLIC_ORIGIN"
    >,
    // Sends the queued Signal events. The Worker passes its delivery; the cron sends them otherwise.
    options: { fetch?: Fetch; now?: () => number; flushAuthEvents?: () => Effect.Effect<void, RemoteFailure> } = {},
  ) {
    const clientId = bindings.DISCORD_CLIENT_ID?.trim();
    const clientSecret = bindings.DISCORD_CLIENT_SECRET?.trim();
    const stateSecret = bindings.DISCORD_STATE_SECRET?.trim();
    if (!clientId || !clientSecret || !stateSecret || new TextEncoder().encode(stateSecret).byteLength < 32) {
      throw new DiscordAppError(503, "discord_not_configured", "The OpenBot Discord app is not configured.");
    }
    this.#database = bindings.DB;
    this.#clientId = clientId;
    this.#clientSecret = clientSecret;
    this.#stateSecret = stateSecret;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#now = options.now ?? Date.now;
    this.#developmentOrigin = bindings.DISCORD_DEV_PUBLIC_ORIGIN?.trim() || null;
    this.#flushAuthEvents = options.flushAuthEvents ?? (() => Effect.void);
  }

  /** Where Discord sends the browser back. A development API can name its public origin. */
  redirectUri(requestUrl: string): string {
    return new URL("/v2/discord/callback", this.#developmentOrigin ?? requestUrl).toString();
  }

  /** The Discord install URL for one connect of one host that the account owns. */

  readonly authorizeUrl = Effect.fn("DiscordAppService.authorizeUrl")(function* (
    this: DiscordAppService,
    user: AuthUser,
    input: { hostId: string; hostNonce: string; hostPublicKey: string; redirectUri: string },
  ): Effect.fn.Return<string, DiscordAppError | DiscordOperationError> {
    if (!NONCE_PATTERN.test(input.hostNonce) || !isRawP256PublicKey(input.hostPublicKey)) {
      return yield* new DiscordAppError(400, "invalid_discord_request", "The Discord sign-in request is invalid.");
    }
    const host = yield* discordCall(() =>
      this.#database
        .prepare("SELECT owner_user_id FROM remote_hosts WHERE host_id = ? LIMIT 1")
        .bind(input.hostId)
        .first<{ owner_user_id: string }>(),
    );
    if (host?.owner_user_id !== user.id) {
      return yield* new DiscordAppError(403, "forbidden", "Only the owner of this server can connect Discord.");
    }
    const state = yield* this.#signState({
      u: user.id,
      h: input.hostId,
      n: input.hostNonce,
      k: input.hostPublicKey,
      e: this.#now() + STATE_TTL_MS,
    });
    const url = new URL("https://discord.com/oauth2/authorize");
    url.searchParams.set("client_id", this.#clientId);
    url.searchParams.set("scope", "bot");
    url.searchParams.set("permissions", DISCORD_BOT_PERMISSIONS);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("state", state);
    // A guild install, not a user install.
    url.searchParams.set("integration_type", "0");
    return url.toString();
  }).bind(this);

  /**
   * Exchanges the code, links the guild to the host in `state`, and seals the link to the host key.
   * Returns what the desktop needs: the nonce, to find its connect, and the sealed grant.
   *
   * A guild answers to one host. The account that connected it can move it to another of its hosts;
   * another account gets `discord_guild_taken` until the first host disconnects.
   */

  readonly complete = Effect.fn("DiscordAppService.complete")(function* (
    this: DiscordAppService,
    input: { code: string; state: string; redirectUri: string },
  ): Effect.fn.Return<{ nonce: string; grant: string }, DiscordAppError | DiscordOperationError> {
    const state = yield* this.#verifyState(input.state);
    const response = yield* discordCall(() =>
      this.#fetch(`${DISCORD_API}/oauth2/token`, {
        method: "POST",
        headers: { Authorization: this.#basicAuthorization(), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: input.code,
          redirect_uri: input.redirectUri,
        }),
        signal: AbortSignal.timeout(10_000),
      }),
    );
    const body = yield* discordCall(() => response.json().catch(() => null));
    // OpenBot does not use the user token. Revoke it at once; a failure does not stop the connect.
    if (isDynamicRecord(body) && isString(body.access_token)) yield* this.#revoke(body.access_token);
    if (!response.ok) {
      return yield* new DiscordAppError(502, "discord_exchange_failed", "Discord did not accept the install.");
    }
    const { guild } = yield* Schema.decodeUnknownEffect(DiscordGrant)(body).pipe(
      Effect.mapError(() => new DiscordAppError(502, "discord_exchange_failed", "Discord did not accept the install.")),
    );
    // One statement, so two connects at once cannot both win. Another account's row stays as it is.
    // When the link is made, Signal drops any older route of the guild: a host that the guild moved
    // away from cannot keep it with the ticket it holds.
    const now = this.#now();
    const [linked] = yield* discordCall(() =>
      this.#database.batch([
        this.#database
          .prepare(
            `INSERT INTO discord_guild_routes (guild_id, host_id, account_id, connected_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(guild_id) DO UPDATE SET host_id = excluded.host_id, connected_at = excluded.connected_at
           WHERE discord_guild_routes.account_id = excluded.account_id`,
          )
          .bind(guild.id, state.h, state.u, now),
        authEventStatement(
          this.#database,
          { type: "discord-route-revoked", guildId: guild.id, through: now - 1 },
          now,
          {
            sql: "EXISTS (SELECT 1 FROM discord_guild_routes WHERE guild_id = ? AND account_id = ? AND connected_at = ?)",
            binds: [guild.id, state.u, now],
          },
        ),
      ]),
    );
    yield* this.#flushAuthEvents().pipe(Effect.mapError(() => new DiscordOperationError({})));
    if (!linked || linked.meta.changes === 0) {
      return yield* new DiscordAppError(
        409,
        "discord_guild_taken",
        "Another OpenBot server answers this Discord server. Disconnect it there first.",
      );
    }
    return {
      nonce: state.n,
      grant: yield* discordCall(() =>
        sealDiscordGuildGrant(state.k, state.n, { guildId: guild.id, guildName: guild.name, appId: this.#clientId }),
      ),
    };
  }).bind(this);

  #basicAuthorization(): string {
    return `Basic ${btoa(`${this.#clientId}:${this.#clientSecret}`)}`;
  }

  readonly #revoke = Effect.fn("DiscordAppService.revoke")(function* (this: DiscordAppService, token: string) {
    yield* discordCall(() =>
      this.#fetch(`${DISCORD_API}/oauth2/token/revoke`, {
        method: "POST",
        headers: { Authorization: this.#basicAuthorization(), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token, token_type_hint: "access_token" }),
        signal: AbortSignal.timeout(10_000),
      }),
    ).pipe(Effect.ignore);
  });

  readonly #signState = Effect.fn("DiscordAppService.signState")(function* (
    this: DiscordAppService,
    payload: StatePayload,
  ): Effect.fn.Return<string, DiscordAppError | DiscordOperationError> {
    const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
    return `${body}.${yield* hmacSha256(this.#stateSecret, body).pipe(Effect.mapError(() => new DiscordOperationError({})))}`;
  });

  readonly #verifyState = Effect.fn("DiscordAppService.verifyState")(function* (
    this: DiscordAppService,
    state: string,
  ): Effect.fn.Return<StatePayload, DiscordAppError> {
    const [body, signature, extra] = state.split(".");
    if (!body || !signature || extra !== undefined) return yield* invalidState();
    const key = yield* Effect.tryPromise({
      try: () =>
        crypto.subtle.importKey(
          "raw",
          new TextEncoder().encode(this.#stateSecret),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["verify"],
        ),
      catch: invalidState,
    });
    const bytes = yield* Effect.try({ try: () => fromBase64Url(signature), catch: invalidState });
    const valid = yield* Effect.tryPromise({
      try: () => crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(body)),
      catch: invalidState,
    });
    if (!valid) return yield* invalidState();
    const payload = yield* Effect.try({
      try: (): unknown => JSON.parse(new TextDecoder().decode(fromBase64Url(body))),
      catch: invalidState,
    });
    const decoded = yield* Schema.decodeUnknownEffect(StatePayload)(payload).pipe(Effect.mapError(invalidState));
    if (decoded.e < this.#now()) return yield* invalidState();
    return decoded;
  });
}

function invalidState(): DiscordAppError {
  return new DiscordAppError(400, "discord_state_invalid", "The Discord sign-in expired. Start it again.");
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
