import { githubPage, type HostGitHubConnectorStatus, withoutGitHubPages } from "@openbot/contracts/ipc";
import type { CONNECTORS_ROUTES } from "@openbot/contracts/team-protocol/connectors-v1";
import { runTeamEffect } from "@openbot/team-client";
import {
  githubConnectorRepositories,
  githubConnectorRequest,
  type TeamAdminRequestError,
} from "@openbot/team-client/team-admin-requests";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { Effect } from "effect";
import { type GitHubConnectorPort, polledGitHubConnectorPort } from "../connectors/github-connector-port";

type StatusRoute = Exclude<keyof typeof CONNECTORS_ROUTES, "githubRepositories">;

export function webGitHubConnectorPort(request: () => TeamApiRequest): GitHubConnectorPort {
  let last: HostGitHubConnectorStatus | null = null;
  const run = <T>(effect: (request: TeamApiRequest) => Effect.Effect<T, TeamAdminRequestError>) =>
    runTeamEffect(Effect.suspend(() => effect(request())).pipe(Effect.mapError((error) => error.cause)));
  const send = async (route: StatusRoute) => {
    last = await run((target) => githubConnectorRequest(target, route));
    return last;
  };
  const open = (address: string | null) => {
    const page = githubPage(address);
    if (page) window.open(page, "_blank", "noopener,noreferrer");
  };
  const withTab = async (route: StatusRoute, page: (status: HostGitHubConnectorStatus) => string | null) => {
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    try {
      const status = await send(route);
      const address = githubPage(page(status));
      if (tab && address) tab.location.href = address;
      else tab?.close();
      return withoutGitHubPages(status);
    } catch (error) {
      tab?.close();
      throw error;
    }
  };
  return polledGitHubConnectorPort({
    status: async () => withoutGitHubPages(await send("githubStatus")),
    connect: () => withTab("githubConnect", (status) => (status.state === "pending" ? status.verificationUri : null)),
    cancel: async () => withoutGitHubPages(await send("githubCancel")),
    disconnect: async () => {
      const signedIn = last?.state === "connected" || last?.state === "expired";
      if (signedIn) return withTab("githubDisconnect", (status) => status.revokeUrl);
      return withoutGitHubPages(await send("githubDisconnect"));
    },
    repositories: () => run(githubConnectorRepositories),
    openVerification: async () => open(last?.verificationUri ?? null),
    openInstall: async () => open(last?.installUrl ?? null),
  });
}
