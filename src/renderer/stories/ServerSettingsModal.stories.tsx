import type { HostReleaseStatus, HostStatus, HostUpdateStatus } from "@openbot/contracts/ipc";
import { createSignal, onSettled, snapshot } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { ServerSettingsModal, type ServerSettingsModalProps } from "../src/features/servers/ServerSettingsModal";
import {
  STORY_HOST_STATUS,
  STORY_HOSTED_SITES,
  STORY_INVITES,
  STORY_PRESENCE,
  STORY_SERVERS,
} from "../src/preview/fixtures";
import { createMockOpenBot } from "./mock-openbot";

const localServer = STORY_SERVERS.find((server) => server.kind === "local") ?? STORY_SERVERS[0];
const remoteServer = STORY_SERVERS.find((server) => server.kind === "remote") ?? STORY_SERVERS[1];
if (!remoteServer) throw new Error("Story server fixtures need a remote server.");

const meta = {
  title: "Settings/ServerSettingsModal",
  component: ServerSettingsModal,
  render: (args) => <RemoteSetupStory settings={args} />,
  args: {
    open: true,
    onOpenChange: fn(),
    platform: "darwin",
    server: localServer,
    hostStatus: STORY_HOST_STATUS,
    members: STORY_PRESENCE.members,
    invites: STORY_INVITES,
    loading: false,
    loadError: null,
    onRetry: fn(async () => undefined),
    onSaveIdentity: fn(async () => undefined),
    onSetPublished: fn(async () => undefined),
    onSetMuted: fn(async () => undefined),
    onCreateInvite: fn(async (input) => ({
      id: "invite-story",
      inviteUrl: "https://team.example.com/invite/story",
      expiresAt: "2026-08-29T10:00:00.000Z",
      role: input.role,
      usedAt: null,
      email: input.email ?? null,
      permanent: input.permanent ?? false,
      useCount: 0,
    })),
    onUpdateMember: fn(async () => undefined),
    onRemoveMember: fn(async () => undefined),
    onRevokeInvite: fn(async () => undefined),
    onOpenScreenRecordingSettings: fn(async () => undefined),
    onRecheckScreenRecording: fn(async () => undefined),
  },
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

export const RemoteDesktopAfterPublication: Story = {
  render: (args) => <PublicationSetupStory settings={args} />,
};

function PublicationSetupStory(props: { settings: ServerSettingsModalProps }) {
  const [published, setPublished] = createSignal(false);
  return (
    <RemoteSetupStory
      settings={{
        ...props.settings,
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
  render: (args) => <RemoteSetupStory settings={args} hostUpdate={STORY_HOST_UPDATE} />,
};

export const RemoteUpdateWaiting: Story = {
  args: remoteUpdateArgs,
  render: (args) => (
    <RemoteSetupStory
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
    <RemoteSetupStory
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
    <RemoteSetupStory
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
    <RemoteSetupStory settings={args} hostUpdate={{ ...STORY_HOST_UPDATE, remoteUpdates: "disabled" }} />
  ),
};

function RemoteSetupStory(props: {
  settings: ServerSettingsModalProps;
  hostUpdate?: HostUpdateStatus;
  hostRelease?: HostReleaseStatus;
}) {
  const previous = window.openbot;
  // Storybook passes the args as a store, and the mock copies its options with `structuredClone`.
  const hostStatus = props.settings.hostStatus;
  const mock = createMockOpenBot({
    ...(hostStatus ? { hostStatus: snapshot(hostStatus) } : {}),
    ...(props.hostUpdate ? { hostUpdate: props.hostUpdate } : {}),
    ...(props.hostRelease ? { hostRelease: props.hostRelease } : {}),
  });
  window.openbot = mock.api;
  onSettled(() => () => {
    mock.dispose();
    window.openbot = previous;
  });
  return <ServerSettingsModal {...props.settings} />;
}

export const SmallViewport: Story = {
  parameters: {
    viewport: { defaultViewport: "serverMobile" },
  },
};

export const HostedReleaseAvailable: Story = {
  args: remoteUpdateArgs,
  render: (args) => (
    <RemoteSetupStory
      settings={args}
      hostUpdate={{ ...STORY_HOST_UPDATE, currentVersion: "0.25.2", phase: "unsupported", availableVersion: null }}
      hostRelease={{ currentVersion: "0.25.2", latestVersion: "0.26.0", phase: "available", method: "hosted" }}
    />
  ),
};

export const ContainerReleaseAvailable: Story = {
  args: remoteUpdateArgs,
  render: (args) => (
    <RemoteSetupStory
      settings={args}
      hostUpdate={{ ...STORY_HOST_UPDATE, currentVersion: "0.25.2", phase: "unsupported", availableVersion: null }}
      hostRelease={{ currentVersion: "0.25.2", latestVersion: "0.26.0", phase: "available", method: "container" }}
    />
  ),
};
