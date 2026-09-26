import { ServerRail } from "@openbot/ui/features/servers/ServerRail";
import { createMemo, createSignal } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_SERVERS } from "./fixtures";

const args: Parameters<typeof ServerRail>[0] = {
  servers: STORY_SERVERS,
  onSelect: fn(),
  onSetMuted: fn(),
  onSetNotificationLevel: fn(),
  onReorder: fn(),
  onAdd: fn(),
  onOpenSettings: fn(),
  onOpenUsage: fn(),
};

const MANY_SERVERS = createManyServers();

function createManyServers() {
  const local = STORY_SERVERS.find((server) => server.kind === "local");
  const remote = STORY_SERVERS.find((server) => server.kind === "remote");
  if (!local || !remote) return STORY_SERVERS;
  return [
    local,
    ...Array.from({ length: 16 }, (_, index) => ({
      ...remote,
      id: `remote-${index + 1}`,
      name: `Remote server ${index + 1}`,
      active: false,
      logoUrl: null,
    })),
  ];
}

function InteractiveServerRail(props: Parameters<typeof ServerRail>[0]) {
  const [activeServerOverride, setActiveServerOverride] = createSignal<string>();
  const [serverOrder, setServerOrder] = createSignal(props.servers.map((server) => server.id));
  const activeServerId = createMemo(
    () => activeServerOverride() ?? props.servers.find((server) => server.active)?.id ?? props.servers[0]?.id,
  );
  const storyServers = createMemo(() =>
    serverOrder().flatMap((serverId) => {
      const server = props.servers.find((candidate) => candidate.id === serverId);
      return server ? [{ ...server, active: server.id === activeServerId() }] : [];
    }),
  );
  return (
    <ServerRail
      servers={storyServers()}
      onSelect={(serverId) => {
        setActiveServerOverride(serverId);
        props.onSelect(serverId);
      }}
      onReorder={(serverIds) => {
        setServerOrder([
          ...props.servers.filter((server) => server.kind === "local").map((server) => server.id),
          ...serverIds,
        ]);
        props.onReorder(serverIds);
      }}
      onSetMuted={props.onSetMuted}
      onSetNotificationLevel={props.onSetNotificationLevel}
      onAdd={props.onAdd}
      onOpenSettings={props.onOpenSettings}
      onOpenUsage={props.onOpenUsage}
    />
  );
}

const meta = {
  title: "Navigation/ServerRail",
  component: ServerRail,
  render: (storyArgs) => <InteractiveServerRail {...storyArgs} />,
  args,
  decorators: [(Story) => <div class="app-frame app-frame-edge app-frame-with-server-rail">{Story()}</div>],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ServerRail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {};

export const OfflineRemote: Story = {
  args: {
    servers: STORY_SERVERS.map((server) =>
      server.kind === "remote" ? { ...server, state: "offline" as const } : server,
    ),
  },
};

export const ManyServers: Story = {
  args: { servers: MANY_SERVERS },
};

export const SortableServers: Story = {
  args: { servers: MANY_SERVERS.slice(0, 4) },
};

export const RemoteSelected: Story = {
  args: {
    servers: STORY_SERVERS.map((server) => ({ ...server, active: server.kind === "remote" })),
  },
};

export const Muted: Story = {
  args: { servers: STORY_SERVERS.map((server) => ({ ...server, notificationsMuted: server.kind === "remote" })) },
};

/** A remote server muted for one hour, with notifications set to only when it needs me. */
export const MutedUntil: Story = {
  args: {
    servers: STORY_SERVERS.map((server) =>
      server.kind === "remote"
        ? {
            ...server,
            notificationsMuted: true,
            notificationsMutedUntil: Date.now() + 3_600_000,
            notificationLevel: "needs-me" as const,
          }
        : server,
    ),
  },
};
