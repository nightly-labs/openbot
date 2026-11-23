import { isCreditMediaJobId } from "@openbot/contracts/credit-media";
import { sourceText } from "@openbot/i18n/source";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../../../server/effect-runtime";
import {
  apiError,
  creditMediaErrorResponse,
  requestCreditMedia,
  requestCreditMediaPayer,
} from "../../../../../../server/request-auth";

export const Route = createFileRoute("/v1/media/jobs/$jobId/outputs/$index")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const caller = yield* requestCreditMediaPayer(request);
            if (!caller) return apiError(401, "unauthorized", sourceText("error.billing.mediaSignInRequired"));
            const index = /^\d{1,2}$/.test(params.index) ? Number(params.index) : -1;
            if (!isCreditMediaJobId(params.jobId) || index < 0)
              return apiError(404, "media_job_not_found", sourceText("error.billing.mediaJobNotFound"));
            return yield* requestCreditMedia().output(caller.payer, params.jobId, index);
          }),
          creditMediaErrorResponse,
        ),
    },
  },
});
