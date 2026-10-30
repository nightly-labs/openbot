import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { sendContactMessage } from "../../server/contact-message";
import { runApiResponse } from "../../server/effect-runtime";
import { isSameOriginReportRequest } from "../../server/hosted-site-report-request";
import { readJsonObject } from "../../server/json-body";
import { apiError, authErrorResponse, requestContactMessageServices } from "../../server/request-auth";
import { requestSourceIp } from "../../server/source-ip";

// The contact form on `/contact`. Only that page can send: the route needs no sign-in, so it checks
// the origin as the site report form does.
export const Route = createFileRoute("/v1/contact")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            if (!isSameOriginReportRequest(request)) {
              return apiError(403, "invalid_contact_origin", "Open the contact form on openbot.run.");
            }
            const body = yield* readJsonObject(request);
            yield* sendContactMessage(requestContactMessageServices(), body, requestSourceIp(request));
            return new Response(null, { status: 204 });
          }),
          authErrorResponse,
        ),
    },
  },
});
