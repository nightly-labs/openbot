import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/**
 * What the skill screens reach in main: the marketplace, the agent skills dialog and the local
 * skills library, which live in `settings` and `conversation`. The MCP calls are here because a
 * plugin install saves its app beside its skills.
 */
export interface SkillsPort {
  agent: Pick<
    OpenBotDesktopApi["agent"],
    "listInstalledSkills" | "listMcpServers" | "removeMcpServer" | "saveMcpServer" | "testMcpServer"
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
