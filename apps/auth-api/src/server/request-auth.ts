import { env, waitUntil } from "cloudflare:workers";
import { CREDIT_MEDIA_HOST_HEADER, CREDIT_MEDIA_HOST_TOKEN_HEADER } from "@openbot/contracts/credit-media";
import { FEEDBACK_REPOSITORY } from "@openbot/contracts/feedback";
import { HOSTING_DEVELOPER_KEY_HEADER } from "@openbot/contracts/hosted-servers";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { type AccountAnalytics, createAccountAnalytics } from "./account-analytics";
import { AccountAttribution } from "./account-attribution";
import { adminTokenMatches } from "./admin-token";
import { AgentMarketplace, AgentMarketplaceError } from "./agent-marketplace";
import { AgentTemplates } from "./agent-templates";
import { type FcmRelaySender, sharedFcmSender } from "./android-notification-relay";
import { AuthOperationError, AuthService, AuthServiceError, readStoreReviewSignIn } from "./auth-service";
import { BillingError, type BillingService } from "./billing-service";
import { CompanySignInError, CompanySignInService } from "./company-sign-in";
import type { ContactMessageServices } from "./contact-message";
import { type CreditMediaPayer, CreditMediaService } from "./credit-media-service";
import { CustomServerOffers } from "./custom-server-offers";
import { D1AuthRepository } from "./d1-auth-repository";
import { DiscordAppError, DiscordAppService } from "./discord-app";
import { runApiEffect } from "./effect-runtime";
import {
  createContactMessageDelivery,
  createEmailCodeDelivery,
  createOwnerTransferEmailDelivery,
  createTeamInviteEmailDelivery,
} from "./email-delivery";
import {
  COUNT_FEEDBACK,
  DELETE_EARLIER_FEEDBACK_DAYS,
  FEEDBACK_DAILY_LIMIT,
  UNCOUNT_FEEDBACK,
} from "./feedback-daily-counts";
import { feedbackOwner } from "./feedback-owner";
import { GitHubInstallationTokens, GitHubInstallationTokensError } from "./github-installation-tokens";
import { createHostedBilling } from "./hosted-billing";
import { type HostedServerService, HostedServerServiceError } from "./hosted-server-service";
import { HostedSiteInputError } from "./hosted-site-contract";
import { HostedSiteStorageError } from "./hosted-site-effects";
import { enforceHostedSiteReportRateLimit as enforceReportRateLimit } from "./hosted-site-request-policy";
import { adoptUnlinkedHostedSites, resolveHostedSiteScope } from "./hosted-site-server";
import { HostedSiteService } from "./hosted-site-service";
import { JsonBodyError } from "./json-body";
import { type ApnsRelaySender, sharedApnsSender } from "./live-activity-relay";
import { MarketplaceQueryError } from "./marketplace-pagination";
import {
  enforceMarketplaceMutation,
  type MarketplaceMutationKind,
  MarketplaceRateLimitError,
} from "./marketplace-request-policy";
import { mediaGatewayFromBinding } from "./media-gateway";
import {
  type NearIntentsOwner,
  NearIntentsRelay,
  NearIntentsRelayError,
  nearIntentsRelayErrorResponse,
} from "./near-intents-relay";
import { Referrals } from "./referrals";
import {
  deliverPendingRemoteAuthEvents,
  notifyAccountProfileChanged,
  RemoteControlPlane,
  RemoteControlPlaneError,
  verifyRemoteServiceSignature,
} from "./remote-control-plane";
import { SkillMarketplace, SkillMarketplaceError } from "./skill-marketplace";
import { SlackAppError, SlackAppService } from "./slack-app";
import {
  type OwnerTransferEmailDelivery,
  requireWorkerBindings,
  type TeamInviteEmailDelivery,
  type WorkerBindings,
} from "./types";
import { WatchSessionStoreError, WatchSessions } from "./watch-sessions";

function accountAnalytics(bindings: WorkerBindings): AccountAnalytics {
  return createAccountAnalytics({
    clientId: bindings.OPENPANEL_CLIENT_ID,
    clientSecret: bindings.OPENPANEL_CLIENT_SECRET,
    fetch: (input, init) => fetch(input, init),
    schedule,
    database: bindings.DB,
  });
}

