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

/** How often a sign-in in the host's own tab asks the host whether it ended. */
const HOST_SIGN_IN_POLL_MS = 1_000;

/**
 * A sign-in whose page only the connected host can reach, such as an MCP server on the host's
 * loopback address. The host opens it in its own tab, which the live view shows.
 */
export interface WebHostSignIn {
  /** The account is an owner or admin: the host shows its private sign-in tabs only to them. */
  canAdminister: () => boolean;
  /** The host opens a sign-in page in its own tab (`mcp-sign-in-v1`, `browser-view`). */
  hostTab: () => boolean;
}

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
  hostSignIn?: WebHostSignIn,
): MarketplaceCalls {
  const catalog = createMarketplaceCatalog(accountFetch);
  const relay = webMcpRelay();
  /** The host tab of each sign-in in the host's own browser, by the address it signs in to. */
  const hostTabs = new Map<string, string | null>();
  const run = <T>(effect: Effect.Effect<T, { cause: unknown }>) =>
    runTeamEffect(effect.pipe(Effect.mapError((error) => error.cause)));

  /**
   * The relay already ended on the host. Only the host reaches the page, so its own tab shows it, and
   * the status is read until the sign-in ends.
   */
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
      // Nobody watches the page any more, so it must not stay open on the host for the full timeout.
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
      // The Marketplace asks only a host with `github-skills-v1`.
      readGithub: async (link) =>
        runTeamEffect(readGithubSkills(request(serverId), link).pipe(Effect.mapError((error) => error.cause))),
    }),
    mcp: {
      listMcpServers: async (serverId) =>
        runTeamEffect(listMcpServers(request(serverId)).pipe(Effect.mapError((error) => error.cause))),
      // A host without `mcp-sign-in-v1` refuses the route; the marketplace then shows no sign-in state.
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
      // The Marketplace asks only a host with `mcp-sign-in-app-v1`.
      mcpSignInApp: async (input, serverId) =>
        runTeamEffect(mcpSignInApp(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
      saveMcpSignInApp: async (input, serverId) =>
        runTeamEffect(saveMcpSignInApp(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
      removeMcpSignInApp: async (input, serverId) =>
        runTeamEffect(removeMcpSignInApp(request(serverId), input).pipe(Effect.mapError((error) => error.cause))),
      // The marketplace asks only a host that relays its sign-ins (`sign-in-relay-v1`): the page opens
      // in this browser, and the user pastes the address it ends on.
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
      // No await comes before `window.open`: a browser blocks a page that the user's click did not open.
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
