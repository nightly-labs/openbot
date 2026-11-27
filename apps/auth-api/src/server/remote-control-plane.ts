import { BILLING_PLAN_IDS, storageTierGb, storageTierOf } from "@openbot/contracts/billing";
import { CUSTOM_SERVER_PAID_STATUSES } from "@openbot/contracts/custom-server-plans";
import {
  HOST_KEY_HANDOVER_LIMIT,
  type HostKeyHandover,
  hostKeyHandoverStatement,
} from "@openbot/contracts/host-key-handover";
import { DEFAULT_TEAM_MEMBER_LIMIT } from "@openbot/contracts/input-limits";
import { isAvatarColor } from "@openbot/contracts/ipc";
import { isSignalHomeId } from "@openbot/contracts/ipc-host-signal-home";
import type { MobileConnectHostBinding } from "@openbot/contracts/mobile-connect";
import { type DynamicRecord, isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
import type { RemoteAuthEvent } from "@openbot/contracts/signal-protocol/auth-events";
import {
  DISCORD_ROUTE_AUDIENCE,
  DISCORD_ROUTE_GUILDS_LIMIT,
  DISCORD_ROUTE_TTL_SECONDS,
  type DiscordRouteGuild,
} from "@openbot/contracts/signal-protocol/discord-route";
import {
  GITHUB_ROUTE_AUDIENCE,
  GITHUB_ROUTE_TTL_SECONDS,
  type GitHubRouteRepository,
} from "@openbot/contracts/signal-protocol/github-route";
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
  WATCH_TICKET_AUDIENCE,
  WATCH_TICKET_TTL_SECONDS,
  type WatchTicketClaims,
} from "@openbot/contracts/signal-protocol/watch-relay";
import {
  WEBHOOK_ROUTE_AUDIENCE,
  WEBHOOK_ROUTE_ID_PATTERN,
  WEBHOOK_ROUTE_TTL_SECONDS,
  WEBHOOK_ROUTES_LIMIT,
  type WebhookRoute,
} from "@openbot/contracts/signal-protocol/webhook-route";
import {
  isServerAppearanceColor,
  isServerAppearanceShape,
  type ServerAppearance,
  serverAppearanceOrNull,
} from "@openbot/contracts/team-protocol/host-appearance-v1";
import { sourceText } from "@openbot/i18n/source";
import { Context, Effect, Layer, Option, Result, Schema } from "effect";
import { importJWK, type JWK, type JWTPayload, SignJWT } from "jose";
import {
  type BillingEntitlement,
  getServerEntitlement,
  type OwnerLicense,
  type OwnerLicenseJsonRow,
  ownerLicenseForHost,
  ownerLicenseFromRows,
  ownerLicensesJsonSql,
  SERVER_MEMBER_LIMIT_SQL,
  type ServerEntitlementJsonRow,
  serverEntitlementFromRows,
  serverEntitlementsJsonSql,
  serverMemberLimitValueSql,
} from "./billing-entitlement";
import { decodeBase64Url, hmacSha256, importHmacSha256Key, randomToken, sha256 } from "./crypto";
import { CUSTOM_SERVER_OFFER_COLUMNS, type CustomServerOfferRow, customServerPayment } from "./custom-server-offers";
import type { GitHubInstallationTokensError, GitHubRepositoryRoute } from "./github-installation-tokens";
import { PERSISTENT_SESSION_EXPIRES_AT } from "./session-policy";
import { CHECKOUT_LIFETIME_SECONDS } from "./stripe-client";
import type { AuthUser, WorkerBindings } from "./types";

const TICKET_TTL_SECONDS = 180;
const LEGACY_SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;
const AUTH_EVENT_RETRY_MS = 60_000;
const AUTH_EVENT_SEND_CONCURRENCY = 6;
const AUTH_EVENT_CLAIM_MS = 2 * 60_000;
const MAX_OUTSTANDING_INVITES_PER_HOST = 50;
const MAX_PERMANENT_INVITES_PER_HOST = 5;
const MAX_TELEGRAM_LINK_CODES_PER_HOST = 10;
const OWNER_TRANSFER_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const OWNER_TRANSFER_COLUMNS = `t.transfer_id, t.host_id, h.name AS host_name, t.from_user_id, u.email AS from_email,
  u.name AS from_name, t.to_email, t.created_at, t.expires_at`;
const CUSTOM_SERVER_PAID_SQL = CUSTOM_SERVER_PAID_STATUSES.map((status) => `'${status}'`).join(", ");
const BILLED_SERVER_SQL = `(EXISTS(SELECT 1 FROM hosted_servers WHERE server_id = ?)
  OR EXISTS(SELECT 1 FROM custom_server_offers WHERE host_id = ?
    AND (subscription_status IN (${CUSTOM_SERVER_PAID_SQL}) OR (checkout_session_id IS NOT NULL AND updated_at > ?))))`;
const OWNER_TRANSFER_FROM = `FROM remote_owner_transfers t
  JOIN remote_hosts h ON h.host_id = t.host_id
  JOIN users u ON u.id = t.from_user_id`;

interface OwnerTransferRow {
  transfer_id: string;
  host_id: string;
  host_name: string;
  from_user_id: string;
  from_email: string;
  from_name: string | null;
  to_email: string;
  created_at: number;
  expires_at: number;
}

export interface OwnerTransferRecord {
  transferId: string;
  hostId: string;
  hostName: string;
  fromEmail: string;
  fromName: string | null;
  toEmail: string;
  createdAt: number;
  expiresAt: number;
}

