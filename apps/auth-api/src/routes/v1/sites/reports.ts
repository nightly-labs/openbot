import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../server/effect-runtime";
import { isSameOriginReportRequest } from "../../../server/hosted-site-report-request";
import { readRequestBytes } from "../../../server/json-body";
import {
  apiError,
  enforceHostedSiteReportRateLimit,
  hostedSiteErrorResponse,
  json,
  requestHostedSiteService,
  requestSourceIp,
} from "../../../server/request-auth";

export const Route = createFileRoute("/v1/sites/reports")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            if (!isSameOriginReportRequest(request)) {
              return apiError(403, "invalid_report_origin", "Open the report form on openbot.run.");
            }
            const sourceIp = requestSourceIp(request);
            yield* enforceHostedSiteReportRateLimit(sourceIp);
            const contentType = request.headers.get("Content-Type") ?? "";
            if (!contentType.startsWith("application/x-www-form-urlencoded")) {
              return apiError(400, "invalid_report", "The report form is invalid.");
            }
            const body = new TextDecoder().decode(yield* readRequestBytes(request, 4_096));
            const form = new URLSearchParams(body);
            const hostname = form.get("hostname")?.trim().toLowerCase() ?? "";
            const reason = form.get("reason")?.trim().toLowerCase() ?? "";
            const details = form.get("details")?.trim() || null;
            yield* requestHostedSiteService().report(hostname, reason, details, sourceIp);
            return json({ reported: true }, 201);
          }),
          hostedSiteErrorResponse,
        ),
    },
  },
});