export function requestAccountAttribution(): AccountAttribution {
  const bindings = requireWorkerBindings(env);
  return new AccountAttribution({ database: bindings.DB, analytics: accountAnalytics(bindings) });
}

export function requestAuthService(): AuthService {
  const bindings = requireWorkerBindings(env);
  const exposeDevelopmentCode = bindings.AUTH_EXPOSE_DEVELOPMENT_CODE === "true";
  const analytics = accountAnalytics(bindings);
  return new AuthService({
    repository: new D1AuthRepository(bindings.DB),
    delivery: exposeDevelopmentCode ? null : createEmailCodeDelivery(bindings, analytics),
    exposeDevelopmentCode,
    storeReviewSignIn: readStoreReviewSignIn(bindings.STORE_REVIEW_EMAIL, bindings.STORE_REVIEW_CODE),
    flushSessionRevocations: () => Effect.sync(() => schedule(deliverPendingRemoteAuthEvents(bindings, Date.now()))),
    profileChanged: (userId) => notifyAccountProfileChanged(bindings, userId, schedule),
    analytics,
    attribution: new AccountAttribution({ database: bindings.DB, analytics }),
    referrals: new Referrals({ database: bindings.DB }),
    usesCompanySignIn: (email) =>
      new CompanySignInService(bindings)
        .usesCompanySignIn(email)
        .pipe(Effect.mapError(() => new AuthOperationError({ message: "Account operation failed." }))),
  });
}

export function requestCompanySignIn(): CompanySignInService {
  const bindings = requireWorkerBindings(env);
  const remote = new RemoteControlPlane(bindings, { schedule });
  return new CompanySignInService(bindings, {
    flushSessionRevocations: () => Effect.sync(() => schedule(deliverPendingRemoteAuthEvents(bindings, Date.now()))),
    revokeMembership: (actorUserId, hostId, membershipId) =>
      remote.changeMembership(actorUserId, { hostId, membershipId, revoke: true }).pipe(Effect.asVoid),
    joinServer: (hostId, userId, options) => remote.joinByCompanySignIn(hostId, userId, options),
  });
}

export function companySignInErrorResponse(error: unknown): Response {
  if (error instanceof CompanySignInError) return apiError(error.status, error.code, error.message);
  return remoteControlPlaneErrorResponse(error);
}

export function requestAvatarBucket(): R2Bucket {
  const bindings = requireWorkerBindings(env);
  return bindings.AVATARS;
}

export function requestSkillMarketplace(): SkillMarketplace {
  const bindings = requireWorkerBindings(env);
  return new SkillMarketplace(bindings);
}

export function requestAgentMarketplace(): AgentMarketplace {
  return new AgentMarketplace(requireWorkerBindings(env));
}

export function requestAgentTemplates(): AgentTemplates {
  return new AgentTemplates(requireWorkerBindings(env));
}

export function requestHostedSiteScope(request: Request, userId: string) {
  return resolveHostedSiteScope(requireWorkerBindings(env).DB, userId, request);
}

export function requestAdoptUnlinkedHostedSites(userId: string, serverId: string) {
  return adoptUnlinkedHostedSites(requireWorkerBindings(env).DB, userId, serverId, Date.now());
}

export function requestHostedSiteService(): HostedSiteService {
  const bindings = requireWorkerBindings(env);
  return new HostedSiteService(
    bindings.DB,
    bindings.SITES,
    Date.now,
    bindings.SITE_REPORT_HASH_SECRET,
    bindings.SITE_LOCAL_ORIGIN,
  );
}

export function requestReferrals(): Referrals {
  return new Referrals({ database: requireWorkerBindings(env).DB });
}

export function requestCreditMedia(): CreditMediaService {
  const bindings = requireWorkerBindings(env);
  return new CreditMediaService({
    database: bindings.DB,
    gateway: mediaGatewayFromBinding(bindings.MEDIA_GATEWAY),
    now: () => Date.now(),
    analytics: accountAnalytics(bindings),
  });
}