function ownerTransferRecord(row: OwnerTransferRow): OwnerTransferRecord {
  return {
    transferId: row.transfer_id,
    hostId: row.host_id,
    hostName: row.host_name,
    fromEmail: row.from_email,
    fromName: row.from_name,
    toEmail: row.to_email,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function billedServerBinds(hostId: string, now: number): [string, string, number] {
  return [hostId, hostId, now - CHECKOUT_LIFETIME_SECONDS * 1_000];
}

function ownerTransferHosted(): RemoteControlPlaneError {
  return new RemoteControlPlaneError(409, "owner_transfer_hosted", sourceText("error.remote.ownerTransferHosted"));
}

function ownerTransferInvalid(): RemoteControlPlaneError {
  return new RemoteControlPlaneError(404, "owner_transfer_invalid", sourceText("error.remote.ownerTransferInvalid"));
}
const MEMBER_SEAT_AVAILABLE_SQL = `(
  EXISTS(SELECT 1 FROM remote_memberships WHERE host_id = ? AND user_id = ? AND status = 'active')
  OR (SELECT COUNT(*) FROM remote_memberships WHERE host_id = ? AND status = 'active') < ?
)`;
const LICENSE_SEAT_AVAILABLE_SQL = `(
  EXISTS(SELECT 1 FROM remote_memberships m JOIN remote_hosts h ON h.host_id = m.host_id
          WHERE h.owner_user_id = ? AND m.user_id = ? AND m.status = 'active')
  OR (SELECT COUNT(DISTINCT m.user_id) FROM remote_memberships m JOIN remote_hosts h ON h.host_id = m.host_id
       WHERE h.owner_user_id = ? AND m.user_id <> ? AND m.status = 'active') + 1 < ?
)`;

interface MemberSeat {
  readonly sql: string;
  readonly binds: readonly (string | number)[];
  readonly limit: number;
  readonly memberBinds: readonly (string | number)[] | null;
  readonly licenseBinds: readonly (string | number)[] | null;
}

interface ServerMemberLimitRow {
  member_limit: number;
}

interface MemberLimit {
  readonly limit: number;
  readonly fromLicense: boolean;
  readonly licenseRaises: boolean;
}

const JOINED_NOW_SQL = `EXISTS(
  SELECT 1 FROM remote_memberships
   WHERE host_id = ? AND user_id = ? AND status = 'active' AND membership_id = ? AND updated_at = ?
)`;

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

function removedAtAfterChange(change: { revoke: boolean; leave: boolean; activating: boolean }) {
  if (!change.revoke) return change.activating ? "NULL" : "removed_at";
  if (change.leave) return "CASE WHEN status = 'active' THEN 0 ELSE removed_at END";
  return "CASE WHEN status = 'revoked' AND removed_at > 0 THEN removed_at ELSE ? END";
}

export type { RemoteMemberRole };

function hostedStorage(plan: string | null, storageTier: number | null): { storageGb: number } | Record<string, never> {
  return isOneOf(BILLING_PLAN_IDS, plan) ? { storageGb: storageTierGb(plan, storageTierOf(storageTier)) } : {};
}

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

export interface SqlCondition {
  sql: string;
  binds: unknown[];
}

function memberLimitFrom(
  custom: ServerMemberLimitRow | null,
  plan: BillingEntitlement | null,
  license: OwnerLicense | null,
): MemberLimit {
  const below = (limit: number) => license !== null && license.users < limit;
  if (custom) return { limit: custom.member_limit, fromLicense: false, licenseRaises: below(custom.member_limit) };
  if (plan?.hosted) return { limit: plan.memberLimit, fromLicense: false, licenseRaises: below(plan.memberLimit) };
  if (license?.entitled && license.users > (plan?.memberLimit ?? 0))
    return { limit: license.users, fromLicense: true, licenseRaises: true };
  const limit = plan?.memberLimit ?? DEFAULT_TEAM_MEMBER_LIMIT;
  return {
    limit,
    fromLicense: false,
    licenseRaises: below(limit) || (license?.entitled === true && plan !== null && license.users === limit),
  };
}

function keyHandoversStatement(database: D1Database, condition: SqlCondition): D1PreparedStatement {
  return database
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
    .bind(...condition.binds, HOST_KEY_HANDOVER_LIMIT);
}

function keyHandoversJsonSql(host: string): string {
  return `(SELECT json_group_array(json_object('host_id', k.host_id, 'issued_at', k.issued_at,
      'previous_public_key', k.previous_public_key, 'public_key', k.public_key,
      'previous_signature', k.previous_signature, 'signature', k.signature))
    FROM (SELECT host_id, issued_at, previous_public_key, public_key, previous_signature, signature
            FROM remote_host_key_handovers WHERE host_id = ${host}
           ORDER BY issued_at DESC LIMIT ${HOST_KEY_HANDOVER_LIMIT}) k)`;
}

function jsonRows<T>(value: string): T[] {
  return JSON.parse(value);
}

function newestFirst<T extends { updated_at: number }>(rows: T[]): T[] {
  return rows.sort((left, right) => right.updated_at - left.updated_at);
}

function keyHandoversFromRows(rows: readonly RemoteHostKeyHandoverRow[]): Map<string, HostKeyHandover[]> {
  const handovers = new Map<string, HostKeyHandover[]>();
  for (const row of rows) {
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
}

interface RemoteHostRow {
  host_id: string;
  owner_user_id: string;
  name: string;
  logo_key: string | null;
  auth_epoch: number;
  machine_token_hash: string | null;
  device_public_key: string | null;
  signal_home: string | null;
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
  signal_home: string | null;
}

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
  max_uses: number | null;
  use_count: number;
}

interface TicketSignerConfig {
  privateJwk: string;
  publicJwks: string;
  keyId: string;
}

type RemoteFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

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
  pending_targets: string | null;
}

export type RemoteAuthEventBindings = Pick<
  WorkerBindings,
  "DB" | "REMOTE_AUTH_WEBHOOK_URL" | "REMOTE_AUTH_WEBHOOK_URLS" | "REMOTE_AUTH_WEBHOOK_SECRET"
>;

export interface RemoteSignalPlan {
  entryUrl: string;
  homes: ReadonlyMap<string, string>;
  locations: ReadonlyMap<string, SignalLocation>;
  countries: ReadonlyMap<string, readonly string[]>;
}

interface SignalHostPlace {
  location: SignalLocation | null;
  country: string | null;
  preferred: string | null;
}

export interface SignalLocation {
  latitude: number;
  longitude: number;
}

interface RemoteSignalHome {
  id: string;
  url: string;
}

const SIGNAL_COUNTRY_PATTERN = /^[A-Z][A-Z0-9]$/u;
const NEAR_SIGNAL_HOME_MARGIN_KM = 1_000;
const EARTH_RADIUS_KM = 6_371;
const SIGNAL_HOME_MOVE_TIMEOUT_MS = 2_000;

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
      signal?: string;
      now: number;
    },
  ) {
    const issuedAt = Math.floor(input.now / 1_000);
    const expiresAt = Math.min(issuedAt + TICKET_TTL_SECONDS, Math.floor(input.sessionExpiresAt / 1_000));
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
        ...(input.signal ? { signal: input.signal } : {}),
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

  readonly issueWatch = Effect.fn("RemoteTicketSigner.issueWatch")(function* (
    this: RemoteTicketSigner,
    input: {
      claims: Omit<WatchTicketClaims, "aud" | "jti" | "iat" | "exp">;
      sessionExpiresAt: number;
      now: number;
    },
  ) {
    const issuedAt = Math.floor(input.now / 1_000);
    const expiresAt = Math.min(issuedAt + WATCH_TICKET_TTL_SECONDS, Math.floor(input.sessionExpiresAt / 1_000));
    const signingKey = yield* this.#signingKey();
    const ticket = yield* remoteCall(() =>
      new SignJWT({ ...input.claims })
        .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: this.#keyId })
        .setJti(crypto.randomUUID())
        .setIssuedAt(issuedAt)
        .setExpirationTime(expiresAt)
        .setAudience(WATCH_TICKET_AUDIENCE)
        .sign(signingKey),
    );
    return { ticket, expiresAt: expiresAt * 1_000 };
  }).bind(this);

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

  readonly issueGitHubRoute = Effect.fn("RemoteTicketSigner.issueGitHubRoute")(function* (
    this: RemoteTicketSigner,
    input: { hostId: string; repositories: GitHubRouteRepository[]; now: number },
  ) {
    const signingKey = yield* this.#signingKey();
    const issuedAt = Math.floor(input.now / 1_000);
    const repositories = input.repositories.map((repository) => ({
      id: repository.id,
      installationId: repository.installationId,
    }));
    return yield* remoteCall(() =>
      new SignJWT({ hid: input.hostId, repositories })
        .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: this.#keyId })
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + GITHUB_ROUTE_TTL_SECONDS)
        .setAudience(GITHUB_ROUTE_AUDIENCE)
        .sign(signingKey),
    );
  }).bind(this);
}

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

