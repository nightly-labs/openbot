import { Toaster, toast } from "@openbot/ui";
import { createSignal, onCleanup, onSettled } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createHostRestartToasts, type HostRestartView } from "../src/features/updates/host-restart-toast";

const meta = {
  title: "Updates/Host update notices",
  component: Toaster,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof Toaster>;
export default meta;
type Story = StoryObj<typeof meta>;

function NoticeStory(props: { start: () => void }): ReturnType<typeof Toaster> {
  onSettled(() => props.start());
  onCleanup(() => toast.dismiss());
  return (
    <main class="foundation-story">
      <Toaster />
    </main>
  );
}

function RestartStory(props: { restart: HostRestartView["restart"]; online: boolean }) {
  const [hosts] = createSignal<HostRestartView[]>([
    { id: "story-restart", name: "Studio", online: props.online, restart: props.restart, version: "0.24.0" },
  ]);
  createHostRestartToasts(hosts);
  return <NoticeStory start={() => undefined} />;
}

export const RestartWaiting: Story = {
  render: () => <RestartStory restart="waiting" online />,
};

export const Restarting: Story = {
  render: () => <RestartStory restart="restarting" online />,
};
