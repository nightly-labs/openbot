import type { AccountSession } from "@openbot/contracts/mobile-connect";
import { isDynamicRecord, isFunction } from "@openbot/contracts/runtime-values";
import type { Effect } from "effect";
import type { AuthStoreError } from "./d1-auth-repository";
import type { EmailDeliveryError } from "./email-delivery";
import type { SmtpFailure } from "./smtp-email-delivery";

export interface WorkerBindings {
  DB: D1Database;
  AVATARS: R2Bucket;
  SKILLS: R2Bucket;
  SITES: R2Bucket;
  MARKETPLACE_INGRESS_RATE_LIMITER: RateLimit;
  MARKETPLACE_MUTATION_RATE_LIMITER: RateLimit;
  MARKETPLACE_UPLOAD_RATE_LIMITER: RateLimit;
  SITE_REPORT_RATE_LIMITER: RateLimit;
  GITHUB_TOKEN_RATE_LIMITER: RateLimit;
  /** Checked by the Live Activity relay only, so a Worker without it keeps its other routes. */
  LIVE_ACTIVITY_RATE_LIMITER?: RateLimit;
  AUTH_EXPOSE_DEVELOPMENT_CODE?: string;
  EMAIL_SMTP_HOST?: string;
  EMAIL_SMTP_PORT?: string;
  EMAIL_SMTP_USERNAME?: string;
  EMAIL_SMTP_PASSWORD?: string;
  EMAIL_FROM?: string;
  EMAIL_DELIVERY_WEBHOOK_URL?: string;
  EMAIL_DELIVERY_WEBHOOK_SECRET?: string;
  SKILLS_ADMIN_TOKEN?: string;
  SITE_OPERATIONS_ADMIN_TOKEN?: string;
  SITE_REPORT_HASH_SECRET?: string;
  SITE_COOKIE_ISOLATION_READY?: string;
  SITE_PUBLISH_ENABLED?: string;
  SITE_LOCAL_ORIGIN?: string;
  REMOTE_TICKET_PRIVATE_JWK?: string;
  REMOTE_TICKET_PUBLIC_JWKS?: string;
  REMOTE_TICKET_KEY_ID?: string;
  REMOTE_SIGNAL_URL?: string;
  REMOTE_AUTH_WEBHOOK_URL?: string;
  REMOTE_AUTH_WEBHOOK_SECRET?: string;
  /** Signs Slack route tickets. Its public key must also be in `REMOTE_TICKET_PUBLIC_JWKS`. */
  SLACK_ROUTE_PRIVATE_JWK?: string;
  SLACK_ROUTE_KEY_ID?: string;
  /** The OpenBot Slack app, which every workspace installs. */
  SLACK_CLIENT_ID?: string;
  SLACK_CLIENT_SECRET?: string;
  /** Signs the OAuth `state` of the Slack install. At least 32 bytes. */
  SLACK_STATE_SECRET?: string;
  /** Development only: the public HTTPS tunnel of a local API, which Slack can send the browser back to. */
  SLACK_DEV_PUBLIC_ORIGIN?: string;
  /** Signs Discord route tickets. Its public key must also be in `REMOTE_TICKET_PUBLIC_JWKS`. */
  DISCORD_ROUTE_PRIVATE_JWK?: string;
  DISCORD_ROUTE_KEY_ID?: string;
  /** The OpenBot Discord app, which every Discord server adds. Its bot token is only in Signal. */
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  /** Signs the OAuth `state` of the Discord install. At least 32 bytes. */
  DISCORD_STATE_SECRET?: string;
  /** Development only: the public origin of a local API, which Discord can send the browser back to. */
  DISCORD_DEV_PUBLIC_ORIGIN?: string;
  /** A Stripe sandbox (`sk_test_`) key in development and test. */
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  HOSTED_SERVERS_ENABLED?: string;
  /** Comma-separated account IDs or emails that can create hosted servers. `*` allows each account. */
  HOSTED_SERVERS_ALLOWED_USER_IDS?: string;
  /** A request with this key in `OpenBot-Hosting-Developer-Key` can create hosted servers. Test Worker only. */
  HOSTED_SERVERS_DEVELOPER_KEY?: string;
  /** The boat named snapshot that new hosted servers start from. */
  HOSTED_SERVER_TEMPLATE?: string;
  BOAT_API_KEY?: string;
  BOAT_WEBHOOK_SECRET?: string;
  /** An OpenPanel server client and its write-only secret, for account events. Set only in production. */
  OPENPANEL_CLIENT_ID?: string;
  OPENPANEL_CLIENT_SECRET?: string;
  /** The public Client ID of the OpenBot GitHub App. */
  GITHUB_APP_CLIENT_ID?: string;
  /** The private key of the OpenBot GitHub App as a PKCS #8 PEM. Without it, no installation token is issued. */
  GITHUB_APP_PRIVATE_KEY?: string;
  /** The Apple Push Notification service key (`.p8`, PEM text). The Live Activity relay is off without it. */
  APNS_PRIVATE_KEY?: string;
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  /** The iOS app bundle ID. */
  APNS_TOPIC?: string;
  /** Local development only: the development server that forwards to Apple over HTTP/2. */
  APNS_ORIGIN?: string;
}