export const requestCreditMediaPayer = Effect.fn("CreditMedia.requestPayer")(function* (request: Request) {
  const hostId = request.headers.get(CREDIT_MEDIA_HOST_HEADER);
  const machineToken = request.headers.get(CREDIT_MEDIA_HOST_TOKEN_HEADER);
  if (hostId || machineToken) {
    if (!hostId || !machineToken || hostId.length > 200 || machineToken.length > 512)
      return yield* new RemoteControlPlaneError(401, "host_unauthorized", "The host credential is invalid.");
    yield* requestRemoteControlPlane().authenticateHost(hostId, machineToken);
    const payer: CreditMediaPayer = { wallet: "server", serverId: hostId };
    return { payer, actorUserId: null };
  }
  const user = yield* requestUser(request);
  if (!user) return null;
  const payer: CreditMediaPayer = { wallet: "personal", userId: user.id };
  return { payer, actorUserId: user.id };
});

export const requestNearIntentsOwner = Effect.fn("NearIntents.requestOwner")(function* (request: Request) {
  const hostId = request.headers.get(CREDIT_MEDIA_HOST_HEADER);
  const machineToken = request.headers.get(CREDIT_MEDIA_HOST_TOKEN_HEADER);
  if (hostId || machineToken) {
    if (!hostId || !machineToken || hostId.length > 200 || machineToken.length > 512)
      return yield* new RemoteControlPlaneError(401, "host_unauthorized", "The host credential is invalid.");
    yield* requestRemoteControlPlane().authenticateHost(hostId, machineToken);
    const owner: NearIntentsOwner = { kind: "server", serverId: hostId };
    return owner;
  }
  const user = yield* requestUser(request);
  if (!user) return null;
  const owner: NearIntentsOwner = { kind: "user", userId: user.id };
  return owner;
});

export function requestNearIntentsRelay(): NearIntentsRelay {
  const bindings = requireWorkerBindings(env);
  return new NearIntentsRelay({
    database: bindings.DB,
    partnerKey: bindings.NEAR_INTENTS_PARTNER_KEY,
    upstream: bindings.NEAR_INTENTS_AGENT_API_URL,
  });
}

export function nearIntentsErrorResponse(error: unknown): Response {
  if (error instanceof NearIntentsRelayError) return nearIntentsRelayErrorResponse(error);
  if (error instanceof RemoteControlPlaneError)
    return nearIntentsRelayErrorResponse(new NearIntentsRelayError(error.status, error.code, error.message));
  console.error("near-intents: the relay failed");
  return nearIntentsRelayErrorResponse(
    new NearIntentsRelayError(503, "wallet_service_unavailable", "The crypto wallet service is not available."),
  );
}

export function creditMediaErrorResponse(error: unknown): Response {
  if (error instanceof BillingError) {
    const response = apiError(error.status, error.code, error.message);
    if (error.code === "media_busy") response.headers.set("Retry-After", "10");
    return response;
  }
  return remoteControlPlaneErrorResponse(error);
}

export function requestBillingService(): BillingService | null {
  return requestHostedBilling().billing;
}

export function requestCustomServerOffers(): CustomServerOffers {
  return new CustomServerOffers({ database: requireWorkerBindings(env).DB, billing: requestBillingService() });
}

export function billingErrorResponse(error: unknown): Response {
  if (error instanceof BillingError) return apiError(error.status, error.code, error.message);
  return authErrorResponse(error);
}

export function requireSitePublishingEnabled(): void {
  const bindings = requireWorkerBindings(env);
  if (bindings.SITE_PUBLISH_ENABLED !== "true") {
    throw new HostedSiteInputError(409, "publishing_disabled", "Site publishing is temporarily disabled.");
  }
  if (bindings.SITE_COOKIE_ISOLATION_READY !== "true") {
    throw new HostedSiteInputError(
      409,
      "cookie_isolation_unavailable",
      "Site publishing is disabled until openbot.site has public-suffix cookie isolation.",
    );
  }
}

export function hostedSiteErrorResponse(error: unknown): Response {
  if (error instanceof HostedSiteInputError) {
    const response = apiError(error.status, error.code, error.message);
    if (error.retryAfterSeconds !== undefined) response.headers.set("Retry-After", String(error.retryAfterSeconds));
    return response;
  }
  if (error instanceof HostedSiteStorageError) return siteStorageUnavailableResponse(error);
  return authErrorResponse(error);
}

