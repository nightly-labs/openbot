import {
  HOST_KEY_HANDOVER_LIMIT,
  type HostKeyHandover,
  hostKeyHandoverStatement,
} from "@openbot/contracts/host-key-handover";
import { DEFAULT_TEAM_MEMBER_LIMIT } from "@openbot/contracts/input-limits";
import type { MobileConnectHostBinding } from "@openbot/contracts/mobile-connect";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import type { RemoteAuthEvent } from "@openbot/contracts/signal-protocol/auth-events";
import {
  DISCORD_ROUTE_AUDIENCE,
  DISCORD_ROUTE_GUILDS_LIMIT,
  DISCORD_ROUTE_TTL_SECONDS,
  type DiscordRouteGuild,
} from "@openbot/contracts/signal-protocol/discord-route";
import type { IngressRoute } from "@openbot/contracts/signal-protocol/ingress-queue";
import {
  SLACK_ROUTE_AUDIENCE,
  SLACK_ROUTE_TEAMS_LIMIT,
  SLACK_ROUTE_TTL_SECONDS,
  type SlackRouteClaims,
  type SlackRouteTeam,
} from "@openbot/contracts/signal-protocol/slack-route";
import {
  TELEGRAM_BOT_ID_PATTERN,
  TELEGRAM_CHAT_ID_PATTERN,
  TELEGRAM_LINK_CODE_PATTERN,
  TELEGRAM_LINK_CODE_TTL_SECONDS,
  TELEGRAM_ROUTE_AUDIENCE,
  TELEGRAM_ROUTE_CHATS_LIMIT,
  TELEGRAM_ROUTE_TTL_SECONDS,
  type TelegramRouteChat,
  type TelegramRouteClaims,
} from "@openbot/contracts/signal-protocol/telegram-route";
import {
  REMOTE_TICKET_AUDIENCE,
  REMOTE_TICKET_PROTOCOL_VERSION,
  type RemoteMemberRole,
  type RemoteTicketClaims,
} from "@openbot/contracts/signal-protocol/ticket";
import {
  WEBHOOK_ROUTE_AUDIENCE,
  WEBHOOK_ROUTE_ID_PATTERN,
  WEBHOOK_ROUTE_TTL_SECONDS,
  WEBHOOK_ROUTES_LIMIT,
  type WebhookRoute,
} from "@openbot/contracts/signal-protocol/webhook-route";
import { sourceText } from "@openbot/i18n/source";
import { Context, Effect, Layer, Result, Schema } from "effect";
import { importJWK, type JWK, type JWTPayload, SignJWT } from "jose";
import {
  getServerEntitlement,
  type OwnerLicense,
  ownerLicenseForHost,
  SERVER_MEMBER_LIMIT_SQL,
} from "./billing-entitlement";
import { decodeBase64Url, hmacSha256, importHmacSha256Key, randomToken, sha256 } from "./crypto";
import { PERSISTENT_SESSION_EXPIRES_AT } from "./session-policy";
import type { AuthUser, WorkerBindings } from "./types";

const TICKET_TTL_SECONDS = 180;
const LEGACY_SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;
const AUTH_EVENT_RETRY_MS = 60_000;
const AUTH_EVENT_SEND_CONCURRENCY = 6;
/** Longer than one drain: 50 events, 6 at a time, each with a 5 s timeout. */
const AUTH_EVENT_CLAIM_MS = 2 * 60_000;
const MAX_OUTSTANDING_INVITES_PER_HOST = 50;
const MAX_PERMANENT_INVITES_PER_HOST = 5;
const MAX_TELEGRAM_LINK_CODES_PER_HOST = 10;
// An active member keeps a seat; anyone else needs a free one. Binds: host, user, host, limit.
const MEMBER_SEAT_AVAILABLE_SQL = `(
  EXISTS(SELECT 1 FROM remote_memberships WHERE host_id = ? AND user_id = ? AND status = 'active')
  OR (SELECT COUNT(*) FROM remote_memberships WHERE host_id = ? AND status = 'active') < ?
)`;
// The commercial license of the host's owner counts people across all the owner's servers: the owner,
// and each other account with an active membership. A person who is already counted joins another
// server of the owner freely; anyone else needs a free license user. Binds: owner, user, owner, owner,
// license users.
const LICENSE_SEAT_AVAILABLE_SQL = `(
  EXISTS(SELECT 1 FROM remote_memberships m JOIN remote_hosts h ON h.host_id = m.host_id
          WHERE h.owner_user_id = ? AND m.user_id = ? AND m.status = 'active')
  OR (SELECT COUNT(DISTINCT m.user_id) FROM remote_memberships m JOIN remote_hosts h ON h.host_id = m.host_id
       WHERE h.owner_user_id = ? AND m.user_id <> ? AND m.status = 'active') + 1 < ?
)`;

/** The seat checks for one user on one host: the host's member limit and the owner's license. */
interface MemberSeat {
  readonly sql: string;
  readonly binds: readonly (string | number)[];
  readonly limit: number;
  /** Null when the license gives the limit: the license count is then the stricter check. */
  readonly memberBinds: readonly (string | number)[] | null;
  readonly licenseBinds: readonly (string | number)[] | null;
}

interface MemberLimit {
  readonly limit: number;
  /** True when the users of the owner's license give the limit. */
  readonly fromLicense: boolean;
}

/** The membership row that this accept wrote: its id and its update time. */
const JOINED_NOW_SQL = `EXISTS(
  SELECT 1 FROM remote_memberships
   WHERE host_id = ? AND user_id = ? AND status = 'active' AND membership_id = ? AND updated_at = ?
)`;

// An invitation admits a user only while its creator can still invite on the host, and it never undoes
// a removal made after the invitation: the removed member needs a new invitation or a reactivation.
// A member who left is not removed, so an earlier invitation still admits them. A revoked row with no
// removal time counts as a removal.
// Binds the user ID of the account that accepts.
const INVITE_STILL_GRANTED_SQL = `(
  EXISTS(
    SELECT 1 FROM remote_memberships
     WHERE host_id = remote_invites.host_id AND user_id = remote_invites.created_by_user_id
       AND status = 'active' AND role IN ('owner', 'admin')
  )
  AND NOT EXISTS(
    SELECT 1 FROM remote_memberships
     WHERE host_id = remote_invites.host_id AND user_id = ? AND status = 'revoked'
       AND COALESCE(removed_at, updated_at) >= remote_invites.created_at
  )
)`;

/**
 * The SQL value of `removed_at` after a membership change. It is the time of the first removal by an
 * owner or admin, 0 when the member left, and NULL for an active member. A revoked row with NULL comes
 * from a Worker before migration 0036, so the invitation check counts it as a removal. The value reads
 * the row as the UPDATE finds it, so a leave that races a removal cannot clear it, and a member who is
 * already revoked cannot clear a removal by leaving again. It binds the change time when it has a
 * placeholder.
 */
function removedAtAfterChange(change: { revoke: boolean; leave: boolean; activating: boolean }) {
  if (!change.revoke) return change.activating ? "NULL" : "removed_at";
  if (change.leave) return "CASE WHEN status = 'active' THEN 0 ELSE removed_at END";
  return "CASE WHEN status = 'revoked' AND removed_at > 0 THEN removed_at ELSE ? END";
}

export type { RemoteMemberRole };

export class RemoteControlPlaneError extends Schema.TaggedError<RemoteControlPlaneError>()("RemoteControlPlaneError", {
  status: Schema.Number,
  code: Schema.String,
  message: Schema.String,
}) {
  constructor(status: number, code: string, message: string) {
    super({ status, code, message });
  }
}
class RemoteOperationError extends Schema.TaggedError<RemoteOperationError>()("RemoteOperationError", {}) {}
export type RemoteFailure = RemoteControlPlaneError | RemoteOperationError;
function remoteValidate<A>(operation: () => A): Effect.Effect<A, RemoteFailure> {
  return Effect.try({
    try: operation,
    catch: (error) => (error instanceof RemoteControlPlaneError ? error : new RemoteOperationError({})),
  });
}
function remoteCall<A>(operation: () => Promise<A>): Effect.Effect<A, RemoteFailure> {
  return Effect.tryPromise({
    try: operation,
    catch: (error) => (error instanceof RemoteControlPlaneError ? error : new RemoteOperationError({})),
  });
}

/** A SQL condition and its binds, which a statement adds to its WHERE clause. */
export interface SqlCondition {
  sql: string;
  binds: unknown[];
}

interface RemoteHostRow {
  host_id: string;
  owner_user_id: string;
  name: string;
  logo_key: string | null;
  auth_epoch: number;
  machine_token_hash: string | null;
  device_public_key: string | null;
}

interface RemoteHostKeyHandoverRow {
  host_id: string;
  issued_at: number;
  previous_public_key: string;
  public_key: string;
  previous_signature: string;
  signature: string;
}

interface RemoteMembershipRow {
  membership_id: string;
  host_id: string;
  user_id: string;
  role: RemoteMemberRole;
  status: "active" | "revoked";
}

interface RemoteSessionRow extends RemoteMembershipRow {
  session_id: string;
  expires_at: number;
  ended_at: number | null;
  auth_epoch: number;
}

// What a resume token has to prove it still stands for. The Signal service holds the token; this
// is the subset of the ticket it hands back for re-validation, derived so a claim renamed in the
// contract cannot be silently dropped from the check.
export type RemoteResumeClaims = Pick<
  RemoteTicketClaims,
  "sessionId" | "hostId" | "userId" | "membershipId" | "role" | "authEpoch" | "sessionExpiresAt"
>;

interface RemoteInviteRow {
  invite_id: string;
  host_id: string;
  email: string | null;
  role: Exclude<RemoteMemberRole, "owner">;
  expires_at: number;
  used_at: number | null;
  revoked_at: number | null;
  // NULL means unlimited. Rows written before 0020 carry the migration default of 1.
  max_uses: number | null;
  use_count: number;
}

interface TicketSignerConfig {
  privateJwk: string;
  publicJwks: string;
  keyId: string;
}

type RemoteFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** The OpenBot Telegram bot that this Worker links chats for. */
interface TelegramBot {
  botId: string;
  botUsername: string;
}

interface TelegramLinkCodeRow {
  bot_id: string;
  host_id: string;
  account_id: string;
  expires_at: number;
  chat_id: string | null;
}

interface TelegramChatLink {
  hostId: string;
  linkedAt: number;
}

interface RemoteAuthEventRow {
  event_id: string;
  payload: string;
  attempts: number;
}

interface RemotePublicJwk extends DynamicRecord {
  kid: string;
  kty: string;
}

interface RemotePublicJwks {
  keys: RemotePublicJwk[];
}

export class RemoteTicketSigner {
  readonly #keyId: string;
  readonly #publicJwks: RemotePublicJwks;
  readonly #privateJwk: JWK;
  #key: Awaited<ReturnType<typeof importJWK>> | null = null;

  constructor(config: TicketSignerConfig) {
    this.#keyId = requiredIdentifier(config.keyId, "ticket key ID");
    this.#publicJwks = parseJwks(config.publicJwks, this.#keyId);
    this.#privateJwk = parseJwk(config.privateJwk);
  }

  /**
   * Every request in the isolate shares this signer, so only the resolved key is kept: the runtime
   * refuses a promise that another request made. Two requests that race import the key twice, which
   * costs one import and leaves the same key behind.
   */
  readonly #signingKey = Effect.fn("RemoteTicketSigner.signingKey")(function* (this: RemoteTicketSigner) {
    this.#key ??= yield* remoteCall(() => importJWK(this.#privateJwk, "ES256"));
    return this.#key;
  });

  publicJwks(): RemotePublicJwks {
    return this.#publicJwks;
  }

  readonly issue = Effect.fn("RemoteTicketSigner.issue")(function* (
    this: RemoteTicketSigner,
    input: {
      sessionId: string;
      hostId: string;
      userId: string;
      membershipId: string;
      role: RemoteMemberRole | "host";
      authEpoch: number;
      sessionExpiresAt: number;
      clientPublicKey?: string;
      now: number;
    },
  ) {
    const issuedAt = Math.floor(input.now / 1_000);
    const expiresAt = Math.min(issuedAt + TICKET_TTL_SECONDS, Math.floor(input.sessionExpiresAt / 1_000));
    // `aud`, `jti`, `iat` and `exp` are set by the builder below, so they are the four claims this
    // literal leaves out - the `satisfies` covers the rest against what the two verifiers read.
    const signingKey = yield* this.#signingKey();
    const ticket = yield* remoteCall(() =>
      new SignJWT({
        sessionId: input.sessionId,
        hostId: input.hostId,
        userId: input.userId,
        membershipId: input.membershipId,
        role: input.role,
        authEpoch: input.authEpoch,
        protocolMinimum: REMOTE_TICKET_PROTOCOL_VERSION,
        protocolMaximum: REMOTE_TICKET_PROTOCOL_VERSION,
        sessionExpiresAt: Math.floor(input.sessionExpiresAt / 1_000),
        ...(input.clientPublicKey ? { clientPublicKey: input.clientPublicKey } : {}),
      } satisfies Omit<RemoteTicketClaims, "aud" | "jti" | "iat" | "exp">)
        .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: this.#keyId })
        .setJti(crypto.randomUUID())
        .setIssuedAt(issuedAt)
        .setExpirationTime(expiresAt)
        .setAudience(REMOTE_TICKET_AUDIENCE)
        .sign(signingKey),
    );
    return { ticket, expiresAt: expiresAt * 1_000 };
  }).bind(this);

  /**
   * Signs the opaque webhook route IDs linked to one host with the published remote ticket key.
   * The audience and claims differ from host and member tickets, so no other deployment secret is needed.
   */
  readonly issueWebhookRoute = Effect.fn("RemoteTicketSigner.issueWebhookRoute")(function* (
    this: RemoteTicketSigner,
    input: { hostId: string; routes: WebhookRoute[]; now: number },
  ) {
    const signingKey = yield* this.#signingKey();
    const issuedAt = Math.floor(input.now / 1_000);
    return yield* remoteCall(() =>
      new SignJWT({ hid: input.hostId, routes: input.routes })
        .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: this.#keyId })
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + WEBHOOK_ROUTE_TTL_SECONDS)
        .setAudience(WEBHOOK_ROUTE_AUDIENCE)
        .sign(signingKey),
    );
  }).bind(this);
}

/**
 * Signs the route tickets that name the Slack workspaces and the Telegram chats linked to a host. It
 * uses its own key, which the public JWKS also lists, so each key can rotate on its own. Each ticket
 * kind has its own audience, so Signal cannot take one kind for the other.
 */
class RouteSigner {
  readonly #keyId: string;
  readonly #privateJwk: JWK;
  #key: Awaited<ReturnType<typeof importJWK>> | null = null;

  constructor(config: TicketSignerConfig) {
    this.#keyId = requiredIdentifier(config.keyId, "Slack route key ID");
    parseJwks(config.publicJwks, this.#keyId);
    this.#privateJwk = parseJwk(config.privateJwk);
  }

  readonly issue = Effect.fn("RouteSigner.issue")(function* (
    this: RouteSigner,
    input: { audience: string; claims: JWTPayload; ttlSeconds: number; now: number },
  ) {
    this.#key ??= yield* remoteCall(() => importJWK(this.#privateJwk, "ES256"));
    const key = this.#key;
    const issuedAt = Math.floor(input.now / 1_000);
    return yield* remoteCall(() =>
      new SignJWT(input.claims)
        .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: this.#keyId })
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + input.ttlSeconds)
        .setAudience(input.audience)
        .sign(key),
    );
  }).bind(this);
}

/** Signs the Discord route ticket that names the guilds linked to a host, with its own key. */
class DiscordRouteSigner {
  readonly #keyId: string;
  readonly #privateJwk: JWK;
  #key: Awaited<ReturnType<typeof importJWK>> | null = null;

  constructor(config: TicketSignerConfig) {
    this.#keyId = requiredIdentifier(config.keyId, "Discord route key ID");
    parseJwks(config.publicJwks, this.#keyId);
    this.#privateJwk = parseJwk(config.privateJwk);
  }

  readonly issue = Effect.fn("DiscordRouteSigner.issue")(function* (
    this: DiscordRouteSigner,
    input: { hostId: string; guilds: DiscordRouteGuild[]; now: number },
  ) {
    this.#key ??= yield* remoteCall(() => importJWK(this.#privateJwk, "ES256"));
    const key = this.#key;
    const issuedAt = Math.floor(input.now / 1_000);
    return yield* remoteCall(() =>
      new SignJWT({ hid: input.hostId, guilds: input.guilds })
        .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: this.#keyId })
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + DISCORD_ROUTE_TTL_SECONDS)
        .setAudience(DISCORD_ROUTE_AUDIENCE)
        .sign(key),
    );
  }).bind(this);
}

/** One signer for each key: the JWKS parse and the key import are too costly for every request. */
const ticketSigners = new Map<string, { config: TicketSignerConfig; signer: RemoteTicketSigner }>();

