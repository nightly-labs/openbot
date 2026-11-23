import { sourceText } from "@openbot/i18n/source";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../server/effect-runtime";
import {
  apiError,
  creditMediaErrorResponse,
  json,
  requestCreditMedia,
  requestCreditMediaPayer,
} from "../../../server/request-auth";

export const Route = createFileRoute("/v1/media/balance")({
  server: {
    handlers: {
      GET: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const caller = yield* requestCreditMediaPayer(request);
            if (!caller) return apiError(401, "unauthorized", sourceText("error.billing.mediaSignInRequired"));
            return json(yield* requestCreditMedia().balance(caller.payer));
          }),
          creditMediaErrorResponse,
        ),
    },
  },
});