function isWorkerBindings(value: unknown): value is WorkerBindings {
  if (!isDynamicRecord(value)) return false;
  const database = value.DB;
  const avatars = value.AVATARS;
  const skills = value.SKILLS;
  const sites = value.SITES;
  const marketplaceIngressRateLimiter = value.MARKETPLACE_INGRESS_RATE_LIMITER;
  const marketplaceMutationRateLimiter = value.MARKETPLACE_MUTATION_RATE_LIMITER;
  const marketplaceUploadRateLimiter = value.MARKETPLACE_UPLOAD_RATE_LIMITER;
  const siteReportRateLimiter = value.SITE_REPORT_RATE_LIMITER;
  const githubTokenRateLimiter = value.GITHUB_TOKEN_RATE_LIMITER;
  if (
    !isDynamicRecord(database) ||
    !isFunction(database.prepare) ||
    !isDynamicRecord(avatars) ||
    !isFunction(avatars.get) ||
    !isFunction(avatars.put) ||
    !isFunction(avatars.delete) ||
    !isDynamicRecord(skills) ||
    !isFunction(skills.get) ||
    !isFunction(skills.put) ||
    !isFunction(skills.delete) ||
    !isDynamicRecord(sites) ||
    !isFunction(sites.get) ||
    !isFunction(sites.put) ||
    !isFunction(sites.delete) ||
    !isDynamicRecord(marketplaceIngressRateLimiter) ||
    !isFunction(marketplaceIngressRateLimiter.limit) ||
    !isDynamicRecord(marketplaceMutationRateLimiter) ||
    !isFunction(marketplaceMutationRateLimiter.limit) ||
    !isDynamicRecord(marketplaceUploadRateLimiter) ||
    !isFunction(marketplaceUploadRateLimiter.limit) ||
    !isDynamicRecord(siteReportRateLimiter) ||
    !isFunction(siteReportRateLimiter.limit) ||
    !isDynamicRecord(githubTokenRateLimiter) ||
    !isFunction(githubTokenRateLimiter.limit)
  ) {
    return false;
  }
  return true;
}

export function requireWorkerBindings(value: unknown): WorkerBindings {
  if (!isWorkerBindings(value)) {
    throw new Error("Cloudflare worker bindings are unavailable.");
  }
  return value;
}

