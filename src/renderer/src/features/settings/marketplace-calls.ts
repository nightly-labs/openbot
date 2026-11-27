import type {
  AddedAgent,
  InstallMarketplaceAgentInput,
  McpAccessSnapshot,
  McpSignInRelayPage,
  SetMcpAccessInput,
} from "@openbot/contracts/ipc";
import type { PluginCatalog } from "@openbot/contracts/plugin-catalog";
import { appPort } from "../../app-port";
import { type AgentSkillCalls, agentSkillCalls, type SkillsPort, skillsPort } from "../../skills-port";

export interface MarketplaceCalls {
  skills: Pick<SkillsPort["skills"], "get" | "getBySlug" | "list">;
  pluginCatalog: () => Promise<PluginCatalog | null>;
  agents: Pick<SkillsPort["marketplaceAgents"], "get" | "getListing" | "list">;
  agentSkills: (hostServerId?: string) => AgentSkillCalls;
  mcp: Pick<
    SkillsPort["agent"],
    | "cancelMcpSignIn"
    | "listMcpServers"
    | "listMcpSignIns"
    | "mcpSignInApp"
    | "removeMcpServer"
    | "removeMcpSignInApp"
    | "saveMcpServer"
    | "saveMcpSignInApp"
    | "setMcpServerEnabled"
    | "signInMcpServer"
    | "signOutMcpServer"
    | "testMcpServer"
  >;
  mcpAccess?: MarketplaceMcpAccessCalls | undefined;
  addAgent: (input: InstallMarketplaceAgentInput, serverId: string | undefined) => Promise<AddedAgent>;
  openUrl: (url: string) => Promise<void>;
  signInRelay?: MarketplaceSignInRelay | undefined;
  copySignInLink?: ((url: string, serverId: string) => Promise<void>) | undefined;
  macAutomation?: SkillsPort["macAutomation"]["request"] | undefined;
  shareOrigin?: string | undefined;
}

interface MarketplaceMcpAccessCalls {
  get: (serverId: string) => Promise<McpAccessSnapshot>;
  set: (input: SetMcpAccessInput, serverId: string) => Promise<McpAccessSnapshot>;
  roles: (serverId: string) => Promise<readonly { id: string; name: string }[]>;
}

export interface MarketplaceSignInRelay {
  page: (url: string, serverId: string) => Promise<McpSignInRelayPage | null>;
  open: (url: string, serverId: string) => Promise<void>;
  paste: (url: string, address: string, serverId: string) => Promise<void>;
  hostTab?: ((url: string, serverId: string) => Promise<string | null>) | undefined;
}

export function desktopMarketplaceCalls(): MarketplaceCalls {
  const port = skillsPort();
  return {
    skills: port.skills,
    pluginCatalog: () => port.skills.pluginCatalog(),
    agents: port.marketplaceAgents,
    agentSkills: agentSkillCalls,
    mcp: port.agent,
    mcpAccess: {
      get: (serverId) => port.agent.getMcpAccess(serverId),
      set: (input, serverId) => port.agent.setMcpAccess(input, serverId),
      roles: async (serverId) => (await port.hostAdmin.getAgentAccess(serverId)).roles ?? [],
    },
    addAgent: async (input, serverId) =>
      serverId ? port.agent.addMarketplaceAgent(input, serverId) : (await port.marketplaceAgents.install(input)).agent,
    openUrl: (url) => appPort().openUrl(url),
    signInRelay: {
      page: (url, serverId) => port.agent.mcpSignInRelay({ url }, serverId),
      open: (url, serverId) => port.agent.openMcpSignInRelay({ url }, serverId),
      paste: (url, address, serverId) => port.agent.completeMcpSignInRelay({ url, address }, serverId),
      hostTab: (url, serverId) => port.agent.mcpSignInPage({ url }, serverId),
    },
    copySignInLink: (url, serverId) => port.agent.copyMcpSignInLink({ url }, serverId),
    macAutomation: (targets) => port.macAutomation.request(targets),
  };
}