const SITE_STORAGE_RETRY_AFTER_SECONDS = 60;

function siteStorageUnavailableResponse(error: HostedSiteStorageError): Response {
  const reference = requestFailureReference();
  console.error("Site storage request failed:", reference, error._tag);
  const response = json(
    {
      error: {
        code: "site_storage_unavailable",
        message:
          "Site storage did not answer for a short time. A site that is online stays online. Try again in about 1 minute.",
        reference,
      },
    },
    503,
  );
  response.headers.set("Retry-After", String(SITE_STORAGE_RETRY_AFTER_SECONDS));
  return response;
}

let githubInstallationTokens: { key: string; service: GitHubInstallationTokens } | null = null;

export function requestGitHubInstallationTokens(): GitHubInstallationTokens {
  const bindings = requireWorkerBindings(env);
  const clientId = bindings.GITHUB_APP_CLIENT_ID?.trim();
  const privateKey = bindings.GITHUB_APP_PRIVATE_KEY?.trim();
  if (!clientId || !privateKey) {
    throw new GitHubInstallationTokensError(503, "github_app_unavailable", "The OpenBot GitHub App is not configured.");
  }
  const key = `${clientId}\u0000${privateKey}`;
  if (githubInstallationTokens?.key !== key) {
    githubInstallationTokens = {
      key,
      service: new GitHubInstallationTokens({ clientId, privateKey, fetch: (input, init) => fetch(input, init) }),
    };
  }
  return githubInstallationTokens.service;
}

export const enforceGitHubTokenRateLimit = Effect.fn("GitHub.enforceTokenRateLimit")(function* (sourceIp: string) {
  const result = yield* Effect.tryPromise({
    try: () => requireWorkerBindings(env).GITHUB_TOKEN_RATE_LIMITER.limit({ key: `ip:${sourceIp}` }),
    catch: () =>
      new GitHubInstallationTokensError(503, "github_app_unavailable", "The OpenBot GitHub App is unavailable."),
  });
  if (!result.success) {
    return yield* new GitHubInstallationTokensError(
      429,
      "rate_limited",
      "Too many GitHub token requests. Try again later.",
    );
  }
});

export const enforceFeedbackSearchRateLimit = Effect.fn("GitHub.enforceFeedbackSearchRateLimit")(function* (
  userId: string,
) {
  const limiter = requireWorkerBindings(env).FEEDBACK_RATE_LIMITER;
  const unavailable = () =>
    new GitHubInstallationTokensError(503, "feedback_unavailable", "Feedback is not available.");
  if (!limiter) return yield* unavailable();
  const result = yield* Effect.tryPromise({
    try: () => limiter.limit({ key: `search:${userId}` }),
    catch: unavailable,
  });
  if (!result.success) {
    return yield* new GitHubInstallationTokensError(429, "rate_limited", "Too many searches. Try again later.");
  }
});

export function requestFeedbackOwner(userId: string) {
  const privateKey = requireWorkerBindings(env).GITHUB_APP_PRIVATE_KEY?.trim();
  if (!privateKey)
    return Effect.fail(
      new GitHubInstallationTokensError(503, "github_app_unavailable", "The OpenBot GitHub App is not configured."),
    );
  return feedbackOwner(privateKey, userId);
}

export function requestFeedbackWithdrawnRepository(): string | null {
  const repository = requireWorkerBindings(env).FEEDBACK_WITHDRAWN_REPOSITORY?.trim();
  if (!repository || !/^[\w.-]+\/[\w.-]+$/u.test(repository)) return null;
  const owner = (name: string) => name.split("/")[0]?.toLowerCase();
  return owner(repository) === owner(FEEDBACK_REPOSITORY) ? repository : null;
}

export const enforceFeedbackWithdrawRateLimit = Effect.fn("GitHub.enforceFeedbackWithdrawRateLimit")(function* (
  userId: string,
) {
  const limiter = requireWorkerBindings(env).FEEDBACK_RATE_LIMITER;
  const unavailable = () =>
    new GitHubInstallationTokensError(503, "feedback_unavailable", "Feedback is not available.");
  if (!limiter) return yield* unavailable();
  const result = yield* Effect.tryPromise({
    try: () => limiter.limit({ key: `withdraw:${userId}` }),
    catch: unavailable,
  });
  if (!result.success) {
    return yield* new GitHubInstallationTokensError(429, "rate_limited", "Too many requests. Try again later.");
  }
});