export interface MobileAuthSessionResult {
  sessionToken: string;
  user: AuthUser;
  host?: import("@openbot/contracts/mobile-connect").MobileConnectHostBinding;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface MobileAuthDevice {
  sessionId: string;
  name: string;
  platform: "ios" | "android" | "unknown";
  connectedAt: number;
  lastActiveAt: number;
}

export interface MobileAuthDeviceIdentity {
  id: string;
  name: string;
  platform: MobileAuthDevice["platform"];
}

export interface EmailCodeDelivery {
  send(message: {
    email: string;
    code: string;
    expiresAt: number;
  }): Effect.Effect<void, EmailDeliveryError | SmtpFailure>;
}

export interface TeamInviteEmailDelivery {
  send(message: {
    email: string;
    inviterEmail: string;
    serverName: string;
    inviteUrl: string;
    role: "admin" | "member";
  }): Effect.Effect<void, EmailDeliveryError | SmtpFailure>;
}

export type EmailVerificationResult =
  | { status: "verified"; session: { sessionToken: string; user: AuthUser } }
  | { status: "invalid" | "expired" | "too_many_attempts" };

export type EmailChallengeDeliveryState = "pending" | "sent" | "failed";

export interface EmailChallengeRecord {
  email: string;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
  deliveryState: EmailChallengeDeliveryState;
}

export interface AuthRepository {
  listAccountSessions(
    userId: string,
    currentToken: string,
    now: number,
  ): Effect.Effect<AccountSession[], AuthStoreError>;
  revokeAccountSession(userId: string, sessionId: string, now: number): Effect.Effect<boolean, AuthStoreError>;
  latestEmailChallengeAt(email: string): Effect.Effect<number | null, AuthStoreError>;
  findEmailChallenge(idHash: string): Effect.Effect<EmailChallengeRecord | null, AuthStoreError>;
  createEmailChallenge(input: {
    idHash: string;
    email: string;
    codeHash: string;
    sourceIpHash: string;
    createdAt: number;
    expiresAt: number;
    maxAttempts: number;
  }): Effect.Effect<boolean, AuthStoreError>;
  completeEmailChallengeDelivery(
    idHash: string,
    state: "sent" | "failed",
    now: number,
  ): Effect.Effect<void, AuthStoreError>;
  verifyEmailChallenge(input: {
    idHash: string;
    codeHash: string;
    now: number;
    session: { id: string; token: string; expiresAt: number };
  }): Effect.Effect<EmailVerificationResult, AuthStoreError>;
  incrementRateLimit(
    keyHash: string,
    windowStart: number,
    limit: number,
  ): Effect.Effect<{ allowed: boolean; count: number; windowStart: number }, AuthStoreError>;
  authenticate(sessionToken: string, now: number): Effect.Effect<AuthUser | null, AuthStoreError>;
  authenticateDesktopSession(sessionToken: string, now: number): Effect.Effect<AuthUser | null, AuthStoreError>;
  revokeSession(sessionToken: string, now: number): Effect.Effect<void, AuthStoreError>;
  revokeMobileSession(sessionToken: string, now: number): Effect.Effect<boolean, AuthStoreError>;
  updateUserName(userId: string, name: string, now: number): Effect.Effect<AuthUser, AuthStoreError>;
  updateUserAvatar(
    userId: string,
    avatarUrl: string | null,
    expectedAvatarUrl: string | null,
    now: number,
  ): Effect.Effect<AuthUser | null, AuthStoreError>;
  createTeamAuthTicket(input: {
    ticketHash: string;
    userId: string;
    serverId: string;
    createdAt: number;
    expiresAt: number;
  }): Effect.Effect<void, AuthStoreError>;
  replaceMobileAuthTicket(input: {
    host?: import("@openbot/contracts/mobile-connect").MobileConnectHostBinding;
    ticketHash: string;
    userId: string;
    serverId: string;
    createdAt: number;
    expiresAt: number;
  }): Effect.Effect<void, AuthStoreError>;
  redeemTeamAuthTicket(input: {
    ticketHash: string;
    serverId: string;
    now: number;
  }): Effect.Effect<AuthUser | null, AuthStoreError>;
  redeemMobileAuthTicket(input: {
    ticketHash: string;
    serverId: string;
    now: number;
    session: { id: string; token: string; expiresAt: number };
    device: MobileAuthDeviceIdentity;
  }): Effect.Effect<MobileAuthSessionResult | null, AuthStoreError>;
  authenticateMobileSession(sessionToken: string, now: number): Effect.Effect<AuthUser | null, AuthStoreError>;
  listMobileAuthDevices(userId: string, now: number): Effect.Effect<MobileAuthDevice[], AuthStoreError>;
  revokeMobileAuthDevice(userId: string, sessionId: string, now: number): Effect.Effect<boolean, AuthStoreError>;
}
