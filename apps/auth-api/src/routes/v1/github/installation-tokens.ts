import { createFileRoute } from "@tanstack/solid-router";
import { runApiEffect } from "../../../server/effect-runtime";
import {
  apiError,
  bearerToken,
  enforceGitHubTokenRateLimit,
  githubInstallationTokensErrorResponse,
  json,
  requestGitHubInstallationTokens,
  requestSourceIp,
} from "../../../server/request-auth";

/**
 * Installation tokens of the OpenBot GitHub App, so that GitHub shows an agent's work as
 * `openbotgit[bot]`. The bearer is the GitHub user token of the OpenBot computer, not an OpenBot
 * session: the app works without an OpenBot account. GitHub checks the token, and the answer holds
 * only the repositories where that user can push.
 */
export const Route = createFileRoute("/v1/github/installation-tokens")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await runApiEffect(enforceGitHubTokenRateLimit(requestSourceIp(request)));
          const userToken = bearerToken(request);
          if (!userToken) return apiError(401, "github_unauthorized", "Send the GitHub sign-in as a bearer token.");
          return json({ installations: await runApiEffect(requestGitHubInstallationTokens().issue(userToken)) });
        } catch (error) {
          return githubInstallationTokensErrorResponse(error);
        }
      },
    },
  },
});
