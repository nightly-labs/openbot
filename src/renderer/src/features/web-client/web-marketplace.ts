import { createMarketplaceCatalog } from "@openbot/team-client/marketplace-catalog";
import {
  installAgentSkill,
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
import type { MarketplaceCalls } from "../settings/marketplace-calls";

/**
 * The marketplace of the browser client. The catalog comes from the account service that serves
 * `/app`; installs go to the connected host, which answers only an owner or admin. Nothing is
 * published from a browser, so there are no publishing calls.
 *
 * Make it once: the dialog keeps its overview cache for each `list` function.
 */
export function createWebMarketplaceCalls(
  accountFetch: typeof fetch,
  request: (serverId?: string) => TeamApiRequest,
): MarketplaceCalls {
  const catalog = createMarketplaceCatalog(accountFetch);
  return {
    skills: catalog.skills,
    agents: catalog.agents,
    agentSkills: (serverId) => ({
      listInstalled: async (agentId) => listAgentSkills(request(serverId), agentId),
      install: async (input) => installAgentSkill(request(serverId), input),
      uninstall: async (input) => uninstallAgentSkill(request(serverId), input),
      setEnabled: async (input) => setAgentSkillEnabled(request(serverId), input),
    }),
    mcp: {
      listMcpServers: async (serverId) => listMcpServers(request(serverId)),
      testMcpServer: async (input, serverId) => testMcpServer(request(serverId), input),
      saveMcpServer: async (input, serverId) => saveMcpServer(request(serverId), input),
      removeMcpServer: async (input, serverId) => removeMcpServer(request(serverId), input),
    },
    addAgent: async (input, serverId) => {
      if (!serverId) throw new Error("Only an owner or admin of this server can add an agent to it.");
      return installMarketplaceAgent(request(serverId), input);
    },
    openUrl: async (url) => {
      const protocol = URL.parse(url)?.protocol;
      if (protocol !== "https:" && protocol !== "http:") throw new Error("This link cannot be opened.");
      window.open(url, "_blank", "noopener");
    },
  };
}
