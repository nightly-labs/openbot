import type {
  AgentBrowserProfile,
  BrowserProfileList,
  BrowserProfileSummary,
  BrowserTabProfile,
  ClearBrowserDataInput,
  UpdateAgentBrowserProfileInput,
  UpdateBrowserProfileInput,
} from "@openbot/contracts/ipc";

/**
 * The browser profiles of one server, and the profile of each of its agents. Desktop reaches them
 * through main for this computer and for a joined server; the web client asks the host directly.
 */
export interface BrowserProfileCalls {
  list(): Promise<BrowserProfileList>;
  create(name: string): Promise<BrowserProfileSummary>;
  update(input: UpdateBrowserProfileInput): Promise<BrowserProfileSummary>;
  clear(input: ClearBrowserDataInput): Promise<void>;
  remove(profileId: string): Promise<void>;
  readAgent(agentId: string): Promise<AgentBrowserProfile>;
  updateAgent(input: UpdateAgentBrowserProfileInput): Promise<AgentBrowserProfile>;
  /** The profile of each open tab that is not in the shared session. */
  tabProfiles(): Promise<BrowserTabProfile[]>;
}

/** The desktop calls for one server. Reads `window.openbot` on each call: stories replace it per case. */
export function desktopBrowserProfileCalls(serverId?: string): BrowserProfileCalls {
  const agent = () => window.openbot.agent;
  return {
    list: () => agent().listBrowserProfiles(serverId),
    create: (name) => agent().createBrowserProfile(name, serverId),
    update: (input) => agent().updateBrowserProfile(input, serverId),
    clear: (input) => agent().clearBrowserData(input, serverId),
    remove: (profileId) => agent().deleteBrowserProfile(profileId, serverId),
    readAgent: (agentId) => agent().getAgentBrowserProfile(agentId, serverId),
    updateAgent: (input) => agent().updateAgentBrowserProfile(input, serverId),
    tabProfiles: () => agent().listBrowserTabProfiles(serverId),
  };
}
