import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { SLACK_BOT_SCOPES } from "@openbot/contracts/slack-app";
import { isRawP256PublicKey, sealSlackWorkspaceGrant } from "@openbot/contracts/slack-workspace-grant";
import { Effect, Schema } from "effect";
import { decodeBase64Url, encodeBase64Url, hmacSha256, importHmacSha256Key } from "./crypto";
import type { RemoteFailure } from "./remote-control-plane";
import { authEventStatement } from "./remote-control-plane";
import type { AuthUser, WorkerBindings } from "./types";

const STATE_TTL_MS = 10 * 60_000;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const SLACK_ID_PATTERN = /^[A-Z0-9]{1,32}$/u;
const DEVELOPMENT_RETURN_PATTERN = /^http:\/\/127\.0\.0\.1:[0-9]{2,5}\/slack-workspace$/u;

export class SlackAppError extends Schema.TaggedError<SlackAppError>()("SlackAppError", {
  status: Schema.Number,
  code: Schema.String,
  message: Schema.String,
}) {
  constructor(status: number, code: string, message: string) {
    super({ status, code, message });
  }
}

class SlackOperationError extends Schema.TaggedError<SlackOperationError>()("SlackOperationError", {}) {}

function slackCall<A>(operation: () => Promise<A>): Effect.Effect<A, SlackAppError | SlackOperationError> {
  return Effect.tryPromise({
    try: operation,
    catch: (error) => (error instanceof SlackAppError ? error : new SlackOperationError({})),
  });
}

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const StatePayload = Schema.Struct({
  u: Schema.String,
  h: Schema.String,
  n: Schema.String,
  k: Schema.String,
  e: Schema.Number,
  r: Schema.optional(Schema.String),
});
type StatePayload = typeof StatePayload.Type;
const SlackGrant = Schema.Struct({
  token_type: Schema.Literal("bot"),
  access_token: Schema.String,
  bot_user_id: Schema.String,
  app_id: Schema.String,
  team: Schema.Struct({ id: Schema.String }),
});

