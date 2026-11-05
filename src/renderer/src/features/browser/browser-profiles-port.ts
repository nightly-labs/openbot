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

/** The saved proxies of one server, and the proxy of each named profile (`browser-proxies-v1`). */
interface BrowserProxyCalls {
  /** Null: the server has no proxy routes. */
  list(): Promise<BrowserProxyList | null>;
  save(input: SaveBrowserProxyInput): Promise<BrowserProxySummary>;
  remove(input: DeleteBrowserProxyInput): Promise<void>;
  setProfileProxy(input: SetBrowserProfileProxyInput): Promise<void>;
  /**
   * Whether this desktop app shares its connection with the server. Absent on the web client and for
   * this computer's own server.
   */
  computerSharing?: BrowserComputerSharingCalls;
}

interface BrowserComputerSharingCalls {
  /** Null: the server cannot use the connection of this computer. */
  read(): Promise<BrowserComputerSharing | null>;
  /** On also adds the computer of this member to the proxies of the server. */
  set(sharing: boolean): Promise<void>;
}

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
  /** Absent when this client cannot change the proxies of the server. */
  proxies?: BrowserProxyCalls;
  /**
   * Calls `listener` each time the host reports a change of its profiles or of an agent's profile,
   * also one made on another device. Absent when the host does not report changes.
   */
  onChanged?(listener: () => void): () => void;
}

/** The desktop calls for one server. Reads `window.openbot` on each call: stories replace it per case. */
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
