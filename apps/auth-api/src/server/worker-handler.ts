import { Effect } from "effect";
import { routeRequest as routeHostedSiteRequest } from "../../../site-router/src/index";
import { type AuthRetentionResult, pruneExpiredAuthData } from "./auth-data-retention";
import { canonicalHostRedirect, permanentTrailingSlashRedirect } from "./canonical-redirect";
import { runApiEffect } from "./effect-runtime";
import { createHostedBilling } from "./hosted-billing";
import type { HostedServerBindings } from "./hosted-server-service";
import { HostedSiteService } from "./hosted-site-service";
import { enforceMarketplaceIngress, MarketplaceRateLimitError } from "./marketplace-request-policy";
import { pageMarkdownResponse } from "./page-markdown";
import { deliverPendingRemoteAuthEvents, RemoteControlPlane } from "./remote-control-plane";
import type { WorkerBindings } from "./types";

type WorkerFetch = (request: Request) => Response | Promise<Response>;
type AuthDataPruner = typeof pruneExpiredAuthData;
type RetentionLogger = (result: AuthRetentionResult) => void;
type WorkerExecutionContext = Pick<ExecutionContext, "waitUntil">;
type RemoteAuthEventDelivery = typeof deliverPendingRemoteAuthEvents;

export function createWorkerHandler(
  fetchHandler: WorkerFetch,
  prune: AuthDataPruner = pruneExpiredAuthData,
  log: RetentionLogger = logRetentionResult,
  deliverRemoteAuthEvents: RemoteAuthEventDelivery = deliverPendingRemoteAuthEvents,
) {
  return {
    async fetch(
      request: Request,
      bindings: Pick<WorkerBindings, "MARKETPLACE_INGRESS_RATE_LIMITER"> &
        Partial<Pick<WorkerBindings, "SITES" | "SITE_LOCAL_ORIGIN">>,
      context?: WorkerExecutionContext,
    ) {
      const hostRedirect = canonicalHostRedirect(request);
      if (hostRedirect) return hostRedirect;
      const earlyResponse = await runApiEffect(
        Effect.gen(function* () {
          const localSiteResponse = yield* serveLocalHostedSite(request, bindings);
          if (localSiteResponse) return localSiteResponse;
          yield* enforceMarketplaceIngress(request, bindings);
          return null;
        }).pipe(
          Effect.catchIf(
            (error) => error instanceof MarketplaceRateLimitError,
            (error) =>
              Effect.succeed(
                Response.json(
                  { error: { code: error.code, message: error.message } },
                  {
                    status: error.status,
                    headers: {
                      "Cache-Control": "no-store",
                      "Retry-After": String(error.retryAfterSeconds),
                      "X-Content-Type-Options": "nosniff",
                    },
                  },
                ),
              ),
          ),
        ),
      );
      if (earlyResponse) return earlyResponse;
      // Drawn from the HTML pages, so it renders them through the same handler.
      const markdown = await pageMarkdownResponse(request, fetchHandler);
      if (markdown) return markdown;
      const response = Promise.resolve(fetchHandler(request)).then((result) =>
        permanentTrailingSlashRedirect(request, result),
      );
      if (context && isEmailSignInStart(request)) {
        context.waitUntil(
          response.then(
            () => undefined,
            () => undefined,
          ),
        );
      }
      return response;
    },
    async scheduled(
      controller: Pick<ScheduledController, "scheduledTime">,
      bindings: Pick<WorkerBindings, "DB" | "REMOTE_AUTH_WEBHOOK_URL" | "REMOTE_AUTH_WEBHOOK_SECRET"> &
        Partial<Pick<WorkerBindings, "SITES" | HostedServerTickBindingKey>>,
    ) {
      const now = controller.scheduledTime;
      // Retention starts after the hosted server check; delivery and site cleanup run beside both.
      const hostingThenRetention = Effect.gen(function* () {
        const hostingResult = bindings.BOAT_API_KEY ? yield* tickHostedServers(bindings, now) : null;
        if (hostingResult && Object.values(hostingResult).some(Boolean)) {
          console.info("Hosted server check completed.", hostingResult);
        }
        return isDailyRetentionRun(now) ? yield* prune(bindings.DB, now) : null;
      });
      // Each job runs to its end, so a failure of one does not cut another. The first failure still
      // fails the run.
      const [retention, , sites] = await runApiEffect(
        Effect.all(
          [
            Effect.exit(hostingThenRetention),
            Effect.exit(deliverRemoteAuthEvents(bindings, now)),
            Effect.exit(
              bindings.SITES ? new HostedSiteService(bindings.DB, bindings.SITES).cleanup(now) : Effect.succeed(null),
            ),
          ],
          { concurrency: "unbounded" },
        ).pipe(
          Effect.flatMap(([retentionExit, deliveryExit, sitesExit]) =>
            Effect.all([retentionExit, deliveryExit, sitesExit]),
          ),
        ),
      );
      if (retention) log(retention);
      if (sites) console.info("Hosted site cleanup completed.", sites);
    },
  } satisfies ExportedHandler<WorkerBindings>;
}

