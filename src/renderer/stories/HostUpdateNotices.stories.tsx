import type { HostUpdateStatus } from "@openbot/contracts/ipc";
import { Toaster, toast } from "@openbot/ui";
import { createSignal, onCleanup, onSettled } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { watchHostUpdate } from "../src/features/servers/host-update-toast";
import { createHostRestartToasts, type HostRestartView } from "../src/features/updates/host-restart-toast";

const meta = {
  title: "Updates/Host update notices",
  component: Toaster,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof Toaster>;
export default meta;
type Story = StoryObj<typeof meta>;

const AVAILABLE: HostUpdateStatus = {
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

function NoticeStory(props: { start: () => void }): ReturnType<typeof Toaster> {
  onSettled(() => props.start());
  onCleanup(() => toast.dismiss());
  return (
    <main class="foundation-story">
      <Toaster />
    </main>
  );
}

/** What an admin sees when a joined host has a new version. */
export const UpdateAvailable: Story = {
  render: () => (
    <NoticeStory
      start={() =>
        watchHostUpdate({
          serverId: "story-available",
          name: "Studio",
          calls: { getUpdateStatus: async () => AVAILABLE },
          openUpdates: () => undefined,
        })
      }
    />
  ),
};

/** The percentage climbs while the host downloads; the notice closes when the download is ready. */
export const Downloading: Story = {
  render: () => {
    let progress = 0;
    return (
      <NoticeStory
        start={() =>
          watchHostUpdate({
            serverId: "story-download",
            name: "Studio",
            calls: {
              getUpdateStatus: async () => {
                progress = Math.min(progress + 7, 99);
                return { ...AVAILABLE, phase: "downloading", progress };
              },
            },
            offer: false,
          })
        }
      />
    );
  },
};

function RestartStory(props: { restart: HostRestartView["restart"]; online: boolean }) {
  const [hosts] = createSignal<HostRestartView[]>([
    { id: "story-restart", name: "Studio", online: props.online, restart: props.restart, version: "0.24.0" },
  ]);
  createHostRestartToasts(hosts);
  return <NoticeStory start={() => undefined} />;
}

/** Every member sees this while the host waits for idle agents before it restarts. */
export const RestartWaiting: Story = {
  render: () => <RestartStory restart="waiting" online />,
};

/** Every member sees this while the host restarts and the connection is away. */
export const Restarting: Story = {
  render: () => <RestartStory restart="restarting" online />,
};
