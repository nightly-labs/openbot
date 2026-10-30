import type { ServerNotificationLevel } from "@openbot/contracts/ipc";
import { Heading, SettingsSection, Toaster } from "@openbot/ui";
import {
  NotificationMatrix,
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

const LOCAL: NotificationMatrixServer = {
  id: "local",
  name: "Norbert’s MacBook Pro",
  level: "all",
  muted: false,
  mutedUntil: null,
  offline: false,
  deviceOnly: false,
  agents: {
    status: "ready",
    agents: [
      { id: "atlas", name: "Atlas", detail: "Research", sharedOff: false, level: null },
      { id: "scout", name: "Scout", detail: "Morning news routine", sharedOff: false, level: "nothing" },
      { id: "ledger", name: "Ledger", detail: "Invoices and receipts", sharedOff: false, level: null },
    ],
  },
};
const ACME: NotificationMatrixServer = {
  id: "acme",
  name: "Acme Studio",
  level: "needs-me",
  muted: true,
  mutedUntil: Date.now() + 2 * 60 * 60_000,
  offline: false,
  deviceOnly: false,
  agents: {
    status: "ready",
    agents: [
      { id: "nova", name: "Nova", detail: "Support inbox", sharedOff: false, level: "all" },
      { id: "pixel", name: "Pixel", detail: "Design QA", sharedOff: false, level: null },
      { id: "echo", name: "Echo", detail: "Release notes", sharedOff: true, level: null },
    ],
  },
};
/** A joined server on an older OpenBot, and one that is offline. */
const LAB: NotificationMatrixServer = {
  id: "lab",
  name: "Old lab server",
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
            onTurnOnAgent={fn(async () => undefined)}
          />
        </SettingsSection>
      </div>
      <Toaster />
    </main>
  );
}

/** Every row state: own levels, levels from the server, a shared switch that is off, mute, an old and an offline server. */
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

/** A server set to Nothing keeps every agent silent, so their choices are off. */
export const ServerSetToNothing: Story = {
  render: () => <MatrixStory servers={[{ ...LOCAL, level: "nothing" }]} />,
};

/** Each save fails: the choice goes back to the saved level and a toast tells why. */
export const SaveFails: Story = {
  render: () => <MatrixStory servers={[LOCAL, ACME]} failSaves />,
};
