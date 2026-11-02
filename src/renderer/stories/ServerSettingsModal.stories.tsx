import {
  type AgentAccessChange,
  type AgentAccessSnapshot,
  type BrowserProfileSummary,
  type HostStatus,
  type HostUpdateStatus,
  type McpServerConfig,
  type McpSignInState,
  type McpTestResult,
  nextBrowserProfileHue,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createSignal, createStore } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type { ServerBrowserProfilesOptions } from "../src/features/browser/ServerBrowserProfilesPanel";
import type { McpPanelSignIn } from "../src/features/servers/ServerMcpPanel";
import type { ServerAgentAccessOptions } from "../src/features/servers/ServerRolesSection";
import { ServerSettingsModal, type ServerSettingsModalProps } from "../src/features/servers/ServerSettingsModal";
import {
  STORY_AGENT_SUMMARIES,
  STORY_HOST_STATUS,
  STORY_HOSTED_SITES,
  STORY_MCP_SERVERS,
  STORY_PRESENCE,
} from "../src/preview/fixtures";
import { createSignInHost } from "./mcp-sign-in-host";
import {
  ServerSettingsStory,
  STORY_LOCAL_SERVER,
  STORY_REMOTE_SERVER,
  serverSettingsArgs,
} from "./server-settings-story";

const localServer = STORY_LOCAL_SERVER;
const remoteServer = STORY_REMOTE_SERVER;

const meta = {
  title: "Settings/ServerSettingsModal",
  component: ServerSettingsModal,
  render: (args) => <ServerSettingsStory settings={args} />,
  args: serverSettingsArgs(),
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    viewport: {
      options: {
        serverDesktop: {
          name: "Server settings — 1200 × 820",
          styles: { width: "1200px", height: "820px" },
        },
        serverMinimum: {
          name: "Server settings — 960 × 640",
          styles: { width: "960px", height: "640px" },
        },
        serverMobile: {
          name: "Server settings — 640 × 720",
          styles: { width: "640px", height: "720px" },
        },
        serverNarrow: {
          name: "Server settings — 480 × 720",
          styles: { width: "480px", height: "720px" },
        },
      },
    },
  },
} satisfies Meta<typeof ServerSettingsModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LocalFirstSetup: Story = {
  args: {
    server: { ...localServer, name: "Local", state: "online", apiUrl: null },
    hostStatus: {
      ...STORY_HOST_STATUS,
      phase: "unconfigured",
      configured: false,
      enabledOnLaunch: false,
      serverId: null,
      serverName: null,
      logoUrl: null,
      apiUrl: null,
      apiOnline: false,
      remoteDesktopReady: false,
      remoteDesktopScreenRecordingDenied: false,
      remoteDesktopUnattended: false,
      remoteDesktopActiveSessions: 0,
      remoteDesktopMaxSessions: 4,
    },
    members: [],
    invites: [],
  },
};

export const FirstSetupInvalidNameSmallViewport: Story = {
  args: LocalFirstSetup.args,
  parameters: {
    viewport: { defaultViewport: "serverMobile" },
  },
};

/** Members of a server with no name yet: publishing generates one, so the switch is ready. */
export const LocalFirstPublication: Story = {
  args: { ...LocalFirstSetup.args, initialSection: "members" },
};

export const RemoteDesktopAfterPublication: Story = {
  render: (args) => <PublicationSetupStory settings={args} />,
};

function PublicationSetupStory(props: { settings: ServerSettingsModalProps }) {
  const [published, setPublished] = createSignal(false);
  return (
    <ServerSettingsStory
      settings={{
        ...props.settings,
        initialSection: "members",
        get hostStatus(): HostStatus {
          return { ...STORY_HOST_STATUS, configured: true, phase: published() ? "online" : "idle" };
        },
        onSetPublished: async (value) => {
          setPublished(value);
        },
      }}
    />
  );
}

export const LocalOnline: Story = {
  args: {
    hostStatus: {
      ...STORY_HOST_STATUS,
      apiUrl: "https://eu-west-1.gateway.example.com/openbot/servers/team_7f3c19a2",
    },
  },
};

export const ActionError: Story = {
  args: {
    loadError: "The server did not respond. Check the connection and try again.",
  },
};

export const RemoteAdministrator: Story = {
  args: {
    server: { ...remoteServer, role: "admin" },
    hostStatus: null,
  },
};

export const RemoteMember: Story = {
  args: {
    server: { ...remoteServer, role: "member" },
    hostStatus: null,
    invites: [],
  },
};

/**
 * A joined server's MCP list. Granola asks for a sign-in on Test connection; Linear is signed in
 * already. Sign in shows the server's page from the host's browser: Allow finishes the sign-in, and
 * Cancel sign-in stops it.
 */
