import {
  type AgentAccessChange,
  type AgentAccessSnapshot,
  type BrowserProfileSummary,
  type BrowserProxyComputer,
  type BrowserProxySummary,
  type HostStatus,
  type HostUpdateStatus,
  nextBrowserProfileHue,
  parseBrowserProxyAddress,
  type ServerAuditEntry,
} from "@openbot/contracts/ipc";
import type { OwnerTransfer } from "@openbot/contracts/owner-transfer";
import { sourceText } from "@openbot/i18n/source";
import { Toaster } from "@openbot/ui";
import { createSignal, createStore } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type { ServerBrowserProfilesOptions } from "../src/features/browser/ServerBrowserProfilesPanel";
import { OwnerTransferPrompt } from "../src/features/servers/OwnerTransferPrompt";
import type { ServerAuditOptions } from "../src/features/servers/ServerAuditSection";
import type { OwnerTransferCalls } from "../src/features/servers/ServerOwnerTransferSection";
import type { ServerAgentAccessOptions } from "../src/features/servers/ServerRolesSection";
import { ServerSettingsModal, type ServerSettingsModalProps } from "../src/features/servers/ServerSettingsModal";
import {
  STORY_AGENT_SUMMARIES,
  STORY_HOST_STATUS,
  STORY_HOSTED_SITES,
  STORY_PRESENCE,
  STORY_SERVER_AUDIT_ENTRIES,
} from "../src/preview/fixtures";
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
      remoteDesktopNeedsX11Session: false,
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

export const RemoteOwnerInBrowser: Story = {
  args: {
    server: remoteServer,
    hostStatus: null,
    initialSection: "members",
    onDownloadDesktopApp: fn(),
  },
  render: (args) => (
    <>
      <ServerSettingsStory settings={args} />
      <Toaster />
    </>
  ),
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

const STORY_BROWSER_PROXIES: BrowserProxySummary[] = [
  {
    id: "5c6d7e8f90a1b2c3d4e5f60718293a4b",
    scheme: "socks5",
    host: "home.example.net",
    port: 1080,
    username: "agent",
    hasPassword: true,
    profileIds: ["0a1b2c3d4e5f60718293a4b5c6d7e8f9"],
    failure: null,
  },
];

const STORY_BROWSER_COMPUTERS: BrowserProxyComputer[] = [
  {
    id: "7e8f90a1b2c3d4e5f60718293a4b5c6d",
    memberId: "member-ada",
    name: "Ada Lovelace",
    online: true,
    mine: false,
    profileIds: ["f9e8d7c6b5a4938271605f4e3d2c1b0a"],
    failure: null,
  },
];

interface StoryComputers {
  computers: readonly BrowserProxyComputer[];
  sharing: boolean;
}

function storyBrowserProfiles(
  initial: readonly BrowserProfileSummary[],
  initialProxies: readonly BrowserProxySummary[] = [],
  initialComputers?: StoryComputers,
): ServerBrowserProfilesOptions {
  const [state, setState] = createStore<{
    profiles: BrowserProfileSummary[] | undefined;
    sharedAgentIds: string[] | undefined;
    proxies: BrowserProxySummary[] | undefined;
    computers: BrowserProxyComputer[] | undefined;
    sharing: boolean | undefined;
  }>({
    profiles: initial.map((profile) => ({ ...profile, agentIds: [...profile.agentIds] })),
    proxies: initialProxies.map((proxy) => ({ ...proxy, profileIds: [...proxy.profileIds] })),
    computers: (initialComputers?.computers ?? []).map((computer) => ({
      ...computer,
      profileIds: [...computer.profileIds],
    })),
    sharing: initialComputers?.sharing,
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
          draft.sharedAgentIds?.push(...(draft.profiles?.[index]?.agentIds ?? []));
          draft.profiles?.splice(index, 1);
        }),
      saveProxy: async (input) => {
        const parsed = parseBrowserProxyAddress(input.address);
        if (parsed === null) throw new Error(sourceText("error.backend.browserProxyAddressInvalid"));
        const { scheme, host, port, username, password } = parsed;
        const id = input.proxyId ?? crypto.randomUUID().replaceAll("-", "");
        setState((draft) => {
          const proxies = draft.proxies ?? [];
          const existing = proxies.find((proxy) => proxy.id === id);
          const fields = {
            scheme,
            host,
            port,
            username,
            hasPassword: password !== null || (existing?.hasPassword === true && input.keepPassword === true),
          };
          if (existing) Object.assign(existing, fields);
          else proxies.push({ id, ...fields, profileIds: [], failure: null });
          draft.proxies = proxies;
          if (input.assignTo !== undefined) assignStoryProxy(draft, input.assignTo, id);
        });
      },
      removeProxy: async (proxyId) =>
        setState((draft) => {
          draft.proxies = draft.proxies?.filter((proxy) => proxy.id !== proxyId);
          draft.computers = draft.computers?.filter((computer) => computer.id !== proxyId);
        }),
      setProfileProxy: async (profileId, proxyId) => setState((draft) => assignStoryProxy(draft, profileId, proxyId)),
      setSharing: async (sharing, assignTo) =>
        setState((draft) => {
          draft.sharing = sharing;
          const computers = draft.computers ?? [];
          let mine = computers.find((computer) => computer.mine);
          if (sharing && !mine) {
            mine = {
              id: crypto.randomUUID().replaceAll("-", ""),
              memberId: "member-you",
              name: "You",
              online: true,
              mine: true,
              profileIds: [],
              failure: null,
            };
            computers.push(mine);
          }
          if (mine) mine.online = sharing;
          draft.computers = computers;
          if (mine && assignTo !== undefined) assignStoryProxy(draft, assignTo, mine.id);
        }),
    },
  };
}

