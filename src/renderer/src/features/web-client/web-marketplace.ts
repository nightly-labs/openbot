import { agentTemplateShareOrigin } from "@openbot/contracts/agent-template-links";
import type { McpServerConfig, McpTestResult } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n";
import { runTeamEffect } from "@openbot/team-client";
import { createMarketplaceCatalog } from "@openbot/team-client/marketplace-catalog";
import {
  cancelMcpSignIn,
  getHostAgentAccess,
  getHostMcpAccess,
  installAgentSkill,
  installAgentTemplate,
  installMarketplaceAgent,
  listAgentSkills,
  listMcpServers,
  listMcpSignIns,
  mcpSignInApp,
  mcpSignInStatus,
  readGithubSkills,
  removeMcpServer,
  removeMcpSignInApp,
  saveMcpServer,
  saveMcpSignInApp,
  setAgentSkillEnabled,
  setHostMcpAccess,
  setMcpServerEnabled,
  signOutMcpServer,
  startMcpSignIn,
  testMcpServer,
  uninstallAgentSkill,
} from "@openbot/team-client/team-admin-requests";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { currentText } from "@openbot/ui/text";
import { Effect } from "effect";
import type { AgentTemplateInstallCalls } from "../agent-templates/agent-templates-port";
import type { MarketplaceCalls } from "../settings/marketplace-calls";
import { webMcpRelay } from "./web-mcp-relay";

const HOST_SIGN_IN_POLL_MS = 1_000;

export interface WebHostSignIn {
  canAdminister: () => boolean;
  hostTab: () => boolean;
}

const noAgentInstall = () => currentText().t("webClient.error.agentInstallNotAllowed");

export function createWebMarketplaceCalls(
  accountFetch: typeof fetch,
  request: (serverId?: string) => TeamApiRequest,
  hostSignIn?: WebHostSignIn,
): MarketplaceCalls {
  const catalog = createMarketplaceCatalog(accountFetch);
  const relay = webMcpRelay();
  const hostTabs = new Map<string, string | null>();
  const run = <T>(effect: Effect.Effect<T, { cause: unknown }>) =>
    runTeamEffect(effect.pipe(Effect.mapError((error) => error.cause)));

  async function signInOnHostTab(serverId: string, config: McpServerConfig): Promise<McpTestResult> {
    if (!hostSignIn?.canAdminister()) return { toolCount: 0, error: sourceText("error.mcp.signInPageOnServer") };
    if (!hostSignIn.hostTab()) return { toolCount: 0, error: sourceText("error.mcp.signInOnHost") };
    const url = config.url;
    await run(startMcpSignIn(request(serverId), { config }));
    hostTabs.set(url, null);
    try {
      while (true) {
        const status = await run(mcpSignInStatus(request(serverId), { url }));
        if (status.result) return status.result;
        hostTabs.set(url, status.tabId);
        await new Promise((resolve) => setTimeout(resolve, HOST_SIGN_IN_POLL_MS));
      }
    } catch (error) {
      void run(cancelMcpSignIn(request(serverId), { url })).catch(() => undefined);
      throw error;
    } finally {
      hostTabs.delete(url);
    }
  }
  return {
    skills: {
      list: (query) => runTeamEffect(catalog.skills.list(query)),
      get: (id) => runTeamEffect(catalog.skills.get(id)),
      getBySlug: (slug) => runTeamEffect(catalog.skills.getBySlug(slug)),
    },
    pluginCatalog: () => runTeamEffect(catalog.plugins.catalog()),
    agents: {
      list: (query) => runTeamEffect(catalog.agents.list(query)),
      get: (id) => runTeamEffect(catalog.agents.get(id)),
      getListing: (id) => runTeamEffect(catalog.agents.getListing(id)),
    },
    shareOrigin: agentTemplateShareOrigin(window.location.origin),
    agentSkills: (serverId) => ({
      listInstalled: async (agentId) =>
        runTeamEffect(listAgentSkills(request(serverId), agentId).pipe(Effect.mapError((error) => error.cause))),
      install: async (input) =>
        runTeamEffect(installAgentSkill(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
      uninstall: async (input) =>
        runTeamEffect(uninstallAgentSkill(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
      setEnabled: async (input) =>
        runTeamEffect(setAgentSkillEnabled(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
      readGithub: async (link) =>
        runTeamEffect(readGithubSkills(request(serverId), link).pipe(Effect.mapError((error) => error.cause))),
    }),
    mcp: {
      listMcpServers: async (serverId) =>
        runTeamEffect(listMcpServers(request(serverId)).pipe(Effect.mapError((error) => error.cause))),
      listMcpSignIns: async (serverId) =>
        runTeamEffect(listMcpSignIns(request(serverId)).pipe(Effect.mapError((error) => error.cause))),
      testMcpServer: async (input, serverId) =>
        runTeamEffect(testMcpServer(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
      saveMcpServer: async (input, serverId) =>
        runTeamEffect(saveMcpServer(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
      removeMcpServer: async (input, serverId) =>
        runTeamEffect(removeMcpServer(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
      setMcpServerEnabled: async (input, serverId) =>
        runTeamEffect(setMcpServerEnabled(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
      signOutMcpServer: async (input, serverId) =>
        runTeamEffect(signOutMcpServer(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
      mcpSignInApp: async (input, serverId) =>
        runTeamEffect(mcpSignInApp(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
      saveMcpSignInApp: async (input, serverId) =>
        runTeamEffect(saveMcpSignInApp(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
      removeMcpSignInApp: async (input, serverId) =>
        runTeamEffect(removeMcpSignInApp(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
      signInMcpServer: async ({ config }, serverId) => {
        if (!serverId) throw new Error(sourceText("error.mcp.signInOnHost"));
        const result = await relay.signIn(request(serverId), config);
        return result ?? signInOnHostTab(serverId, config);
      },
      cancelMcpSignIn: async (input, serverId) => {
        await runTeamEffect(cancelMcpSignIn(request(serverId), input).pipe(Effect.mapError((error) => error.cause)));
      },
    },
    mcpAccess: {
      get: async (serverId) =>
        runTeamEffect(getHostMcpAccess(request(serverId)).pipe(Effect.mapError((error) => error.cause))),
      set: async (input, serverId) =>
        runTeamEffect(setHostMcpAccess(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
      roles: async (serverId) =>
        (await runTeamEffect(getHostAgentAccess(request(serverId)).pipe(Effect.mapError((error) => error.cause))))
          .roles ?? [],
    },
    signInRelay: {
      page: async (url) => relay.page(url),
      open: async (url) => relay.open(url),
      paste: (url, address) => relay.paste(url, address),
      hostTab: async (url) => hostTabs.get(url) ?? null,
    },
    addAgent: async (input, serverId) => {
      if (!serverId) throw new Error(noAgentInstall());
      return runTeamEffect(
        installMarketplaceAgent(request(serverId), input).pipe(Effect.mapError((error) => error.cause)),
      );
    },
    openUrl: async (url) => {
      const protocol = URL.parse(url)?.protocol;
      if (protocol !== "https:" && protocol !== "http:") {
        throw new Error(currentText().t("webClient.error.linkBlocked"));
      }
      window.open(url, "_blank", "noopener");
    },
  };
}

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
