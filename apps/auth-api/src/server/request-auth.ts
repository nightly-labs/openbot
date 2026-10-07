import { env, waitUntil } from "cloudflare:workers";
import { HOSTING_DEVELOPER_KEY_HEADER } from "@openbot/contracts/hosted-servers";
import { Effect } from "effect";
import { adminTokenMatches } from "./admin-token";
import { AgentMarketplace, AgentMarketplaceError } from "./agent-marketplace";
import { AgentTemplates } from "./agent-templates";
import { AuthOperationError, AuthService, AuthServiceError } from "./auth-service";
import { BillingError, type BillingService } from "./billing-service";
import { D1AuthRepository } from "./d1-auth-repository";
import { DiscordAppError, DiscordAppService } from "./discord-app";
import { runApiEffect } from "./effect-runtime";
import { createEmailCodeDelivery, createTeamInviteEmailDelivery } from "./email-delivery";
import { GitHubInstallationTokens, GitHubInstallationTokensError } from "./github-installation-tokens";
import { createHostedBilling } from "./hosted-billing";
import { type HostedServerService, HostedServerServiceError } from "./hosted-server-service";
import { HostedSiteInputError } from "./hosted-site-contract";
import { enforceHostedSiteReportRateLimit as enforceReportRateLimit } from "./hosted-site-request-policy";
import { resolveHostedSiteScope } from "./hosted-site-server";
import { HostedSiteService } from "./hosted-site-service";
import { JsonBodyError } from "./json-body";
import { type ApnsLiveActivitySender, sharedApnsSender } from "./live-activity-relay";
import { MarketplaceQueryError } from "./marketplace-pagination";
import {
  enforceMarketplaceMutation,
  type MarketplaceMutationKind,
  MarketplaceRateLimitError,
} from "./marketplace-request-policy";
import {
  deliverPendingRemoteAuthEvents,
  notifyAccountProfileChanged,
  RemoteControlPlane,
  RemoteControlPlaneError,
  verifyRemoteServiceSignature,
} from "./remote-control-plane";
import { SkillMarketplace, SkillMarketplaceError } from "./skill-marketplace";
import { SlackAppError, SlackAppService } from "./slack-app";
import { requireWorkerBindings, type TeamInviteEmailDelivery } from "./types";

export function requestAuthService(): AuthService {
  const bindings = requireWorkerBindings(env);
  const exposeDevelopmentCode = bindings.AUTH_EXPOSE_DEVELOPMENT_CODE === "true";
  return new AuthService({
    repository: new D1AuthRepository(bindings.DB),
    delivery: exposeDevelopmentCode ? null : createEmailCodeDelivery(bindings),
    exposeDevelopmentCode,
    // The revocation is already written and the cron redelivers it, so the answer does not wait.
    flushSessionRevocations: () => Effect.sync(() => schedule(deliverPendingRemoteAuthEvents(bindings, Date.now()))),
    profileChanged: (userId) => notifyAccountProfileChanged(bindings, userId, schedule),
  });
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

/** The sites that a signed-in `/v1/sites` request can see and change. See `resolveHostedSiteScope`. */
export function requestHostedSiteScope(request: Request, userId: string) {
  return resolveHostedSiteScope(requireWorkerBindings(env).DB, userId, request);
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

/** The billing service, or null when this deployment has no Stripe key. */
export function requestBillingService(): BillingService | null {
  return requestHostedBilling().billing;
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
  if (error instanceof HostedSiteInputError) return apiError(error.status, error.code, error.message);
  return authErrorResponse(error);
}

/**
 * One service for each key, so the imported key and the app ID are read once for each isolate. Only
 * resolved values are kept: workerd refuses a promise that another request made.
 */
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

export function githubInstallationTokensErrorResponse(error: unknown): Response {
  if (error instanceof GitHubInstallationTokensError) {
    const response = apiError(error.status, error.code, error.message);
    if (error.status === 429) response.headers.set("Retry-After", "60");
    return response;
  }
  return authErrorResponse(error);
}

/**
 * The Live Activity relay: the Apple sender and the limit for each host. `null` when this Worker has
 * no Apple key or no limiter, so the relay is off.
 */
export function requestLiveActivityRelay(): {
  sender: ApnsLiveActivitySender;
  /** A host sends a few updates a minute for each phone. More is a fault or misuse. */
  allow(hostId: string): Effect.Effect<boolean, AuthOperationError>;
} | null {
  const bindings = requireWorkerBindings(env);
  const { APNS_PRIVATE_KEY, APNS_KEY_ID, APNS_TEAM_ID, APNS_TOPIC, APNS_ORIGIN, LIVE_ACTIVITY_RATE_LIMITER } = bindings;
  if (!APNS_PRIVATE_KEY || !APNS_KEY_ID || !APNS_TEAM_ID || !APNS_TOPIC || !LIVE_ACTIVITY_RATE_LIMITER) return null;
  const origin = developmentApnsOrigin(APNS_ORIGIN);
  return {
    sender: sharedApnsSender({
      // A deploy passes the key as one line, with `\n` for each line break.
      privateKey: APNS_PRIVATE_KEY.replaceAll("\\n", "\n"),
      keyId: APNS_KEY_ID,
      teamId: APNS_TEAM_ID,
      topic: APNS_TOPIC,
      ...(origin ? { origin } : {}),
    }),
    allow: (hostId) =>
      Effect.tryPromise({
        try: () => LIVE_ACTIVITY_RATE_LIMITER.limit({ key: `host:${hostId}` }),
        catch: () => new AuthOperationError({ message: "Account operation failed." }),
      }).pipe(Effect.map((result) => result.success)),
  };
}

/** Only a development server on this computer can stand in for Apple. */
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

export function requestTeamInviteEmailDelivery(): TeamInviteEmailDelivery | null {
  const bindings = requireWorkerBindings(env);
  return createTeamInviteEmailDelivery(bindings);
}

export function requestRemoteControlPlane(): RemoteControlPlane {
  return new RemoteControlPlane(requireWorkerBindings(env), { schedule });
}

/** Pass the request when the call checks who can create servers, so its developer key counts. */
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

export function requestSlackApp(): SlackAppService {
  const bindings = requireWorkerBindings(env);
  // The events are already in D1 and the cron redelivers them, so the answer does not wait.
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
  // The events are already in D1 and the cron redelivers them, so the answer does not wait.
  return new DiscordAppService(bindings, {
    flushAuthEvents: () => Effect.sync(() => schedule(deliverPendingRemoteAuthEvents(bindings, Date.now()))),
  });
}

export function discordAppErrorResponse(error: unknown): Response {
  if (error instanceof DiscordAppError) return apiError(error.status, error.code, error.message);
  return authErrorResponse(error);
}

export function requestRemoteSignalUrl(): string {
  const value = requireWorkerBindings(env).REMOTE_SIGNAL_URL?.trim();
  if (!value)
    throw new RemoteControlPlaneError(503, "remote_not_configured", "The Remote Signal URL is not configured.");
  return value;
}

export function requestSourceIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ?? request.headers.get("X-Forwarded-For")?.split(",")[0] ?? "127.0.0.1"
  );
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
  return apiError(500, "internal_error", "The account service could not complete the request.");
}

/** Starts background work in the active Worker invocation. */
function schedule<E>(work: Effect.Effect<void, E>): void {
  waitUntil(runApiEffect(work));
}