function assignStoryProxy(
  draft: { proxies: BrowserProxySummary[] | undefined; computers: BrowserProxyComputer[] | undefined },
  profileId: string,
  proxyId: string | null,
): void {
  for (const proxy of [...(draft.proxies ?? []), ...(draft.computers ?? [])]) {
    proxy.profileIds = proxy.profileIds.filter((id) => id !== profileId);
    if (proxy.id === proxyId) proxy.profileIds.push(profileId);
  }
}

export const BrowserProfiles: Story = {
  args: { initialSection: "browser-profiles" },
  render: (args) => (
    <ServerSettingsStory settings={{ ...args, browserProfiles: storyBrowserProfiles(STORY_BROWSER_PROFILES) }} />
  ),
};

export const BrowserProfilesWithProxies: Story = {
  args: { initialSection: "browser-profiles" },
  render: (args) => (
    <ServerSettingsStory
      settings={{ ...args, browserProfiles: storyBrowserProfiles(STORY_BROWSER_PROFILES, STORY_BROWSER_PROXIES) }}
    />
  ),
};

export const BrowserProfilesProxyFailing: Story = {
  args: { initialSection: "browser-profiles" },
  render: (args) => (
    <ServerSettingsStory
      settings={{
        ...args,
        browserProfiles: storyBrowserProfiles(
          STORY_BROWSER_PROFILES,
          STORY_BROWSER_PROXIES.map((proxy): BrowserProxySummary => ({ ...proxy, failure: "unreachable" })),
        ),
      }}
    />
  ),
};

export const BrowserProfilesProxySignInRefused: Story = {
  args: { initialSection: "browser-profiles" },
  render: (args) => (
    <ServerSettingsStory
      settings={{
        ...args,
        browserProfiles: storyBrowserProfiles(
          STORY_BROWSER_PROFILES,
          STORY_BROWSER_PROXIES.map((proxy): BrowserProxySummary => ({ ...proxy, failure: "signIn" })),
        ),
      }}
    />
  ),
};

export const BrowserProfilesWithComputers: Story = {
  args: { initialSection: "browser-profiles" },
  render: (args) => (
    <ServerSettingsStory
      settings={{
        ...args,
        browserProfiles: storyBrowserProfiles(STORY_BROWSER_PROFILES, STORY_BROWSER_PROXIES, {
          computers: STORY_BROWSER_COMPUTERS,
          sharing: false,
        }),
      }}
    />
  ),
};

