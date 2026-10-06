import { isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../server/effect-runtime";
import { readJsonObject } from "../../../server/json-body";
import { apiError, json, requestSlackApp, requestUser, slackAppErrorResponse } from "../../../server/request-auth";

// Starts the OpenBot Slack app's install for one connect of one host. The host sends a one-use
// public key, and the bot token comes back sealed to it.
export const Route = createFileRoute("/v2/slack/authorize")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const body = yield* readJsonObject(request);
            if (!isString(body.hostId) || !isString(body.hostNonce) || !isString(body.hostPublicKey))
              return apiError(400, "invalid_slack_request", "The Slack sign-in request is invalid.");
            if (body.returnUrl !== undefined && !isString(body.returnUrl))
              return apiError(400, "invalid_slack_request", "The Slack sign-in request is invalid.");
            const slack = requestSlackApp();
            const authorizeUrl = yield* slack.authorizeUrl(user, {
              hostId: body.hostId,
              hostNonce: body.hostNonce,
              hostPublicKey: body.hostPublicKey,
              redirectUri: slack.redirectUri(request.url),
              ...(body.returnUrl ? { returnUrl: body.returnUrl } : {}),
            });
            return json({ authorizeUrl });
          }),
          slackAppErrorResponse,
        ),
    },
  },
});