const REMOTE_MCP_SERVERS: McpServerConfig[] = [
  {
    id: "mcp-granola",
    name: "Granola",
    transport: "http",
    enabled: true,
    command: "",
    args: [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: "https://mcp.granola.ai/mcp",
    headers: [],
  },
  ...STORY_MCP_SERVERS.filter((config) => config.id === "mcp-linear" || config.id === "mcp-sqlite").map((config) => ({
    ...config,
    headers: [],
  })),
];

export const RemoteMcpSignIn: Story = {
  args: {
    server: { ...remoteServer, role: "admin" },
    hostStatus: null,
    initialSection: "mcp",
    mcpServers: REMOTE_MCP_SERVERS,
  },
  render: (args) => <McpSignInStory settings={args} />,
};

export const RemoteMcpMember: Story = {
  args: {
    server: { ...remoteServer, role: "member" },
    hostStatus: null,
    invites: [],
    initialSection: "mcp",
    mcpServers: REMOTE_MCP_SERVERS,
  },
  render: (args) => <McpSignInStory settings={args} />,
};

/**
 * This computer's MCP list after Granola refused its saved sign-in. The row asks for a new sign-in
 * with no test, and Sign in finishes at once. A joined host never reports a lost sign-in.
 */
export const LocalMcpSignInNeeded: Story = {
  args: {
    initialSection: "mcp",
    mcpServers: REMOTE_MCP_SERVERS,
  },
  render: (args) => (
    <McpSignInStory
      settings={args}
      initial={{ "mcp-granola": { mcpServerId: "mcp-granola", signedIn: false, needsSignIn: true } }}
    />
  ),
};

/**
 * This computer's MCP list, to connect Granola. In Connect a custom MCP, paste
 * `https://mcp.granola.ai/mcp` into Command to launch: the form moves to Streamable HTTP. Save
 * tests the server, which asks for a sign-in, signs in, and then saves the row.
 */
export const LocalMcpConnect: Story = {
  args: {
    initialSection: "mcp",
    mcpServers: REMOTE_MCP_SERVERS.filter((config) => config.id !== "mcp-granola"),
  },
  render: (args) => <McpSignInStory settings={args} />,
};

function McpSignInStory(props: { settings: ServerSettingsModalProps; initial?: Record<string, McpSignInState> }) {
  const [states, setStates] = createStore<Record<string, McpSignInState>>({
    "mcp-linear": { mcpServerId: "mcp-linear", signedIn: true },
    ...props.initial,
  });
  const [servers, setServers] = createSignal(props.settings.mcpServers ?? []);
  const save = async (config: McpServerConfig) => {
    const id = config.id || `mcp-${config.name.toLowerCase().replaceAll(" ", "-")}`;
    // A draft signs in before it has an id: the new row keeps that sign-in.
    if (!config.id && states[""]?.signedIn)
      setStates((current) => {
        current[id] = { mcpServerId: id, signedIn: true };
        delete current[""];
      });
    setServers((list) =>
      list.some((server) => server.id === id)
        ? list.map((server) => (server.id === id ? { ...config, id } : server))
        : [...list, { ...config, id }],
    );
  };
  const local = props.settings.server.kind === "local";
  const host = createSignInHost();
  const waiting = new Map<string, (result: McpTestResult) => void>();
  const finish = (url: string, result: McpTestResult) => {
    host.close(url);
    waiting.get(url)?.(result);
    waiting.delete(url);
  };
  const signIn: McpPanelSignIn = {
    states,
    ...(local
      ? {}
      : {
          remote: { hostName: props.settings.server.name, runtime: host.runtime, clipboard: true, pages: host.pages },
        }),
    start: (config) =>
      new Promise((resolve) => {
        waiting.set(config.url, (result) => {
          if (!result.error)
            setStates((current) => {
              current[config.id] = { mcpServerId: config.id, signedIn: true };
            });
          resolve(result);
        });
        if (local) finish(config.url, { toolCount: 6, error: null });
        else host.open(config.url, config.name, () => finish(config.url, { toolCount: 6, error: null }));
      }),
    cancel: async (url) => finish(url, { toolCount: 0, error: sourceText("error.backend.mcpSignInCancelled") }),
    signOut: async (id) =>
      setStates((current) => {
        delete current[id];
      }),
  };
  const test = async (config: McpServerConfig): Promise<McpTestResult> => {
    if (config.transport === "http" && !states[config.id]?.signedIn)
      return { toolCount: 0, error: sourceText("error.backend.mcpSignInRequired") };
    return { toolCount: 6, error: null };
  };
  return (
    <ServerSettingsStory
      settings={{
        ...props.settings,
        get mcpServers() {
          return servers();
        },
        mcpSignIn: signIn,
        onTestMcpServer: test,
        onSaveMcpServer: save,
      }}
    />
  );
}

/** A Starter server with one site of its own and one unlinked site from before it was registered. */
export const Sites: Story = {
  args: {
    initialSection: "sites",
    hostedSites: {
      api: {
        list: async () => ({ sites: STORY_HOSTED_SITES.map((site) => ({ ...site })), limit: 3, used: 2 }),
        delete: fn(async () => undefined),
      },
      onOpenSite: fn(),
    },
  },
};

const STORY_BROWSER_PROFILES: BrowserProfileSummary[] = [
  { id: "0a1b2c3d4e5f60718293a4b5c6d7e8f9", name: "Client A", hue: 215, agentIds: ["chief", "research"], tabCount: 3 },
  { id: "f9e8d7c6b5a4938271605f4e3d2c1b0a", name: "Client B", hue: 30, agentIds: ["sales"], tabCount: 1 },
  { id: "1b2c3d4e5f60718293a4b5c6d7e8f90a", name: "Personal", hue: 150, agentIds: [], tabCount: 0 },
];

/** Profiles in memory, so add, rename, color, clear and delete change the list as the host does. */
function storyBrowserProfiles(initial: readonly BrowserProfileSummary[]): ServerBrowserProfilesOptions {
  // Five agents in all: the ones that no named profile has use the shared profile.
  const [state, setState] = createStore<{
    profiles: BrowserProfileSummary[] | undefined;
    sharedAgentIds: string[] | undefined;
  }>({
    profiles: initial.map((profile) => ({ ...profile, agentIds: [...profile.agentIds] })),
    sharedAgentIds: ["chief", "research", "sales", "writer", "support"].filter(
      (agentId) => !initial.some((profile) => profile.agentIds.includes(agentId)),
    ),
  });
  const change = (recipe: (profiles: BrowserProfileSummary[]) => void) => async () =>
    setState((draft) => {
      if (draft.profiles) recipe(draft.profiles);
    });
  return {
    listAgents: async () => [
      { id: "chief", name: "Chief" },
      { id: "research", name: "Research" },
      { id: "sales", name: "Sales Outbound" },
    ],
    store: {
      state,
      refresh: async () => undefined,
      // The story is one window, so no other device changes the profiles.
      follow: () => () => undefined,
      create: async (name) => {
        if (state.profiles?.some((profile) => profile.name.toLowerCase() === name.toLowerCase()))
          throw new Error(sourceText("error.backend.browserProfileNameTaken"));
        const id = crypto.randomUUID().replaceAll("-", "");
        await change((profiles) => {
          profiles.push({
            id,
            name,
            hue: nextBrowserProfileHue(profiles.map((profile) => profile.hue)),
            agentIds: [],
            tabCount: 0,
          });
        })();
        return id;
      },
      rename: (profileId, name) =>
        change((profiles) => {
          const profile = profiles.find((item) => item.id === profileId);
          if (profile) profile.name = name;
        })(),
      recolor: (profileId, hue) =>
        change((profiles) => {
          const profile = profiles.find((item) => item.id === profileId);
          if (profile) profile.hue = hue;
        })(),
      clear: (profileId) =>
        change((profiles) => {
          const profile = profiles.find((item) => item.id === profileId);
          if (profile) profile.tabCount = 0;
        })(),
      remove: async (profileId) =>
        setState((draft) => {
          const index = draft.profiles?.findIndex((item) => item.id === profileId) ?? -1;
          if (index < 0) return;
          // A delete moves the agents of the profile to the shared profile.
          draft.sharedAgentIds?.push(...(draft.profiles?.[index]?.agentIds ?? []));
          draft.profiles?.splice(index, 1);
        }),
    },
  };
}

/** The named browser profiles of this computer: a color, a name, and one menu for each profile. */
export const BrowserProfiles: Story = {
  args: { initialSection: "browser-profiles" },
  render: (args) => (
    <ServerSettingsStory settings={{ ...args, browserProfiles: storyBrowserProfiles(STORY_BROWSER_PROFILES) }} />
  ),
};

/** No named profile yet: the agents use the shared profile or their own. */
export const BrowserProfilesEmpty: Story = {
  args: { initialSection: "browser-profiles" },
  render: (args) => <ServerSettingsStory settings={{ ...args, browserProfiles: storyBrowserProfiles([]) }} />,
};

export const SitesForMember: Story = {
  args: {
    ...Sites.args,
    server: { ...remoteServer, role: "member" },
    hostStatus: null,
  },
};

const STORY_HOST_UPDATE: HostUpdateStatus = {
  phase: "available",
  currentVersion: "0.23.0",
  availableVersion: "0.24.0",
  progress: null,
  errorCode: null,
  remoteUpdates: "allowed",
  autoDownload: true,
  autoInstall: false,
  restart: null,
};

const remoteUpdateArgs = {
  server: { ...remoteServer, role: "admin" as const },
  hostStatus: null,
  hostUpdate: {},
  initialSection: "updates" as const,
};

export const RemoteUpdateAvailable: Story = {
  args: remoteUpdateArgs,
  render: (args) => <ServerSettingsStory settings={args} hostUpdate={STORY_HOST_UPDATE} />,
};

export const RemoteUpdateWaiting: Story = {
  args: remoteUpdateArgs,
  render: (args) => (
    <ServerSettingsStory
      settings={args}
      hostUpdate={{
        ...STORY_HOST_UPDATE,
        phase: "ready",
        progress: 100,
        restart: { requestedBy: "Ada Lovelace", mode: "when-idle", waitingFor: ["agent-turn", "routine-run"] },
      }}
    />
  ),
};

export const RemoteUpdateDownloading: Story = {
  args: remoteUpdateArgs,
  render: (args) => (
    <ServerSettingsStory
      settings={args}
      hostUpdate={{
        ...STORY_HOST_UPDATE,
        phase: "downloading",
        progress: 42,
        restart: { requestedBy: "Ada Lovelace", mode: "when-idle", waitingFor: [] },
      }}
    />
  ),
};

export const RemoteUpdateAutomatic: Story = {
  args: remoteUpdateArgs,
  render: (args) => (
    <ServerSettingsStory
      settings={args}
      hostUpdate={{
        ...STORY_HOST_UPDATE,
        phase: "ready",
        progress: 100,
        autoInstall: true,
        restart: { requestedBy: null, mode: "when-idle", waitingFor: ["agent-turn"] },
      }}
    />
  ),
};

export const RemoteUpdateDisabled: Story = {
  args: remoteUpdateArgs,
  render: (args) => (
    <ServerSettingsStory settings={args} hostUpdate={{ ...STORY_HOST_UPDATE, remoteUpdates: "disabled" }} />
  ),
};

export const SmallViewport: Story = {
  parameters: {
    viewport: { defaultViewport: "serverMobile" },
  },
};

export const HostedReleaseAvailable: Story = {
  args: remoteUpdateArgs,
  render: (args) => (
    <ServerSettingsStory
      settings={args}
      hostUpdate={{ ...STORY_HOST_UPDATE, currentVersion: "0.25.2", phase: "unsupported", availableVersion: null }}
      hostRelease={{ currentVersion: "0.25.2", latestVersion: "0.26.0", phase: "available", method: "hosted" }}
    />
  ),
};

export const ContainerReleaseAvailable: Story = {
  args: remoteUpdateArgs,
  render: (args) => (
    <ServerSettingsStory
      settings={args}
      hostUpdate={{ ...STORY_HOST_UPDATE, currentVersion: "0.25.2", phase: "unsupported", availableVersion: null }}
      hostRelease={{ currentVersion: "0.25.2", latestVersion: "0.26.0", phase: "available", method: "container" }}
    />
  ),
};

/**
 * The roles of one story server: Research is closed to Everyone, Legal chats with it, and Finance
 * reads Sales. A save keeps its change until Storybook loads the story file again.
 */
function storyAgentAccess(): ServerAgentAccessOptions {
  let stored: AgentAccessChange = {
    revision: 3,
    everyone: { research: "none", sales: "view" },
    roles: [
      { id: "role-legal", name: "Legal", agents: { research: "chat" }, memberIds: ["member-jon"] },
      { id: "role-finance", name: "Finance", agents: { sales: "manage" }, memberIds: ["member-jon", "member-maya"] },
    ],
  };
  const read = (): AgentAccessSnapshot => ({
    ...structuredClone(stored),
    mine: Object.fromEntries(STORY_AGENT_SUMMARIES.map((agent) => [agent.id, "manage" as const])),
  });
  return {
    calls: {
      getAgentAccess: async () => read(),
      setAgentAccess: async (change) => {
        stored = { ...structuredClone(change), revision: change.revision + 1 };
        return read();
      },
    },
    listAgents: async () => STORY_AGENT_SUMMARIES.slice(0, 3),
  };
}

/** Everyone, then the custom roles. A role page sets the level of each agent. */
export const Roles: Story = {
  args: { initialSection: "roles", agentAccess: storyAgentAccess() },
};

/** The role menu of each member row holds the server role and the custom roles. */
export const MembersWithRoles: Story = {
  args: { initialSection: "members", agentAccess: storyAgentAccess() },
};

/** Only the owner and no invitation: sample invitations land behind the invite action, one at a time. */
export const MembersEmpty: Story = {
  args: {
    initialSection: "members",
    members: STORY_PRESENCE.members.filter((member) => member.role === "owner"),
    invites: [],
  },
};