export const BrowserProfilesComputerOffline: Story = {
  args: { initialSection: "browser-profiles" },
  render: (args) => (
    <ServerSettingsStory
      settings={{
        ...args,
        browserProfiles: storyBrowserProfiles(STORY_BROWSER_PROFILES, [], {
          computers: STORY_BROWSER_COMPUTERS.map((computer) => ({ ...computer, online: false })),
          sharing: false,
        }),
      }}
    />
  ),
};

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

export const Roles: Story = {
  args: { initialSection: "roles", agentAccess: storyAgentAccess() },
};

function storyServerAudit(entries: ServerAuditEntry[]): ServerAuditOptions {
  return {
    calls: { getAuditLog: async () => ({ entries: structuredClone(entries) }) },
    listAgents: async () => STORY_AGENT_SUMMARIES.slice(0, 3),
  };
}

export const AuditLog: Story = {
  render: () => (
    <ServerSettingsStory
      settings={{
        ...serverSettingsArgs(),
        initialSection: "audit",
        agentAccess: storyAgentAccess(),
        serverAudit: storyServerAudit(STORY_SERVER_AUDIT_ENTRIES),
      }}
    />
  ),
};

export const AuditLogEmpty: Story = {
  render: () => (
    <ServerSettingsStory
      settings={{ ...serverSettingsArgs(), initialSection: "audit", serverAudit: storyServerAudit([]) }}
    />
  ),
};

export const MembersWithRoles: Story = {
  args: { initialSection: "members", agentAccess: storyAgentAccess() },
};

export const MembersEmpty: Story = {
  args: {
    initialSection: "members",
    members: STORY_PRESENCE.members.filter((member) => member.role === "owner"),
    invites: [],
  },
};

const STORY_OWNER_TRANSFER: OwnerTransfer = {
  transferId: "transfer-story",
  hostId: remoteServer.id,
  hostName: remoteServer.name,
  fromEmail: "person@example.com",
  fromName: "Norbert",
  toEmail: "ada@example.com",
  createdAt: Date.parse("2026-11-19T10:00:00.000Z"),
  expiresAt: Date.parse("2026-11-26T10:00:00.000Z"),
};

function storyOwnerTransfer(pending: OwnerTransfer | null): OwnerTransferCalls {
  let transfer = pending;
  return {
    getOwnerTransfer: async () => transfer,
    startOwnerTransfer: async (email) => {
      transfer = { ...STORY_OWNER_TRANSFER, toEmail: email };
      return transfer;
    },
    cancelOwnerTransfer: async () => {
      transfer = null;
    },
  };
}

export const OwnerTransferStart: Story = {
  args: {
    server: { ...remoteServer, role: "owner" },
    hostStatus: null,
    initialSection: "members",
    ownerTransfer: storyOwnerTransfer(null),
  },
};

export const OwnerTransferPending: Story = {
  args: {
    server: { ...remoteServer, role: "owner" },
    hostStatus: null,
    initialSection: "members",
    ownerTransfer: storyOwnerTransfer(STORY_OWNER_TRANSFER),
  },
};

export const OwnerTransferPendingForAdministrator: Story = {
  args: {
    server: { ...remoteServer, role: "admin" },
    hostStatus: null,
    initialSection: "members",
    ownerTransfer: storyOwnerTransfer(STORY_OWNER_TRANSFER),
  },
};

export const OwnerTransferIncoming: Story = {
  render: () => (
    <>
      <OwnerTransferPrompt
        calls={{
          list: async () => [STORY_OWNER_TRANSFER],
          accept: async () => ({ hostId: STORY_OWNER_TRANSFER.hostId, hostName: STORY_OWNER_TRANSFER.hostName }),
          decline: async () => undefined,
        }}
        reloadKey={0}
        onAccepted={fn()}
      />
      <Toaster />
    </>
  ),
};
