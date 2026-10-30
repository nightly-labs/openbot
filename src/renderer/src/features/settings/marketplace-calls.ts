import type { AddedAgent, InstallMarketplaceAgentInput, McpSignInRelayPage } from "@openbot/contracts/ipc";
import { appPort } from "../../app-port";
import { type AgentSkillCalls, agentSkillCalls, type SkillsPort, skillsPort } from "../../skills-port";

/**
 * What the marketplace calls. The desktop app reads the catalog and changes agents through main. The
 * browser client reads the catalog on its own origin and changes its host over the Team API.
 */
export interface MarketplaceCalls {
  skills: Pick<SkillsPort["skills"], "get" | "list">;
  agents: Pick<SkillsPort["marketplaceAgents"], "get" | "list">;
  agentSkills: (hostServerId?: string) => AgentSkillCalls;
  mcp: Pick<
    SkillsPort["agent"],
    | "cancelMcpSignIn"
    | "listMcpServers"
    | "listMcpSignIns"
    | "removeMcpServer"
    | "saveMcpServer"
    | "signInMcpServer"
    | "testMcpServer"
  >;
  /** `serverId` absent: this computer, which is also the only place an installed agent is updated. */
  addAgent: (input: InstallMarketplaceAgentInput, serverId: string | undefined) => Promise<AddedAgent>;
  openUrl: (url: string) => Promise<void>;
  /** A sign-in that a joined server relays to this computer's browser. Absent: this client cannot take one. */
  signInRelay?: MarketplaceSignInRelay | undefined;
  /** Asks macOS on this computer for Automation access to Apple apps. Absent: this client cannot. */
  macAutomation?: SkillsPort["macAutomation"]["request"] | undefined;
}

/** The relayed sign-in of the app at `url` on the joined server `serverId`, while it waits. */
export interface MarketplaceSignInRelay {
  page: (url: string, serverId: string) => Promise<McpSignInRelayPage | null>;
  open: (url: string, serverId: string) => Promise<void>;
  paste: (url: string, address: string, serverId: string) => Promise<void>;
}

/** Read on each call, as `skillsPort` is: tests and stories replace `window.openbot` per case. */
export function desktopMarketplaceCalls(): MarketplaceCalls {
  const port = skillsPort();
  return {
    skills: port.skills,
    agents: port.marketplaceAgents,
    agentSkills: agentSkillCalls,
    mcp: port.agent,
    addAgent: async (input, serverId) =>
      serverId ? port.agent.addMarketplaceAgent(input, serverId) : (await port.marketplaceAgents.install(input)).agent,
    openUrl: (url) => appPort().openUrl(url),
    signInRelay: {
      page: (url, serverId) => port.agent.mcpSignInRelay({ url }, serverId),
      open: (url, serverId) => port.agent.openMcpSignInRelay({ url }, serverId),
      paste: (url, address, serverId) => port.agent.completeMcpSignInRelay({ url, address }, serverId),
    },
    macAutomation: (targets) => port.macAutomation.request(targets),
  };
}