export const enforceFeedbackRateLimit = Effect.fn("GitHub.enforceFeedbackRateLimit")(function* (userId: string) {
  const bindings = requireWorkerBindings(env);
  const limiter = bindings.FEEDBACK_RATE_LIMITER;
  const unavailable = () =>
    new GitHubInstallationTokensError(503, "feedback_unavailable", "Feedback is not available.");
  if (!limiter) return yield* unavailable();
  const result = yield* Effect.tryPromise({ try: () => limiter.limit({ key: `user:${userId}` }), catch: unavailable });
  if (!result.success) {
    return yield* new GitHubInstallationTokensError(429, "rate_limited", "Too much feedback. Try again later.");
  }
  const day = new Date().toISOString().slice(0, 10);
  const [, counted] = yield* Effect.tryPromise({
    try: () =>
      bindings.DB.batch([
        bindings.DB.prepare(DELETE_EARLIER_FEEDBACK_DAYS).bind(userId, day),
        bindings.DB.prepare(COUNT_FEEDBACK).bind(userId, day, FEEDBACK_DAILY_LIMIT),
      ]),
    catch: unavailable,
  });
  if (!counted?.results.length) {
    return yield* new GitHubInstallationTokensError(
      429,
      "feedback_daily_limit",
      "Too much feedback today. Try again tomorrow.",
    );
  }
  return day;
});

export const uncountFeedback = Effect.fn("GitHub.uncountFeedback")(function* (userId: string, day: string) {
  const bindings = requireWorkerBindings(env);
  yield* Effect.tryPromise(() => bindings.DB.prepare(UNCOUNT_FEEDBACK).bind(userId, day).run()).pipe(Effect.ignore);
});

function secondsToNextUtcDay(now = Date.now()): number {
  const day = 86_400_000;
  return Math.ceil((day - (now % day)) / 1000);
}

export function githubInstallationTokensErrorResponse(error: unknown): Response {
  if (error instanceof GitHubInstallationTokensError) {
    const response = apiError(error.status, error.code, error.message);
    if (error.status === 429)
      response.headers.set("Retry-After", String(error.code === "feedback_daily_limit" ? secondsToNextUtcDay() : 60));
    return response;
  }
  return authErrorResponse(error);
}

export function requestApnsRelay(): {
  sender: ApnsRelaySender;
  allow(hostId: string): Effect.Effect<boolean, AuthOperationError>;
  allowNotification(hostId: string): Effect.Effect<boolean, AuthOperationError>;
} | null {
  const bindings = requireWorkerBindings(env);
  const { APNS_PRIVATE_KEY, APNS_KEY_ID, APNS_TEAM_ID, APNS_TOPIC, APNS_ORIGIN, LIVE_ACTIVITY_RATE_LIMITER } = bindings;
  if (!APNS_PRIVATE_KEY || !APNS_KEY_ID || !APNS_TEAM_ID || !APNS_TOPIC || !LIVE_ACTIVITY_RATE_LIMITER) return null;
  const origin = developmentApnsOrigin(APNS_ORIGIN);
  const limit = relayLimit(LIVE_ACTIVITY_RATE_LIMITER);
  return {
    sender: sharedApnsSender({
      privateKey: APNS_PRIVATE_KEY.replaceAll("\\n", "\n"),
      keyId: APNS_KEY_ID,
      teamId: APNS_TEAM_ID,
      topic: APNS_TOPIC,
      ...(origin ? { origin } : {}),
    }),
    allow: (hostId) => limit(`host:${hostId}`),
    allowNotification: (hostId) => limit(`notification:host:${hostId}`),
  };
}

export function requestFcmRelay(): {
  sender: FcmRelaySender;
  allowNotification(hostId: string): Effect.Effect<boolean, AuthOperationError>;
} | null {
  const { FCM_SERVICE_ACCOUNT, LIVE_ACTIVITY_RATE_LIMITER } = requireWorkerBindings(env);
  if (!FCM_SERVICE_ACCOUNT || !LIVE_ACTIVITY_RATE_LIMITER) return null;
  const sender = sharedFcmSender(FCM_SERVICE_ACCOUNT);
  if (!sender) return null;
  const limit = relayLimit(LIVE_ACTIVITY_RATE_LIMITER);
  return { sender, allowNotification: (hostId) => limit(`notification:host:${hostId}`) };
}

