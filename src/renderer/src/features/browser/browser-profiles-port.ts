import {
  type AgentBrowserProfile,
  type BrowserComputerSharing,
  type BrowserProfileList,
  type BrowserProfileSummary,
  type BrowserProxyList,
  type BrowserProxySummary,
  type BrowserTabProfile,
  type ClearBrowserDataInput,
  type DeleteBrowserProxyInput,
  LOCAL_SERVER_ID,
  type SaveBrowserProxyInput,
  type SetBrowserProfileProxyInput,
  type UpdateAgentBrowserProfileInput,
  type UpdateBrowserProfileInput,
} from "@openbot/contracts/ipc";

interface BrowserProxyCalls {
  list(): Promise<BrowserProxyList | null>;
  save(input: SaveBrowserProxyInput): Promise<BrowserProxySummary>;
  remove(input: DeleteBrowserProxyInput): Promise<void>;
  setProfileProxy(input: SetBrowserProfileProxyInput): Promise<void>;
  computerSharing?: BrowserComputerSharingCalls;
}

interface BrowserComputerSharingCalls {
  read(): Promise<BrowserComputerSharing | null>;
  set(sharing: boolean): Promise<void>;
}

export interface BrowserProfileCalls {
  list(): Promise<BrowserProfileList>;
  create(name: string): Promise<BrowserProfileSummary>;
  update(input: UpdateBrowserProfileInput): Promise<BrowserProfileSummary>;
  clear(input: ClearBrowserDataInput): Promise<void>;
  remove(profileId: string): Promise<void>;
  readAgent(agentId: string): Promise<AgentBrowserProfile>;
  updateAgent(input: UpdateAgentBrowserProfileInput): Promise<AgentBrowserProfile>;
  tabProfiles(): Promise<BrowserTabProfile[]>;
  proxies?: BrowserProxyCalls;
  onChanged?(listener: () => void): () => void;
}

export function desktopBrowserProfileCalls(serverId?: string): BrowserProfileCalls {
  const agent = () => window.openbot.agent;
  const eventServerId = serverId ?? LOCAL_SERVER_ID;
  return {
    list: () => agent().listBrowserProfiles(serverId),
    create: (name) => agent().createBrowserProfile(name, serverId),
    update: (input) => agent().updateBrowserProfile(input, serverId),
    clear: (input) => agent().clearBrowserData(input, serverId),
    remove: (profileId) => agent().deleteBrowserProfile(profileId, serverId),
    readAgent: (agentId) => agent().getAgentBrowserProfile(agentId, serverId),
    updateAgent: (input) => agent().updateAgentBrowserProfile(input, serverId),
    tabProfiles: () => agent().listBrowserTabProfiles(serverId),
    proxies: {
      list: () => agent().listBrowserProxies(serverId),
      save: (input) => agent().saveBrowserProxy(input, serverId),
      remove: (input) => agent().deleteBrowserProxy(input, serverId),
      setProfileProxy: (input) => agent().setBrowserProfileProxy(input, serverId),
      ...(serverId === undefined || serverId === LOCAL_SERVER_ID
        ? {}
        : {
            computerSharing: {
              read: () => agent().getBrowserComputerSharing(serverId),
              set: (sharing) => agent().setBrowserComputerSharing({ sharing }, serverId),
            },
          }),
    },
    onChanged: (listener) =>
      agent().onScopedEvent((scoped) => {
        if (scoped.serverId === eventServerId && scoped.event.type === "browser-profiles-changed") listener();
      }),
  };
}
