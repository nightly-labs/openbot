import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../server/effect-runtime";
import {
  apiError,
  bearerToken,
  enforceGitHubTokenRateLimit,
  githubInstallationTokensErrorResponse,
  json,
  requestGitHubInstallationTokens,
} from "../../../server/request-auth";
import { requestSourceIp } from "../../../server/source-ip";

export const Route = createFileRoute("/v1/github/installation-tokens")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            yield* enforceGitHubTokenRateLimit(requestSourceIp(request));
            const userToken = bearerToken(request);
            if (!userToken) return apiError(401, "github_unauthorized", "Send the GitHub sign-in as a bearer token.");
            return json({ installations: yield* requestGitHubInstallationTokens().issue(userToken) });
          }),
          githubInstallationTokensErrorResponse,
        ),
    },
  },
});
