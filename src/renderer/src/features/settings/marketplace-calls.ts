import type { AddedAgent, InstallMarketplaceAgentInput } from "@openbot/contracts/ipc";
import { appPort } from "../../app-port";
import { type AgentSkillCalls, agentSkillCalls, type SkillsPort, skillsPort } from "../../skills-port";

/**
 * What the marketplace calls. The desktop app reads the catalog and changes agents through main. The
 * browser client reads the catalog on its own origin and changes its host over the Team API.
 */
export interface MarketplaceCalls {
  skills: Pick<SkillsPort["skills"], "get" | "list">;
  agents: Pick<SkillsPort["marketplaceAgents"], "get" | "list">;
  /** The account's own submissions. Absent where nothing can be published from, as in the browser. */
  publishing?:
    | {
        skills: Pick<SkillsPort["skills"], "choosePackage" | "listMine" | "submit">;
        agents: Pick<SkillsPort["marketplaceAgents"], "listMine" | "preview" | "submit">;
      }
    | undefined;
  agentSkills: (hostServerId?: string) => AgentSkillCalls;
  mcp: Pick<SkillsPort["agent"], "listMcpServers" | "removeMcpServer" | "saveMcpServer" | "testMcpServer">;
  /** `serverId` absent: this computer, which is also the only place an installed agent is updated. */
  addAgent: (input: InstallMarketplaceAgentInput, serverId: string | undefined) => Promise<AddedAgent>;
  openUrl: (url: string) => Promise<void>;
}

/** Read on each call, as `skillsPort` is: tests and stories replace `window.openbot` per case. */
export function desktopMarketplaceCalls(): MarketplaceCalls {
  const port = skillsPort();
  return {
    skills: port.skills,
    agents: port.marketplaceAgents,
    publishing: { skills: port.skills, agents: port.marketplaceAgents },
    agentSkills: agentSkillCalls,
    mcp: port.agent,
    addAgent: async (input, serverId) =>
      serverId ? port.agent.addMarketplaceAgent(input, serverId) : (await port.marketplaceAgents.install(input)).agent,
    openUrl: (url) => appPort().openUrl(url),
  };
}