function relayLimit(limiter: RateLimit) {
  return (key: string) =>
    Effect.tryPromise({
      try: () => limiter.limit({ key }),
      catch: () => new AuthOperationError({ message: "Account operation failed." }),
    }).pipe(Effect.map((result) => result.success));
}

function developmentApnsOrigin(value: string | undefined): string | undefined {
  return value && /^http:\/\/127\.0\.0\.1:\d+\/__dev\/apns$/u.test(value) ? value : undefined;
}

export function enforceMarketplaceMutationRateLimit(kind: MarketplaceMutationKind, principal: string) {
  return enforceMarketplaceMutation(requireWorkerBindings(env), kind, principal);
}

export function enforceHostedSiteReportRateLimit(sourceIp: string) {
  return enforceReportRateLimit(requireWorkerBindings(env), sourceIp);
}

export function marketplaceErrorResponse(error: unknown): Response {
  if (error instanceof AgentMarketplaceError) return apiError(error.status, error.code, error.message);
  return skillErrorResponse(error);
}

export function requestUser(request: Request) {
  const token = bearerToken(request);
  if (!token) return Effect.succeed(null);
  return requestAuthService().authenticate(token);
}

export function skillErrorResponse(error: unknown): Response {
  if (error instanceof MarketplaceQueryError) return apiError(400, error.code, error.message);
  if (error instanceof MarketplaceRateLimitError) {
    const response = apiError(error.status, error.code, error.message);
    response.headers.set("Retry-After", String(error.retryAfterSeconds));
    return response;
  }
  if (error instanceof SkillMarketplaceError) return apiError(error.status, error.code, error.message);
  return authErrorResponse(error);
}

export const requireSkillsAdmin = Effect.fn("Auth.requireSkillsAdmin")(function* (request: Request) {
  return yield* adminTokenMatches(requireWorkerBindings(env).SKILLS_ADMIN_TOKEN, bearerToken(request));
});

export const requireOperationsAdmin = Effect.fn("Auth.requireOperationsAdmin")(function* (request: Request) {
  return yield* adminTokenMatches(requireWorkerBindings(env).SITE_OPERATIONS_ADMIN_TOKEN, bearerToken(request));
});

export const requireServerClaimsAdmin = Effect.fn("Auth.requireServerClaimsAdmin")(function* (request: Request) {
  return yield* adminTokenMatches(requireWorkerBindings(env).SERVER_CLAIMS_ADMIN_TOKEN, bearerToken(request));
});

export function requestContactMessageServices(): ContactMessageServices {
  const bindings = requireWorkerBindings(env);
  return {
    repository: new D1AuthRepository(bindings.DB),
    now: () => Date.now(),
    delivery: () => createContactMessageDelivery(bindings, accountAnalytics(bindings)),
  };
}

export function requestTeamInviteEmailDelivery(): TeamInviteEmailDelivery | null {
  const bindings = requireWorkerBindings(env);
  return createTeamInviteEmailDelivery(bindings, accountAnalytics(bindings));
}

export function requestOwnerTransferEmailDelivery(): OwnerTransferEmailDelivery | null {
  const bindings = requireWorkerBindings(env);
  return createOwnerTransferEmailDelivery(bindings, accountAnalytics(bindings));
}

export function requestRemoteControlPlane(): RemoteControlPlane {
  return new RemoteControlPlane(requireWorkerBindings(env), { schedule });
}

export function requestWatchSessions(): WatchSessions {
  const bindings = requireWorkerBindings(env);
  const limiter = bindings.WATCH_TICKET_RATE_LIMITER;
  return new WatchSessions({
    database: bindings.DB,
    now: () => Date.now(),
    issueTicket: (input) => Effect.suspend(() => requestRemoteControlPlane().issueWatchTicket(input)),
    allowTicket: limiter
      ? (watchSessionId) =>
          Effect.tryPromise({
            try: () => limiter.limit({ key: `watch:${watchSessionId}` }),
            catch: () => new WatchSessionStoreError({}),
          }).pipe(Effect.map((result) => result.success))
      : null,
  });
}