const ticketSigners = new Map<string, { config: TicketSignerConfig; signer: RemoteTicketSigner }>();

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
    signal: RemoteSignalPlan | null;
    webhookUrls: readonly string[];
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
      | "REMOTE_SIGNAL_URL"
      | "REMOTE_SIGNAL_HOMES"
      | "REMOTE_SIGNAL_HOME_LOCATIONS"
      | "REMOTE_SIGNAL_HOME_COUNTRIES"
      | "REMOTE_AUTH_WEBHOOK_URL"
      | "REMOTE_AUTH_WEBHOOK_URLS"
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
    const webhookUrls = remoteAuthWebhookUrls(bindings);
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
      signal: remoteSignalPlan(bindings),
      webhookUrls,
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
        automatic?: boolean | undefined;
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
      if (input.automatic && existing && !existing.machine_token_hash) {
        const ownerMembership = yield* remoteCall(() =>
          dependencies.database
            .prepare("SELECT 1 FROM remote_memberships WHERE host_id = ? AND user_id = ? AND status = 'active' LIMIT 1")
            .bind(hostId, user.id)
            .first(),
        );
        if (!ownerMembership)
          return yield* new RemoteControlPlaneError(409, "host_removed", sourceText("error.remote.hostRemoved"));
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

  readonly revokeHostCredential = Effect.fn("RemoteControlPlane.revokeHostCredential")(
    function* (this: RemoteControlPlane, user: AuthUser, input: { hostId: string; machineToken: string }) {
      const dependencies = yield* RemoteDependencies;
      const hostId = yield* remoteValidate(() => requiredIdentifier(input.hostId, "host ID"));
      const host = yield* this.authenticateHost(hostId, input.machineToken);
      if (host.owner_user_id !== user.id) {
        return yield* new RemoteControlPlaneError(403, "host_owner_mismatch", "This host belongs to another account.");
      }
      const now = dependencies.now();
      yield* remoteCall(() =>
        dependencies.database.batch([
          dependencies.database
            .prepare(
              `UPDATE remote_hosts SET machine_token_hash = NULL, auth_epoch = auth_epoch + 1, updated_at = ?
               WHERE host_id = ? AND owner_user_id = ? AND machine_token_hash = ?`,
            )
            .bind(now, hostId, user.id, host.machine_token_hash),
          this.#authEpochEventStatement(hostId, now, user.id, { sql: "machine_token_hash IS NULL", binds: [] }),
        ]),
      );
      yield* this.#flushAuthEvents();
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

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
        if (yield* this.#handoverStored(handover)) return { keyHandovers: yield* this.#keyHandovers(hostId) };
        return yield* handoverConflict();
      }
      if (host.device_public_key !== handover.previousPublicKey) return yield* handoverConflict();

      const now = dependencies.now();
      const handoverId = crypto.randomUUID();
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
            `SELECT h.host_id, h.name, h.logo_key, h.appearance_shape, h.appearance_color, h.device_public_key,
           h.auth_epoch, m.membership_id, m.role, m.hidden_at,
           (SELECT s.plan FROM hosted_servers s WHERE s.server_id = h.host_id
             AND s.desired_state NOT IN ('deleted', 'stopped')) AS hosted_plan,
           (SELECT s.operator_host FROM hosted_servers s WHERE s.server_id = h.host_id
             AND s.desired_state NOT IN ('deleted', 'stopped')) AS operator_host,
           (SELECT s.storage_tier FROM hosted_servers s WHERE s.server_id = h.host_id
             AND s.desired_state NOT IN ('deleted', 'stopped')) AS hosted_storage_tier,
           ${keyHandoversJsonSql("h.host_id")} AS key_handovers,
           ${ownerLicensesJsonSql("h.owner_user_id")} AS owner_licenses,
           ${serverMemberLimitValueSql("h.host_id")} AS custom_member_limit,
           ${serverEntitlementsJsonSql("h.host_id")} AS server_entitlements,
           ${CUSTOM_SERVER_OFFER_COLUMNS}
         FROM remote_memberships m
         JOIN remote_hosts h ON h.host_id = m.host_id
         LEFT JOIN custom_server_offers o ON o.host_id = h.host_id
         WHERE m.user_id = ? AND m.status = 'active'
         ORDER BY h.name, h.host_id`,
          )
          .bind(userId)
          .all<
            {
              host_id: string;
              name: string;
              logo_key: string | null;
              appearance_shape: string | null;
              appearance_color: string | null;
              device_public_key: string | null;
              auth_epoch: number;
              membership_id: string;
              role: RemoteMemberRole;
              hidden_at: number | null;
              hosted_plan: string | null;
              operator_host: string | null;
              hosted_storage_tier: number | null;
              key_handovers: string;
              owner_licenses: string;
              custom_member_limit: number | null;
              server_entitlements: string;
            } & CustomServerOfferRow
          >(),
      );
      const now = dependencies.now();
      return (result.results ?? []).map((row) => {
        const license = ownerLicenseFromRows(newestFirst(jsonRows<OwnerLicenseJsonRow>(row.owner_licenses)), now);
        const plan = serverEntitlementFromRows(
          newestFirst(jsonRows<ServerEntitlementJsonRow>(row.server_entitlements)),
          now,
        );
        const custom = row.custom_member_limit === null ? null : { member_limit: row.custom_member_limit };
        const { limit, licenseRaises } = memberLimitFrom(custom, plan, license);
        return {
          hostId: row.host_id,
          name: row.name,
          logoKey: row.logo_key,
          appearance: storedAppearance(row.appearance_shape, row.appearance_color),
          devicePublicKey: row.device_public_key,
          keyHandovers:
            keyHandoversFromRows(
              jsonRows<RemoteHostKeyHandoverRow>(row.key_handovers).sort(
                (left, right) => left.issued_at - right.issued_at,
              ),
            ).get(row.host_id) ?? [],
          authEpoch: row.auth_epoch,
          membershipId: row.membership_id,
          role: row.role,
          memberLimit: license ? Math.min(limit, license.users) : limit,
          licenseRaisesMemberLimit: row.role === "owner" && licenseRaises,
          hosted: row.hosted_plan !== null,
          ...(row.hidden_at === null ? {} : { hidden: true as const }),
          ...(row.operator_host === null ? {} : { restartAvailable: false }),
          ...hostedStorage(row.hosted_plan, row.hosted_storage_tier),
          ...customServerPayment(row, row.role),
        };
      });
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
                u.email, u.name, u.avatar_url, u.chat_color
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
            chat_color: string | null;
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
        chatColor: isAvatarColor(member.chat_color) ? member.chat_color : null,
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

  readonly setHostAppearance = Effect.fn("RemoteControlPlane.setHostAppearance")(
    function* (
      this: RemoteControlPlane,
      userId: string,
      hostId: string,
      value: unknown,
    ): Effect.fn.Return<ServerAppearance | null, RemoteFailure, RemoteDependencies> {
      const dependencies = yield* RemoteDependencies;
      yield* this.#requireRole(hostId, userId, ["owner"]);
      const host = yield* this.#host(hostId);
      if (!host) return yield* new RemoteControlPlaneError(404, "host_not_found", "The remote host does not exist.");
      const appearance = yield* remoteValidate(() => {
        if (value === null) return null;
        const parsed = serverAppearanceOrNull(value);
        if (!parsed) throw invalid("server appearance");
        return parsed;
      });
      yield* remoteCall(() =>
        dependencies.database
          .prepare(
            "UPDATE remote_hosts SET appearance_shape = ?, appearance_color = ?, updated_at = ? WHERE host_id = ?",
          )
          .bind(appearance?.shape ?? null, appearance?.color ?? null, dependencies.now(), hostId)
          .run(),
      );
      return appearance;
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
        keyHandovers: yield* this.#keyHandovers(invite.host_id),
      };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

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
                 role = excluded.role, status = 'active', updated_at = excluded.updated_at, removed_at = NULL, hidden_at = NULL
                WHERE remote_memberships.status = 'revoked' AND remote_memberships.role <> 'owner'`
                : `INSERT INTO remote_memberships(
                 membership_id, host_id, user_id, role, status, created_at, updated_at
               ) SELECT ?, ?, ?, ?, 'active', ?, ?
                 FROM remote_invites
                WHERE invite_id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?
                  AND ${memberSeat.sql} AND ${INVITE_STILL_GRANTED_SQL}
               ON CONFLICT(host_id, user_id) DO UPDATE SET
                 role = excluded.role, status = 'active', updated_at = excluded.updated_at, removed_at = NULL, hidden_at = NULL
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

  readonly joinByCompanySignIn = Effect.fn("RemoteControlPlane.joinByCompanySignIn")(
    function* (
      this: RemoteControlPlane,
      hostId: string,
      userId: string,
      options: { restore: boolean },
    ): Effect.fn.Return<"joined" | "member" | "removed" | "no_seat", RemoteFailure, RemoteDependencies> {
      const dependencies = yield* RemoteDependencies;
      const existing = yield* remoteCall(() =>
        dependencies.database
          .prepare(
            "SELECT membership_id, role, status FROM remote_memberships WHERE host_id = ? AND user_id = ? LIMIT 1",
          )
          .bind(hostId, userId)
          .first<Pick<RemoteMembershipRow, "membership_id" | "role" | "status">>(),
      );
      if (existing?.status === "active" || existing?.role === "owner") return "member";
      if (existing && !options.restore) return "removed";
      const memberSeat = yield* this.#memberSeat(hostId, userId);
      const now = dependencies.now();
      const membershipId = crypto.randomUUID();
      const joinedNow = [hostId, userId, existing?.membership_id ?? membershipId, now] as const;
      const joined = yield* remoteCall(() =>
        dependencies.database.batch([
          dependencies.database
            .prepare(
              `INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
               SELECT ?, ?, ?, 'member', 'active', ?, ? WHERE ${memberSeat.sql}
               ON CONFLICT(host_id, user_id) DO UPDATE SET
                 role = 'member', status = 'active', updated_at = excluded.updated_at, removed_at = NULL, hidden_at = NULL
                WHERE remote_memberships.status = 'revoked' AND remote_memberships.role <> 'owner'`,
            )
            .bind(membershipId, hostId, userId, now, now, ...memberSeat.binds),
          dependencies.database
            .prepare(
              `UPDATE remote_sessions SET ended_at = ? WHERE host_id = ? AND user_id = ? AND ended_at IS NULL
                AND ${JOINED_NOW_SQL}`,
            )
            .bind(now, hostId, userId, ...joinedNow),
          this.#authEventStatement({ type: "account-servers-changed", userId }, now, {
            sql: JOINED_NOW_SQL,
            binds: [...joinedNow],
          }),
        ]),
      );
      if ((joined[0]?.meta.changes ?? 0) === 1) {
        yield* this.#flushAuthEvents();
        return "joined";
      }
      const concurrent = yield* remoteCall(() =>
        dependencies.database
          .prepare("SELECT 1 AS found FROM remote_memberships WHERE host_id = ? AND user_id = ? AND status = 'active'")
          .bind(hostId, userId)
          .first<{ found: number }>(),
      );
      return concurrent ? "member" : "no_seat";
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
      const activating = !input.revoke && (input.reactivate === true || membership.status === "active");
      const memberSeat = yield* this.#memberSeat(input.hostId, membership.user_id);
      const reactivating = activating && membership.status !== "active";
      if (reactivating) yield* this.#requireMemberSeat(memberSeat);
      const removedAt = removedAtAfterChange({
        revoke: input.revoke === true,
        leave: leavingOwnMembership,
        activating,
      });
      const now = dependencies.now();
      const status = input.revoke ? "revoked" : activating ? "active" : membership.status;
      const guardsRole = input.revoke !== true;
      const applied: SqlCondition = guardsRole
        ? {
            sql: "EXISTS(SELECT 1 FROM remote_memberships WHERE membership_id = ? AND status = ? AND role = ? AND updated_at = ?)",
            binds: [input.membershipId, status, role, now],
          }
        : {
            sql: "EXISTS(SELECT 1 FROM remote_memberships WHERE membership_id = ? AND status = ? AND updated_at = ?)",
            binds: [input.membershipId, status, now],
          };
      const closingInvites = input.revoke === true || (membership.role === "admin" && role !== "admin");
      const revokingAccess = input.revoke === true;
      const changed = yield* remoteCall(() =>
        dependencies.database.batch([
          dependencies.database
            .prepare(
              `UPDATE remote_memberships SET ${guardsRole ? "role = ?, " : ""}status = ?, updated_at = ?, removed_at = ${removedAt}${reactivating ? ", hidden_at = NULL" : ""}
            WHERE membership_id = ? AND status = ?${guardsRole ? " AND role = ?" : " AND role != 'owner'"}${activating ? ` AND ${memberSeat.sql}` : ""}`,
            )
            .bind(
              ...(guardsRole ? [role] : []),
              status,
              now,
              ...(removedAt.includes("?") ? [now] : []),
              input.membershipId,
              membership.status,
              ...(guardsRole ? [membership.role] : []),
              ...(activating ? memberSeat.binds : []),
            ),
          ...(closingInvites
            ? [
                dependencies.database
                  .prepare(
                    `UPDATE remote_invites SET revoked_at = ?
                  WHERE host_id = ? AND created_by_user_id = ? AND revoked_at IS NULL
                    AND (used_at IS NULL OR max_uses IS NULL) AND ${applied.sql}`,
                  )
                  .bind(now, input.hostId, membership.user_id, ...applied.binds),
              ]
            : []),
          ...(revokingAccess
            ? [
                dependencies.database
                  .prepare(
                    `UPDATE remote_hosts SET auth_epoch = auth_epoch + 1, updated_at = ? WHERE host_id = ? AND ${applied.sql}`,
                  )
                  .bind(now, input.hostId, ...applied.binds),
              ]
            : []),
          dependencies.database
            .prepare(
              `INSERT INTO remote_auth_events(event_id, payload, created_at, attempts, next_attempt_at)
            SELECT lower(hex(randomblob(16))),
                   json_object('type', 'remote-session-ended', 'hostId', host_id, 'sessionId', session_id),
                   ?, 0, ?
              FROM remote_sessions
             WHERE host_id = ? AND user_id = ? AND ended_at IS NULL AND ${applied.sql}`,
            )
            .bind(now, now, input.hostId, membership.user_id, ...applied.binds),
          dependencies.database
            .prepare(
              `UPDATE remote_sessions SET ended_at = ?
            WHERE host_id = ? AND user_id = ? AND ended_at IS NULL AND ${applied.sql}`,
            )
            .bind(now, input.hostId, membership.user_id, ...applied.binds),
          ...(revokingAccess ? [this.#authEpochEventStatement(input.hostId, now, undefined, applied)] : []),
          this.#authEventStatement({ type: "account-servers-changed", userId: membership.user_id }, now, applied),
        ]),
      );
      yield* this.#flushAuthEvents();
      if ((changed[0]?.meta.changes ?? 0) === 1) return;
      const current = yield* remoteCall(() =>
        dependencies.database
          .prepare("SELECT role, status FROM remote_memberships WHERE membership_id = ?")
          .bind(input.membershipId)
          .first<Pick<RemoteMembershipRow, "role" | "status">>(),
      );
      if (activating && current?.status === membership.status && current.role === membership.role) {
        yield* this.#requireMemberSeat(memberSeat);
        return yield* memberLimitReached(memberSeat.limit);
      }
      if (current?.status === status && (!guardsRole || current.role === role)) return;
      return yield* new RemoteControlPlaneError(
        409,
        "membership_changed",
        "The membership changed while this change was made. Load the members again.",
      );
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly createOwnerTransfer = Effect.fn("RemoteControlPlane.createOwnerTransfer")(
    function* (this: RemoteControlPlane, user: AuthUser, input: { hostId: string; email: string }) {
      const dependencies = yield* RemoteDependencies;
      yield* this.#requireRole(input.hostId, user.id, ["owner"]);
      const email = input.email.trim().toLowerCase();
      if (!email || email.length > 320 || !email.includes("@")) return yield* invalid("new owner email");
      if (email === user.email.trim().toLowerCase()) {
        return yield* new RemoteControlPlaneError(
          409,
          "owner_transfer_self",
          sourceText("error.remote.ownerTransferSelf"),
        );
      }
      if (yield* this.#isBilled(input.hostId)) return yield* ownerTransferHosted();
      const now = dependencies.now();
      const transferId = crypto.randomUUID();
      const expiresAt = now + OWNER_TRANSFER_TTL_MS;
      const [, created] = yield* remoteCall(() =>
        dependencies.database.batch([
          dependencies.database
            .prepare(
              `UPDATE remote_owner_transfers SET status = 'cancelled', updated_at = ?
             WHERE host_id = ? AND status = 'pending'`,
            )
            .bind(now, input.hostId),
          dependencies.database
            .prepare(
              `INSERT INTO remote_owner_transfers(
             transfer_id, host_id, from_user_id, to_email, status, created_at, expires_at, updated_at
           )
           SELECT ?, host_id, ?, ?, 'pending', ?, ?, ?
             FROM remote_hosts WHERE host_id = ? AND owner_user_id = ? AND NOT ${BILLED_SERVER_SQL}`,
            )
            .bind(
              transferId,
              user.id,
              email,
              now,
              expiresAt,
              now,
              input.hostId,
              user.id,
              ...billedServerBinds(input.hostId, now),
            ),
          dependencies.database
            .prepare(
              `INSERT INTO remote_auth_events(event_id, payload, created_at, attempts, next_attempt_at)
             SELECT lower(hex(randomblob(16))), json_object('type', 'account-servers-changed', 'userId', id), ?, 0, ?
               FROM users WHERE email = ?
                AND EXISTS(SELECT 1 FROM remote_owner_transfers WHERE transfer_id = ? AND status = 'pending')`,
            )
            .bind(now, now, email, transferId),
        ]),
      );
      yield* this.#flushAuthEvents();
      if ((created?.meta.changes ?? 0) !== 1) {
        return yield* new RemoteControlPlaneError(
          403,
          "remote_permission_denied",
          "The account cannot perform this remote operation.",
        );
      }
      const transfer = yield* this.#ownerTransfer(transferId);
      if (!transfer) return yield* new RemoteOperationError({});
      return transfer;
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly pendingOwnerTransfer = Effect.fn("RemoteControlPlane.pendingOwnerTransfer")(
    function* (this: RemoteControlPlane, user: AuthUser, hostId: string) {
      const dependencies = yield* RemoteDependencies;
      yield* this.#requireRole(hostId, user.id, ["owner", "admin"]);
      const row = yield* remoteCall(() =>
        dependencies.database
          .prepare(
            `SELECT transfer_id FROM remote_owner_transfers
           WHERE host_id = ? AND status = 'pending' AND expires_at > ? LIMIT 1`,
          )
          .bind(hostId, dependencies.now())
          .first<{ transfer_id: string }>(),
      );
      return row ? yield* this.#ownerTransfer(row.transfer_id) : null;
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly cancelOwnerTransfer = Effect.fn("RemoteControlPlane.cancelOwnerTransfer")(
    function* (this: RemoteControlPlane, user: AuthUser, hostId: string) {
      const dependencies = yield* RemoteDependencies;
      yield* this.#requireRole(hostId, user.id, ["owner"]);
      yield* remoteCall(() =>
        dependencies.database
          .prepare(
            `UPDATE remote_owner_transfers SET status = 'cancelled', updated_at = ?
           WHERE host_id = ? AND status = 'pending'`,
          )
          .bind(dependencies.now(), hostId)
          .run(),
      );
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly incomingOwnerTransfers = Effect.fn("RemoteControlPlane.incomingOwnerTransfers")(
    function* (this: RemoteControlPlane, user: AuthUser) {
      const dependencies = yield* RemoteDependencies;
      const rows = yield* remoteCall(() =>
        dependencies.database
          .prepare(
            `SELECT ${OWNER_TRANSFER_COLUMNS} ${OWNER_TRANSFER_FROM}
           WHERE t.to_email = ? AND t.status = 'pending' AND t.expires_at > ? AND h.owner_user_id = t.from_user_id
           ORDER BY t.created_at DESC LIMIT 20`,
          )
          .bind(user.email.trim().toLowerCase(), dependencies.now())
          .all<OwnerTransferRow>(),
      );
      return (rows.results ?? []).map(ownerTransferRecord);
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly declineOwnerTransfer = Effect.fn("RemoteControlPlane.declineOwnerTransfer")(
    function* (this: RemoteControlPlane, user: AuthUser, transferId: string) {
      const dependencies = yield* RemoteDependencies;
      const declined = yield* remoteCall(() =>
        dependencies.database
          .prepare(
            `UPDATE remote_owner_transfers SET status = 'declined', updated_at = ?
           WHERE transfer_id = ? AND to_email = ? AND status = 'pending'`,
          )
          .bind(dependencies.now(), transferId, user.email.trim().toLowerCase())
          .run(),
      );
      if ((declined.meta.changes ?? 0) !== 1) return yield* ownerTransferInvalid();
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly acceptOwnerTransfer = Effect.fn("RemoteControlPlane.acceptOwnerTransfer")(
    function* (this: RemoteControlPlane, user: AuthUser, transferId: string) {
      const dependencies = yield* RemoteDependencies;
      const now = dependencies.now();
      const transfer = yield* remoteCall(() =>
        dependencies.database
          .prepare(
            `SELECT ${OWNER_TRANSFER_COLUMNS} ${OWNER_TRANSFER_FROM}
           WHERE t.transfer_id = ? AND t.to_email = ? AND t.status = 'pending' AND t.expires_at > ?
             AND h.owner_user_id = t.from_user_id
           LIMIT 1`,
          )
          .bind(transferId, user.email.trim().toLowerCase(), now)
          .first<OwnerTransferRow>(),
      );
      if (!transfer || transfer.from_user_id === user.id) return yield* ownerTransferInvalid();
      if (yield* this.#isBilled(transfer.host_id)) return yield* ownerTransferHosted();
      const hostId = transfer.host_id;
      const fromUserId = transfer.from_user_id;
      const existing = yield* remoteCall(() =>
        dependencies.database
          .prepare("SELECT membership_id FROM remote_memberships WHERE host_id = ? AND user_id = ? LIMIT 1")
          .bind(hostId, user.id)
          .first<{ membership_id: string }>(),
      );
      const membershipId = existing?.membership_id ?? crypto.randomUUID();
      const applied: SqlCondition = {
        sql: `EXISTS(SELECT 1 FROM remote_owner_transfers
               WHERE transfer_id = ? AND status = 'accepted' AND to_user_id = ? AND updated_at = ?)`,
        binds: [transferId, user.id, now],
      };
      const accountRoute = (table: string) =>
        dependencies.database
          .prepare(`UPDATE ${table} SET account_id = ? WHERE host_id = ? AND ${applied.sql}`)
          .bind(user.id, hostId, ...applied.binds);
      const ownerColumn = (table: string, keyColumn: string, ownerColumnName: string) =>
        dependencies.database
          .prepare(
            `UPDATE ${table} SET ${ownerColumnName} = ? WHERE ${keyColumn} = ? AND ${ownerColumnName} = ? AND ${applied.sql}`,
          )
          .bind(user.id, hostId, fromUserId, ...applied.binds);
      const [accepted] = yield* remoteCall(() =>
        dependencies.database.batch([
          dependencies.database
            .prepare(
              `UPDATE remote_owner_transfers SET status = 'accepted', to_user_id = ?, updated_at = ?
             WHERE transfer_id = ? AND status = 'pending' AND expires_at > ?
               AND EXISTS(SELECT 1 FROM remote_hosts WHERE host_id = ? AND owner_user_id = ?) AND NOT ${BILLED_SERVER_SQL}`,
            )
            .bind(user.id, now, transferId, now, hostId, fromUserId, ...billedServerBinds(hostId, now)),
          dependencies.database
            .prepare(
              `UPDATE remote_hosts SET owner_user_id = ?, auth_epoch = auth_epoch + 1, updated_at = ?
             WHERE host_id = ? AND owner_user_id = ? AND ${applied.sql}`,
            )
            .bind(user.id, now, hostId, fromUserId, ...applied.binds),
          dependencies.database
            .prepare(
              `INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at)
             SELECT ?, ?, ?, 'owner', 'active', ?, ? WHERE ${applied.sql}
             ON CONFLICT(host_id, user_id) DO UPDATE SET
               role = 'owner', status = 'active', removed_at = NULL, hidden_at = NULL, updated_at = excluded.updated_at`,
            )
            .bind(membershipId, hostId, user.id, now, now, ...applied.binds),
          dependencies.database
            .prepare(
              `UPDATE remote_memberships SET role = 'member', status = 'revoked', removed_at = ?, updated_at = ?
             WHERE host_id = ? AND user_id = ? AND ${applied.sql}`,
            )
            .bind(now, now, hostId, fromUserId, ...applied.binds),
          dependencies.database
            .prepare(
              `UPDATE remote_invites SET revoked_at = ?
             WHERE host_id = ? AND created_by_user_id = ? AND revoked_at IS NULL
               AND (used_at IS NULL OR max_uses IS NULL) AND ${applied.sql}`,
            )
            .bind(now, hostId, fromUserId, ...applied.binds),
          ownerColumn("server_member_limits", "server_id", "owner_user_id"),
          ownerColumn("server_site_limits", "server_id", "owner_user_id"),
          ownerColumn("hosted_sites", "server_id", "user_id"),
          accountRoute("slack_workspace_routes"),
          accountRoute("discord_guild_routes"),
          accountRoute("telegram_chat_routes"),
          accountRoute("telegram_link_codes"),
          accountRoute("webhook_routes"),
          dependencies.database
            .prepare(
              `INSERT INTO remote_auth_events(event_id, payload, created_at, attempts, next_attempt_at)
             SELECT lower(hex(randomblob(16))),
                    json_object('type', 'remote-session-ended', 'hostId', host_id, 'sessionId', session_id),
                    ?, 0, ?
               FROM remote_sessions
              WHERE host_id = ? AND user_id = ? AND ended_at IS NULL AND ${applied.sql}`,
            )
            .bind(now, now, hostId, fromUserId, ...applied.binds),
          dependencies.database
            .prepare(
              `UPDATE remote_sessions SET ended_at = ?
             WHERE host_id = ? AND user_id = ? AND ended_at IS NULL AND ${applied.sql}`,
            )
            .bind(now, hostId, fromUserId, ...applied.binds),
          this.#authEpochEventStatement(hostId, now, user.id, applied),
          this.#authEventStatement({ type: "account-servers-changed", userId: fromUserId }, now, applied),
          this.#authEventStatement({ type: "account-servers-changed", userId: user.id }, now, applied),
        ]),
      );
      if ((accepted?.meta.changes ?? 0) !== 1) return yield* ownerTransferInvalid();
      yield* this.#flushAuthEvents();
      return { hostId, hostName: transfer.host_name };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly issueTransferredOwnerSession = Effect.fn("RemoteControlPlane.issueTransferredOwnerSession")(
    function* (this: RemoteControlPlane, hostId: string, machineToken: string, previousSessionToken: string | null) {
      const dependencies = yield* RemoteDependencies;
      const host = yield* this.authenticateHost(hostId, machineToken);
      const now = dependencies.now();
      const transfer = yield* remoteCall(() =>
        dependencies.database
          .prepare(
            `SELECT transfer_id, from_user_id, host_session_id FROM remote_owner_transfers
           WHERE host_id = ? AND status = 'accepted' AND to_user_id = ?
           ORDER BY updated_at DESC LIMIT 1`,
          )
          .bind(hostId, host.owner_user_id)
          .first<{ transfer_id: string; from_user_id: string; host_session_id: string | null }>(),
      );
      if (!transfer) {
        return yield* new RemoteControlPlaneError(
          404,
          "owner_session_unavailable",
          "This server has no ownership change to apply.",
        );
      }
      const previousHash = previousSessionToken
        ? yield* sha256(previousSessionToken).pipe(
            Effect.mapError((error) =>
              error instanceof RemoteControlPlaneError ? error : new RemoteOperationError({}),
            ),
          )
        : null;
      const sessionId = crypto.randomUUID();
      const sessionToken = randomToken();
      const sessionTokenHash = yield* sha256(sessionToken).pipe(
        Effect.mapError((error) => (error instanceof RemoteControlPlaneError ? error : new RemoteOperationError({}))),
      );
      const issued: SqlCondition = {
        sql: "EXISTS(SELECT 1 FROM remote_owner_transfers WHERE transfer_id = ? AND host_session_id = ?)",
        binds: [transfer.transfer_id, sessionId],
      };
      const [claimed] = yield* remoteCall(() =>
        dependencies.database.batch([
          dependencies.database
            .prepare(
              `UPDATE remote_owner_transfers SET host_session_id = ?
             WHERE transfer_id = ? AND host_session_id IS ?`,
            )
            .bind(sessionId, transfer.transfer_id, transfer.host_session_id),
          dependencies.database
            .prepare(
              `INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at)
             SELECT ?, ?, ?, ?, ?, ? WHERE ${issued.sql}`,
            )
            .bind(
              sessionId,
              host.owner_user_id,
              sessionTokenHash,
              PERSISTENT_SESSION_EXPIRES_AT,
              now,
              now,
              ...issued.binds,
            ),
          dependencies.database
            .prepare(
              `UPDATE auth_sessions SET revoked_at = ?
             WHERE revoked_at IS NULL AND ${issued.sql} AND (id IS ? OR (token_hash IS ? AND user_id IN (?, ?)))`,
            )
            .bind(
              now,
              ...issued.binds,
              transfer.host_session_id,
              previousHash,
              transfer.from_user_id,
              host.owner_user_id,
            ),
        ]),
      );
      if ((claimed?.meta.changes ?? 0) !== 1) {
        return yield* new RemoteControlPlaneError(
          409,
          "owner_session_superseded",
          "Another request applied this ownership change. Try again.",
        );
      }
      const owner = yield* remoteCall(() =>
        dependencies.database
          .prepare("SELECT id, email, name, avatar_url FROM users WHERE id = ?")
          .bind(host.owner_user_id)
          .first<{ id: string; email: string; name: string | null; avatar_url: string | null }>(),
      );
      if (!owner) return yield* new RemoteOperationError({});
      return {
        sessionToken,
        user: { id: owner.id, email: owner.email, name: owner.name, avatarUrl: owner.avatar_url },
      };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly #isBilled = Effect.fn("RemoteControlPlane.isBilled")(function* (
    this: RemoteControlPlane,
    hostId: string,
  ): Effect.fn.Return<boolean, RemoteFailure, RemoteDependencies> {
    const dependencies = yield* RemoteDependencies;
    const row = yield* remoteCall(() =>
      dependencies.database
        .prepare(`SELECT ${BILLED_SERVER_SQL} AS billed`)
        .bind(...billedServerBinds(hostId, dependencies.now()))
        .first<{ billed: number }>(),
    );
    return row?.billed === 1;
  });

  readonly #ownerTransfer = Effect.fn("RemoteControlPlane.ownerTransfer")(function* (
    this: RemoteControlPlane,
    transferId: string,
  ): Effect.fn.Return<OwnerTransferRecord | null, RemoteFailure, RemoteDependencies> {
    const dependencies = yield* RemoteDependencies;
    const row = yield* remoteCall(() =>
      dependencies.database
        .prepare(`SELECT ${OWNER_TRANSFER_COLUMNS} ${OWNER_TRANSFER_FROM} WHERE t.transfer_id = ? LIMIT 1`)
        .bind(transferId)
        .first<OwnerTransferRow>(),
    );
    return row ? ownerTransferRecord(row) : null;
  });

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
      const expiresAt = PERSISTENT_SESSION_EXPIRES_AT;
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
                h.auth_epoch, h.signal_home
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
      const signal = dependencies.signal;
      if (!signal) return yield* remoteSignalNotConfigured();
      const home = configuredSignalHome(signal, session.signal_home);
      const issued = yield* dependencies.signer.issue({
        sessionId,
        hostId: session.host_id,
        userId,
        membershipId: session.membership_id,
        role: session.role,
        authEpoch: session.auth_epoch,
        sessionExpiresAt: session.expires_at,
        clientPublicKey: boundClientPublicKey,
        ...(home ? { signal: home.id } : {}),
        now,
      });
      return { ...issued, signalUrl: home?.url ?? signal.entryUrl };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly issueWatchTicket = Effect.fn("RemoteControlPlane.issueWatchTicket")(
    function* (
      this: RemoteControlPlane,
      input: {
        watchSessionId: string;
        userId: string;
        hostId: string;
        clientPublicKey: string;
        sessionExpiresAt: number;
      },
    ) {
      const dependencies = yield* RemoteDependencies;
      const membership = yield* remoteCall(() =>
        dependencies.database
          .prepare(
            `SELECT m.membership_id, m.host_id, m.user_id, m.role, m.status, h.auth_epoch, h.signal_home
         FROM remote_memberships m
         JOIN remote_hosts h ON h.host_id = m.host_id
         WHERE m.host_id = ? AND m.user_id = ? AND m.status = 'active' LIMIT 1`,
          )
          .bind(input.hostId, input.userId)
          .first<RemoteMembershipRow & { auth_epoch: number; signal_home: string | null }>(),
      );
      const member = yield* remoteValidate(() => this.#assertRole(membership, ["owner", "admin", "member"]));
      const signal = dependencies.signal;
      if (!signal) return yield* remoteSignalNotConfigured();
      const home = configuredSignalHome(signal, member.signal_home);
      const issued = yield* dependencies.signer.issueWatch({
        claims: {
          watchSessionId: input.watchSessionId,
          hostId: member.host_id,
          userId: input.userId,
          membershipId: member.membership_id,
          role: member.role,
          authEpoch: member.auth_epoch,
          clientPublicKey: input.clientPublicKey,
          ...(home ? { signal: home.id } : {}),
        },
        sessionExpiresAt: input.sessionExpiresAt,
        now: dependencies.now(),
      });
      return { ...issued, signalUrl: home?.url ?? signal.entryUrl };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly planChanged = Effect.fn("RemoteControlPlane.planChanged")(
    function* (this: RemoteControlPlane, hostId: string): Effect.fn.Return<void, RemoteFailure, RemoteDependencies> {
      yield* this.#serversChanged(
        "SELECT user_id FROM remote_memberships WHERE host_id = ? AND status = 'active'",
        hostId,
      );
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

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

  readonly removeOwnedHost = Effect.fn("RemoteControlPlane.removeOwnedHost")(
    function* (this: RemoteControlPlane, userId: string, hostId: string) {
      yield* this.#requireRole(hostId, userId, ["owner"]);
      if (yield* this.#isBilled(hostId))
        return yield* new RemoteControlPlaneError(
          409,
          "hosted_server_removal",
          sourceText("error.remote.hostedServerRemoval"),
        );
      yield* this.deleteHost(userId, hostId, true);
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

  readonly setHostHidden = Effect.fn("RemoteControlPlane.setHostHidden")(
    function* (this: RemoteControlPlane, userId: string, hostId: string, hidden: boolean) {
      const membership = yield* this.#requireRole(hostId, userId, ["owner", "admin", "member"]);
      const dependencies = yield* RemoteDependencies;
      const now = dependencies.now();
      yield* remoteCall(() =>
        dependencies.database
          .prepare(
            `UPDATE remote_memberships SET hidden_at = ?, updated_at = ?
              WHERE membership_id = ? AND status = 'active' AND (hidden_at IS NULL) = ?`,
          )
          .bind(hidden ? now : null, now, membership.membership_id, hidden ? 1 : 0)
          .run(),
      );
      yield* this.#serversChanged("SELECT ? AS user_id", userId);
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
      const creditMoveId = `server-removed:${crypto.randomUUID()}`;
      yield* remoteCall(() =>
        dependencies.database.batch([
          dependencies.database
            .prepare(
              `INSERT INTO credit_ledger(
                 entry_id, user_id, server_id, amount_tenths, kind, actor_user_id, reference, created_at
               )
               SELECT ?1, NULL, ?2, -balance, 'transfer', ?3, ?2, ?4
                 FROM (SELECT COALESCE(SUM(amount_tenths), 0) AS balance FROM credit_ledger WHERE server_id = ?2)
                WHERE balance > 0 AND EXISTS (SELECT 1 FROM remote_hosts WHERE host_id = ?2 AND owner_user_id = ?3)`,
            )
            .bind(`${creditMoveId}:out`, hostId, ownerUserId, now),
          dependencies.database
            .prepare(
              `INSERT INTO credit_ledger(
                 entry_id, user_id, server_id, amount_tenths, kind, actor_user_id, reference, created_at
               )
               SELECT ?1, ?2, NULL, -amount_tenths, 'transfer', ?2, ?3, ?4 FROM credit_ledger WHERE entry_id = ?5`,
            )
            .bind(`${creditMoveId}:in`, ownerUserId, hostId, now, `${creditMoveId}:out`),
          dependencies.database
            .prepare(
              `UPDATE credit_holds SET user_id = ?2, server_id = NULL
                WHERE server_id = ?1 AND status = 'held'
                  AND EXISTS (SELECT 1 FROM remote_hosts WHERE host_id = ?1 AND owner_user_id = ?2)`,
            )
            .bind(hostId, ownerUserId),
          dependencies.database
            .prepare(
              `UPDATE credit_grants SET user_id = ?2, server_id = NULL
                WHERE server_id = ?1 AND status = 'active'
                  AND EXISTS (SELECT 1 FROM remote_hosts WHERE host_id = ?1 AND owner_user_id = ?2)`,
            )
            .bind(hostId, ownerUserId),
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
          dependencies.database
            .prepare("UPDATE hosted_sites SET server_id = NULL WHERE server_id = ? AND user_id = ?")
            .bind(hostId, ownerUserId),
          dependencies.database
            .prepare(
              "UPDATE webhook_routes SET revoked_at = ? WHERE host_id = ? AND account_id = ? AND revoked_at IS NULL",
            )
            .bind(now, hostId, ownerUserId),
          ...(retainIdentity
            ? [
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
    function* (
      this: RemoteControlPlane,
      hostId: string,
      machineToken: string,
      placement: {
        signalHome: boolean | null;
        failedSignalUrl: string | null;
        location?: SignalLocation | null;
        country?: string | null;
        preferredSignalHome?: string | null;
      } = {
        signalHome: null,
        failedSignalUrl: null,
      },
    ) {
      const dependencies = yield* RemoteDependencies;
      const host = yield* this.authenticateHost(hostId, machineToken);
      const signal = dependencies.signal;
      if (!signal) return yield* remoteSignalNotConfigured();
      if (placement.signalHome === null && host.signal_home !== null)
        yield* remoteCall(() =>
          dependencies.database
            .prepare("UPDATE remote_hosts SET signal_home = NULL WHERE host_id = ?")
            .bind(hostId)
            .run(),
        );
      const home = placement.signalHome
        ? yield* this.#placeHost(host, signal, placement.failedSignalUrl, {
            location: placement.location ?? null,
            country: placement.country ?? null,
            preferred: placement.preferredSignalHome ?? null,
          })
        : null;
      const issued = yield* dependencies.signer.issue({
        sessionId: `host-${hostId}`,
        hostId,
        userId: host.owner_user_id,
        membershipId: `${hostId}:host`,
        role: "host",
        authEpoch: host.auth_epoch,
        sessionExpiresAt: PERSISTENT_SESSION_EXPIRES_AT,
        ...(home ? { signal: home.id } : {}),
        now: dependencies.now(),
      });
      return { ...issued, signalUrl: home?.url ?? signal.entryUrl };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

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
            : route.platform === "telegram"
              ? dependencies.database
                  .prepare("SELECT host_id FROM telegram_chat_routes WHERE bot_id = ? AND chat_id = ?")
                  .bind(route.botId, route.chatId)
              : dependencies.database
                  .prepare(
                    `SELECT route.host_id FROM webhook_routes route
                     JOIN remote_hosts host ON host.host_id = route.host_id AND host.owner_user_id = route.account_id
                     WHERE route.route_id = ? AND route.revoked_at IS NULL`,
                  )
                  .bind(route.routeId);
      const row = yield* remoteCall(() => statement.first<{ host_id: string }>());
      return row?.host_id ?? null;
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

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

  readonly listSignalHomes = Effect.fn("RemoteControlPlane.listSignalHomes")(
    function* (
      this: RemoteControlPlane,
      hostId: string,
      machineToken: string,
    ): Effect.fn.Return<{ homes: RemoteSignalHome[] }, RemoteFailure, RemoteDependencies> {
      const dependencies = yield* RemoteDependencies;
      yield* this.authenticateHost(hostId, machineToken);
      const signal = dependencies.signal;
      if (!signal) return yield* remoteSignalNotConfigured();
      return { homes: [...signal.homes].map(([id, url]) => ({ id, url })) };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

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

  readonly issueGitHubRoute = Effect.fn("RemoteControlPlane.issueGitHubRoute")(
    function* (
      this: RemoteControlPlane,
      hostId: string,
      machineToken: string,
      repositories: Effect.Effect<GitHubRepositoryRoute[], GitHubInstallationTokensError>,
    ): Effect.fn.Return<
      { ticket: string; repositories: GitHubRepositoryRoute[] },
      RemoteFailure | GitHubInstallationTokensError,
      RemoteDependencies
    > {
      const dependencies = yield* RemoteDependencies;
      yield* this.authenticateHost(hostId, machineToken);
      const routes = yield* repositories;
      return {
        ticket: yield* dependencies.signer.issueGitHubRoute({ hostId, repositories: routes, now: dependencies.now() }),
        repositories: routes,
      };
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

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
      const current = yield* this.#telegramLinkState(codeHash, input, now);
      if ("hostId" in current) return current;
      return yield* telegramLinkInvalid();
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

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
      return input.chats
        .filter((chat) => linked.get(`${chat.botId}:${chat.id}`) === chat.linkedAt)
        .map((chat) => ({ id: chat.id, botId: chat.botId, linkedAt: chat.linkedAt }));
    },
    (operation) => operation.pipe(Effect.provide(this.#layer)),
  ).bind(this);

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

  readonly #memberSeat = Effect.fn("RemoteControlPlane.memberSeat")(function* (
    this: RemoteControlPlane,
    hostId: string,
    userId: string,
  ): Effect.fn.Return<MemberSeat, RemoteFailure, RemoteDependencies> {
    const license = yield* this.#ownerLicense(hostId);
    const { limit, fromLicense } = yield* this.#memberLimit(hostId, license);
    const licenseBinds = license ? [license.ownerId, userId, license.ownerId, license.ownerId, license.users] : null;
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

  readonly #memberLimit = Effect.fn("RemoteControlPlane.memberLimit")(function* (
    this: RemoteControlPlane,
    hostId: string,
    license: OwnerLicense | null,
  ): Effect.fn.Return<MemberLimit, RemoteFailure, RemoteDependencies> {
    const dependencies = yield* RemoteDependencies;
    const custom = yield* remoteCall(() =>
      dependencies.database.prepare(SERVER_MEMBER_LIMIT_SQL).bind(hostId).first<{ member_limit: number }>(),
    );
    if (custom) return memberLimitFrom(custom, null, license);
    const plan = yield* getServerEntitlement(dependencies.database, hostId, dependencies.now()).pipe(
      Effect.mapError((error) => (error instanceof RemoteControlPlaneError ? error : new RemoteOperationError({}))),
    );
    return memberLimitFrom(null, plan, license);
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
          `SELECT host_id, owner_user_id, name, logo_key, auth_epoch, machine_token_hash, device_public_key, signal_home
         FROM remote_hosts WHERE host_id = ? LIMIT 1`,
        )
        .bind(hostId)
        .first<RemoteHostRow>(),
    );
  });

  readonly #placeHost = Effect.fn("RemoteControlPlane.placeHost")(function* (
    this: RemoteControlPlane,
    host: RemoteHostRow,
    signal: RemoteSignalPlan,
    failedSignalUrl: string | null,
    place: SignalHostPlace,
  ): Effect.fn.Return<RemoteSignalHome | null, RemoteFailure, RemoteDependencies> {
    const dependencies = yield* RemoteDependencies;
    const current = configuredSignalHome(signal, host.signal_home);
    const preferred = configuredSignalHome(signal, place.preferred);
    if (preferred && preferred.url !== failedSignalUrl) {
      if (preferred.id === host.signal_home) return preferred;
      if (yield* signalAnswers(dependencies.fetch, preferred.url, SIGNAL_HOME_MOVE_TIMEOUT_MS))
        return yield* this.#storeSignalHome(host, signal, preferred);
    }
    const candidates = nearSignalHomes(signal, failedSignalUrl, place);
    if (current && candidates.includes(current.id)) return current;
    const chosen = configuredSignalHome(signal, yield* rendezvousSignalHome(host.host_id, candidates));
    if (!chosen || chosen.id === host.signal_home) return chosen;
    if (
      current &&
      current.url !== failedSignalUrl &&
      !(yield* signalAnswers(dependencies.fetch, chosen.url, SIGNAL_HOME_MOVE_TIMEOUT_MS))
    )
      return current;
    return yield* this.#storeSignalHome(host, signal, chosen);
  });

  readonly #storeSignalHome = Effect.fn("RemoteControlPlane.storeSignalHome")(function* (
    this: RemoteControlPlane,
    host: RemoteHostRow,
    signal: RemoteSignalPlan,
    chosen: RemoteSignalHome,
  ): Effect.fn.Return<RemoteSignalHome, RemoteFailure, RemoteDependencies> {
    const dependencies = yield* RemoteDependencies;
    const stored = yield* remoteCall(() =>
      dependencies.database
        .prepare("UPDATE remote_hosts SET signal_home = ? WHERE host_id = ? AND signal_home IS ?")
        .bind(chosen.id, host.host_id, host.signal_home)
        .run(),
    );
    if ((stored.meta.changes ?? 0) === 1) return chosen;
    const raced = yield* remoteCall(() =>
      dependencies.database
        .prepare("SELECT signal_home FROM remote_hosts WHERE host_id = ? LIMIT 1")
        .bind(host.host_id)
        .first<{ signal_home: string | null }>(),
    );
    return configuredSignalHome(signal, raced?.signal_home ?? null) ?? chosen;
  });

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

  readonly #keyHandoversByHost = Effect.fn("RemoteControlPlane.keyHandoversByHost")(function* (
    this: RemoteControlPlane,
    condition: SqlCondition,
  ): Effect.fn.Return<Map<string, HostKeyHandover[]>, RemoteFailure, RemoteDependencies> {
    const dependencies = yield* RemoteDependencies;
    const result = yield* remoteCall(() =>
      keyHandoversStatement(dependencies.database, condition).all<RemoteHostKeyHandoverRow>(),
    );
    return keyHandoversFromRows(result.results ?? []);
  });

  readonly #keyHandovers = Effect.fn("RemoteControlPlane.keyHandovers")(function* (
    this: RemoteControlPlane,
    hostId: string,
  ): Effect.fn.Return<HostKeyHandover[], RemoteFailure, RemoteDependencies> {
    return (yield* this.#keyHandoversByHost({ sql: "host_id = ?", binds: [hostId] })).get(hostId) ?? [];
  });

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

  #authEpochEventStatement(
    hostId: string,
    now: number,
    ownerUserId?: string,
    condition?: SqlCondition,
  ): D1PreparedStatement {
    return this.#database
      .prepare(
        `INSERT INTO remote_auth_events(event_id, payload, created_at, attempts, next_attempt_at)
         SELECT ?, json_object('type', 'remote-auth-changed', 'hostId', host_id, 'authEpoch', auth_epoch), ?, 0, ?
         FROM remote_hosts WHERE host_id = ? AND (? IS NULL OR owner_user_id = ?)${condition ? ` AND ${condition.sql}` : ""}`,
      )
      .bind(
        crypto.randomUUID(),
        now,
        now,
        hostId,
        ownerUserId ?? null,
        ownerUserId ?? null,
        ...(condition?.binds ?? []),
      );
  }

  readonly #flushAuthEvents = Effect.fn("RemoteControlPlane.flushAuthEvents")(function* (
    this: RemoteControlPlane,
  ): Effect.fn.Return<void, RemoteFailure, RemoteDependencies> {
    const dependencies = yield* RemoteDependencies;
    const delivery = Effect.suspend(() =>
      deliverRemoteAuthEvents({
        database: dependencies.database,
        webhookUrls: dependencies.webhookUrls,
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
  bindings: RemoteAuthEventBindings,
  userId: string,
  waitUntil: (delivery: Effect.Effect<void, RemoteFailure>) => void,
  fetcher: RemoteFetch = (input, init) => fetch(input, init),
) {
  if (remoteAuthWebhookUrls(bindings).length === 0 || !bindings.REMOTE_AUTH_WEBHOOK_SECRET?.trim()) return;
  const now = Date.now();
  yield* remoteCall(() => authEventStatement(bindings.DB, { type: "account-profile-changed", userId }, now).run());
  waitUntil(deliverPendingRemoteAuthEvents(bindings, now, fetcher));
});

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

function remoteSignalNotConfigured(): RemoteControlPlaneError {
  return new RemoteControlPlaneError(503, "remote_not_configured", "The Remote Signal URL is not configured.");
}

export function remoteSignalPlan(
  bindings: Pick<
    WorkerBindings,
    "REMOTE_SIGNAL_URL" | "REMOTE_SIGNAL_HOMES" | "REMOTE_SIGNAL_HOME_LOCATIONS" | "REMOTE_SIGNAL_HOME_COUNTRIES"
  >,
): RemoteSignalPlan | null {
  const entryUrl = bindings.REMOTE_SIGNAL_URL?.trim();
  if (!entryUrl) return null;
  const entryProtocol = urlProtocol(entryUrl);
  if (entryProtocol !== "wss:" && entryProtocol !== "ws:") return null;
  const permitsWs = entryProtocol === "ws:";
  const homes = new Map<string, string>();
  for (const entry of (bindings.REMOTE_SIGNAL_HOMES ?? "").split(",")) {
    if (!entry.trim()) continue;
    const separator = entry.indexOf("=");
    if (separator < 0) return null;
    const id = entry.slice(0, separator).trim();
    const url = entry.slice(separator + 1).trim();
    const protocol = urlProtocol(url);
    if (!isSignalHomeId(id) || homes.has(id)) return null;
    if (protocol !== "wss:" && !(permitsWs && protocol === "ws:")) return null;
    homes.set(id, url);
  }
  if (homes.size === 0) return { entryUrl, homes, locations: new Map(), countries: new Map() };
  const locations = signalHomeLocations(bindings.REMOTE_SIGNAL_HOME_LOCATIONS ?? "", homes);
  const countries = signalHomeCountries(bindings.REMOTE_SIGNAL_HOME_COUNTRIES ?? "", homes);
  return locations && countries ? { entryUrl, homes, locations, countries } : null;
}

function signalHomeCountries(
  value: string,
  homes: ReadonlyMap<string, string>,
): ReadonlyMap<string, readonly string[]> | null {
  const countries = new Map<string, readonly string[]>();
  for (const entry of value.split(",")) {
    if (!entry.trim()) continue;
    const separator = entry.indexOf("=");
    if (separator < 0) return null;
    const country = entry.slice(0, separator).trim();
    const ids = entry
      .slice(separator + 1)
      .split("+")
      .map((id) => id.trim());
    if (!SIGNAL_COUNTRY_PATTERN.test(country) || countries.has(country)) return null;
    if (ids.some((id) => !homes.has(id)) || new Set(ids).size !== ids.length) return null;
    countries.set(country, ids);
  }
  return countries;
}

function signalHomeLocations(
  value: string,
  homes: ReadonlyMap<string, string>,
): ReadonlyMap<string, SignalLocation> | null {
  const locations = new Map<string, SignalLocation>();
  for (const entry of value.split(",")) {
    if (!entry.trim()) continue;
    const separator = entry.indexOf("=");
    if (separator < 0) return null;
    const id = entry.slice(0, separator).trim();
    const [latitude, longitude, ...rest] = entry.slice(separator + 1).split(":");
    const location = signalLocation(latitude, longitude);
    if (!homes.has(id) || locations.has(id) || rest.length > 0 || !location) return null;
    locations.set(id, location);
  }
  return locations.size === 0 || locations.size === homes.size ? locations : null;
}

export function signalLocation(latitude: unknown, longitude: unknown): SignalLocation | null {
  if (typeof latitude !== "string" || typeof longitude !== "string") return null;
  if (!latitude.trim() || !longitude.trim()) return null;
  const location = { latitude: Number(latitude), longitude: Number(longitude) };
  return Math.abs(location.latitude) <= 90 && Math.abs(location.longitude) <= 180 ? location : null;
}

function urlProtocol(value: string): string | null {
  try {
    return new URL(value).protocol;
  } catch {
    return null;
  }
}

function configuredSignalHome(signal: RemoteSignalPlan, id: string | null): RemoteSignalHome | null {
  const url = id === null ? undefined : signal.homes.get(id);
  return id !== null && url !== undefined ? { id, url } : null;
}

function nearSignalHomes(signal: RemoteSignalPlan, failedSignalUrl: string | null, place: SignalHostPlace): string[] {
  const homes = [...signal.homes];
  const available = homes.filter(([, url]) => url !== failedSignalUrl);
  const ids = (available.length > 0 ? available : homes).map(([id]) => id);
  const countryHomes = place.country === null ? undefined : signal.countries.get(place.country);
  const inCountry = ids.filter((id) => countryHomes?.includes(id));
  if (inCountry.length > 0) return inCountry;
  const location = place.location;
  if (!location || signal.locations.size === 0) return ids;
  const distances = new Map(
    ids.map((id) => {
      const home = signal.locations.get(id);
      return [id, home ? distanceKm(location, home) : Number.POSITIVE_INFINITY];
    }),
  );
  const nearest = Math.min(...distances.values());
  return ids.filter((id) => (distances.get(id) ?? Number.POSITIVE_INFINITY) <= nearest + NEAR_SIGNAL_HOME_MARGIN_KM);
}

function signalHealthUrl(signalUrl: string): string {
  const parsed = new URL(signalUrl);
  return `${parsed.protocol === "ws:" ? "http:" : "https:"}//${parsed.host}/health/ready`;
}

export function signalAnswers(
  fetcher: (input: string, init: RequestInit) => Promise<Response>,
  signalUrl: string,
  timeoutMs: number,
): Effect.Effect<boolean> {
  return Effect.tryPromise({
    try: (signal) =>
      fetcher(signalHealthUrl(signalUrl), {
        method: "GET",
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      }),
    catch: () => null,
  }).pipe(
    Effect.map((response) => response.ok),
    Effect.orElseSucceed(() => false),
  );
}

function distanceKm(from: SignalLocation, to: SignalLocation): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitude = radians(to.latitude - from.latitude);
  const longitude = radians(to.longitude - from.longitude);
  const a =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitude / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

const rendezvousSignalHome = Effect.fn("RemoteControlPlane.rendezvousSignalHome")(function* (
  hostId: string,
  candidates: readonly string[],
) {
  let chosen: { id: string; score: bigint } | null = null;
  for (const id of candidates) {
    const digest = yield* remoteCall(() =>
      crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${id}\n${hostId}`)),
    );
    const score = new DataView(digest).getBigUint64(0);
    if (!chosen || score > chosen.score) chosen = { id, score };
  }
  return chosen?.id ?? null;
});

function remoteAuthWebhookUrls(
  bindings: Pick<WorkerBindings, "REMOTE_AUTH_WEBHOOK_URL" | "REMOTE_AUTH_WEBHOOK_URLS">,
): string[] {
  const urls = (bindings.REMOTE_AUTH_WEBHOOK_URLS ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  if (urls.length > 0) return [...new Set(urls)];
  const url = bindings.REMOTE_AUTH_WEBHOOK_URL?.trim();
  return url ? [url] : [];
}

const decodeAuthEventTargets = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.String)));

function pendingAuthEventTargets(stored: string | null, webhookUrls: readonly string[]): readonly string[] {
  if (stored === null) return webhookUrls;
  const pending = Option.getOrUndefined(decodeAuthEventTargets(stored));
  return pending ? webhookUrls.filter((url) => pending.includes(url)) : webhookUrls;
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
  bindings: RemoteAuthEventBindings,
  now: number,
  fetcher: RemoteFetch = (input, init) => fetch(input, init),
) {
  return deliverRemoteAuthEvents({
    database: bindings.DB,
    webhookUrls: remoteAuthWebhookUrls(bindings),
    webhookSecret: bindings.REMOTE_AUTH_WEBHOOK_SECRET?.trim() || null,
    fetch: fetcher,
    now,
  });
}

const deliverRemoteAuthEvents = Effect.fn("RemoteControlPlane.deliverAuthEvents")(function* (input: {
  database: D1Database;
  webhookUrls: readonly string[];
  webhookSecret: string | null;
  fetch: RemoteFetch;
  now: number;
}) {
  const { webhookUrls, webhookSecret } = input;
  if (webhookUrls.length === 0 || !webhookSecret) return;
  const result = yield* remoteCall(() =>
    input.database
      .prepare(
        `UPDATE remote_auth_events SET next_attempt_at = ?
         WHERE event_id IN (SELECT event_id FROM remote_auth_events WHERE next_attempt_at <= ? ORDER BY created_at LIMIT 50)
         RETURNING event_id, payload, attempts, pending_targets`,
      )
      .bind(input.now + AUTH_EVENT_CLAIM_MS, input.now)
      .all<RemoteAuthEventRow>(),
  );
  const send = Effect.fn("RemoteControlPlane.sendAuthEvent")(function* (url: string, payload: string) {
    const timestamp = Math.floor(input.now / 1_000).toString();
    const signature = yield* hmacSha256(webhookSecret, `${timestamp}.${payload}`).pipe(
      Effect.mapError((error) => (error instanceof RemoteControlPlaneError ? error : new RemoteOperationError({}))),
    );
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        input.fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "OpenBot-Timestamp": timestamp,
            "OpenBot-Signature": signature,
          },
          body: payload,
          signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
        }),
      catch: () => new RemoteOperationError({}),
    });
    if (!response.ok) return yield* new RemoteOperationError({});
  });
  yield* Effect.forEach(
    result.results ?? [],
    (event) =>
      Effect.gen(function* () {
        const targets = pendingAuthEventTargets(event.pending_targets, webhookUrls);
        const sent = yield* Effect.forEach(
          targets,
          (url) => Effect.result(send(url, event.payload)).pipe(Effect.map((delivery) => ({ url, delivery }))),
          { concurrency: "unbounded" },
        );
        const failed = sent.filter((target) => Result.isFailure(target.delivery)).map((target) => target.url);
        if (failed.length === 0) {
          const deleted = yield* Effect.result(
            remoteCall(() =>
              input.database.prepare("DELETE FROM remote_auth_events WHERE event_id = ?").bind(event.event_id).run(),
            ),
          );
          if (Result.isSuccess(deleted)) return;
        }
        const delay = Math.min(AUTH_EVENT_RETRY_MS * 2 ** Math.min(event.attempts, 6), 60 * 60_000);
        yield* remoteCall(() =>
          input.database
            .prepare(
              "UPDATE remote_auth_events SET attempts = attempts + 1, next_attempt_at = ?, pending_targets = ? WHERE event_id = ?",
            )
            .bind(input.now + delay, JSON.stringify(failed), event.event_id)
            .run(),
        );
      }),
    { concurrency: AUTH_EVENT_SEND_CONCURRENCY, discard: true },
  );
});

const PUBLIC_KEY_HEADER = "-----BEGIN PUBLIC KEY-----";
const PUBLIC_KEY_FOOTER = "-----END PUBLIC KEY-----";

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

function storedAppearance(shape: string | null, color: string | null): ServerAppearance | null {
  if (!isServerAppearanceShape(shape)) return null;
  return { shape, color: isServerAppearanceColor(color) ? color : null };
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

const PRIVATE_JWK_MEMBERS = new Set(["d", "p", "q", "dp", "dq", "qi", "oth", "k"]);

function parsePublicJwk(value: unknown): RemotePublicJwk {
  if (!isDynamicRecord(value) || !isString(value.kid) || !isString(value.kty)) {
    throw new Error("REMOTE_TICKET_PUBLIC_JWKS is invalid.");
  }
  const publicMembers = Object.entries(value).filter(([name]) => !PRIVATE_JWK_MEMBERS.has(name));
  return { ...Object.fromEntries(publicMembers), kid: value.kid, kty: value.kty };
}
