import { Effect } from "effect";
import { HostedSiteInputError } from "./hosted-site-contract";
import { siteCall } from "./hosted-site-effects";
import type { WorkerBindings } from "./types";

export const enforceHostedSiteReportRateLimit = Effect.fn("HostedSites.enforceReportRateLimit")(function* (
  bindings: Pick<WorkerBindings, "SITE_REPORT_RATE_LIMITER">,
  sourceIp: string,
) {
  const result = yield* siteCall(() => bindings.SITE_REPORT_RATE_LIMITER.limit({ key: `ip:${sourceIp}` }));
  if (!result.success) {
    return yield* new HostedSiteInputError(
      429,
      "report_rate_limit",
      "Too many reports were submitted. Try again later.",
    );
  }
});
