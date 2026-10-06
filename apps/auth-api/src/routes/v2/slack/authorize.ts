import { isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { readJsonObject } from "../../../server/json-body";
import { apiError, json, requestSlackApp, requestUser, slackAppErrorResponse } from "../../../server/request-auth";

// Starts the OpenBot Slack app's install for one connect of one host. The host sends a one-use
// public key, and the bot token comes back sealed to it.
export const Route = createFileRoute("/v2/slack/authorize")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const user = await requestUser(request);
          if (!user) return apiError(401, "unauthorized", "Sign in is required.");
          const body = await readJsonObject(request);
          if (!isString(body.hostId) || !isString(body.hostNonce) || !isString(body.hostPublicKey))
            return apiError(400, "invalid_slack_request", "The Slack sign-in request is invalid.");
          if (body.returnUrl !== undefined && !isString(body.returnUrl))
            return apiError(400, "invalid_slack_request", "The Slack sign-in request is invalid.");
          const slack = requestSlackApp();
          const authorizeUrl = await slack.authorizeUrl(user, {
            hostId: body.hostId,
            hostNonce: body.hostNonce,
            hostPublicKey: body.hostPublicKey,
            redirectUri: slack.redirectUri(request.url),
            ...(body.returnUrl ? { returnUrl: body.returnUrl } : {}),
          });
          return json({ authorizeUrl });
        } catch (error) {
          return slackAppErrorResponse(error);
        }
      },
    },
  },
});