export function requestHostedServerService(request?: Request): HostedServerService {
  return requestHostedBilling(request?.headers.get(HOSTING_DEVELOPER_KEY_HEADER) ?? null).hosting;
}

function requestHostedBilling(developerKey: string | null = null) {
  const bindings = requireWorkerBindings(env);
  const remote = new RemoteControlPlane(bindings, { schedule });
  return createHostedBilling(bindings, {
    removeHost: (ownerUserId, hostId) => remote.deleteHost(ownerUserId, hostId),
    developerKey,
    planChanged: (hostId) => remote.planChanged(hostId),
    licenseChanged: (userId) => remote.licenseChanged(userId),
    schedule,
  });
}

export function hostedServerErrorResponse(error: unknown): Response {
  if (error instanceof HostedServerServiceError) return apiError(error.status, error.code, error.message);
  if (error instanceof BillingError) return apiError(error.status, error.code, error.message);
  if (error instanceof HostedSiteInputError) return apiError(error.status, error.code, error.message);
  return remoteControlPlaneErrorResponse(error);
}

export function verifyRemoteServiceRequest(request: Request, body: string) {
  const secret = requireWorkerBindings(env).REMOTE_AUTH_WEBHOOK_SECRET;
  if (!secret) return Effect.succeed(false);
  return verifyRemoteServiceSignature(
    secret,
    body,
    request.headers.get("OpenBot-Timestamp") ?? "",
    request.headers.get("OpenBot-Signature") ?? "",
  );
}

export function remoteControlPlaneErrorResponse(error: unknown): Response {
  if (error instanceof RemoteControlPlaneError) return apiError(error.status, error.code, error.message);
  return authErrorResponse(error);
}

export function githubRouteErrorResponse(error: unknown): Response {
  if (error instanceof RemoteControlPlaneError) return remoteControlPlaneErrorResponse(error);
  return githubInstallationTokensErrorResponse(error);
}

export function requestSlackApp(): SlackAppService {
  const bindings = requireWorkerBindings(env);
  return new SlackAppService(bindings, {
    flushAuthEvents: () => Effect.sync(() => schedule(deliverPendingRemoteAuthEvents(bindings, Date.now()))),
  });
}

export function slackAppErrorResponse(error: unknown): Response {
  if (error instanceof SlackAppError) return apiError(error.status, error.code, error.message);
  return authErrorResponse(error);
}

export function requestDiscordApp(): DiscordAppService {
  const bindings = requireWorkerBindings(env);
  return new DiscordAppService(bindings, {
    flushAuthEvents: () => Effect.sync(() => schedule(deliverPendingRemoteAuthEvents(bindings, Date.now()))),
  });
}

export function discordAppErrorResponse(error: unknown): Response {
  if (error instanceof DiscordAppError) return apiError(error.status, error.code, error.message);
  return authErrorResponse(error);
}

export function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length);
  return token && token.length <= 512 ? token : null;
}

export function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function publicMarketplaceJson(value: unknown): Response {
  return Response.json(value, {
    headers: {
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300, stale-if-error=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function apiError(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

export function authErrorResponse(error: unknown): Response {
  if (error instanceof JsonBodyError) {
    return apiError(error.status, error.code, error.message);
  }
  if (error instanceof AuthServiceError) {
    const response = apiError(error.status, error.code, error.message);
    if (error.retryAfterSeconds !== undefined) {
      response.headers.set("Retry-After", String(error.retryAfterSeconds));
    }
    return response;
  }
  const reference = requestFailureReference();
  console.error("Account service request failed:", reference, errorType(error));
  return json(
    { error: { code: "internal_error", message: "The account service could not complete the request.", reference } },
    500,
  );
}

function requestFailureReference(): string {
  return `auth/${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function errorType(error: unknown): string {
  if (isDynamicRecord(error) && isString(error._tag)) return error._tag;
  return error instanceof Error ? error.name : typeof error;
}

export function schedule<E>(work: Effect.Effect<void, E>): void {
  waitUntil(runApiEffect(work));
}