/**
 * Keyed by the key ID so the map holds one entry for each key, and checked against the material so
 * a key ID that another configuration reuses -- a test, or a rotation that keeps the name -- still
 * gets its own signer.
 */
function sharedTicketSigner(config: TicketSignerConfig): RemoteTicketSigner {
  const cached = ticketSigners.get(config.keyId);
  if (cached && cached.config.privateJwk === config.privateJwk && cached.config.publicJwks === config.publicJwks) {
    return cached.signer;
  }
  const signer = new RemoteTicketSigner(config);
  ticketSigners.set(config.keyId, { config, signer });
  return signer;
}

class RemoteDependencies extends Context.Service<
  RemoteDependencies,
  {
    database: D1Database;
    signer: RemoteTicketSigner;
    routeSigner: RouteSigner | null;
    telegram: TelegramBot | null;
    discordRouteSigner: DiscordRouteSigner | null;
    now: () => number;
    schedule: ((delivery: Effect.Effect<void, RemoteFailure>) => void) | null;
    fetch: RemoteFetch;
    webhookUrl: string | null;
    webhookSecret: string | null;
  }
>()("auth-api/RemoteControlPlane/Dependencies") {}

export class RemoteControlPlane {
  readonly #layer: Layer.Layer<RemoteDependencies>;

  readonly #database: D1Database;
  readonly #signer: RemoteTicketSigner;

