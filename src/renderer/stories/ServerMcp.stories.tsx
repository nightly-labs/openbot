import { createSignal } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type { McpServerConfig } from "../src/features/servers/mcp-servers";
import { ServerSettingsModal, type ServerSettingsModalProps } from "../src/features/servers/ServerSettingsModal";
import {
  STORY_HOST_STATUS,
  STORY_INVITES,
  STORY_MCP_SERVERS,
  STORY_PRESENCE,
  STORY_SERVERS,
} from "../src/preview/fixtures";

/**
 * Story args never change, so the panel would answer a switch with the same row. This owner keeps
 * the list in a signal and still calls the spy args.
 */
function McpSettingsHost(props: ServerSettingsModalProps) {
  const [servers, setServers] = createSignal<McpServerConfig[]>(props.mcpServers ?? []);

  return (
    <ServerSettingsModal
      {...props}
      mcpServers={servers()}
      onSaveMcpServer={async (config) => {
        await props.onSaveMcpServer?.(config);
        setServers((current) =>
          current.some((server) => server.id === config.id)
            ? current.map((server) => (server.id === config.id ? config : server))
            : [...current, config],
        );
      }}
      onRemoveMcpServer={async (id) => {
        await props.onRemoveMcpServer?.(id);
        setServers((current) => current.filter((server) => server.id !== id));
      }}
      onSetMcpServerEnabled={async (id, enabled) => {
        await props.onSetMcpServerEnabled?.(id, enabled);
        setServers((current) => current.map((server) => (server.id === id ? { ...server, enabled } : server)));
      }}
    />
  );
}

const localServer = STORY_SERVERS.find((server) => server.kind === "local") ?? STORY_SERVERS[0];

const meta = {
  title: "Settings/ServerMcp",
  component: ServerSettingsModal,
  render: (args) => <McpSettingsHost {...args} />,
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
    mcpServers: STORY_MCP_SERVERS,
    onSaveMcpServer: fn(async () => undefined),
    onRemoveMcpServer: fn(async () => undefined),
    onSetMcpServerEnabled: fn(async () => undefined),
    // A test answers for the configuration given, so the one whose command is not on this machine
    // fails even though every other field is filled in.
    onTestMcpServer: fn(async (config: McpServerConfig) =>
      config.command.startsWith("bunx")
        ? { toolCount: 0, error: "Command not found: bunx" }
        : { toolCount: 12, error: null },
    ),
  },
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    viewport: {
      options: {
        serverDesktop: { name: "Server settings — 1200 × 820", styles: { width: "1200px", height: "820px" } },
        serverMinimum: { name: "Server settings — 960 × 640", styles: { width: "960px", height: "640px" } },
        serverMobile: { name: "Server settings — 640 × 720", styles: { width: "640px", height: "720px" } },
        serverNarrow: { name: "Server settings — 480 × 720", styles: { width: "480px", height: "720px" } },
      },
    },
  },
} satisfies Meta<typeof ServerSettingsModal>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The rows report what the user set, not a connection: OpenBot connects only when the user asks for
 * a test, so a row that was never tested says only whether its tools are offered to the agents.
 */
export const McpList: Story = {};

export const McpEmpty: Story = {
  args: { mcpServers: [] },
};

/** A read that failed, which is not the same statement as a server that holds no MCP servers. */
export const McpLoadFailed: Story = {
  args: {
    mcpServers: [],
    mcpLoadError: "The MCP servers could not load.",
    onRetryMcpServers: fn(),
  },
};

export const McpNarrowViewport: Story = {
  parameters: { viewport: { defaultViewport: "serverNarrow" } },
};

/** At this width, the repeatable rows of the MCP form are the risk. */
export const McpFormNarrowViewport: Story = {
  parameters: { viewport: { defaultViewport: "serverMobile" } },
};