type HostedServerTickBindingKey =
  | Exclude<keyof HostedServerBindings, "DB">
  | "REMOTE_TICKET_PRIVATE_JWK"
  | "REMOTE_TICKET_PUBLIC_JWKS"
  | "REMOTE_TICKET_KEY_ID"
  | "STRIPE_SECRET_KEY"
  | "STRIPE_WEBHOOK_SECRET"
  | "OPENPANEL_CLIENT_ID"
  | "OPENPANEL_CLIENT_SECRET";

function tickHostedServers(
  bindings: Pick<WorkerBindings, "DB" | "REMOTE_AUTH_WEBHOOK_URL" | "REMOTE_AUTH_WEBHOOK_SECRET"> &
    Partial<Pick<WorkerBindings, HostedServerTickBindingKey>>,
  now: number,
) {
  const remote = new RemoteControlPlane(bindings);
  // The cron waits for the analytics sends itself. They never reject.
  const sends: Effect.Effect<void>[] = [];
  return Effect.gen(function* () {
    const result = yield* createHostedBilling(bindings, {
      removeHost: (ownerUserId, hostId) => remote.deleteHost(ownerUserId, hostId),
      planChanged: (hostId) => remote.planChanged(hostId),
      schedule: (send) => sends.push(send),
    }).hosting.tick(now);
    return result;
  }).pipe(
    Effect.ensuring(Effect.suspend(() => Effect.all(sends, { concurrency: "unbounded", discard: true }))),
    Effect.catch(() =>
      Effect.sync(() => {
        console.warn("Hosted server check failed.");
        return null;
      }),
    ),
  );
}

function serveLocalHostedSite(
  request: Request,
  bindings: Partial<Pick<WorkerBindings, "SITES" | "SITE_LOCAL_ORIGIN">>,
) {
  if (!bindings.SITES || !bindings.SITE_LOCAL_ORIGIN) return Effect.succeed(null);
  const requestUrl = new URL(request.url);
  const configuredOrigin = new URL(bindings.SITE_LOCAL_ORIGIN);
  const suffix = `.${configuredOrigin.hostname}`;
  if (
    requestUrl.protocol !== configuredOrigin.protocol ||
    requestUrl.port !== configuredOrigin.port ||
    !requestUrl.hostname.endsWith(suffix)
  ) {
    return Effect.succeed(null);
  }
  const label = requestUrl.hostname.slice(0, -suffix.length);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label)) return Effect.succeed(null);
  const hostedUrl = new URL(requestUrl);
  hostedUrl.protocol = "https:";
  hostedUrl.hostname = `${label}.openbot.site`;
  hostedUrl.port = "";
  return routeHostedSiteRequest(
    new Request(hostedUrl, request),
    { SITES: bindings.SITES, SITE_SERVE_ENABLED: "true" },
    Date.now(),
  );
}

function isEmailSignInStart(request: Request): boolean {
  return (
    request.method === "POST" &&
    ["/v1/auth/email/start", "/api/browser/email/start"].includes(new URL(request.url).pathname)
  );
}

function isDailyRetentionRun(scheduledTime: number): boolean {
  const scheduled = new Date(scheduledTime);
  return scheduled.getUTCHours() === 0 && scheduled.getUTCMinutes() === 0;
}

function logRetentionResult(result: AuthRetentionResult): void {
  console.info("Auth data retention completed.", result);
}
