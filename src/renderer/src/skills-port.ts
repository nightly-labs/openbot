import type {
  InstalledSkill,
  InstallSkillInput,
  OpenBotDesktopApi,
  SetEnabledSkillInput,
  UninstallSkillInput,
} from "@openbot/contracts/ipc";

/**
 * What the skill screens reach in main: the marketplace, the agent skills dialog and the local
 * skills library, which live in `settings` and `conversation`. The MCP calls are here because a
 * plugin install saves its app beside its skills.
 */
export interface SkillsPort {
  agent: Pick<
    OpenBotDesktopApi["agent"],
    | "addMarketplaceAgent"
    | "installAgentSkill"
    | "listAgentSkills"
    | "listInstalledSkills"
    | "listMcpServers"
    | "removeMcpServer"
    | "saveMcpServer"
    | "setAgentSkillEnabled"
    | "testMcpServer"
    | "uninstallAgentSkill"
  >;
  marketplaceAgents: Pick<
    OpenBotDesktopApi["marketplaceAgents"],
    "get" | "install" | "list" | "listMine" | "preview" | "submit"
  >;
  skills: Pick<
    OpenBotDesktopApi["skills"],
    | "choosePackage"
    | "get"
    | "install"
    | "list"
    | "listInstalled"
    | "listMine"
    | "localGet"
    | "localInstall"
    | "localList"
    | "setEnabled"
    | "submit"
    | "uninstall"
  >;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function skillsPort(): SkillsPort {
  return window.openbot;
}

/** The marketplace reads the agent skills dialog uses for descriptions and details. */
export type SkillCatalogCalls = Pick<SkillsPort["skills"], "get" | "list">;

/** The skills of one agent: read, install, remove and turn on or off. */
export interface AgentSkillCalls {
  listInstalled(agentId: string): Promise<InstalledSkill[]>;
  install(input: InstallSkillInput): Promise<InstalledSkill>;
  uninstall(input: UninstallSkillInput): Promise<void>;
  setEnabled(input: SetEnabledSkillInput): Promise<InstalledSkill>;
}

/**
 * Without a server, the skills of this computer's agents. With one, the host of that joined server,
 * which answers only an owner or admin, installs a marketplace skill with its own account.
 */
export function agentSkillCalls(hostServerId?: string): AgentSkillCalls {
  const port = skillsPort();
  if (!hostServerId) return port.skills;
  return {
    listInstalled: (agentId) => port.agent.listAgentSkills(agentId, hostServerId),
    install: (input) => port.agent.installAgentSkill(input, hostServerId),
    uninstall: (input) => port.agent.uninstallAgentSkill(input, hostServerId),
    setEnabled: (input) => port.agent.setAgentSkillEnabled(input, hostServerId),
  };
}