export class SlackAppService {
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
      "DB" | "SLACK_CLIENT_ID" | "SLACK_CLIENT_SECRET" | "SLACK_STATE_SECRET" | "SLACK_DEV_PUBLIC_ORIGIN"
    >,
    options: { fetch?: Fetch; now?: () => number; flushAuthEvents?: () => Effect.Effect<void, RemoteFailure> } = {},
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
    this.#flushAuthEvents = options.flushAuthEvents ?? (() => Effect.void);
  }

  redirectUri(requestUrl: string): string {
    return new URL("/v2/slack/callback", this.#developmentOrigin ?? requestUrl).toString();
  }

  readonly authorizeUrl = Effect.fn("SlackAppService.authorizeUrl")(function* (
    this: SlackAppService,
    user: AuthUser,
    input: { hostId: string; hostNonce: string; hostPublicKey: string; redirectUri: string; returnUrl?: string },
  ): Effect.fn.Return<string, SlackAppError | SlackOperationError> {
    if (!NONCE_PATTERN.test(input.hostNonce) || !isRawP256PublicKey(input.hostPublicKey)) {
      return yield* new SlackAppError(400, "invalid_slack_request", "The Slack sign-in request is invalid.");
    }
    if (
      input.returnUrl !== undefined &&
      (!this.#developmentOrigin || !DEVELOPMENT_RETURN_PATTERN.test(input.returnUrl))
    ) {
      return yield* new SlackAppError(400, "invalid_slack_request", "The Slack sign-in request is invalid.");
    }
    const host = yield* slackCall(() =>
      this.#database
        .prepare("SELECT owner_user_id FROM remote_hosts WHERE host_id = ? LIMIT 1")
        .bind(input.hostId)
        .first<{ owner_user_id: string }>(),
    );
    if (host?.owner_user_id !== user.id) {
      return yield* new SlackAppError(403, "forbidden", "Only the owner of this server can connect Slack.");
    }
    const state = yield* this.#signState({
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
  }).bind(this);

  readonly complete = Effect.fn("SlackAppService.complete")(function* (
    this: SlackAppService,
    input: {
      code: string;
      state: string;
      redirectUri: string;
    },
  ): Effect.fn.Return<{ nonce: string; grant: string; returnUrl?: string }, SlackAppError | SlackOperationError> {
    const state = yield* this.#verifyState(input.state);
    const response = yield* slackCall(() =>
      this.#fetch("https://slack.com/api/oauth.v2.access", {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${this.#clientId}:${this.#clientSecret}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ code: input.code, redirect_uri: input.redirectUri }),
        signal: AbortSignal.timeout(10_000),
      }),
    );
    const body = yield* slackCall(() => response.json().catch(() => null));
    if (!isDynamicRecord(body) || body.ok !== true) {
      return yield* new SlackAppError(502, "slack_exchange_failed", "Slack did not accept the install.");
    }
    if (body.is_enterprise_install === true) {
      return yield* new SlackAppError(
        400,
        "slack_enterprise_install",
        "Connect one workspace, not a whole organization.",
      );
    }
    const workspaceName = isDynamicRecord(body.team) && isString(body.team.name) ? body.team.name : undefined;
    const grant = yield* Schema.decodeUnknownEffect(SlackGrant)(body).pipe(
      Effect.mapError(() => new SlackAppError(502, "slack_exchange_failed", "Slack did not accept the install.")),
    );
    const team = grant.team;
    if (!SLACK_ID_PATTERN.test(team.id))
      return yield* new SlackAppError(502, "slack_exchange_failed", "Slack did not accept the install.");
    const now = this.#now();
    const [linked] = yield* slackCall(() =>
      this.#database.batch([
        this.#database
          .prepare(
            `INSERT INTO slack_workspace_routes (team_id, host_id, account_id, app_id, bot_user_id, connected_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(team_id) DO UPDATE SET host_id = excluded.host_id, app_id = excluded.app_id,
             bot_user_id = excluded.bot_user_id, connected_at = excluded.connected_at
           WHERE slack_workspace_routes.account_id = excluded.account_id`,
          )
          .bind(team.id, state.h, state.u, grant.app_id, grant.bot_user_id, now),
        authEventStatement(
          this.#database,
          { type: "slack-route-revoked", appId: grant.app_id, teamId: team.id, through: now - 1 },
          now,
          {
            sql: "EXISTS (SELECT 1 FROM slack_workspace_routes WHERE team_id = ? AND account_id = ? AND connected_at = ?)",
            binds: [team.id, state.u, now],
          },
        ),
      ]),
    );
    yield* this.#flushAuthEvents().pipe(
      Effect.mapError((error) => (error instanceof SlackAppError ? error : new SlackOperationError({}))),
    );
    if (!linked || linked.meta.changes === 0) {
      return yield* new SlackAppError(
        409,
        "slack_workspace_taken",
        "Another OpenBot server answers this Slack workspace. Disconnect it there first.",
      );
    }
    return {
      ...(state.r ? { returnUrl: state.r } : {}),
      nonce: state.n,
      grant: yield* slackCall(() =>
        sealSlackWorkspaceGrant(state.k, state.n, {
          botToken: grant.access_token,
          botUserId: grant.bot_user_id,
          appId: grant.app_id,
          workspaceId: team.id,
          workspaceName: workspaceName ?? team.id,
        }),
      ),
    };
  }).bind(this);

  readonly #signState = Effect.fn("SlackAppService.signState")(function* (
    this: SlackAppService,
    payload: StatePayload,
  ): Effect.fn.Return<string, SlackAppError | SlackOperationError> {
    const body = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
    return `${body}.${yield* hmacSha256(this.#stateSecret, body).pipe(Effect.mapError((error) => (error instanceof SlackAppError ? error : new SlackOperationError({}))))}`;
  });

  readonly #verifyState = Effect.fn("SlackAppService.verifyState")(function* (
    this: SlackAppService,
    state: string,
  ): Effect.fn.Return<StatePayload, SlackAppError> {
    const [body, signature, extra] = state.split(".");
    if (!body || !signature || extra !== undefined) return yield* invalidState();
    const key = yield* Effect.tryPromise({
      try: () => importHmacSha256Key(this.#stateSecret, "verify"),
      catch: invalidState,
    });
    const bytes = yield* Effect.try({ try: () => decodeBase64Url(signature), catch: invalidState });
    const valid = yield* Effect.tryPromise({
      try: () => crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(body)),
      catch: invalidState,
    });
    if (!valid) return yield* invalidState();
    const payload = yield* Effect.try({
      try: (): unknown => JSON.parse(new TextDecoder().decode(decodeBase64Url(body))),
      catch: invalidState,
    });
    const decoded = yield* Schema.decodeUnknownEffect(StatePayload)(payload).pipe(Effect.mapError(invalidState));
    if (decoded.e < this.#now() || (decoded.r !== undefined && !DEVELOPMENT_RETURN_PATTERN.test(decoded.r)))
      return yield* invalidState();
    return decoded;
  });
}

function invalidState(): SlackAppError {
  return new SlackAppError(400, "slack_state_invalid", "The Slack sign-in expired. Start it again.");
}