  constructor(
    bindings: Pick<
      WorkerBindings,
      | "DB"
      | "REMOTE_TICKET_PRIVATE_JWK"
      | "REMOTE_TICKET_PUBLIC_JWKS"
      | "REMOTE_TICKET_KEY_ID"
      | "REMOTE_AUTH_WEBHOOK_URL"
      | "REMOTE_AUTH_WEBHOOK_SECRET"
      | "SLACK_ROUTE_PRIVATE_JWK"
      | "SLACK_ROUTE_KEY_ID"
      | "DISCORD_ROUTE_PRIVATE_JWK"
      | "DISCORD_ROUTE_KEY_ID"
      | "TELEGRAM_BOT_ID"
      | "TELEGRAM_BOT_USERNAME"
    >,
    options: {
      fetch?: RemoteFetch;
      now?: () => number;
      schedule?: (delivery: Effect.Effect<void, RemoteFailure>) => void;
    } = {},
  ) {
    if (!bindings.REMOTE_TICKET_PRIVATE_JWK || !bindings.REMOTE_TICKET_PUBLIC_JWKS || !bindings.REMOTE_TICKET_KEY_ID) {
      throw new RemoteControlPlaneError(503, "remote_not_configured", "Remote ticket signing is not configured.");
    }
    this.#database = bindings.DB;
    this.#signer = sharedTicketSigner({
      privateJwk: bindings.REMOTE_TICKET_PRIVATE_JWK,
      publicJwks: bindings.REMOTE_TICKET_PUBLIC_JWKS,
      keyId: bindings.REMOTE_TICKET_KEY_ID,
    });
    const routeSigner =
      bindings.SLACK_ROUTE_PRIVATE_JWK && bindings.SLACK_ROUTE_KEY_ID
        ? new RouteSigner({
            privateJwk: bindings.SLACK_ROUTE_PRIVATE_JWK,
            publicJwks: bindings.REMOTE_TICKET_PUBLIC_JWKS,
            keyId: bindings.SLACK_ROUTE_KEY_ID,
          })
        : null;
    const discordRouteSigner =
      bindings.DISCORD_ROUTE_PRIVATE_JWK && bindings.DISCORD_ROUTE_KEY_ID
        ? new DiscordRouteSigner({
            privateJwk: bindings.DISCORD_ROUTE_PRIVATE_JWK,
            publicJwks: bindings.REMOTE_TICKET_PUBLIC_JWKS,
            keyId: bindings.DISCORD_ROUTE_KEY_ID,
          })
        : null;
    const telegramBotId = bindings.TELEGRAM_BOT_ID?.trim();
    const telegramBotUsername = bindings.TELEGRAM_BOT_USERNAME?.trim();
    const telegram =
      telegramBotId && telegramBotUsername && TELEGRAM_BOT_ID_PATTERN.test(telegramBotId)
        ? { botId: telegramBotId, botUsername: telegramBotUsername }
        : null;
    const webhookUrl = bindings.REMOTE_AUTH_WEBHOOK_URL?.trim() || null;
    const webhookSecret = bindings.REMOTE_AUTH_WEBHOOK_SECRET?.trim() || null;
    const fetcher: RemoteFetch = options.fetch ?? ((input, init) => fetch(input, init));
    const now = options.now ?? Date.now;
    const schedule = options.schedule ?? null;
    this.#layer = Layer.succeed(RemoteDependencies, {
      database: this.#database,
      signer: this.#signer,
      routeSigner,
      discordRouteSigner,
      telegram,
      now,
      schedule,
      fetch: fetcher,
      webhookUrl,
      webhookSecret,
    });
  }

  publicJwks(): RemotePublicJwks {
    return this.#signer.publicJwks();
  }

  readonly registerHost = Effect.fn("RemoteControlPlane.registerHost")(
    function* (
      this: RemoteControlPlane,
      user: AuthUser,
      input: {
        hostId: string;
        name: string;
        ownerMembershipId: string;
        devicePublicKey?: string | null | undefined;
        rotateCredential?: boolean | undefined;
        machineToken?: string | undefined;
      },
    ) {
      const dependencies = yield* RemoteDependencies;
      const hostId = yield* remoteValidate(() => requiredIdentifier(input.hostId, "host ID"));
      const name = yield* remoteValidate(() => requiredText(input.name, 120, "host name"));
      const ownerMembershipId = yield* remoteValidate(() =>
        requiredIdentifier(input.ownerMembershipId, "owner membership ID"),
      );
      const existing = yield* this.#host(hostId);
      if (existing && existing.owner_user_id !== user.id) {
        return yield* new RemoteControlPlaneError(403, "host_owner_mismatch", "This host belongs to another account.");
      }
      yield* this.#requireHostReservation(hostId, user.id);
      const now = dependencies.now();
      const devicePublicKey = input.devicePublicKey ?? null;
      const providedMachineToken = input.machineToken;
      const providedMachineTokenHash = providedMachineToken
        ? yield* sha256(providedMachineToken).pipe(
            Effect.mapError((error) =>
              error instanceof RemoteControlPlaneError ? error : new RemoteOperationError({}),
            ),
          )
        : null;
      const rotateCredential =
        !existing?.machine_token_hash ||
        input.rotateCredential !== false ||
        existing.device_public_key !== devicePublicKey ||
        existing.machine_token_hash !== providedMachineTokenHash ||
        LEGACY_SHA256_HEX_PATTERN.test(existing.machine_token_hash ?? "");
      if (!rotateCredential && existing) {
        const metadata = yield* remoteCall(() =>
          dependencies.database.batch([
            dependencies.database
              .prepare(
                `UPDATE remote_hosts SET name = ?, device_public_key = ?, updated_at = ?
             WHERE host_id = ? AND owner_user_id = ?`,
              )
              .bind(name, devicePublicKey, now, hostId, user.id),
            dependencies.database
              .prepare(
                `INSERT INTO remote_memberships(
               membership_id, host_id, user_id, role, status, created_at, updated_at
             )
             SELECT ?, host_id, ?, 'owner', 'active', ?, ?
             FROM remote_hosts WHERE host_id = ? AND owner_user_id = ?
             ON CONFLICT(host_id, user_id) DO UPDATE SET
               role = 'owner', status = 'active', updated_at = excluded.updated_at`,
              )
              .bind(ownerMembershipId, user.id, now, now, hostId, user.id),
          ]),
        );
        if (metadata.some((result) => (result.meta.changes ?? 0) !== 1)) {
          return yield* new RemoteControlPlaneError(
            403,
            "host_owner_mismatch",
            "This host belongs to another account.",
          );
        }
        const membership = yield* this.#requireRole(hostId, user.id, ["owner"]);
        return {
          hostId,
          name,
          membershipId: membership.membership_id,
          authEpoch: existing.auth_epoch,
          machineToken: null,
        };
      }
      const machineToken = randomToken();
      const machineTokenHash = yield* sha256(machineToken).pipe(
        Effect.mapError((error) => (error instanceof RemoteControlPlaneError ? error : new RemoteOperationError({}))),
      );
      const membershipId = ownerMembershipId;
      const [, ...registration] = yield* remoteCall(() =>
        dependencies.database.batch([
          // A registration with another key is a new pairing. The stored handovers lead to a key that
          // the host no longer has, and a client that follows them could not reach the next step.
          dependencies.database
            .prepare(
              `DELETE FROM remote_host_key_handovers WHERE host_id = ? AND EXISTS(
             SELECT 1 FROM remote_hosts
             WHERE host_id = ? AND owner_user_id = ? AND device_public_key IS NOT ?
           )`,
            )
            .bind(hostId, hostId, user.id, devicePublicKey),
          dependencies.database
            .prepare(
              `INSERT INTO remote_hosts(
             host_id, owner_user_id, name, device_public_key, machine_token_hash, auth_epoch, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
           ON CONFLICT(host_id) DO UPDATE SET
             name = excluded.name,
             device_public_key = excluded.device_public_key,
             machine_token_hash = excluded.machine_token_hash,
             auth_epoch = remote_hosts.auth_epoch + 1,
             updated_at = excluded.updated_at
           WHERE remote_hosts.owner_user_id = excluded.owner_user_id`,
            )
            .bind(hostId, user.id, name, devicePublicKey, machineTokenHash, now, now),
          dependencies.database
            .prepare(
              `INSERT INTO remote_memberships(
             membership_id, host_id, user_id, role, status, created_at, updated_at
           )
           SELECT ?, host_id, ?, 'owner', 'active', ?, ?
           FROM remote_hosts WHERE host_id = ? AND owner_user_id = ?
           ON CONFLICT(host_id, user_id) DO UPDATE SET
             role = 'owner', status = 'active', updated_at = excluded.updated_at`,
            )
            .bind(membershipId, user.id, now, now, hostId, user.id),
          this.#authEpochEventStatement(hostId, now, user.id),
          // Only for a host this account did not have. Publishing an existing one again rotates its
          // credential without changing anyone's server list, and this owner's other devices would
          // re-read the account for nothing on every start of the host.
          ...(existing?.machine_token_hash
            ? []
            : [this.#authEventStatement({ type: "account-servers-changed", userId: user.id }, now)]),
        ]),
      );
      if (registration.some((result) => (result.meta.changes ?? 0) !== 1)) {
        return yield* new RemoteControlPlaneError(403, "host_owner_mismatch", "This host belongs to another account.");
      }
      yield* this.#flushAuthEvents();
      const registered = yield* this.#host(hostId);
      if (!registered || registered.owner_user_id !== user.id || registered.machine_token_hash !== machineTokenHash) {
        return yield* new RemoteControlPlaneError(
          409,
          "host_registration_superseded",
          "A newer host registration replaced this one.",
        );
      }
      const ownerMembership = yield* this.#requireRole(hostId, user.id, ["owner"]);
      return {
        hostId,
        name,
        membershipId: ownerMembership.membership_id,
        authEpoch: registered.auth_epoch,
        machineToken,
      };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * The host moves its identity to a new key. The previous key and the new key both signed the step,
   * so a client that trusts the previous key can follow it to the new key. The account service only
   * keeps and sends the steps: each client checks the signatures itself.
   *
   * The machine token and the auth epoch do not change, so paired devices stay signed in. Mobile
   * Connect links pin the previous key, so they stop. A step that does not start at the stored key
   * fails with `host_key_handover_conflict`, and the host then drops its new key.
   */
  readonly handOverHostKey = Effect.fn("RemoteControlPlane.handOverHostKey")(
    function* (
      this: RemoteControlPlane,
      user: AuthUser,
      input: { hostId: string; machineToken: string; handover: HostKeyHandover },
    ): Effect.fn.Return<{ keyHandovers: HostKeyHandover[] }, RemoteFailure, RemoteDependencies> {
      const dependencies = yield* RemoteDependencies;
      const hostId = yield* remoteValidate(() => requiredIdentifier(input.hostId, "host ID"));
      const { handover } = input;
      if (handover.hostId !== hostId || handover.publicKey === handover.previousPublicKey) {
        return yield* invalid("host key handover");
      }
      const host = yield* this.authenticateHost(hostId, input.machineToken);
      if (host.owner_user_id !== user.id) {
        return yield* new RemoteControlPlaneError(403, "host_owner_mismatch", "This host belongs to another account.");
      }
      yield* this.#requireHostReservation(hostId, user.id);
      const statement = new TextEncoder().encode(hostKeyHandoverStatement(handover));
      const signed = yield* Effect.all([
        verifyEd25519(handover.previousPublicKey, handover.previousSignature, statement),
        verifyEd25519(handover.publicKey, handover.signature, statement),
      ]);
      if (!signed.every(Boolean)) return yield* invalid("host key handover");

      if (host.device_public_key === handover.publicKey) {
        // The same request again, for example after a lost answer.
        if (yield* this.#handoverStored(handover)) return { keyHandovers: yield* this.#keyHandovers(hostId) };
        return yield* handoverConflict();
      }
      if (host.device_public_key !== handover.previousPublicKey) return yield* handoverConflict();

      const now = dependencies.now();
      const handoverId = crypto.randomUUID();
      // The step is stored only while the host still has the previous key and this machine token, and
      // only when it is later than every stored step, so the stored order is the order of the chain.
      // The other statements change data only when this request stored its step.
      const stored = `EXISTS(SELECT 1 FROM remote_host_key_handovers WHERE handover_id = ?)`;
      const [inserted, updated] = yield* remoteCall(() =>
        dependencies.database.batch([
          dependencies.database
            .prepare(
              `INSERT INTO remote_host_key_handovers(
             handover_id, host_id, issued_at, previous_public_key, public_key, previous_signature, signature, created_at
           )
           SELECT ?, host_id, ?, ?, ?, ?, ?, ?
           FROM remote_hosts
           WHERE host_id = ? AND owner_user_id = ? AND machine_token_hash = ? AND device_public_key = ?
             AND NOT EXISTS(SELECT 1 FROM remote_host_key_handovers WHERE host_id = ? AND issued_at >= ?)
           ON CONFLICT DO NOTHING`,
            )
            .bind(
              handoverId,
              handover.issuedAt,
              handover.previousPublicKey,
              handover.publicKey,
              handover.previousSignature,
              handover.signature,
              now,
              hostId,
              user.id,
              host.machine_token_hash,
              handover.previousPublicKey,
              hostId,
              handover.issuedAt,
            ),
          dependencies.database
            .prepare(
              `UPDATE remote_hosts SET device_public_key = ?, updated_at = ?
             WHERE host_id = ? AND device_public_key = ? AND ${stored}`,
            )
            .bind(handover.publicKey, now, hostId, handover.previousPublicKey, handoverId),
          // A Mobile Connect QR code names the previous key, so a phone could not use it after this step.
          dependencies.database
            .prepare(
              `UPDATE mobile_connect_links SET revoked_at = ? WHERE host_id = ? AND revoked_at IS NULL AND ${stored}`,
            )
            .bind(now, hostId, handoverId),
          dependencies.database
            .prepare(
              `DELETE FROM remote_host_key_handovers
             WHERE host_id = ? AND handover_id NOT IN (
               SELECT handover_id FROM remote_host_key_handovers WHERE host_id = ?
               ORDER BY issued_at DESC LIMIT ?
             )`,
            )
            .bind(hostId, hostId, HOST_KEY_HANDOVER_LIMIT),
        ]),
      );
      if (inserted?.meta.changes !== 1 || updated?.meta.changes !== 1) {
        // A concurrent request can store the same step first.
        const current = yield* this.#host(hostId);
        if (current?.device_public_key === handover.publicKey && (yield* this.#handoverStored(handover))) {
          return { keyHandovers: yield* this.#keyHandovers(hostId) };
        }
        return yield* handoverConflict();
      }
      return { keyHandovers: yield* this.#keyHandovers(hostId) };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly listHosts = Effect.fn("RemoteControlPlane.listHosts")(
    function* (this: RemoteControlPlane, userId: string) {
      const dependencies = yield* RemoteDependencies;
      const result = yield* remoteCall(() =>
        dependencies.database
          .prepare(
            `SELECT h.host_id, h.name, h.logo_key, h.device_public_key, h.auth_epoch, m.membership_id, m.role,
           EXISTS(SELECT 1 FROM hosted_servers s WHERE s.server_id = h.host_id
             AND s.desired_state NOT IN ('deleted', 'stopped')) AS hosted
         FROM remote_memberships m
         JOIN remote_hosts h ON h.host_id = m.host_id
         WHERE m.user_id = ? AND m.status = 'active'
         ORDER BY h.name, h.host_id`,
          )
          .bind(userId)
          .all<{
            host_id: string;
            name: string;
            logo_key: string | null;
            device_public_key: string | null;
            auth_epoch: number;
            membership_id: string;
            role: RemoteMemberRole;
            hosted: number;
          }>(),
      );
      const keyHandovers = yield* this.#keyHandoversByHost({
        sql: "host_id IN (SELECT host_id FROM remote_memberships WHERE user_id = ? AND status = 'active')",
        binds: [userId],
      });
      return yield* Effect.forEach(
        result.results ?? [],
        (row) =>
          Effect.gen({ self: this }, function* () {
            const license = yield* this.#ownerLicense(row.host_id);
            const { limit } = yield* this.#memberLimit(row.host_id, license);
            return {
              hostId: row.host_id,
              name: row.name,
              logoKey: row.logo_key,
              devicePublicKey: row.device_public_key,
              keyHandovers: keyHandovers.get(row.host_id) ?? [],
              authEpoch: row.auth_epoch,
              membershipId: row.membership_id,
              role: row.role,
              // The license counts the people of all the owner's servers, and any open license refuses a
              // join after its users. So no server takes more people than the license has users.
              memberLimit: license ? Math.min(limit, license.users) : limit,
              // A server with an ended plan is not marked: a restart needs a new plan, which only the owner buys.
              hosted: row.hosted === 1,
            };
          }),
        { concurrency: "unbounded" },
      );
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly createInvite = Effect.fn("RemoteControlPlane.createInvite")(
    function* (
      this: RemoteControlPlane,
      user: AuthUser,
      input: {
        hostId: string;
        role: Exclude<RemoteMemberRole, "owner">;
        email?: string | null | undefined;
        expiresInSeconds?: number | undefined;
        permanent?: boolean | undefined;
      },
    ) {
      const dependencies = yield* RemoteDependencies;
      yield* this.#requireRole(input.hostId, user.id, ["owner", "admin"]);
      if (input.role !== "admin" && input.role !== "member") return yield* invalid("invite role");
      const permanent = input.permanent ?? false;
      // A permanent link is a shareable URL, never an addressed message: binding it to an
      // email would promise a restriction the token cannot enforce.
      if (permanent && input.email?.trim()) return yield* invalid("permanent invite email");
      if (permanent && input.expiresInSeconds !== undefined) return yield* invalid("permanent invite lifetime");
      const now = dependencies.now();
      const ttl = input.expiresInSeconds ?? 7 * 24 * 60 * 60;
      if (!permanent && (!Number.isSafeInteger(ttl) || ttl < 300 || ttl > 30 * 24 * 60 * 60)) {
        return yield* invalid("invite lifetime");
      }
      const email = input.email?.trim().toLowerCase() || null;
      const inviteId = crypto.randomUUID();
      const token = randomToken();
      const tokenHash = yield* sha256(token).pipe(
        Effect.mapError((error) => (error instanceof RemoteControlPlaneError ? error : new RemoteOperationError({}))),
      );
      const expiresAt = permanent ? PERSISTENT_SESSION_EXPIRES_AT : now + ttl * 1_000;
      if (permanent) {
        // The count and the insert are one statement: two concurrent requests cannot both
        // read below the cap and then both insert.
        const created = yield* remoteCall(() =>
          dependencies.database
            .prepare(
              `INSERT INTO remote_invites(
             invite_id, host_id, token_hash, email, role, created_by_user_id, expires_at, created_at,
             max_uses, use_count
           )
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0
           WHERE (
             SELECT COUNT(*) FROM remote_invites
             WHERE host_id = ? AND max_uses IS NULL AND revoked_at IS NULL
           ) < ?`,
            )
            .bind(
              inviteId,
              input.hostId,
              tokenHash,
              email,
              input.role,
              user.id,
              expiresAt,
              now,
              input.hostId,
              MAX_PERMANENT_INVITES_PER_HOST,
            )
            .run(),
        );
        if ((created.meta.changes ?? 0) !== 1) {
          return yield* new RemoteControlPlaneError(
            429,
            "invite_limit_reached",
            "Revoke a permanent invitation link before creating another one.",
          );
        }
        return { inviteId, token, expiresAt, permanent, useCount: 0 };
      }
      // One statement, as for a permanent link.
      const created = yield* remoteCall(() =>
        dependencies.database
          .prepare(
            `INSERT INTO remote_invites(
           invite_id, host_id, token_hash, email, role, created_by_user_id, expires_at, created_at,
           max_uses, use_count
         )
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, 1, 0
         WHERE (
           SELECT COUNT(*) FROM remote_invites
           WHERE host_id = ? AND max_uses IS NOT NULL
             AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?
         ) < ?`,
          )
          .bind(
            inviteId,
            input.hostId,
            tokenHash,
            email,
            input.role,
            user.id,
            expiresAt,
            now,
            input.hostId,
            now,
            MAX_OUTSTANDING_INVITES_PER_HOST,
          )
          .run(),
      );
      if ((created.meta.changes ?? 0) !== 1) {
        return yield* new RemoteControlPlaneError(
          429,
          "invite_limit_reached",
          "Revoke or use an active invitation before creating another one.",
        );
      }
      return { inviteId, token, expiresAt, permanent, useCount: 0 };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly listInvites = Effect.fn("RemoteControlPlane.listInvites")(
    function* (this: RemoteControlPlane, userId: string, hostId: string) {
      const dependencies = yield* RemoteDependencies;
      yield* this.#requireRole(hostId, userId, ["owner", "admin"]);
      const result = yield* remoteCall(() =>
        dependencies.database
          .prepare(
            `SELECT invite_id, email, role, expires_at, used_at, revoked_at, max_uses, use_count
         FROM remote_invites WHERE host_id = ? ORDER BY created_at DESC`,
          )
          .bind(hostId)
          .all<{
            invite_id: string;
            email: string | null;
            role: "admin" | "member";
            expires_at: number;
            used_at: number | null;
            revoked_at: number | null;
            max_uses: number | null;
            use_count: number;
          }>(),
      );
      return (result.results ?? []).map((invite) => {
        // A permanent link stays listed after joins; a Worker from the deploy gap may have
        // stamped used_at on one, which carries no meaning here.
        const permanent = invite.max_uses === null;
        return {
          inviteId: invite.invite_id,
          email: invite.email,
          role: invite.role,
          expiresAt: invite.expires_at,
          usedAt: permanent ? null : invite.used_at,
          revokedAt: invite.revoked_at,
          permanent,
          useCount: invite.use_count ?? 0,
        };
      });
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly listMembers = Effect.fn("RemoteControlPlane.listMembers")(
    function* (this: RemoteControlPlane, userId: string, hostId: string) {
      const dependencies = yield* RemoteDependencies;
      yield* this.#requireRole(hostId, userId, ["owner", "admin", "member"]);
      const result = yield* remoteCall(() =>
        dependencies.database
          .prepare(
            `SELECT m.membership_id, m.role, m.status, m.created_at,
                u.email, u.name, u.avatar_url
         FROM remote_memberships m
         JOIN users u ON u.id = m.user_id
         WHERE m.host_id = ?
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.created_at`,
          )
          .bind(hostId)
          .all<{
            membership_id: string;
            role: RemoteMemberRole;
            status: "active" | "revoked";
            created_at: number;
            email: string;
            name: string | null;
            avatar_url: string | null;
          }>(),
      );
      return (result.results ?? []).map((member) => ({
        membershipId: member.membership_id,
        role: member.role,
        status: member.status,
        createdAt: member.created_at,
        email: member.email,
        name: member.name,
        avatarUrl: member.avatar_url,
      }));
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly hostAsset = Effect.fn("RemoteControlPlane.hostAsset")(
    function* (
      this: RemoteControlPlane,
      userId: string,
      hostId: string,
    ): Effect.fn.Return<{ logoKey: string | null }, RemoteFailure, RemoteDependencies> {
      yield* this.#requireRole(hostId, userId, ["owner", "admin", "member"]);
      const host = yield* this.#host(hostId);
      if (!host) return yield* new RemoteControlPlaneError(404, "host_not_found", "The remote host does not exist.");
      return { logoKey: host.logo_key };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly assertHostOwner = Effect.fn("RemoteControlPlane.assertHostOwner")(
    function* (
      this: RemoteControlPlane,
      userId: string,
      hostId: string,
    ): Effect.fn.Return<void, RemoteFailure, RemoteDependencies> {
      yield* this.#requireRole(hostId, userId, ["owner"]);
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly setHostLogo = Effect.fn("RemoteControlPlane.setHostLogo")(
    function* (
      this: RemoteControlPlane,
      userId: string,
      hostId: string,
      logoKey: string | null,
    ): Effect.fn.Return<string | null, RemoteFailure, RemoteDependencies> {
      const dependencies = yield* RemoteDependencies;
      yield* this.#requireRole(hostId, userId, ["owner"]);
      const host = yield* this.#host(hostId);
      if (!host) return yield* new RemoteControlPlaneError(404, "host_not_found", "The remote host does not exist.");
      yield* remoteCall(() =>
        dependencies.database
          .prepare("UPDATE remote_hosts SET logo_key = ?, updated_at = ? WHERE host_id = ?")
          .bind(logoKey, dependencies.now(), hostId)
          .run(),
      );
      return host.logo_key;
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly previewInvite = Effect.fn("RemoteControlPlane.previewInvite")(
    function* (this: RemoteControlPlane, token: string) {
      const dependencies = yield* RemoteDependencies;
      const validToken = yield* remoteValidate(() => requiredText(token, 512, "invite token"));
      const tokenHash = yield* sha256(validToken).pipe(
        Effect.mapError((error) => (error instanceof RemoteControlPlaneError ? error : new RemoteOperationError({}))),
      );
      const now = dependencies.now();
      const invite = yield* remoteCall(() =>
        dependencies.database
          .prepare(
            `SELECT i.invite_id, i.host_id, i.email, i.role, i.expires_at, i.used_at, i.revoked_at,
                i.max_uses, i.use_count, h.name, h.device_public_key
         FROM remote_invites i JOIN remote_hosts h ON h.host_id = i.host_id
         WHERE i.token_hash = ? LIMIT 1`,
          )
          .bind(tokenHash)
          .first<RemoteInviteRow & { name: string; device_public_key: string | null }>(),
      );
      if (!invite || invite.revoked_at || invite.expires_at <= now || (invite.used_at && invite.max_uses !== null)) {
        return yield* new RemoteControlPlaneError(404, "invite_invalid", "The invitation is invalid or expired.");
      }
      return {
        inviteId: invite.invite_id,
        hostId: invite.host_id,
        hostName: invite.name,
        role: invite.role,
        expiresAt: invite.expires_at,
        emailBound: Boolean(invite.email),
        permanent: invite.max_uses === null,
        devicePublicKey: invite.device_public_key,
        // The invitation names the key that the host had when it made the invitation.
        keyHandovers: yield* this.#keyHandovers(invite.host_id),
      };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * The host name for an invitation email. The caller must be an owner or admin of the host, and
   * the token must identify an open single-use invitation of that host for this email and role.
   */
  readonly emailableInvite = Effect.fn("RemoteControlPlane.emailableInvite")(
    function* (
      this: RemoteControlPlane,
      userId: string,
      input: { hostId: string; token: string; email: string; role: Exclude<RemoteMemberRole, "owner"> },
    ) {
      const dependencies = yield* RemoteDependencies;
      yield* this.#requireRole(input.hostId, userId, ["owner", "admin"]);
      const validToken = yield* remoteValidate(() => requiredText(input.token, 512, "invite token"));
      const tokenHash = yield* sha256(validToken).pipe(
        Effect.mapError((error) => (error instanceof RemoteControlPlaneError ? error : new RemoteOperationError({}))),
      );
      const invite = yield* remoteCall(() =>
        dependencies.database
          .prepare(
            `SELECT i.invite_id, i.host_id, i.email, i.role, i.expires_at, i.used_at, i.revoked_at,
                i.max_uses, i.use_count, h.name
         FROM remote_invites i JOIN remote_hosts h ON h.host_id = i.host_id
         WHERE i.token_hash = ? AND i.host_id = ? LIMIT 1`,
          )
          .bind(tokenHash, input.hostId)
          .first<RemoteInviteRow & { name: string }>(),
      );
      if (
        !invite ||
        invite.revoked_at ||
        invite.expires_at <= dependencies.now() ||
        invite.used_at ||
        invite.max_uses === null ||
        invite.email !== input.email ||
        invite.role !== input.role
      ) {
        return yield* new RemoteControlPlaneError(404, "invite_invalid", "The invitation is invalid or expired.");
      }
      return { hostName: invite.name };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly acceptInvite = Effect.fn("RemoteControlPlane.acceptInvite")(
    function* (this: RemoteControlPlane, user: AuthUser, token: string) {
      const dependencies = yield* RemoteDependencies;
      const now = dependencies.now();
      const validToken = yield* remoteValidate(() => requiredText(token, 512, "invite token"));
      const tokenHash = yield* sha256(validToken).pipe(
        Effect.mapError((error) => (error instanceof RemoteControlPlaneError ? error : new RemoteOperationError({}))),
      );
      const invite = yield* remoteCall(() =>
        dependencies.database
          .prepare(
            `SELECT invite_id, host_id, email, role, expires_at, used_at, revoked_at, max_uses, use_count
         FROM remote_invites WHERE token_hash = ? LIMIT 1`,
          )
          .bind(tokenHash)
          .first<RemoteInviteRow>(),
      );
      const permanent = invite?.max_uses === null;
      if (!invite || invite.revoked_at || invite.expires_at <= now || (!permanent && invite.used_at)) {
        return yield* new RemoteControlPlaneError(404, "invite_invalid", "The invitation is invalid or expired.");
      }
      if (invite.email && invite.email !== user.email.trim().toLowerCase()) {
        return yield* new RemoteControlPlaneError(
          403,
          "invite_email_mismatch",
          "The invitation is for another account.",
        );
      }
      const existingMembership = yield* remoteCall(() =>
        dependencies.database
          .prepare(
            "SELECT membership_id, role, status FROM remote_memberships WHERE host_id = ? AND user_id = ? LIMIT 1",
          )
          .bind(invite.host_id, user.id)
          .first<Pick<RemoteMembershipRow, "membership_id" | "role" | "status">>(),
      );
      if (existingMembership?.role === "owner") {
        return yield* new RemoteControlPlaneError(
          409,
          "owner_membership_protected",
          "The owner cannot accept a member invitation.",
        );
      }
      const granted = yield* remoteCall(() =>
        dependencies.database
          .prepare(`SELECT 1 AS granted FROM remote_invites WHERE invite_id = ? AND ${INVITE_STILL_GRANTED_SQL}`)
          .bind(invite.invite_id, user.id)
          .first<{ granted: number }>(),
      );
      if (!granted) {
        return yield* new RemoteControlPlaneError(404, "invite_invalid", "The invitation is invalid or expired.");
      }
      // A member who opens a link again keeps their role and their sessions, and the invitation stays
      // as it was. A change of role goes through `changeMembership`, which also ends the old sessions.
      if (existingMembership?.status === "active") {
        return {
          hostId: invite.host_id,
          membershipId: existingMembership.membership_id,
          role: existingMembership.role,
        };
      }
      const memberSeat = yield* this.#memberSeat(invite.host_id, user.id);
      yield* this.#requireMemberSeat(memberSeat);
      const membershipId = crypto.randomUUID();
      const seat = memberSeat.binds;
      // The writes after the membership apply only when this accept made it: a new row, or the revoked
      // row that it brought back. An accept that a concurrent one beat leaves the invitation as it was.
      const joinedId = existingMembership?.membership_id ?? membershipId;
      const joinedNow = [invite.host_id, user.id, joinedId, now] as const;
      const accepted = yield* remoteCall(() =>
        dependencies.database.batch([
          dependencies.database
            .prepare(
              permanent
                ? `INSERT INTO remote_memberships(
                 membership_id, host_id, user_id, role, status, created_at, updated_at
               ) SELECT ?, ?, ?, ?, 'active', ?, ?
                 FROM remote_invites
                WHERE invite_id = ? AND revoked_at IS NULL AND expires_at > ? AND ${memberSeat.sql}
                  AND ${INVITE_STILL_GRANTED_SQL}
               ON CONFLICT(host_id, user_id) DO UPDATE SET
                 role = excluded.role, status = 'active', updated_at = excluded.updated_at, removed_at = NULL
                WHERE remote_memberships.status = 'revoked' AND remote_memberships.role <> 'owner'`
                : `INSERT INTO remote_memberships(
                 membership_id, host_id, user_id, role, status, created_at, updated_at
               ) SELECT ?, ?, ?, ?, 'active', ?, ?
                 FROM remote_invites
                WHERE invite_id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?
                  AND ${memberSeat.sql} AND ${INVITE_STILL_GRANTED_SQL}
               ON CONFLICT(host_id, user_id) DO UPDATE SET
                 role = excluded.role, status = 'active', updated_at = excluded.updated_at, removed_at = NULL
                WHERE remote_memberships.status = 'revoked' AND remote_memberships.role <> 'owner'`,
            )
            .bind(
              membershipId,
              invite.host_id,
              user.id,
              invite.role,
              now,
              now,
              invite.invite_id,
              now,
              ...seat,
              user.id,
            ),
          // A permanent link counts the join and stays live; a single-use link burns. A join that
          // lost the last seat to a concurrent one leaves the invitation as it was.
          permanent
            ? dependencies.database
                .prepare(
                  `UPDATE remote_invites SET use_count = use_count + 1
                WHERE invite_id = ? AND revoked_at IS NULL AND expires_at > ? AND ${memberSeat.sql}
                  AND ${INVITE_STILL_GRANTED_SQL} AND ${JOINED_NOW_SQL}`,
                )
                .bind(invite.invite_id, now, ...seat, user.id, ...joinedNow)
            : dependencies.database
                .prepare(
                  `UPDATE remote_invites SET used_at = ?
                WHERE invite_id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?
                  AND ${memberSeat.sql} AND ${INVITE_STILL_GRANTED_SQL} AND ${JOINED_NOW_SQL}`,
                )
                .bind(now, invite.invite_id, now, ...seat, user.id, ...joinedNow),
          dependencies.database
            .prepare(
              `UPDATE remote_sessions SET ended_at = ? WHERE host_id = ? AND user_id = ? AND ended_at IS NULL
                AND ${JOINED_NOW_SQL}`,
            )
            .bind(now, invite.host_id, user.id, ...joinedNow),
          this.#authEventStatement({ type: "account-servers-changed", userId: user.id }, now),
        ]),
      );
      if ((accepted[0]?.meta.changes ?? 0) !== 1 || (accepted[1]?.meta.changes ?? 0) !== 1) {
        // A concurrent accept or reactivation made this user a member first.
        const concurrent = yield* remoteCall(() =>
          dependencies.database
            .prepare(
              "SELECT membership_id, role FROM remote_memberships WHERE host_id = ? AND user_id = ? AND status = 'active' LIMIT 1",
            )
            .bind(invite.host_id, user.id)
            .first<Pick<RemoteMembershipRow, "membership_id" | "role">>(),
        );
        if ((accepted[0]?.meta.changes ?? 0) === 0 && concurrent && concurrent.role !== "owner") {
          return { hostId: invite.host_id, membershipId: concurrent.membership_id, role: concurrent.role };
        }
        yield* this.#requireMemberSeat(memberSeat);
        return yield* new RemoteControlPlaneError(409, "invite_already_used", "The invitation was already used.");
      }
      const membership = yield* remoteCall(() =>
        dependencies.database
          .prepare(
            "SELECT membership_id, role FROM remote_memberships WHERE host_id = ? AND user_id = ? AND status = 'active' LIMIT 1",
          )
          .bind(invite.host_id, user.id)
          .first<Pick<RemoteMembershipRow, "membership_id" | "role">>(),
      );
      if (!membership) {
        return yield* new RemoteControlPlaneError(
          500,
          "membership_missing",
          "The accepted membership could not be loaded.",
        );
      }
      yield* this.#flushAuthEvents();
      return { hostId: invite.host_id, membershipId: membership.membership_id, role: membership.role };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly revokeInvite = Effect.fn("RemoteControlPlane.revokeInvite")(
    function* (
      this: RemoteControlPlane,
      userId: string,
      inviteId: string,
    ): Effect.fn.Return<void, RemoteFailure, RemoteDependencies> {
      const dependencies = yield* RemoteDependencies;
      const invite = yield* remoteCall(() =>
        dependencies.database
          .prepare("SELECT host_id FROM remote_invites WHERE invite_id = ? LIMIT 1")
          .bind(inviteId)
          .first<{ host_id: string }>(),
      );
      if (!invite) return yield* new RemoteControlPlaneError(404, "invite_not_found", "The invitation does not exist.");
      yield* this.#requireRole(invite.host_id, userId, ["owner", "admin"]);
      // The `max_uses IS NULL` arm covers a permanent link a pre-permanent Worker stamped
      // used_at on during the migration/deploy gap; its joins never meant "consumed".
      yield* remoteCall(() =>
        dependencies.database
          .prepare(
            "UPDATE remote_invites SET revoked_at = ? WHERE invite_id = ? AND (used_at IS NULL OR max_uses IS NULL)",
          )
          .bind(dependencies.now(), inviteId)
          .run(),
      );
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly changeMembership = Effect.fn("RemoteControlPlane.changeMembership")(
    function* (
      this: RemoteControlPlane,
      actorUserId: string,
      input: {
        hostId: string;
        membershipId: string;
        role?: Exclude<RemoteMemberRole, "owner">;
        revoke?: boolean;
        reactivate?: boolean;
      },
    ): Effect.fn.Return<void, RemoteFailure, RemoteDependencies> {
      const dependencies = yield* RemoteDependencies;
      const membership = yield* remoteCall(() =>
        dependencies.database
          .prepare(
            "SELECT membership_id, host_id, user_id, role, status FROM remote_memberships WHERE membership_id = ?",
          )
          .bind(input.membershipId)
          .first<RemoteMembershipRow>(),
      );
      if (!membership || membership.host_id !== input.hostId) {
        return yield* new RemoteControlPlaneError(404, "membership_not_found", "The membership does not exist.");
      }
      const leavingOwnMembership = input.revoke === true && membership.user_id === actorUserId;
      if (!leavingOwnMembership) yield* this.#requireRole(input.hostId, actorUserId, ["owner", "admin"]);
      if (membership.role === "owner") {
        return yield* new RemoteControlPlaneError(
          409,
          "owner_membership_protected",
          "The owner membership cannot be changed.",
        );
      }
      const role = input.role ?? membership.role;
      if (role !== "admin" && role !== "member") return yield* invalid("member role");
      if (input.revoke && input.reactivate) return yield* invalid("member status");
      // A role change keeps an active member active, so it needs the seat as a reactivation does.
      const activating = !input.revoke && (input.reactivate === true || membership.status === "active");
      const memberSeat = yield* this.#memberSeat(input.hostId, membership.user_id);
      if (activating && membership.status !== "active") yield* this.#requireMemberSeat(memberSeat);
      const removedAt = removedAtAfterChange({
        revoke: input.revoke === true,
        leave: leavingOwnMembership,
        activating,
      });
      const now = dependencies.now();
      // The writes after the membership apply only when it took its seat. A refused UPDATE leaves the
      // membership as it was, so the member keeps their sessions and invitations.
      const applied = activating
        ? {
            sql: "EXISTS(SELECT 1 FROM remote_memberships WHERE membership_id = ? AND status = 'active')",
            binds: [input.membershipId],
          }
        : undefined;
      // An admin who leaves, is removed or is demoted can no longer invite, so their open invitations
      // close. Then they leave the invitation limits and the list.
      const closingInvites = membership.role === "admin" && (input.revoke === true || role !== "admin");
      // Only a removal or a leave bumps the host's auth epoch. A new epoch makes Signal drop the host
      // and every connected member. A role change or reactivation ends this member's sessions below.
      const revokingAccess = input.revoke === true;
      const changed = yield* remoteCall(() =>
        dependencies.database.batch([
          dependencies.database
            .prepare(
              `UPDATE remote_memberships SET role = ?, status = ?, updated_at = ?, removed_at = ${removedAt}
            WHERE membership_id = ?${activating ? ` AND ${memberSeat.sql}` : ""}`,
            )
            .bind(
              role,
              input.revoke ? "revoked" : activating ? "active" : membership.status,
              now,
              ...(removedAt.includes("?") ? [now] : []),
              input.membershipId,
              ...(activating ? memberSeat.binds : []),
            ),
          ...(closingInvites
            ? [
                dependencies.database
                  .prepare(
                    `UPDATE remote_invites SET revoked_at = ?
                  WHERE host_id = ? AND created_by_user_id = ? AND revoked_at IS NULL
                    AND (used_at IS NULL OR max_uses IS NULL)${applied ? ` AND ${applied.sql}` : ""}`,
                  )
                  .bind(now, input.hostId, membership.user_id, ...(applied?.binds ?? [])),
              ]
            : []),
          ...(revokingAccess
            ? [
                dependencies.database
                  .prepare("UPDATE remote_hosts SET auth_epoch = auth_epoch + 1, updated_at = ? WHERE host_id = ?")
                  .bind(now, input.hostId),
              ]
            : []),
          // The events come from the same batch as the UPDATE below, so a session that opened during
          // this change also ends on Signal. With no epoch bump, nothing else would drop it.
          dependencies.database
            .prepare(
              `INSERT INTO remote_auth_events(event_id, payload, created_at, attempts, next_attempt_at)
            SELECT lower(hex(randomblob(16))),
                   json_object('type', 'remote-session-ended', 'hostId', host_id, 'sessionId', session_id),
                   ?, 0, ?
              FROM remote_sessions
             WHERE host_id = ? AND user_id = ? AND ended_at IS NULL${applied ? ` AND ${applied.sql}` : ""}`,
            )
            .bind(now, now, input.hostId, membership.user_id, ...(applied?.binds ?? [])),
          dependencies.database
            .prepare(
              `UPDATE remote_sessions SET ended_at = ?
            WHERE host_id = ? AND user_id = ? AND ended_at IS NULL${applied ? ` AND ${applied.sql}` : ""}`,
            )
            .bind(now, input.hostId, membership.user_id, ...(applied?.binds ?? [])),
          ...(revokingAccess ? [this.#authEpochEventStatement(input.hostId, now)] : []),
          // The member whose membership this is, and not the owner who changed it: a revoked server
          // has to leave that member's list on every device they are signed in on.
          this.#authEventStatement({ type: "account-servers-changed", userId: membership.user_id }, now, applied),
        ]),
      );
      yield* this.#flushAuthEvents();
      // A concurrent join, reactivation or revoke took the seat after the check above.
      if (activating && (changed[0]?.meta.changes ?? 0) !== 1) {
        yield* this.#requireMemberSeat(memberSeat);
        return yield* memberLimitReached(memberSeat.limit);
      }
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly validateMobileConnectHost = Effect.fn("RemoteControlPlane.validateMobileConnectHost")(
    function* (
      this: RemoteControlPlane,
      userId: string,
      binding: MobileConnectHostBinding,
    ): Effect.fn.Return<void, RemoteFailure, RemoteDependencies> {
      const host = yield* this.#host(binding.hostId);
      const devicePublicKey = host?.device_public_key;
      if (
        !host ||
        host.owner_user_id !== userId ||
        !devicePublicKey ||
        (yield* sha256(devicePublicKey).pipe(
          Effect.mapError((error) => (error instanceof RemoteControlPlaneError ? error : new RemoteOperationError({}))),
        )) !== binding.fingerprint
      ) {
        return yield* new RemoteControlPlaneError(
          409,
          "mobile_host_mismatch",
          "The Mobile Connect host identity does not match.",
        );
      }
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly startSession = Effect.fn("RemoteControlPlane.startSession")(
    function* (this: RemoteControlPlane, userId: string, hostId: string, authSessionHash: string) {
      const dependencies = yield* RemoteDependencies;
      const now = dependencies.now();
      // The role check and the reusable session are one row, so the common answer costs one read.
      const membership = yield* Effect.gen({ self: this }, function* () {
        const roleArgument0 = yield* remoteCall(() =>
          dependencies.database
            .prepare(
              `SELECT m.membership_id, m.host_id, m.user_id, m.role, m.status,
                  s.session_id AS active_session_id, s.expires_at AS active_expires_at
           FROM remote_memberships m
           LEFT JOIN remote_sessions s
             ON s.host_id = m.host_id AND s.user_id = m.user_id AND s.membership_id = m.membership_id
            AND s.ended_at IS NULL AND s.expires_at > ? AND s.auth_session_hash = ?
            AND EXISTS(
              SELECT 1 FROM auth_sessions
               WHERE token_hash = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?
            )
           WHERE m.host_id = ? AND m.user_id = ? AND m.status = 'active'
           ORDER BY s.started_at DESC LIMIT 1`,
            )
            .bind(now, authSessionHash, authSessionHash, userId, now, hostId, userId)
            .first<RemoteMembershipRow & { active_session_id: string | null; active_expires_at: number | null }>(),
        );
        const roleArgument1: RemoteMemberRole[] = ["owner", "admin", "member"];
        return yield* remoteValidate(() => this.#assertRole(roleArgument0, roleArgument1));
      });
      if (membership.active_session_id !== null && membership.active_expires_at !== null) {
        return { sessionId: membership.active_session_id, hostId, expiresAt: membership.active_expires_at };
      }
      const sessionId = crypto.randomUUID();
      // Deliberate product policy: device sessions do not expire with time. Logout
      // or explicit revocation ends only this credential's sessions, not other phones.
      const expiresAt = PERSISTENT_SESSION_EXPIRES_AT;
      // The sweep frees the one-active-session slot, so it has to run before the insert.
      const [, insert] = yield* remoteCall(() =>
        dependencies.database.batch([
          dependencies.database
            .prepare(
              "UPDATE remote_sessions SET ended_at = ? WHERE host_id = ? AND user_id = ? AND ended_at IS NULL AND expires_at <= ?",
            )
            .bind(now, hostId, userId, now),
          dependencies.database
            .prepare(
              `INSERT OR IGNORE INTO remote_sessions(session_id, host_id, user_id, membership_id, started_at, expires_at, auth_session_hash)
           SELECT ?, ?, ?, ?, ?, ?, ?
            WHERE EXISTS(
              SELECT 1 FROM auth_sessions
               WHERE token_hash = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?
            )`,
            )
            .bind(
              sessionId,
              hostId,
              userId,
              membership.membership_id,
              now,
              expiresAt,
              authSessionHash,
              authSessionHash,
              userId,
              now,
            ),
        ]),
      );
      // The insert carries the same live-account-session guard as the read below, so one written row
      // already proves the session may start. Only a row the insert ignored needs the read.
      if (insert?.meta.changes === 1) return { sessionId, hostId, expiresAt };
      const active = yield* remoteCall(() =>
        dependencies.database
          .prepare(
            `SELECT session_id, expires_at FROM remote_sessions
         WHERE host_id = ? AND user_id = ? AND ended_at IS NULL AND expires_at > ?
           AND auth_session_hash = ?
           AND EXISTS(
             SELECT 1 FROM auth_sessions
              WHERE token_hash = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?
           )
         ORDER BY started_at DESC LIMIT 1`,
          )
          .bind(hostId, userId, now, authSessionHash, authSessionHash, userId, now)
          .first<{ session_id: string; expires_at: number }>(),
      );
      if (!active)
        return yield* new RemoteControlPlaneError(401, "auth_session_revoked", "The account session has ended.");
      return { sessionId: active.session_id, hostId, expiresAt: active.expires_at };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly endSession = Effect.fn("RemoteControlPlane.endSession")(
    function* (
      this: RemoteControlPlane,
      userId: string,
      sessionId: string,
      authSessionHash?: string,
    ): Effect.fn.Return<void, RemoteFailure, RemoteDependencies> {
      const dependencies = yield* RemoteDependencies;
      const session = yield* remoteCall(() =>
        dependencies.database
          .prepare(
            "SELECT host_id, user_id, auth_session_hash FROM remote_sessions WHERE session_id = ? AND ended_at IS NULL LIMIT 1",
          )
          .bind(sessionId)
          .first<{ host_id: string; user_id: string; auth_session_hash: string | null }>(),
      );
      if (!session) return;
      if (
        authSessionHash !== undefined &&
        (session.user_id !== userId || session.auth_session_hash !== authSessionHash)
      )
        return yield* new RemoteControlPlaneError(
          403,
          "session_inactive",
          "The remote session does not belong to this browser session.",
        );
      if (session.user_id !== userId) {
        const actor = yield* this.#requireRole(session.host_id, userId, ["owner", "admin"]);
        // Admins manage members, not the owner: only the owner ends the owner's sessions.
        const target =
          actor.role === "owner"
            ? null
            : yield* remoteCall(() =>
                dependencies.database
                  .prepare("SELECT role FROM remote_memberships WHERE host_id = ? AND user_id = ? LIMIT 1")
                  .bind(session.host_id, session.user_id)
                  .first<{ role: string }>(),
              );
        if (target?.role === "owner") {
          return yield* new RemoteControlPlaneError(
            409,
            "owner_membership_protected",
            "The owner membership cannot be changed.",
          );
        }
      }
      const now = dependencies.now();
      const event = { type: "remote-session-ended" as const, hostId: session.host_id, sessionId };
      yield* remoteCall(() =>
        dependencies.database.batch([
          dependencies.database
            .prepare("UPDATE remote_sessions SET ended_at = ? WHERE session_id = ? AND ended_at IS NULL")
            .bind(now, sessionId),
          this.#authEventStatement(event, now),
        ]),
      );
      yield* this.#flushAuthEvents();
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly endUserSessions = Effect.fn("RemoteControlPlane.endUserSessions")(
    function* (this: RemoteControlPlane, userId: string): Effect.fn.Return<void, RemoteFailure, RemoteDependencies> {
      const dependencies = yield* RemoteDependencies;
      const now = dependencies.now();
      yield* remoteCall(() =>
        dependencies.database.batch([
          dependencies.database
            .prepare(
              `INSERT INTO remote_auth_events(event_id, payload, created_at, attempts, next_attempt_at)
           SELECT lower(hex(randomblob(16))),
                  json_object('type', 'remote-session-ended', 'hostId', host_id, 'sessionId', session_id),
                  ?, 0, ?
             FROM remote_sessions
            WHERE user_id = ? AND ended_at IS NULL`,
            )
            .bind(now, now, userId),
          dependencies.database
            .prepare("UPDATE remote_sessions SET ended_at = ? WHERE user_id = ? AND ended_at IS NULL")
            .bind(now, userId),
        ]),
      );
      yield* this.#flushAuthEvents();
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly endAccountSession = Effect.fn("RemoteControlPlane.endAccountSession")(
    function* (
      this: RemoteControlPlane,
      userId: string,
      authSessionHash: string,
    ): Effect.fn.Return<void, RemoteFailure, RemoteDependencies> {
      const dependencies = yield* RemoteDependencies;
      const now = dependencies.now();
      // The database trigger revokes the bound remote sessions and writes the
      // disconnect outbox atomically with logout, including concurrent starts.
      // RETURNING, not meta.changes: D1 also counts the rows that the trigger changes.
      const revoked = yield* remoteCall(() =>
        dependencies.database
          .prepare(
            "UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND user_id = ? AND revoked_at IS NULL RETURNING token_hash",
          )
          .bind(now, authSessionHash, userId)
          .first<{ token_hash: string }>(),
      );
      if (!revoked) {
        return yield* new RemoteControlPlaneError(401, "auth_session_revoked", "The account session has ended.");
      }
      yield* this.#flushAuthEvents();
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly validateResumeClaims = Effect.fn("RemoteControlPlane.validateResumeClaims")(
    function* (
      this: RemoteControlPlane,
      claims: RemoteResumeClaims,
    ): Effect.fn.Return<boolean, RemoteFailure, RemoteDependencies> {
      const dependencies = yield* RemoteDependencies;
      const now = dependencies.now();
      if (claims.sessionExpiresAt * 1_000 <= now || !Number.isSafeInteger(claims.authEpoch)) return false;
      if (claims.role === "host") {
        const host = yield* this.#host(claims.hostId);
        return Boolean(
          host &&
            claims.sessionId === `host-${host.host_id}` &&
            claims.userId === host.owner_user_id &&
            claims.membershipId === `${host.host_id}:host` &&
            claims.authEpoch === host.auth_epoch,
        );
      }
      const session = yield* remoteCall(() =>
        dependencies.database
          .prepare(
            `SELECT s.session_id, s.expires_at, s.ended_at, m.membership_id, m.host_id, m.user_id, m.role, m.status,
                h.auth_epoch
           FROM remote_sessions s
           JOIN remote_memberships m ON m.membership_id = s.membership_id
           JOIN remote_hosts h ON h.host_id = s.host_id
          WHERE s.session_id = ? AND (s.auth_session_hash IS NULL OR EXISTS(
            SELECT 1 FROM auth_sessions a WHERE a.token_hash = s.auth_session_hash
              AND a.user_id = s.user_id AND a.revoked_at IS NULL AND a.expires_at > ?
          )) LIMIT 1`,
          )
          .bind(claims.sessionId, now)
          .first<RemoteSessionRow>(),
      );
      return Boolean(
        session &&
          !session.ended_at &&
          session.expires_at > now &&
          session.status === "active" &&
          session.host_id === claims.hostId &&
          session.user_id === claims.userId &&
          session.membership_id === claims.membershipId &&
          session.role === claims.role &&
          session.auth_epoch === claims.authEpoch &&
          Math.floor(session.expires_at / 1_000) === claims.sessionExpiresAt,
      );
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly issueSessionTicket = Effect.fn("RemoteControlPlane.issueSessionTicket")(
    function* (
      this: RemoteControlPlane,
      userId: string,
      sessionId: string,
      clientPublicKey: string,
      authSessionHash?: string,
    ) {
      const dependencies = yield* RemoteDependencies;
      const boundClientPublicKey = yield* remoteValidate(() =>
        requiredText(clientPublicKey, 8_192, "client public key"),
      );
      const now = dependencies.now();
      const session = yield* remoteCall(() =>
        dependencies.database
          .prepare(
            `SELECT s.session_id, s.expires_at, s.ended_at, m.membership_id, m.host_id, m.user_id, m.role, m.status,
                h.auth_epoch
         FROM remote_sessions s
         JOIN remote_memberships m ON m.membership_id = s.membership_id
         JOIN remote_hosts h ON h.host_id = s.host_id
         WHERE s.session_id = ? AND s.user_id = ? AND (? IS NULL OR s.auth_session_hash = ?) AND (s.auth_session_hash IS NULL OR EXISTS(
           SELECT 1 FROM auth_sessions a WHERE a.token_hash = s.auth_session_hash
             AND a.user_id = s.user_id AND a.revoked_at IS NULL AND a.expires_at > ?
         )) LIMIT 1`,
          )
          .bind(sessionId, userId, authSessionHash ?? null, authSessionHash ?? null, now)
          .first<RemoteSessionRow>(),
      );
      if (!session || session.ended_at || session.expires_at <= now || session.status !== "active") {
        return yield* new RemoteControlPlaneError(403, "session_inactive", "The remote session is not active.");
      }
      return yield* dependencies.signer.issue({
        sessionId,
        hostId: session.host_id,
        userId,
        membershipId: session.membership_id,
        role: session.role,
        authEpoch: session.auth_epoch,
        sessionExpiresAt: session.expires_at,
        clientPublicKey: boundClientPublicKey,
        now,
      });
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /** The plan of a host changed, so each member's devices read the server list, with its member limit, again. */

  readonly planChanged = Effect.fn("RemoteControlPlane.planChanged")(
    function* (this: RemoteControlPlane, hostId: string): Effect.fn.Return<void, RemoteFailure, RemoteDependencies> {
      yield* this.#serversChanged(
        "SELECT user_id FROM remote_memberships WHERE host_id = ? AND status = 'active'",
        hostId,
      );
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * The license of an account changed, so the member limit of its servers can be different. Each active
   * member of those servers reads the server list again, once.
   */

  readonly licenseChanged = Effect.fn("RemoteControlPlane.licenseChanged")(
    function* (
      this: RemoteControlPlane,
      ownerUserId: string,
    ): Effect.fn.Return<void, RemoteFailure, RemoteDependencies> {
      yield* this.#serversChanged(
        `SELECT DISTINCT m.user_id FROM remote_memberships m JOIN remote_hosts h ON h.host_id = m.host_id
          WHERE h.owner_user_id = ? AND m.status = 'active'`,
        ownerUserId,
      );
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * Removes a host and its memberships, invites and sessions. Signal closes the host and client
   * sockets, and each member's devices re-read their server list.
   */

  readonly removeOwnedHost = Effect.fn("RemoteControlPlane.removeOwnedHost")(
    function* (this: RemoteControlPlane, userId: string, hostId: string) {
      const dependencies = yield* RemoteDependencies;
      yield* this.#requireRole(hostId, userId, ["owner"]);
      const hosted = yield* remoteCall(() =>
        dependencies.database
          .prepare("SELECT server_id FROM hosted_servers WHERE server_id = ? LIMIT 1")
          .bind(hostId)
          .first<{ server_id: string }>(),
      );
      if (hosted)
        return yield* new RemoteControlPlaneError(
          409,
          "hosted_server_removal",
          sourceText("error.remote.hostedServerRemoval"),
        );
      yield* this.deleteHost(userId, hostId, true);
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly deleteHost = Effect.fn("RemoteControlPlane.deleteHost")(
    function* (
      this: RemoteControlPlane,
      ownerUserId: string,
      hostId: string,
      retainIdentity = false,
    ): Effect.fn.Return<void, RemoteFailure, RemoteDependencies> {
      const dependencies = yield* RemoteDependencies;
      const now = dependencies.now();
      yield* remoteCall(() =>
        dependencies.database.batch([
          dependencies.database
            .prepare(
              `INSERT INTO remote_auth_events(event_id, payload, created_at, attempts, next_attempt_at)
           SELECT lower(hex(randomblob(16))),
                  json_object('type', 'remote-session-ended', 'hostId', host_id, 'sessionId', session_id),
                  ?, 0, ?
             FROM remote_sessions
            WHERE host_id = ? AND ended_at IS NULL`,
            )
            .bind(now, now, hostId),
          dependencies.database
            .prepare(
              `INSERT INTO remote_auth_events(event_id, payload, created_at, attempts, next_attempt_at)
           SELECT lower(hex(randomblob(16))),
                  json_object('type', 'account-servers-changed', 'userId', user_id),
                  ?, 0, ?
             FROM remote_memberships
            WHERE host_id = ? AND status = 'active'`,
            )
            .bind(now, now, hostId),
          dependencies.database
            .prepare(
              "UPDATE remote_hosts SET auth_epoch = auth_epoch + 1, updated_at = ? WHERE host_id = ? AND owner_user_id = ?",
            )
            .bind(now, hostId, ownerUserId),
          this.#authEpochEventStatement(hostId, now, ownerUserId),
          // The sites stay public until they expire. The unlinked bucket keeps them in the owner's list, to delete.
          dependencies.database
            .prepare("UPDATE hosted_sites SET server_id = NULL WHERE server_id = ? AND user_id = ?")
            .bind(hostId, ownerUserId),
          // Keep the route IDs as tombstones: their public URLs must not move to another host.
          dependencies.database
            .prepare(
              "UPDATE webhook_routes SET revoked_at = ? WHERE host_id = ? AND account_id = ? AND revoked_at IS NULL",
            )
            .bind(now, hostId, ownerUserId),
          ...(retainIdentity
            ? [
                // Signal keeps the revocation epoch. Keep the identity so a later registration
                // advances that epoch instead of starting at 1 with rejected tickets.
                dependencies.database
                  .prepare(
                    "UPDATE remote_hosts SET machine_token_hash = NULL, device_public_key = NULL WHERE host_id = ? AND owner_user_id = ?",
                  )
                  .bind(hostId, ownerUserId),
                dependencies.database.prepare("DELETE FROM remote_memberships WHERE host_id = ?").bind(hostId),
                dependencies.database.prepare("DELETE FROM remote_invites WHERE host_id = ?").bind(hostId),
                dependencies.database.prepare("DELETE FROM slack_workspace_routes WHERE host_id = ?").bind(hostId),
                dependencies.database.prepare("DELETE FROM discord_guild_routes WHERE host_id = ?").bind(hostId),
                dependencies.database.prepare("DELETE FROM telegram_chat_routes WHERE host_id = ?").bind(hostId),
                dependencies.database.prepare("DELETE FROM telegram_link_codes WHERE host_id = ?").bind(hostId),
                // The next registration can come with another key, so the old chain stops here.
                dependencies.database.prepare("DELETE FROM remote_host_key_handovers WHERE host_id = ?").bind(hostId),
              ]
            : [
                dependencies.database
                  .prepare("DELETE FROM remote_hosts WHERE host_id = ? AND owner_user_id = ?")
                  .bind(hostId, ownerUserId),
              ]),
        ]),
      );
      yield* this.#flushAuthEvents();
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly issueHostTicket = Effect.fn("RemoteControlPlane.issueHostTicket")(
    function* (this: RemoteControlPlane, hostId: string, machineToken: string) {
      const dependencies = yield* RemoteDependencies;
      const host = yield* this.authenticateHost(hostId, machineToken);
      return yield* dependencies.signer.issue({
        sessionId: `host-${hostId}`,
        hostId,
        userId: host.owner_user_id,
        membershipId: `${hostId}:host`,
        role: "host",
        authEpoch: host.auth_epoch,
        sessionExpiresAt: PERSISTENT_SESSION_EXPIRES_AT,
        now: dependencies.now(),
      });
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * The route ticket that the host's Signal `ingress` socket presents: the Slack workspaces linked to
   * this host, signed. The host asks for a new one each time the socket connects.
   */

  readonly issueSlackRoute = Effect.fn("RemoteControlPlane.issueSlackRoute")(
    function* (
      this: RemoteControlPlane,
      hostId: string,
      machineToken: string,
    ): Effect.fn.Return<{ ticket: string; teams: string[] }, RemoteFailure, RemoteDependencies> {
      const dependencies = yield* RemoteDependencies;
      const signer = dependencies.routeSigner;
      if (!signer) {
        return yield* new RemoteControlPlaneError(503, "slack_not_configured", "Slack routing is not configured.");
      }
      yield* this.authenticateHost(hostId, machineToken);
      const rows = yield* remoteCall(() =>
        dependencies.database
          .prepare(
            "SELECT team_id, app_id, connected_at FROM slack_workspace_routes WHERE host_id = ? ORDER BY connected_at DESC LIMIT ?",
          )
          .bind(hostId, SLACK_ROUTE_TEAMS_LIMIT)
          .all<{ team_id: string; app_id: string; connected_at: number }>(),
      );
      const teams = rows.results.map((row) => ({ id: row.team_id, appId: row.app_id, linkedAt: row.connected_at }));
      return {
        ticket: yield* signer.issue({
          audience: SLACK_ROUTE_AUDIENCE,
          claims: { hid: hostId, teams } satisfies Omit<SlackRouteClaims, "aud" | "iat" | "exp">,
          ttlSeconds: SLACK_ROUTE_TTL_SECONDS,
          now: dependencies.now(),
        }),
        teams: teams.map((team) => team.id),
      };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /** The workspaces of a route ticket that D1 still links to the host, with the same link. */

  readonly validateSlackRoute = Effect.fn("RemoteControlPlane.validateSlackRoute")(
    function* (
      this: RemoteControlPlane,
      input: { hostId: string; teams: SlackRouteTeam[] },
    ): Effect.fn.Return<string[], RemoteFailure, RemoteDependencies> {
      const dependencies = yield* RemoteDependencies;
      if (input.teams.length === 0) return [];
      const rows = yield* remoteCall(() =>
        dependencies.database
          .prepare("SELECT team_id, app_id, connected_at FROM slack_workspace_routes WHERE host_id = ?")
          .bind(input.hostId)
          .all<{ team_id: string; app_id: string; connected_at: number }>(),
      );
      const linked = new Map(rows.results.map((row) => [row.team_id, row]));
      return input.teams
        .filter((team) => {
          const row = linked.get(team.id);
          return row?.app_id === team.appId && row.connected_at === team.linkedAt;
        })
        .map((team) => team.id);
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /** The host that a Slack workspace, Discord guild or Telegram chat is linked to, or null. */
  readonly routeHost = Effect.fn("RemoteControlPlane.routeHost")(
    function* (
      this: RemoteControlPlane,
      route: IngressRoute,
    ): Effect.fn.Return<string | null, RemoteFailure, RemoteDependencies> {
      const dependencies = yield* RemoteDependencies;
      const statement =
        route.platform === "slack"
          ? dependencies.database
              .prepare("SELECT host_id FROM slack_workspace_routes WHERE team_id = ? AND app_id = ?")
              .bind(route.teamId, route.appId)
          : route.platform === "discord"
            ? dependencies.database
                .prepare("SELECT host_id FROM discord_guild_routes WHERE guild_id = ?")
                .bind(route.guildId)
            : dependencies.database
                .prepare("SELECT host_id FROM telegram_chat_routes WHERE bot_id = ? AND chat_id = ?")
                .bind(route.botId, route.chatId);
      const row = yield* remoteCall(() => statement.first<{ host_id: string }>());
      return row?.host_id ?? null;
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * Registers one opaque webhook route ID for the authenticated host. A route ID is never freed:
   * senders can still post to a revoked or deleted host's URL, so only the live owner may register it.
   */
  readonly registerWebhookRoute = Effect.fn("RemoteControlPlane.registerWebhookRoute")(
    function* (
      this: RemoteControlPlane,
      hostId: string,
      machineToken: string,
      routeId: string,
    ): Effect.fn.Return<{ routeId: string }, RemoteFailure, RemoteDependencies> {
      const dependencies = yield* RemoteDependencies;
      const validRouteId = yield* remoteValidate(() => requiredText(routeId, 128, "webhook route ID"));
      if (!WEBHOOK_ROUTE_ID_PATTERN.test(validRouteId))
        return yield* new RemoteControlPlaneError(400, "invalid_webhook_route", "The webhook route is invalid.");
      const host = yield* this.authenticateHost(hostId, machineToken);
      const now = dependencies.now();
      const inserted = yield* remoteCall(() =>
        dependencies.database
          .prepare(
            `INSERT INTO webhook_routes (route_id, host_id, account_id, connected_at)
             SELECT ?, ?, ?, ?
             WHERE (SELECT COUNT(*) FROM webhook_routes WHERE host_id = ? AND revoked_at IS NULL) < ?
             ON CONFLICT(route_id) DO NOTHING`,
          )
          .bind(validRouteId, hostId, host.owner_user_id, now, hostId, WEBHOOK_ROUTES_LIMIT)
          .run(),
      );
      if (inserted.meta.changes) return { routeId: validRouteId };
      const existing = yield* remoteCall(() =>
        dependencies.database
          .prepare("SELECT host_id, account_id, revoked_at FROM webhook_routes WHERE route_id = ?")
          .bind(validRouteId)
          .first<{ host_id: string; account_id: string; revoked_at: number | null }>(),
      );
      if (existing) {
        // A host ID is free again after its host is deleted, so the account must match as well.
        if (existing.revoked_at !== null || existing.host_id !== hostId || existing.account_id !== host.owner_user_id)
          return yield* new RemoteControlPlaneError(
            409,
            "webhook_route_conflict",
            "The webhook route is already registered to another host.",
          );
        return { routeId: validRouteId };
      }
      return yield* new RemoteControlPlaneError(
        409,
        "webhook_route_limit",
        "This host has reached its webhook route limit.",
      );
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /** The route ticket that the host's Signal ingress socket presents for generic webhooks. */
  readonly issueWebhookRoute = Effect.fn("RemoteControlPlane.issueWebhookRoute")(
    function* (
      this: RemoteControlPlane,
      hostId: string,
      machineToken: string,
    ): Effect.fn.Return<{ ticket: string; routes: string[] }, RemoteFailure, RemoteDependencies> {
      const dependencies = yield* RemoteDependencies;
      const host = yield* this.authenticateHost(hostId, machineToken);
      const rows = yield* remoteCall(() =>
        dependencies.database
          .prepare(
            `SELECT route_id, connected_at FROM webhook_routes
             WHERE host_id = ? AND account_id = ? AND revoked_at IS NULL
             ORDER BY connected_at DESC LIMIT ?`,
          )
          .bind(hostId, host.owner_user_id, WEBHOOK_ROUTES_LIMIT)
          .all<{ route_id: string; connected_at: number }>(),
      );
      const routes = rows.results.map((row) => ({ id: row.route_id, linkedAt: row.connected_at }));
      return {
        ticket: yield* dependencies.signer.issueWebhookRoute({ hostId, routes, now: dependencies.now() }),
        routes: routes.map((route) => route.id),
      };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /** The route IDs in a ticket that D1 still links, live, to the same host, owner and link time. */
  readonly validateWebhookRoute = Effect.fn("RemoteControlPlane.validateWebhookRoute")(
    function* (
      this: RemoteControlPlane,
      input: { hostId: string; routes: WebhookRoute[] },
    ): Effect.fn.Return<string[], RemoteFailure, RemoteDependencies> {
      const dependencies = yield* RemoteDependencies;
      if (input.routes.length === 0) return [];
      const rows = yield* remoteCall(() =>
        dependencies.database
          .prepare(
            `SELECT route.route_id, route.connected_at FROM webhook_routes route
             JOIN remote_hosts host ON host.host_id = route.host_id AND host.owner_user_id = route.account_id
             WHERE route.host_id = ? AND route.revoked_at IS NULL`,
          )
          .bind(input.hostId)
          .all<{ route_id: string; connected_at: number }>(),
      );
      const linked = new Map(rows.results.map((row) => [row.route_id, row.connected_at]));
      return input.routes.filter((route) => linked.get(route.id) === route.linkedAt).map((route) => route.id);
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * Revokes one webhook route after the host deleted its webhook routine or switched it to a schedule.
   * The row stays as a tombstone so that no other host can register the same public URL.
   */
  readonly disconnectWebhookRoute = Effect.fn("RemoteControlPlane.disconnectWebhookRoute")(
    function* (
      this: RemoteControlPlane,
      hostId: string,
      machineToken: string,
      routeId: string,
    ): Effect.fn.Return<void, RemoteFailure, RemoteDependencies> {
      const dependencies = yield* RemoteDependencies;
      yield* this.authenticateHost(hostId, machineToken);
      const validRouteId = yield* remoteValidate(() => requiredText(routeId, 128, "webhook route ID"));
      const now = dependencies.now();
      const [removed] = yield* remoteCall(() =>
        dependencies.database.batch([
          this.#authEventStatement({ type: "webhook-route-revoked", routeId: validRouteId, through: now }, now, {
            sql: "EXISTS (SELECT 1 FROM webhook_routes WHERE route_id = ? AND host_id = ? AND revoked_at IS NULL)",
            binds: [validRouteId, hostId],
          }),
          dependencies.database
            .prepare(
              "UPDATE webhook_routes SET revoked_at = ? WHERE route_id = ? AND host_id = ? AND revoked_at IS NULL",
            )
            .bind(now, validRouteId, hostId),
        ]),
      );
      if (removed?.meta.changes) yield* this.#flushAuthEvents();
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /** Unlinks a Slack workspace from this host, after the host disconnected it or Slack uninstalled it. */

  readonly disconnectSlackWorkspace = Effect.fn("RemoteControlPlane.disconnectSlackWorkspace")(
    function* (
      this: RemoteControlPlane,
      hostId: string,
      machineToken: string,
      teamId: string,
    ): Effect.fn.Return<void, RemoteFailure, RemoteDependencies> {
      const dependencies = yield* RemoteDependencies;
      yield* this.authenticateHost(hostId, machineToken);
      const link = yield* remoteCall(() =>
        dependencies.database
          .prepare("SELECT app_id FROM slack_workspace_routes WHERE team_id = ? AND host_id = ?")
          .bind(teamId, hostId)
          .first<{ app_id: string }>(),
      );
      if (!link) return;
      const now = dependencies.now();
      // Signal drops the route now, so the host cannot keep the workspace with the ticket it holds.
      yield* remoteCall(() =>
        dependencies.database.batch([
          this.#authEventStatement({ type: "slack-route-revoked", appId: link.app_id, teamId, through: now }, now, {
            sql: "EXISTS (SELECT 1 FROM slack_workspace_routes WHERE team_id = ? AND host_id = ?)",
            binds: [teamId, hostId],
          }),
          dependencies.database
            .prepare("DELETE FROM slack_workspace_routes WHERE team_id = ? AND host_id = ?")
            .bind(teamId, hostId),
        ]),
      );
      yield* this.#flushAuthEvents();
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * The Discord route ticket that the host's Signal `ingress` socket presents: the Discord guilds
   * linked to this host, signed. The host asks for a new one each time the socket connects.
   */

  readonly issueDiscordRoute = Effect.fn("RemoteControlPlane.issueDiscordRoute")(
    function* (
      this: RemoteControlPlane,
      hostId: string,
      machineToken: string,
    ): Effect.fn.Return<{ ticket: string }, RemoteFailure, RemoteDependencies> {
      const dependencies = yield* RemoteDependencies;
      const signer = dependencies.discordRouteSigner;
      if (!signer) {
        return yield* new RemoteControlPlaneError(503, "discord_not_configured", "Discord routing is not configured.");
      }
      yield* this.authenticateHost(hostId, machineToken);
      const rows = yield* remoteCall(() =>
        dependencies.database
          .prepare(
            "SELECT guild_id, connected_at FROM discord_guild_routes WHERE host_id = ? ORDER BY connected_at DESC LIMIT ?",
          )
          .bind(hostId, DISCORD_ROUTE_GUILDS_LIMIT)
          .all<{ guild_id: string; connected_at: number }>(),
      );
      const guilds = rows.results.map((row) => ({ id: row.guild_id, linkedAt: row.connected_at }));
      return { ticket: yield* signer.issue({ hostId, guilds, now: dependencies.now() }) };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /** The guilds of a route ticket that D1 still links to the host, with the same link. */

  readonly validateDiscordRoute = Effect.fn("RemoteControlPlane.validateDiscordRoute")(
    function* (
      this: RemoteControlPlane,
      input: { hostId: string; guilds: DiscordRouteGuild[] },
    ): Effect.fn.Return<string[], RemoteFailure, RemoteDependencies> {
      const dependencies = yield* RemoteDependencies;
      if (input.guilds.length === 0) return [];
      const rows = yield* remoteCall(() =>
        dependencies.database
          .prepare("SELECT guild_id, connected_at FROM discord_guild_routes WHERE host_id = ?")
          .bind(input.hostId)
          .all<{ guild_id: string; connected_at: number }>(),
      );
      const linked = new Map(rows.results.map((row) => [row.guild_id, row.connected_at]));
      return input.guilds.filter((guild) => linked.get(guild.id) === guild.linkedAt).map((guild) => guild.id);
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /** Unlinks a Discord guild from this host, after the host disconnected it. */

  readonly disconnectDiscordGuild = Effect.fn("RemoteControlPlane.disconnectDiscordGuild")(
    function* (
      this: RemoteControlPlane,
      hostId: string,
      machineToken: string,
      guildId: string,
    ): Effect.fn.Return<void, RemoteFailure, RemoteDependencies> {
      const dependencies = yield* RemoteDependencies;
      yield* this.authenticateHost(hostId, machineToken);
      const now = dependencies.now();
      // Signal drops the route now, so the host cannot keep the guild with the ticket it holds.
      const [queued] = yield* remoteCall(() =>
        dependencies.database.batch([
          this.#authEventStatement({ type: "discord-route-revoked", guildId, through: now }, now, {
            sql: "EXISTS (SELECT 1 FROM discord_guild_routes WHERE guild_id = ? AND host_id = ?)",
            binds: [guildId, hostId],
          }),
          dependencies.database
            .prepare("DELETE FROM discord_guild_routes WHERE guild_id = ? AND host_id = ?")
            .bind(guildId, hostId),
        ]),
      );
      if (queued?.meta.changes) yield* this.#flushAuthEvents();
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * Unlinks a Discord guild that the bot left, whichever host it was linked to. Signal reports this
   * from the Gateway, so the link goes also when that host is offline.
   */

  readonly removeDiscordGuild = Effect.fn("RemoteControlPlane.removeDiscordGuild")(
    function* (this: RemoteControlPlane, guildId: string): Effect.fn.Return<void, RemoteFailure, RemoteDependencies> {
      const dependencies = yield* RemoteDependencies;
      const now = dependencies.now();
      const [queued] = yield* remoteCall(() =>
        dependencies.database.batch([
          this.#authEventStatement({ type: "discord-route-revoked", guildId, through: now }, now, {
            sql: "EXISTS (SELECT 1 FROM discord_guild_routes WHERE guild_id = ?)",
            binds: [guildId],
          }),
          dependencies.database.prepare("DELETE FROM discord_guild_routes WHERE guild_id = ?").bind(guildId),
        ]),
      );
      if (queued?.meta.changes) yield* this.#flushAuthEvents();
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * Unlinks every guild that was linked before `before` and that the bot is no longer in. Signal sends
   * the bot's guilds from the Gateway, so a link goes also when every unlink before it failed.
   */

  readonly reconcileDiscordGuilds = Effect.fn("RemoteControlPlane.reconcileDiscordGuilds")(
    function* (
      this: RemoteControlPlane,
      input: { guilds: readonly string[]; before: number },
    ): Effect.fn.Return<number, RemoteFailure, RemoteDependencies> {
      const dependencies = yield* RemoteDependencies;
      const member = new Set(input.guilds);
      const rows = yield* remoteCall(() =>
        dependencies.database
          .prepare("SELECT guild_id, connected_at FROM discord_guild_routes WHERE connected_at < ?")
          .bind(input.before)
          .all<{ guild_id: string; connected_at: number }>(),
      );
      const stale = rows.results.filter((row) => !member.has(row.guild_id));
      if (stale.length === 0) return 0;
      const now = dependencies.now();
      // Each statement names the link it read, so a link made since then stays.
      yield* remoteCall(() =>
        dependencies.database.batch(
          stale.flatMap((row) => [
            this.#authEventStatement({ type: "discord-route-revoked", guildId: row.guild_id, through: now }, now, {
              sql: "EXISTS (SELECT 1 FROM discord_guild_routes WHERE guild_id = ? AND connected_at = ?)",
              binds: [row.guild_id, row.connected_at],
            }),
            dependencies.database
              .prepare("DELETE FROM discord_guild_routes WHERE guild_id = ? AND connected_at = ?")
              .bind(row.guild_id, row.connected_at),
          ]),
        ),
      );
      yield* this.#flushAuthEvents();
      return stale.length;
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * A one-use code that links a Telegram chat to this host. The user opens
   * `https://t.me/<bot>?start=<code>` or `?startgroup=<code>`, and Telegram sends `/start <code>` in
   * the chat. Only the SHA-256 of the code is kept.
   */

  readonly issueTelegramLinkCode = Effect.fn("RemoteControlPlane.issueTelegramLinkCode")(
    function* (
      this: RemoteControlPlane,
      hostId: string,
      machineToken: string,
    ): Effect.fn.Return<{ botUsername: string; code: string; expiresAt: number }, RemoteFailure, RemoteDependencies> {
      const dependencies = yield* RemoteDependencies;
      const telegram = dependencies.telegram;
      if (!telegram) return yield* telegramNotConfigured();
      const host = yield* this.authenticateHost(hostId, machineToken);
      const now = dependencies.now();
      const code = randomToken();
      const codeHash = yield* sha256(code).pipe(
        Effect.mapError((error) => (error instanceof RemoteControlPlaneError ? error : new RemoteOperationError({}))),
      );
      const expiresAt = now + TELEGRAM_LINK_CODE_TTL_SECONDS * 1_000;
      // The count and the insert are one statement: two requests at once cannot both pass the limit.
      const [, created] = yield* remoteCall(() =>
        dependencies.database.batch([
          dependencies.database
            .prepare("DELETE FROM telegram_link_codes WHERE host_id = ? AND expires_at <= ?")
            .bind(hostId, now),
          dependencies.database
            .prepare(
              `INSERT INTO telegram_link_codes(code_hash, bot_id, host_id, account_id, expires_at)
           SELECT ?, ?, ?, ?, ?
           WHERE (SELECT COUNT(*) FROM telegram_link_codes WHERE host_id = ? AND expires_at > ?) < ?`,
            )
            .bind(
              codeHash,
              telegram.botId,
              hostId,
              host.owner_user_id,
              expiresAt,
              hostId,
              now,
              MAX_TELEGRAM_LINK_CODES_PER_HOST,
            ),
        ]),
      );
      if ((created?.meta.changes ?? 0) !== 1) {
        return yield* new RemoteControlPlaneError(
          429,
          "telegram_link_limit",
          "Use an open Telegram link or let it expire before you ask for another one.",
        );
      }
      return { botUsername: telegram.botUsername, code, expiresAt };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * Links a Telegram chat to the host that asked for the code. Signal calls this when a chat sends
   * `/start <code>`.
   *
   * A chat answers to one host. The account that linked it can move it to another of its hosts;
   * another account gets `telegram_chat_taken` until the first host disconnects the chat. A repeat of
   * the code from the chat that it linked gets the same answer.
   */

  readonly linkTelegramChat = Effect.fn("RemoteControlPlane.linkTelegramChat")(
    function* (
      this: RemoteControlPlane,
      input: { botId: string; chatId: string; code: string },
    ): Effect.fn.Return<TelegramChatLink, RemoteFailure, RemoteDependencies> {
      const dependencies = yield* RemoteDependencies;
      if (!dependencies.telegram) return yield* telegramNotConfigured();
      if (
        !TELEGRAM_BOT_ID_PATTERN.test(input.botId) ||
        !TELEGRAM_CHAT_ID_PATTERN.test(input.chatId) ||
        !TELEGRAM_LINK_CODE_PATTERN.test(input.code)
      ) {
        return yield* invalid("Telegram link");
      }
      const codeHash = yield* sha256(input.code).pipe(
        Effect.mapError((error) => (error instanceof RemoteControlPlaneError ? error : new RemoteOperationError({}))),
      );
      const now = dependencies.now();
      const state = yield* this.#telegramLinkState(codeHash, input, now);
      if ("hostId" in state) return state;
      const hostId = state.host_id;
      // One batch, so two links at once cannot both win: the route is written only while the code is
      // unused, and the code is marked used only when the route is this link. Another account's row
      // stays as it is. When the link is made, Signal drops any older route of the chat: a host that
      // the chat moved away from cannot keep it with the ticket it holds.
      const [, used] = yield* remoteCall(() =>
        dependencies.database.batch([
          dependencies.database
            .prepare(
              `INSERT INTO telegram_chat_routes(bot_id, chat_id, host_id, account_id, linked_at)
           SELECT ?, ?, ?, ?, ?
           WHERE EXISTS (
               SELECT 1 FROM telegram_link_codes
                WHERE code_hash = ? AND bot_id = ? AND chat_id IS NULL AND expires_at > ?
             )
             AND (
               SELECT COUNT(*) FROM telegram_chat_routes WHERE host_id = ? AND NOT (bot_id = ? AND chat_id = ?)
             ) < ?
           ON CONFLICT(bot_id, chat_id) DO UPDATE SET host_id = excluded.host_id, linked_at = excluded.linked_at
           WHERE telegram_chat_routes.account_id = excluded.account_id`,
            )
            .bind(
              input.botId,
              input.chatId,
              hostId,
              state.account_id,
              now,
              codeHash,
              input.botId,
              now,
              hostId,
              input.botId,
              input.chatId,
              TELEGRAM_ROUTE_CHATS_LIMIT,
            ),
          dependencies.database
            .prepare(
              `UPDATE telegram_link_codes SET chat_id = ?, linked_at = ?
            WHERE code_hash = ? AND chat_id IS NULL
              AND EXISTS (
                SELECT 1 FROM telegram_chat_routes WHERE bot_id = ? AND chat_id = ? AND host_id = ? AND linked_at = ?
              )`,
            )
            .bind(input.chatId, now, codeHash, input.botId, input.chatId, hostId, now),
          this.#authEventStatement(
            { type: "telegram-route-revoked", botId: input.botId, chatId: input.chatId, through: now - 1 },
            now,
            {
              sql: "EXISTS (SELECT 1 FROM telegram_link_codes WHERE code_hash = ? AND chat_id = ? AND linked_at = ?)",
              binds: [codeHash, input.chatId, now],
            },
          ),
        ]),
      );
      if ((used?.meta.changes ?? 0) === 1) {
        yield* this.#flushAuthEvents();
        return { hostId, linkedAt: now };
      }
      // Another link changed the chat or the code after the first read. Give the answer of the state now.
      const current = yield* this.#telegramLinkState(codeHash, input, now);
      if ("hostId" in current) return current;
      return yield* telegramLinkInvalid();
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * The route ticket that the host's Signal `ingress` socket presents: the Telegram chats linked to
   * this host, signed. The host asks for a new one each time the socket connects.
   */

  readonly issueTelegramRoute = Effect.fn("RemoteControlPlane.issueTelegramRoute")(
    function* (
      this: RemoteControlPlane,
      hostId: string,
      machineToken: string,
    ): Effect.fn.Return<{ ticket: string; chats: string[] }, RemoteFailure, RemoteDependencies> {
      const dependencies = yield* RemoteDependencies;
      const signer = dependencies.routeSigner;
      if (!signer || !dependencies.telegram) return yield* telegramNotConfigured();
      yield* this.authenticateHost(hostId, machineToken);
      const rows = yield* remoteCall(() =>
        dependencies.database
          .prepare(
            "SELECT bot_id, chat_id, linked_at FROM telegram_chat_routes WHERE host_id = ? ORDER BY linked_at DESC LIMIT ?",
          )
          .bind(hostId, TELEGRAM_ROUTE_CHATS_LIMIT)
          .all<{ bot_id: string; chat_id: string; linked_at: number }>(),
      );
      const chats: TelegramRouteChat[] = rows.results.map((row) => ({
        id: row.chat_id,
        botId: row.bot_id,
        linkedAt: row.linked_at,
      }));
      return {
        ticket: yield* signer.issue({
          audience: TELEGRAM_ROUTE_AUDIENCE,
          claims: { hid: hostId, chats } satisfies Omit<TelegramRouteClaims, "aud" | "iat" | "exp">,
          ttlSeconds: TELEGRAM_ROUTE_TTL_SECONDS,
          now: dependencies.now(),
        }),
        chats: chats.map((chat) => chat.id),
      };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /** The chats of a route ticket that D1 still links to the host, with the same bot and link. */

  readonly validateTelegramRoute = Effect.fn("RemoteControlPlane.validateTelegramRoute")(
    function* (
      this: RemoteControlPlane,
      input: { hostId: string; chats: TelegramRouteChat[] },
    ): Effect.fn.Return<TelegramRouteChat[], RemoteFailure, RemoteDependencies> {
      const dependencies = yield* RemoteDependencies;
      if (input.chats.length === 0) return [];
      const rows = yield* remoteCall(() =>
        dependencies.database
          .prepare("SELECT bot_id, chat_id, linked_at FROM telegram_chat_routes WHERE host_id = ?")
          .bind(input.hostId)
          .all<{ bot_id: string; chat_id: string; linked_at: number }>(),
      );
      const linked = new Map(rows.results.map((row) => [`${row.bot_id}:${row.chat_id}`, row.linked_at]));
      // Each current link whole, so Signal keeps only these bot, chat and time triples.
      return input.chats
        .filter((chat) => linked.get(`${chat.botId}:${chat.id}`) === chat.linkedAt)
        .map((chat) => ({ id: chat.id, botId: chat.botId, linkedAt: chat.linkedAt }));
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * Unlinks a Telegram chat from this host, for each bot. It works without the Telegram settings, so
   * a host can always remove a chat.
   */

  readonly disconnectTelegramChat = Effect.fn("RemoteControlPlane.disconnectTelegramChat")(
    function* (
      this: RemoteControlPlane,
      hostId: string,
      machineToken: string,
      chatId: string,
    ): Effect.fn.Return<void, RemoteFailure, RemoteDependencies> {
      const dependencies = yield* RemoteDependencies;
      if (!TELEGRAM_CHAT_ID_PATTERN.test(chatId)) return yield* invalid("Telegram chat ID");
      yield* this.authenticateHost(hostId, machineToken);
      const links = yield* remoteCall(() =>
        dependencies.database
          .prepare("SELECT bot_id FROM telegram_chat_routes WHERE chat_id = ? AND host_id = ?")
          .bind(chatId, hostId)
          .all<{ bot_id: string }>(),
      );
      if (links.results.length === 0) return;
      const now = dependencies.now();
      // Signal drops the route now, so the host cannot keep the chat with the ticket it holds.
      yield* remoteCall(() =>
        dependencies.database.batch([
          ...links.results.map((link) =>
            this.#authEventStatement(
              { type: "telegram-route-revoked", botId: link.bot_id, chatId, through: now },
              now,
              {
                sql: "EXISTS (SELECT 1 FROM telegram_chat_routes WHERE bot_id = ? AND chat_id = ? AND host_id = ?)",
                binds: [link.bot_id, chatId, hostId],
              },
            ),
          ),
          dependencies.database
            .prepare("DELETE FROM telegram_chat_routes WHERE chat_id = ? AND host_id = ?")
            .bind(chatId, hostId),
        ]),
      );
      yield* this.#flushAuthEvents();
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /** Checks the credential that a host received when it registered. */

  readonly authenticateHost = Effect.fn("RemoteControlPlane.authenticateHost")(
    function* (
      this: RemoteControlPlane,
      hostId: string,
      machineToken: string,
    ): Effect.fn.Return<RemoteHostRow, RemoteFailure, RemoteDependencies> {
      const host = yield* this.#host(hostId);
      const expected = host?.machine_token_hash ?? "";
      const provided = yield* sha256(machineToken).pipe(
        Effect.mapError((error) => (error instanceof RemoteControlPlaneError ? error : new RemoteOperationError({}))),
      );
      let difference = expected.length ^ provided.length;
      for (let index = 0; index < provided.length; index += 1) {
        difference |= expected.charCodeAt(index) ^ provided.charCodeAt(index);
      }
      if (!host || !expected || difference !== 0) {
        return yield* new RemoteControlPlaneError(401, "host_unauthorized", "The host credential is invalid.");
      }
      return host;
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  /**
   * Whether a member's device session on this host is still open: not ended, the membership active,
   * and the account session of the device not signed out. The notification relay sends nothing for a
   * closed one, because a host does not learn when the account service ends a session.
   */
  readonly sessionOpen = Effect.fn("RemoteControlPlane.sessionOpen")(
    function* (
      this: RemoteControlPlane,
      hostId: string,
      sessionId: string,
    ): Effect.fn.Return<boolean, RemoteFailure, RemoteDependencies> {
      const dependencies = yield* RemoteDependencies;
      const now = dependencies.now();
      const row = yield* remoteCall(() =>
        dependencies.database
          .prepare(
            `SELECT 1 AS open FROM remote_sessions s
           JOIN remote_memberships m
             ON m.membership_id = s.membership_id AND m.host_id = s.host_id AND m.status = 'active'
          WHERE s.session_id = ? AND s.host_id = ? AND s.ended_at IS NULL AND s.expires_at > ?
            AND (s.auth_session_hash IS NULL OR EXISTS(
              SELECT 1 FROM auth_sessions
               WHERE token_hash = s.auth_session_hash AND user_id = s.user_id AND revoked_at IS NULL AND expires_at > ?
            ))
          LIMIT 1`,
          )
          .bind(sessionId, hostId, now, now)
          .first<{ open: number }>(),
      );
      return row !== null;
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly #requireRole = Effect.fn("RemoteControlPlane.requireRole")(function* (
    this: RemoteControlPlane,
    hostId: string,
    userId: string,
    roles: RemoteMemberRole[],
  ): Effect.fn.Return<RemoteMembershipRow, RemoteFailure, RemoteDependencies> {
    const dependencies = yield* RemoteDependencies;
    return yield* Effect.gen({ self: this }, function* () {
      const roleArgument0 = yield* remoteCall(() =>
        dependencies.database
          .prepare(
            `SELECT membership_id, host_id, user_id, role, status
           FROM remote_memberships WHERE host_id = ? AND user_id = ? AND status = 'active' LIMIT 1`,
          )
          .bind(hostId, userId)
          .first<RemoteMembershipRow>(),
      );
      const roleArgument1 = roles;
      return yield* remoteValidate(() => this.#assertRole(roleArgument0, roleArgument1));
    });
  });

  /**
   * What a link code can do now: the current link, when the code already linked this chat or the chat
   * is already on the code's host, or the code row, when the chat can be linked. Fails otherwise.
   */
  readonly #telegramLinkState = Effect.fn("RemoteControlPlane.telegramLinkState")(function* (
    this: RemoteControlPlane,
    codeHash: string,
    input: { botId: string; chatId: string },
    now: number,
  ): Effect.fn.Return<TelegramChatLink | TelegramLinkCodeRow, RemoteFailure, RemoteDependencies> {
    const dependencies = yield* RemoteDependencies;
    const code = yield* remoteCall(() =>
      dependencies.database
        .prepare(
          "SELECT bot_id, host_id, account_id, expires_at, chat_id FROM telegram_link_codes WHERE code_hash = ? LIMIT 1",
        )
        .bind(codeHash)
        .first<TelegramLinkCodeRow>(),
    );
    if (
      !code ||
      code.expires_at <= now ||
      code.bot_id !== input.botId ||
      (code.chat_id !== null && code.chat_id !== input.chatId)
    ) {
      return yield* telegramLinkInvalid();
    }
    const route = yield* remoteCall(() =>
      dependencies.database
        .prepare(
          "SELECT host_id, account_id, linked_at FROM telegram_chat_routes WHERE bot_id = ? AND chat_id = ? LIMIT 1",
        )
        .bind(input.botId, input.chatId)
        .first<{ host_id: string; account_id: string; linked_at: number }>(),
    );
    if (code.chat_id !== null) {
      // A repeat of the code that linked this chat. The chat can have moved or gone since then.
      if (route?.host_id === code.host_id) return { hostId: route.host_id, linkedAt: route.linked_at };
      return yield* telegramLinkInvalid();
    }
    if (route && route.account_id !== code.account_id) {
      return yield* new RemoteControlPlaneError(
        409,
        "telegram_chat_taken",
        "Another OpenBot server answers this Telegram chat. Disconnect it there first.",
      );
    }
    if (route?.host_id === code.host_id) {
      // The chat is already on this host. The code is used, and the link stays as it is.
      yield* remoteCall(() =>
        dependencies.database
          .prepare("UPDATE telegram_link_codes SET chat_id = ?, linked_at = ? WHERE code_hash = ? AND chat_id IS NULL")
          .bind(input.chatId, route.linked_at, codeHash)
          .run(),
      );
      return { hostId: route.host_id, linkedAt: route.linked_at };
    }
    const linked = yield* remoteCall(() =>
      dependencies.database
        .prepare("SELECT COUNT(*) AS count FROM telegram_chat_routes WHERE host_id = ?")
        .bind(code.host_id)
        .first<{ count: number }>(),
    );
    if ((linked?.count ?? 0) >= TELEGRAM_ROUTE_CHATS_LIMIT) {
      return yield* new RemoteControlPlaneError(
        409,
        "telegram_chat_limit",
        `A server can link up to ${TELEGRAM_ROUTE_CHATS_LIMIT} Telegram chats.`,
      );
    }
    return code;
  });

  /**
   * The seat checks for a user who joins a host or comes back to it. The license check applies only
   * while the owner has an open license. A lower limit removes no one: active members keep their seats.
   */
  readonly #memberSeat = Effect.fn("RemoteControlPlane.memberSeat")(function* (
    this: RemoteControlPlane,
    hostId: string,
    userId: string,
  ): Effect.fn.Return<MemberSeat, RemoteFailure, RemoteDependencies> {
    const license = yield* this.#ownerLicense(hostId);
    const { limit, fromLicense } = yield* this.#memberLimit(hostId, license);
    const licenseBinds = license ? [license.ownerId, userId, license.ownerId, license.ownerId, license.users] : null;
    // The license count covers each of the owner's servers, so it is never below this host's count. With
    // a limit from the license, a full server then answers that the license is full.
    if (fromLicense && licenseBinds) {
      return { sql: LICENSE_SEAT_AVAILABLE_SQL, binds: licenseBinds, limit, memberBinds: null, licenseBinds };
    }
    const memberBinds = [hostId, userId, hostId, limit];
    if (!licenseBinds) return { sql: MEMBER_SEAT_AVAILABLE_SQL, binds: memberBinds, limit, memberBinds, licenseBinds };
    return {
      sql: `(${MEMBER_SEAT_AVAILABLE_SQL} AND ${LICENSE_SEAT_AVAILABLE_SQL})`,
      binds: [...memberBinds, ...licenseBinds],
      limit,
      memberBinds,
      licenseBinds,
    };
  });

  readonly #requireMemberSeat = Effect.fn("RemoteControlPlane.requireMemberSeat")(function* (
    this: RemoteControlPlane,
    seat: MemberSeat,
  ): Effect.fn.Return<void, RemoteFailure, RemoteDependencies> {
    const dependencies = yield* RemoteDependencies;
    const available = yield* remoteCall(() =>
      dependencies.database
        .prepare(
          `SELECT ${seat.memberBinds ? MEMBER_SEAT_AVAILABLE_SQL : "1"} AS member, ${seat.licenseBinds ? LICENSE_SEAT_AVAILABLE_SQL : "1"} AS license`,
        )
        .bind(...(seat.memberBinds ?? []), ...(seat.licenseBinds ?? []))
        .first<{ member: number; license: number }>(),
    );
    if (!available?.member) return yield* memberLimitReached(seat.limit);
    if (!available.license) return yield* licenseUsersFull();
  });

  /** Each user that `usersSql` selects (one `user_id` column, one bind) reads the server list again, once. */
  readonly #serversChanged = Effect.fn("RemoteControlPlane.serversChanged")(function* (
    this: RemoteControlPlane,
    usersSql: string,
    bind: string,
  ): Effect.fn.Return<void, RemoteFailure, RemoteDependencies> {
    const dependencies = yield* RemoteDependencies;
    const now = dependencies.now();
    yield* remoteCall(() =>
      dependencies.database
        .prepare(
          `INSERT INTO remote_auth_events(event_id, payload, created_at, attempts, next_attempt_at)
           SELECT lower(hex(randomblob(16))), json_object('type', 'account-servers-changed', 'userId', user_id), ?, 0, ?
             FROM (${usersSql})`,
        )
        .bind(now, now, bind)
        .run(),
    );
    yield* this.#flushAuthEvents();
  });

  readonly #ownerLicense = Effect.fn("RemoteControlPlane.ownerLicense")(function* (
    this: RemoteControlPlane,
    hostId: string,
  ): Effect.fn.Return<OwnerLicense | null, RemoteFailure, RemoteDependencies> {
    const dependencies = yield* RemoteDependencies;
    return yield* ownerLicenseForHost(dependencies.database, hostId, dependencies.now()).pipe(
      Effect.mapError(() => new RemoteOperationError({})),
    );
  });

  /**
   * The active members that the host's custom limit allows, else its hosted plan. A hosted plan already
   * holds the license users, so it keeps its own limit. Else the users of the owner's entitled license
   * when they are more than a plan that a self-hosted host keeps from before the license, else that plan,
   * else the default. A lower limit removes no one: members who are active keep their seats. `license`
   * is the owner's open license (`ownerLicenseForHost`).
   */
  readonly #memberLimit = Effect.fn("RemoteControlPlane.memberLimit")(function* (
    this: RemoteControlPlane,
    hostId: string,
    license: OwnerLicense | null,
  ): Effect.fn.Return<MemberLimit, RemoteFailure, RemoteDependencies> {
    const dependencies = yield* RemoteDependencies;
    const custom = yield* remoteCall(() =>
      dependencies.database.prepare(SERVER_MEMBER_LIMIT_SQL).bind(hostId).first<{ member_limit: number }>(),
    );
    if (custom) return { limit: custom.member_limit, fromLicense: false };
    const plan = yield* getServerEntitlement(dependencies.database, hostId, dependencies.now()).pipe(
      Effect.mapError((error) => (error instanceof RemoteControlPlaneError ? error : new RemoteOperationError({}))),
    );
    if (plan?.hosted) return { limit: plan.memberLimit, fromLicense: false };
    if (license?.entitled && license.users > (plan?.memberLimit ?? 0))
      return { limit: license.users, fromLicense: true };
    return { limit: plan?.memberLimit ?? DEFAULT_TEAM_MEMBER_LIMIT, fromLicense: false };
  });

  #assertRole<Row extends RemoteMembershipRow>(membership: Row | null, roles: RemoteMemberRole[]): Row {
    if (!membership || !roles.includes(membership.role)) {
      throw new RemoteControlPlaneError(
        403,
        "remote_permission_denied",
        "The account cannot perform this remote operation.",
      );
    }
    return membership;
  }

  readonly #host = Effect.fn("RemoteControlPlane.host")(function* (
    this: RemoteControlPlane,
    hostId: string,
  ): Effect.fn.Return<RemoteHostRow | null, RemoteFailure, RemoteDependencies> {
    const dependencies = yield* RemoteDependencies;
    return yield* remoteCall(() =>
      dependencies.database
        .prepare(
          `SELECT host_id, owner_user_id, name, logo_key, auth_epoch, machine_token_hash, device_public_key
         FROM remote_hosts WHERE host_id = ? LIMIT 1`,
        )
        .bind(hostId)
        .first<RemoteHostRow>(),
    );
  });

  /** The account server creates hosted server IDs, so only the account it created one for can publish it. */
  readonly #requireHostReservation = Effect.fn("RemoteControlPlane.requireHostReservation")(function* (
    this: RemoteControlPlane,
    hostId: string,
    userId: string,
  ): Effect.fn.Return<void, RemoteFailure, RemoteDependencies> {
    const dependencies = yield* RemoteDependencies;
    const reservation = yield* remoteCall(() =>
      dependencies.database
        .prepare("SELECT owner_user_id, desired_state FROM hosted_servers WHERE server_id = ? LIMIT 1")
        .bind(hostId)
        .first<{ owner_user_id: string; desired_state: string }>(),
    );
    if (reservation && (reservation.owner_user_id !== userId || reservation.desired_state === "deleted")) {
      return yield* new RemoteControlPlaneError(403, "host_owner_mismatch", "This host belongs to another account.");
    }
  });

  /** The latest key handovers of each host that `condition` selects, the earliest step first. */
  readonly #keyHandoversByHost = Effect.fn("RemoteControlPlane.keyHandoversByHost")(function* (
    this: RemoteControlPlane,
    condition: SqlCondition,
  ): Effect.fn.Return<Map<string, HostKeyHandover[]>, RemoteFailure, RemoteDependencies> {
    const dependencies = yield* RemoteDependencies;
    const result = yield* remoteCall(() =>
      dependencies.database
        .prepare(
          `SELECT host_id, issued_at, previous_public_key, public_key, previous_signature, signature
         FROM (
           SELECT host_id, issued_at, previous_public_key, public_key, previous_signature, signature,
                  ROW_NUMBER() OVER (PARTITION BY host_id ORDER BY issued_at DESC) AS position
           FROM remote_host_key_handovers WHERE ${condition.sql}
         )
         WHERE position <= ?
         ORDER BY host_id, issued_at`,
        )
        .bind(...condition.binds, HOST_KEY_HANDOVER_LIMIT)
        .all<RemoteHostKeyHandoverRow>(),
    );
    const handovers = new Map<string, HostKeyHandover[]>();
    for (const row of result.results ?? []) {
      const list = handovers.get(row.host_id) ?? [];
      list.push({
        hostId: row.host_id,
        issuedAt: row.issued_at,
        previousPublicKey: row.previous_public_key,
        publicKey: row.public_key,
        previousSignature: row.previous_signature,
        signature: row.signature,
      });
      handovers.set(row.host_id, list);
    }
    return handovers;
  });

  readonly #keyHandovers = Effect.fn("RemoteControlPlane.keyHandovers")(function* (
    this: RemoteControlPlane,
    hostId: string,
  ): Effect.fn.Return<HostKeyHandover[], RemoteFailure, RemoteDependencies> {
    return (yield* this.#keyHandoversByHost({ sql: "host_id = ?", binds: [hostId] })).get(hostId) ?? [];
  });

  /** Whether this exact handover is stored. */
  readonly #handoverStored = Effect.fn("RemoteControlPlane.handoverStored")(function* (
    this: RemoteControlPlane,
    handover: HostKeyHandover,
  ): Effect.fn.Return<boolean, RemoteFailure, RemoteDependencies> {
    const dependencies = yield* RemoteDependencies;
    const row = yield* remoteCall(() =>
      dependencies.database
        .prepare(
          `SELECT 1 AS stored FROM remote_host_key_handovers
         WHERE host_id = ? AND signature = ? AND issued_at = ? AND previous_public_key = ? AND public_key = ?
           AND previous_signature = ?
         LIMIT 1`,
        )
        .bind(
          handover.hostId,
          handover.signature,
          handover.issuedAt,
          handover.previousPublicKey,
          handover.publicKey,
          handover.previousSignature,
        )
        .first<{ stored: number }>(),
    );
    return row !== null;
  });

  #authEventStatement(event: RemoteAuthEvent, now: number, condition?: SqlCondition): D1PreparedStatement {
    return authEventStatement(this.#database, event, now, condition);
  }

  #authEpochEventStatement(hostId: string, now: number, ownerUserId?: string): D1PreparedStatement {
    return this.#database
      .prepare(
        `INSERT INTO remote_auth_events(event_id, payload, created_at, attempts, next_attempt_at)
         SELECT ?, json_object('type', 'remote-auth-changed', 'hostId', host_id, 'authEpoch', auth_epoch), ?, 0, ?
         FROM remote_hosts WHERE host_id = ? AND (? IS NULL OR owner_user_id = ?)`,
      )
      .bind(crypto.randomUUID(), now, now, hostId, ownerUserId ?? null, ownerUserId ?? null);
  }

  /**
   * The event is already in D1 next to the state it reports, and the cron redelivers it, so the
   * answer must not wait for Signal. `schedule` is the Worker's `waitUntil`; without it the caller
   * awaits the delivery, which is what the tests and any script outside a request need.
   */
  readonly #flushAuthEvents = Effect.fn("RemoteControlPlane.flushAuthEvents")(function* (
    this: RemoteControlPlane,
  ): Effect.fn.Return<void, RemoteFailure, RemoteDependencies> {
    const dependencies = yield* RemoteDependencies;
    // The time is read when the delivery starts, which can be later than this flush.
    const delivery = Effect.suspend(() =>
      deliverRemoteAuthEvents({
        database: dependencies.database,
        webhookUrl: dependencies.webhookUrl,
        webhookSecret: dependencies.webhookSecret,
        fetch: dependencies.fetch,
        now: dependencies.now(),
      }),
    );
    if (!dependencies.schedule) return yield* delivery;
    dependencies.schedule(delivery);
  });
}

export const notifyAccountProfileChanged = Effect.fn("RemoteControlPlane.notifyProfileChanged")(function* (
  bindings: Pick<WorkerBindings, "DB" | "REMOTE_AUTH_WEBHOOK_URL" | "REMOTE_AUTH_WEBHOOK_SECRET">,
  userId: string,
  waitUntil: (delivery: Effect.Effect<void, RemoteFailure>) => void,
  fetcher: RemoteFetch = (input, init) => fetch(input, init),
) {
  if (!bindings.REMOTE_AUTH_WEBHOOK_URL?.trim() || !bindings.REMOTE_AUTH_WEBHOOK_SECRET?.trim()) return;
  const now = Date.now();
  yield* remoteCall(() => authEventStatement(bindings.DB, { type: "account-profile-changed", userId }, now).run());
  waitUntil(deliverPendingRemoteAuthEvents(bindings, now, fetcher));
});

/** Queues one event for Signal. `remote/api` decodes each event type with its own schema. */
export function authEventStatement(
  database: D1Database,
  event: RemoteAuthEvent,
  now: number,
  condition?: SqlCondition,
): D1PreparedStatement {
  return database
    .prepare(
      `INSERT INTO remote_auth_events(event_id, payload, created_at, attempts, next_attempt_at)
       SELECT ?, ?, ?, 0, ?${condition ? ` WHERE ${condition.sql}` : ""}`,
    )
    .bind(crypto.randomUUID(), JSON.stringify(event), now, now, ...(condition?.binds ?? []));
}

function telegramNotConfigured(): RemoteControlPlaneError {
  return new RemoteControlPlaneError(503, "telegram_not_configured", "Telegram is not configured.");
}

function telegramLinkInvalid(): RemoteControlPlaneError {
  return new RemoteControlPlaneError(404, "telegram_link_invalid", "The Telegram link is invalid or expired.");
}

function memberLimitReached(limit: number): RemoteControlPlaneError {
  return new RemoteControlPlaneError(409, "member_limit_reached", `A host can have up to ${limit} members.`);
}

function handoverConflict(): RemoteControlPlaneError {
  return new RemoteControlPlaneError(
    409,
    "host_key_handover_conflict",
    "The host key handover does not start at the current host key.",
  );
}

function licenseUsersFull(): RemoteControlPlaneError {
  return new RemoteControlPlaneError(
    409,
    "license_users_full",
    "The owner's license has no free user. The owner can add users to the license.",
  );
}

export function deliverPendingRemoteAuthEvents(
  bindings: Pick<WorkerBindings, "DB" | "REMOTE_AUTH_WEBHOOK_URL" | "REMOTE_AUTH_WEBHOOK_SECRET">,
  now: number,
  fetcher: RemoteFetch = (input, init) => fetch(input, init),
) {
  return deliverRemoteAuthEvents({
    database: bindings.DB,
    webhookUrl: bindings.REMOTE_AUTH_WEBHOOK_URL?.trim() || null,
    webhookSecret: bindings.REMOTE_AUTH_WEBHOOK_SECRET?.trim() || null,
    fetch: fetcher,
    now,
  });
}

const deliverRemoteAuthEvents = Effect.fn("RemoteControlPlane.deliverAuthEvents")(function* (input: {
  database: D1Database;
  webhookUrl: string | null;
  webhookSecret: string | null;
  fetch: RemoteFetch;
  now: number;
}) {
  const { webhookUrl, webhookSecret } = input;
  if (!webhookUrl || !webhookSecret) return;
  // The claim moves the events out of reach of other drains until it lapses, so each drain sends its own.
  const result = yield* remoteCall(() =>
    input.database
      .prepare(
        `UPDATE remote_auth_events SET next_attempt_at = ?
         WHERE event_id IN (SELECT event_id FROM remote_auth_events WHERE next_attempt_at <= ? ORDER BY created_at LIMIT 50)
         RETURNING event_id, payload, attempts`,
      )
      .bind(input.now + AUTH_EVENT_CLAIM_MS, input.now)
      .all<RemoteAuthEventRow>(),
  );
  // Each event saves its result after its send, so a drain that the Worker stops keeps what it did.
  yield* Effect.forEach(
    result.results ?? [],
    (event) =>
      Effect.gen(function* () {
        const delivery = yield* Effect.result(
          Effect.gen(function* () {
            const timestamp = Math.floor(input.now / 1_000).toString();
            const signature = yield* hmacSha256(webhookSecret, `${timestamp}.${event.payload}`).pipe(
              Effect.mapError((error) =>
                error instanceof RemoteControlPlaneError ? error : new RemoteOperationError({}),
              ),
            );
            const response = yield* Effect.tryPromise({
              try: (signal) =>
                input.fetch(webhookUrl, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "OpenBot-Timestamp": timestamp,
                    "OpenBot-Signature": signature,
                  },
                  body: event.payload,
                  signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
                }),
              catch: () => new RemoteOperationError({}),
            });
            if (!response.ok) return yield* new RemoteOperationError({});
            yield* remoteCall(() =>
              input.database.prepare("DELETE FROM remote_auth_events WHERE event_id = ?").bind(event.event_id).run(),
            );
          }),
        );
        if (Result.isFailure(delivery)) {
          const delay = Math.min(AUTH_EVENT_RETRY_MS * 2 ** Math.min(event.attempts, 6), 60 * 60_000);
          yield* remoteCall(() =>
            input.database
              .prepare("UPDATE remote_auth_events SET attempts = attempts + 1, next_attempt_at = ? WHERE event_id = ?")
              .bind(input.now + delay, event.event_id)
              .run(),
          );
        }
      }),
    { concurrency: AUTH_EVENT_SEND_CONCURRENCY, discard: true },
  );
});

const PUBLIC_KEY_HEADER = "-----BEGIN PUBLIC KEY-----";
const PUBLIC_KEY_FOOTER = "-----END PUBLIC KEY-----";

/** Whether `signature` (base64url) is a valid Ed25519 signature of `message` by the SPKI PEM key. */
const verifyEd25519 = Effect.fn("RemoteControlPlane.verifyEd25519")(function* (
  publicKeyPem: string,
  signature: string,
  message: Uint8Array<ArrayBuffer>,
) {
  const verified = yield* Effect.result(
    Effect.tryPromise(async () => {
      const key = await crypto.subtle.importKey("spki", spkiFromPem(publicKeyPem), { name: "Ed25519" }, false, [
        "verify",
      ]);
      return crypto.subtle.verify({ name: "Ed25519" }, key, decodeBase64Url(signature), message);
    }),
  );
  return Result.isSuccess(verified) && verified.success;
});

/** The DER bytes of a PEM public key. Throws when the text is not one PEM public key. */
function spkiFromPem(pem: string): Uint8Array<ArrayBuffer> {
  const trimmed = pem.trim();
  if (!trimmed.startsWith(PUBLIC_KEY_HEADER) || !trimmed.endsWith(PUBLIC_KEY_FOOTER)) throw invalid("host public key");
  const encoded = trimmed.slice(PUBLIC_KEY_HEADER.length, -PUBLIC_KEY_FOOTER.length).replace(/\s/gu, "");
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) throw invalid("host public key");
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
}

function requiredIdentifier(value: string, name: string): string {
  if (!/^[A-Za-z0-9:_-]{1,128}$/u.test(value)) throw invalid(name);
  return value;
}

function requiredText(value: string, maximum: number, name: string): string {
  const text = value.trim();
  if (!text || text.length > maximum) throw invalid(name);
  return text;
}

function invalid(name: string): RemoteControlPlaneError {
  return new RemoteControlPlaneError(400, "invalid_remote_request", `The ${name} is invalid.`);
}

export const verifyRemoteServiceSignature = Effect.fn("RemoteControlPlane.verifyServiceSignature")(function* (
  secret: string,
  body: string,
  timestamp: string,
  signature: string,
  now = Date.now(),
) {
  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds) || Math.abs(now - timestampSeconds * 1_000) > 5 * 60_000) return false;
  const result = yield* Effect.result(
    Effect.gen(function* () {
      const key = yield* remoteCall(() => importHmacSha256Key(secret, "verify"));
      const signatureBytes = yield* remoteValidate(() => decodeBase64Url(signature));
      return yield* remoteCall(() =>
        crypto.subtle.verify("HMAC", key, signatureBytes, new TextEncoder().encode(`${timestamp}.${body}`)),
      );
    }),
  );
  return Result.isSuccess(result) && result.success;
});

function parseJwk(value: string): JWK {
  const parsed = JSON.parse(value);
  if (!isDynamicRecord(parsed) || parsed.kty !== "EC") {
    throw new Error("REMOTE_TICKET_PRIVATE_JWK is invalid.");
  }
  return { ...parsed, kty: "EC" };
}

function parseJwks(value: string, keyId: string): RemotePublicJwks {
  const parsed = JSON.parse(value);
  if (!isDynamicRecord(parsed) || !Array.isArray(parsed.keys)) {
    throw new Error("REMOTE_TICKET_PUBLIC_JWKS is invalid.");
  }
  const keys = parsed.keys.map(parsePublicJwk);
  if (!keys.some((key) => key.kid === keyId && key.kty === "EC"))
    throw new Error("The public JWKS does not contain the active key.");
  return { keys };
}

/** The private members of a JWK (RFC 7518 section 6). `/.well-known/jwks.json` never publishes them. */
const PRIVATE_JWK_MEMBERS = new Set(["d", "p", "q", "dp", "dq", "qi", "oth", "k"]);

function parsePublicJwk(value: unknown): RemotePublicJwk {
  if (!isDynamicRecord(value) || !isString(value.kid) || !isString(value.kty)) {
    throw new Error("REMOTE_TICKET_PUBLIC_JWKS is invalid.");
  }
  const publicMembers = Object.entries(value).filter(([name]) => !PRIVATE_JWK_MEMBERS.has(name));
  return { ...Object.fromEntries(publicMembers), kid: value.kid, kty: value.kty };
}
