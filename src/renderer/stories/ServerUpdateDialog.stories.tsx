import { ServerUpdateDialog, type ServerUpdateView } from "@openbot/ui/features/servers/ServerUpdateDialog";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const OFFER: ServerUpdateView = {
  name: "Research server",
  currentVersion: "0.23.0",
  version: "0.24.0",
  stage: "offer",
  download: "pending",
  progress: null,
  restartMode: null,
  waitingFor: [],
  failure: null,
  elapsedSeconds: 0,
};

function DialogStory(props: { update: Partial<ServerUpdateView>; canManage?: boolean; error?: string }) {
  return (
    <ServerUpdateDialog
      update={{ ...OFFER, ...props.update }}
      canManage={props.canManage ?? true}
      busy={null}
      error={props.error ?? null}
      onStart={() => undefined}
      onRestartNow={() => undefined}
      onCancelRestart={() => undefined}
      onHide={() => undefined}
      onDone={() => undefined}
    />
  );
}

const meta = {
  title: "Servers/Server update dialog",
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Offer: Story = { render: () => <DialogStory update={{}} /> };

export const OfferDownloaded: Story = { render: () => <DialogStory update={{ download: "done" }} /> };

export const MemberOffer: Story = { render: () => <DialogStory update={{}} canManage={false} /> };

export const StartFailed: Story = {
  render: () => <DialogStory update={{}} error="The host refused the request. Try again in a moment." />,
};

export const Downloading: Story = {
  render: () => (
    <DialogStory
      update={{
        stage: "downloading",
        download: "running",
        progress: 42,
        restartMode: "when-idle",
        elapsedSeconds: 38,
      }}
    />
  ),
};

export const WaitingForIdle: Story = {
  render: () => (
    <DialogStory
      update={{
        stage: "waiting",
        download: "done",
        restartMode: "when-idle",
        waitingFor: ["agent-turn", "routine-run"],
        elapsedSeconds: 96,
      }}
    />
  ),
};

export const Restarting: Story = {
  render: () => (
    <DialogStory update={{ stage: "restarting", download: "done", restartMode: "now", elapsedSeconds: 131 }} />
  ),
};

export const BackOnline: Story = {
  render: () => (
    <DialogStory update={{ stage: "online", download: "done", currentVersion: "0.24.0", elapsedSeconds: 164 }} />
  ),
};

export const NotInstalled: Story = {
  render: () => <DialogStory update={{ stage: "failed", download: "done", failure: "version", elapsedSeconds: 170 }} />,
};

export const DownloadFailed: Story = {
  render: () => <DialogStory update={{ stage: "failed", download: "failed", failure: "download" }} />,
};
