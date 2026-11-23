import { sourceText } from "@openbot/i18n/source";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { readCreditMediaSubmission } from "../../../../server/credit-media-service";
import { CREDITS_ENABLED } from "../../../../server/credits-switch";
import { runApiResponse } from "../../../../server/effect-runtime";
import {
  apiError,
  creditMediaErrorResponse,
  json,
  requestCreditMedia,
  requestCreditMediaPayer,
} from "../../../../server/request-auth";

export const Route = createFileRoute("/v1/media/jobs/")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const caller = yield* requestCreditMediaPayer(request);
            if (!caller) return apiError(401, "unauthorized", sourceText("error.billing.mediaSignInRequired"));
            if (!CREDITS_ENABLED)
              return apiError(503, "media_unavailable", sourceText("error.billing.mediaUnavailable"));
            const submission = yield* readCreditMediaSubmission(request);
            return json(yield* requestCreditMedia().submit(caller.payer, caller.actorUserId, submission), 202);
          }),
          creditMediaErrorResponse,
        ),
    },
  },
});
