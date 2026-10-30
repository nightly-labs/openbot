import type { ServerNotificationLevel } from "@openbot/contracts/ipc";
import { Heading, SettingsSection, Toaster } from "@openbot/ui";
import {
  NotificationMatrix,
  type NotificationMatrixAgent,
  type NotificationMatrixServer,
  NotificationScopeTitle,
} from "@openbot/ui/features/settings/NotificationMatrix";
import { createStore } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "Settings/Notification matrix",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** An agent with a drawn avatar. `level` null uses the level of its server. */
function agent(
  id: string,
  name: string,
  detail: string,
  level: ServerNotificationLevel | null,
): NotificationMatrixAgent {
  return { id, name, detail, avatarSeed: id, avatarHue: null, avatarUrl: null, level };
}

const LOCAL: NotificationMatrixServer = {
  id: "local",
  name: "Norbert’s MacBook Pro",
  logoUrl: null,
  level: "all",
  muted: false,
  mutedUntil: null,
  offline: false,
  deviceOnly: false,
  agents: {
    status: "ready",
    agents: [
      agent("atlas", "Atlas", "Research", null),
      agent("scout", "Scout", "Morning news routine", "nothing"),
      agent("ledger", "Ledger", "Invoices and receipts", null),
    ],
  },
};
const ACME: NotificationMatrixServer = {
  id: "acme",
  name: "Acme Studio",
  logoUrl: null,
  level: "needs-me",
  muted: true,
  mutedUntil: Date.now() + 2 * 60 * 60_000,
  offline: false,
  deviceOnly: false,
  agents: {
    status: "ready",
    agents: [
      agent("nova", "Nova", "Support inbox", "all"),
      agent("pixel", "Pixel", "Design QA", null),
      agent("echo", "Echo", "Release notes", null),
    ],
  },
};
/** A joined server on an older OpenBot, and one that is offline. */
const LAB: NotificationMatrixServer = {
  id: "lab",
  name: "Old lab server",
  logoUrl: null,
  level: "all",
  muted: false,
  mutedUntil: null,
  offline: false,
  deviceOnly: true,
  agents: { status: "unsupported" },
};
const RESEARCH: NotificationMatrixServer = {
  id: "research",
  name: "Research server",
  logoUrl: null,
  level: "all",
  muted: false,
  mutedUntil: null,
  offline: true,
  deviceOnly: false,
  agents: { status: "loading" },
};
/** This computer, a joined server, a joined server on an older OpenBot, and one that is offline. */
const SERVERS = [LOCAL, ACME, LAB, RESEARCH];

/** The matrix with the state that a host keeps, so each choice shows as it does in the app. */
function MatrixStory(props: {
  servers: NotificationMatrixServer[];
  device?: "computer" | "browser";
  failSaves?: boolean;
}) {
  const [servers, setServers] = createStore<{ list: NotificationMatrixServer[] }>({
    list: structuredClone(props.servers),
  });
  const failed = async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 400));
    throw new Error("The server did not answer.");
  };
  async function setServerLevel(serverId: string, level: ServerNotificationLevel) {
    if (props.failSaves) return failed();
    setServers((state) => {
      const server = state.list.find((candidate) => candidate.id === serverId);
      if (server) server.level = level;
    });
  }
  async function setAgentLevel(serverId: string, agentId: string, level: ServerNotificationLevel | null) {
    if (props.failSaves) return failed();
    setServers((state) => {
      const server = state.list.find((candidate) => candidate.id === serverId);
      if (server?.agents.status !== "ready") return;
      const agent = server.agents.agents.find((candidate) => candidate.id === agentId);
      if (agent) agent.level = level;
    });
  }
  async function setMuted(serverId: string, muted: boolean, durationMs: number | null) {
    setServers((state) => {
      const server = state.list.find((candidate) => candidate.id === serverId);
      if (!server) return;
      server.muted = muted;
      server.mutedUntil = muted && durationMs !== null ? Date.now() + durationMs : null;
    });
  }
  return (
    <main class="foundation-story">
      <Heading as="h1" size="lg">
        Notifications
      </Heading>
      <div class="settings-story-panel">
        <SettingsSection
          title={<NotificationScopeTitle title="What you hear about" scope="settings.notifications.allDevices" />}
        >
          <NotificationMatrix
            servers={servers.list}
            device={props.device ?? "computer"}
            onSetServerLevel={setServerLevel}
            onSetAgentLevel={setAgentLevel}
            onMute={(serverId, durationMs) => setMuted(serverId, true, durationMs)}
            onUnmute={(serverId) => setMuted(serverId, false, null)}
            onRetry={fn()}
          />
        </SettingsSection>
      </div>
      <Toaster />
    </main>
  );
}

/** Agents with their own level, agents to add, a muted server, an old and an offline server. */
export const Default: Story = {
  render: () => <MatrixStory servers={SERVERS} />,
};

/** The web client: a server on an older OpenBot keeps its level in this browser only. */
export const WebClient: Story = {
  render: () => <MatrixStory servers={SERVERS} device="browser" />,
};

/** The agents of each server load after the tab opens, or fail to load. */
export const Loading: Story = {
  render: () => (
    <MatrixStory
      servers={[
        { ...LOCAL, agents: { status: "loading" } },
        { ...ACME, muted: false, mutedUntil: null, agents: { status: "failed" } },
      ]}
    />
  ),
};

/** A server set to Nothing keeps every agent silent, so its card shows no agents. */
export const ServerSetToNothing: Story = {
  render: () => <MatrixStory servers={[{ ...LOCAL, level: "nothing" }]} />,
};

/** Each save fails: the choice goes back to the saved level and a toast tells why. */
export const SaveFails: Story = {
  render: () => <MatrixStory servers={[LOCAL, ACME]} failSaves />,
};
