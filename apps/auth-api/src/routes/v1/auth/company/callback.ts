import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../server/effect-runtime";
import { apiError, companySignInErrorResponse, requestCompanySignIn } from "../../../../server/request-auth";

// The company provider sends the browser here after a sign-in or a test. The browser goes on to the
// app's loopback listener with a one-time code, or with the error code.
export const Route = createFileRoute("/v1/auth/company/callback")({
  server: {
    handlers: {
      GET: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const target = yield* requestCompanySignIn().finish(new URL(request.url).searchParams, request.url);
            if (!target) {
              return apiError(410, "company_sign_in_expired", "This sign-in expired. Start it again in OpenBot.");
            }
            return new Response(null, {
              status: 303,
              headers: { Location: target, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
            });
          }),
          companySignInErrorResponse,
        ),
    },
  },
});
