import { sourceText } from "@openbot/i18n";
import { runTeamEffect } from "@openbot/team-client";
import { createMarketplaceCatalog } from "@openbot/team-client/marketplace-catalog";
import {
  installAgentSkill,
  installAgentTemplate,
  installMarketplaceAgent,
  listAgentSkills,
  listMcpServers,
  removeMcpServer,
  saveMcpServer,
  setAgentSkillEnabled,
  testMcpServer,
  uninstallAgentSkill,
} from "@openbot/team-client/team-admin-requests";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { currentText } from "@openbot/ui/text";
import { Effect } from "effect";
import type { AgentTemplateInstallCalls } from "../agent-templates/agent-templates-port";
import type { MarketplaceCalls } from "../settings/marketplace-calls";

/** No server id: the account is a member, or the host runs an OpenBot without agent-install-v1. */
const noAgentInstall = () => currentText().t("webClient.error.agentInstallNotAllowed");

/**
 * The marketplace of the browser client. The catalog comes from the account service that serves
 * `/app`; installs go to the connected host, which answers only an owner or admin. Nothing is
 * submitted to the marketplace from a browser, so there are no publishing calls. A share link is
 * published by the host (`agent-publish-v1`).
 *
 * Make it once: the dialog keeps its overview cache for each `list` function.
 */
export function createWebMarketplaceCalls(
  accountFetch: typeof fetch,
  request: (serverId?: string) => TeamApiRequest,
): MarketplaceCalls {
  const catalog = createMarketplaceCatalog(accountFetch);
  return {
    skills: {
      list: (query) => runTeamEffect(catalog.skills.list(query)),
      get: (id) => runTeamEffect(catalog.skills.get(id)),
    },
    agents: {
      list: (query) => runTeamEffect(catalog.agents.list(query)),
      get: (id) => runTeamEffect(catalog.agents.get(id)),
    },
    agentSkills: (serverId) => ({
      listInstalled: async (agentId) =>
        runTeamEffect(listAgentSkills(request(serverId), agentId).pipe(Effect.mapError((error) => error.cause))),
      install: async (input) =>
        runTeamEffect(installAgentSkill(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
      uninstall: async (input) =>
        runTeamEffect(uninstallAgentSkill(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
      setEnabled: async (input) =>
        runTeamEffect(setAgentSkillEnabled(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
    }),
    mcp: {
      listMcpServers: async (serverId) =>
        runTeamEffect(listMcpServers(request(serverId)).pipe(Effect.mapError((error) => error.cause))),
      testMcpServer: async (input, serverId) =>
        runTeamEffect(testMcpServer(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
      saveMcpServer: async (input, serverId) =>
        runTeamEffect(saveMcpServer(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
      removeMcpServer: async (input, serverId) =>
        runTeamEffect(removeMcpServer(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
      // A sign-in opens the browser of the computer that runs OpenBot; the Team API has no route for it.
      signInMcpServer: async () => {
        throw new Error(sourceText("error.mcp.signInOnHost"));
      },
    },
    addAgent: async (input, serverId) => {
      if (!serverId) throw new Error(noAgentInstall());
      return runTeamEffect(
        installMarketplaceAgent(request(serverId), input).pipe(Effect.mapError((error) => error.cause)),
      );
    },
    openUrl: async (url) => {
      const protocol = URL.parse(url)?.protocol;
      if (protocol !== "https:" && protocol !== "http:") throw new Error("This link cannot be opened.");
      window.open(url, "_blank", "noopener");
    },
  };
}

/**
 * The shared agent dialog of the browser client. The template comes from the account service; the host
 * adds the agent. A browser has no computer of its own to add it to.
 */
export function createWebAgentTemplateCalls(
  accountFetch: typeof fetch,
  request: (serverId?: string) => TeamApiRequest,
): AgentTemplateInstallCalls {
  const catalog = createMarketplaceCatalog(accountFetch);
  return {
    agentTemplates: {
      get: (id) => runTeamEffect(catalog.templates.get(id)),
      install: async () => {
        throw new Error(noAgentInstall());
      },
    },
    agent: {
      addTemplateAgent: async (input, serverId) => {
        if (!serverId) throw new Error(noAgentInstall());
        return runTeamEffect(
          installAgentTemplate(request(serverId), input).pipe(Effect.mapError((error) => error.cause)),
        );
      },
    },
  };
}
