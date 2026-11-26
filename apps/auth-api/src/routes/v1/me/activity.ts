import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { readReportedAccounts, recordAccountActivity } from "../../../server/account-activity";
import { runApiResponse } from "../../../server/effect-runtime";
import { readJsonObject } from "../../../server/json-body";
import { apiError, authErrorResponse, json, requestUser } from "../../../server/request-auth";
import { requireWorkerBindings } from "../../../server/types";

export const Route = createFileRoute("/v1/me/activity")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const accounts = readReportedAccounts(yield* readJsonObject(request));
            if (!accounts) return apiError(400, "invalid_accounts", "The account list is not valid.");
            return json(yield* recordAccountActivity(requireWorkerBindings(env).DB, user.id, accounts, Date.now()));
          }),
          authErrorResponse,
        ),
    },
  },
});
