import { isString } from "@openbot/contracts/runtime-values";
import {
  GITHUB_REPOSITORY_NAME_PATTERN,
  GITHUB_ROUTE_REPOSITORIES_LIMIT,
} from "@openbot/contracts/signal-protocol/github-route";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../../server/effect-runtime";
import { readJsonObject } from "../../../../../server/json-body";
import {
  apiError,
  enforceGitHubTokenRateLimit,
  githubRouteErrorResponse,
  json,
  requestGitHubInstallationTokens,
  requestRemoteControlPlane,
} from "../../../../../server/request-auth";
import { requestSourceIp } from "../../../../../server/source-ip";

// The host proves its machine token, as it does for a Signal ticket, and sends its GitHub sign-in
// and the repositories that its GitHub triggers watch. The ticket names only the repositories that
// the sign-in can see through an installation of the OpenBot GitHub App. D1 keeps none of it.
export const Route = createFileRoute("/v2/remote/hosts/$hostId/github-route")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            yield* enforceGitHubTokenRateLimit(requestSourceIp(request));
            const body = yield* readJsonObject(request);
            if (!isString(body.machineToken))
              return apiError(400, "invalid_remote_request", "The host credential is invalid.");
            if (!isString(body.githubToken) || body.githubToken.length === 0)
              return apiError(401, "github_unauthorized", "Send the GitHub sign-in.");
            const names = body.repositories;
            if (
              !Array.isArray(names) ||
              names.length > GITHUB_ROUTE_REPOSITORIES_LIMIT ||
              !names.every((name) => isString(name) && GITHUB_REPOSITORY_NAME_PATTERN.test(name))
            )
              return apiError(400, "invalid_remote_request", "The repository list is invalid.");
            const githubToken = body.githubToken;
            return json(
              yield* requestRemoteControlPlane().issueGitHubRoute(
                params.hostId,
                body.machineToken,
                Effect.suspend(() => requestGitHubInstallationTokens().repositoryRoutes(githubToken, names)),
              ),
            );
          }),
          githubRouteErrorResponse,
        ),
    },
  },
});
