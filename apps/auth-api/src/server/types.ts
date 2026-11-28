import type { AvatarColor } from "@openbot/contracts/ipc";
import type { AccountSession } from "@openbot/contracts/mobile-connect";
import { isDynamicRecord, isFunction } from "@openbot/contracts/runtime-values";
import type { Effect } from "effect";
import type { AuthStoreError } from "./d1-auth-repository";
import type { EmailDeliveryError } from "./email-delivery";
import { observedD1 } from "./observed-d1";
import type { SmtpContactMessage, SmtpFailure, SmtpLicenseMessage, SmtpWelcomeMessage } from "./smtp-email-delivery";

export interface WorkerBindings {
  DB: D1Database;
  CF_VERSION_METADATA?: WorkerVersionMetadata;
  AVATARS: R2Bucket;
  SKILLS: R2Bucket;
  SITES: R2Bucket;
  MARKETPLACE_INGRESS_RATE_LIMITER: RateLimit;
  MARKETPLACE_MUTATION_RATE_LIMITER: RateLimit;
  MARKETPLACE_UPLOAD_RATE_LIMITER: RateLimit;
  SITE_REPORT_RATE_LIMITER: RateLimit;
  GITHUB_TOKEN_RATE_LIMITER: RateLimit;
  LIVE_ACTIVITY_RATE_LIMITER?: RateLimit;
  FEEDBACK_RATE_LIMITER?: RateLimit;
  WATCH_TICKET_RATE_LIMITER?: RateLimit;
  AUTH_EXPOSE_DEVELOPMENT_CODE?: string;
  BROWSER_EXTENSION_IDS?: string;
  EMAIL_SMTP_HOST?: string;
  EMAIL_SMTP_PORT?: string;
  EMAIL_SMTP_USERNAME?: string;
  EMAIL_SMTP_PASSWORD?: string;
  EMAIL_SMTP_OVERFLOW_USERNAME?: string;
  EMAIL_SMTP_OVERFLOW_PASSWORD?: string;
  EMAIL_SMTP_OVERFLOW_2_USERNAME?: string;
  EMAIL_SMTP_OVERFLOW_2_PASSWORD?: string;
  EMAIL_SMTP_OVERFLOW_3_USERNAME?: string;
  EMAIL_SMTP_OVERFLOW_3_PASSWORD?: string;
  EMAIL_FROM?: string;
  EMAIL_REPLY_TO?: string;
  EMAIL_LICENSE_FROM?: string;
  EMAIL_LICENSE_REPLY_TO?: string;
  EMAIL_RELAY?: Fetcher;
  EMAIL_FALLBACK?: SendEmail;
  EMAIL_DELIVERY_WEBHOOK_URL?: string;
  EMAIL_DELIVERY_WEBHOOK_SECRET?: string;
  SKILLS_ADMIN_TOKEN?: string;
  MEDIA_GATEWAY?: Fetcher;
  NEAR_INTENTS_PARTNER_KEY?: string;
  NEAR_INTENTS_AGENT_API_URL?: string;
  SITE_OPERATIONS_ADMIN_TOKEN?: string;
  SERVER_CLAIMS_ADMIN_TOKEN?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_ADMIN_AUD?: string;
  STORE_REVIEW_EMAIL?: string;
  STORE_REVIEW_CODE?: string;
  SITE_REPORT_HASH_SECRET?: string;
  COMPANY_SIGN_IN_SECRET?: string;
  HOSTED_ARCHIVE_KEY_SECRET?: string;
  B2_WORKER_KEY_ID_EU?: string;
  B2_WORKER_APPLICATION_KEY_EU?: string;
  SITE_COOKIE_ISOLATION_READY?: string;
  SITE_PUBLISH_ENABLED?: string;
  SITE_LOCAL_ORIGIN?: string;
  REMOTE_TICKET_PRIVATE_JWK?: string;
  REMOTE_TICKET_PUBLIC_JWKS?: string;
  REMOTE_TICKET_KEY_ID?: string;
  REMOTE_SIGNAL_URL?: string;
  REMOTE_SIGNAL_HOMES?: string;
  REMOTE_SIGNAL_HOME_LOCATIONS?: string;
  REMOTE_SIGNAL_HOME_COUNTRIES?: string;
  REMOTE_AUTH_WEBHOOK_URL?: string;
  REMOTE_AUTH_WEBHOOK_URLS?: string;
  REMOTE_AUTH_WEBHOOK_SECRET?: string;
  SIGNAL_ENTRY_ZONE_ID?: string;
  SIGNAL_ENTRY_DNS_TOKEN?: string;
  SLACK_ROUTE_PRIVATE_JWK?: string;
  SLACK_ROUTE_KEY_ID?: string;
  SLACK_CLIENT_ID?: string;
  SLACK_CLIENT_SECRET?: string;
  SLACK_STATE_SECRET?: string;
  SLACK_DEV_PUBLIC_ORIGIN?: string;
  DISCORD_ROUTE_PRIVATE_JWK?: string;
  DISCORD_ROUTE_KEY_ID?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  DISCORD_STATE_SECRET?: string;
  DISCORD_DEV_PUBLIC_ORIGIN?: string;
  TELEGRAM_BOT_ID?: string;
  TELEGRAM_BOT_USERNAME?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  VIES_REQUESTER_VAT_ID?: string;
  LICENSE_TRIAL_END?: string;
  BILLING_COUNTRY_REQUIRED?: string;
  HOSTED_SERVERS_ENABLED?: string;
  HOSTED_SERVERS_ALLOWED_USER_IDS?: string;
  HOSTED_SERVERS_DEVELOPER_KEY?: string;
  HOSTED_SERVER_TEMPLATE?: string;
  BOAT_API_KEY?: string;
  BOAT_WEBHOOK_SECRET?: string;
  HOSTED_POOL_ALERT_WEBHOOK_URL?: string;
  OPENPANEL_CLIENT_ID?: string;
  OPENPANEL_CLIENT_SECRET?: string;
  GITHUB_APP_CLIENT_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  FEEDBACK_WITHDRAWN_REPOSITORY?: string;
  APNS_PRIVATE_KEY?: string;
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APNS_TOPIC?: string;
  APNS_ORIGIN?: string;
  FCM_SERVICE_ACCOUNT?: string;
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

const observedBindings = new WeakMap<WorkerBindings, WorkerBindings>();

export function requireWorkerBindings(value: unknown): WorkerBindings {
  if (!isWorkerBindings(value)) {
    throw new Error("Cloudflare worker bindings are unavailable.");
  }
  const known = observedBindings.get(value);
  if (known) return known;
  const observed = { ...value, DB: observedD1(value.DB) };
  observedBindings.set(value, observed);
  return observed;
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
  analyticsEnabled: boolean | null;
  chatColor: AvatarColor | null;
}

export interface MobileAuthDevice {
  sessionId: string;
  name: string;
  platform: "ios" | "android" | "unknown";
  connectedAt: number;
  lastActiveAt: number;
  via: "code" | "link";
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

export interface OwnerTransferEmailDelivery {
  send(message: {
    email: string;
    fromEmail: string;
    serverName: string;
    appUrl: string;
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

export interface WelcomeEmailDelivery {
  send(message: SmtpWelcomeMessage): Effect.Effect<void, EmailDeliveryError | SmtpFailure>;
}

export interface LicenseEmailDelivery {
  send(message: SmtpLicenseMessage): Effect.Effect<void, EmailDeliveryError | SmtpFailure>;
}

export interface ContactMessageDelivery {
  send(message: SmtpContactMessage): Effect.Effect<void, EmailDeliveryError | SmtpFailure>;
}

export type EmailVerificationResult =
  | { status: "verified"; session: { sessionToken: string; user: AuthUser }; created: boolean }
  | { status: "invalid" | "expired" | "too_many_attempts" };

export type EmailChallengeDeliveryState = "pending" | "sent" | "failed";

export interface EmailChallengeRecord {
  email: string;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
  deliveryState: EmailChallengeDeliveryState;
}

export type SessionReads = "replica" | "primary";

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
    device?: MobileAuthDeviceIdentity;
  }): Effect.Effect<EmailVerificationResult, AuthStoreError>;
  incrementRateLimit(
    keyHash: string,
    windowStart: number,
    limit: number,
  ): Effect.Effect<{ allowed: boolean; count: number; windowStart: number }, AuthStoreError>;
  authenticate(sessionToken: string, now: number, reads?: SessionReads): Effect.Effect<AuthUser | null, AuthStoreError>;
  authenticateDesktopSession(sessionToken: string, now: number): Effect.Effect<AuthUser | null, AuthStoreError>;
  revokeSession(sessionToken: string, now: number): Effect.Effect<void, AuthStoreError>;
  revokeMobileSession(sessionToken: string, now: number): Effect.Effect<boolean, AuthStoreError>;
  updateUserName(userId: string, name: string, now: number): Effect.Effect<AuthUser, AuthStoreError>;
  updateUserAnalytics(
    userId: string,
    enabled: boolean,
    answeredAt: number,
    now: number,
  ): Effect.Effect<AuthUser, AuthStoreError>;
  updateUserChatColor(
    userId: string,
    chatColor: AvatarColor | null,
    now: number,
  ): Effect.Effect<AuthUser, AuthStoreError>;
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
    host?: import("@openbot/contracts/mobile-connect").MobileConnectHostBinding | undefined;
    ticketHash: string;
    userId: string;
    serverId: string;
    createdAt: number;
    expiresAt: number;
  }): Effect.Effect<void, AuthStoreError>;
  cancelMobileAuthTickets(input: {
    userId: string;
    serverId: string;
    hostId: string;
    now: number;
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
  replaceMobileConnectLink(input: {
    linkHash: string;
    desktopSessionToken: string;
    userId: string;
    host: import("@openbot/contracts/mobile-connect").MobileConnectHostBinding;
    createdAt: number;
  }): Effect.Effect<boolean, AuthStoreError>;
  revokeMobileConnectLink(input: { userId: string; hostId: string; now: number }): Effect.Effect<void, AuthStoreError>;
  redeemMobileConnectLink(input: {
    linkHash: string;
    now: number;
    session: { id: string; token: string; expiresAt: number };
    device: MobileAuthDeviceIdentity;
  }): Effect.Effect<MobileAuthSessionResult | null, AuthStoreError>;
  authenticateMobileSession(sessionToken: string, now: number): Effect.Effect<AuthUser | null, AuthStoreError>;
  listMobileAuthDevices(
    userId: string,
    now: number,
    hostId: string | null,
  ): Effect.Effect<MobileAuthDevice[], AuthStoreError>;
  revokeMobileAuthDevice(userId: string, sessionId: string, now: number): Effect.Effect<boolean, AuthStoreError>;
  createServerClaim(input: {
    claimHash: string;
    email: string;
    createdAt: number;
    expiresAt: number;
  }): Effect.Effect<void, AuthStoreError>;
  createServerClaimForUser(input: {
    claimHash: string;
    userId: string;
    createdAt: number;
    expiresAt: number;
  }): Effect.Effect<void, AuthStoreError>;
  redeemServerClaim(input: {
    claimHash: string;
    now: number;
    session: { id: string; token: string; expiresAt: number };
  }): Effect.Effect<{ sessionToken: string; user: AuthUser } | null, AuthStoreError>;
}
