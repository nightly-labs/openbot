import { AppLoadingScreen } from "@openbot/ui/features/account/AppLoadingScreen";
import { ConversationLoadNotice, ServerConnectionNotice } from "@openbot/ui/features/servers/ServerConnectionNotice";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { SplashPlayground } from "./splash-story-support";

interface LoadingStoryArgs {
  readyAfterMs: number;
}

function LoadingStory(args: LoadingStoryArgs) {
  return (
    <SplashPlayground readyAfterMs={args.readyAfterMs}>
      {(ready, onExited) => <AppLoadingScreen ready={ready()} onExited={onExited} />}
    </SplashPlayground>
  );
}

const meta = {
  title: "Auth/AppLoadingScreen",
  component: LoadingStory,
  args: { readyAfterMs: 9000 },
  argTypes: {
    readyAfterMs: { control: { type: "range", min: 0, max: 20000, step: 500 } },
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof LoadingStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Sequence: Story = {};

export const FastLoad: Story = { args: { readyAfterMs: 300 } };

export const Loading: Story = {
  render: () => <AppLoadingScreen />,
};

export const QuietLoading: Story = {
  render: () => <AppLoadingScreen scene="quiet" title="Loading OpenBot" />,
};

export const QuietStartingServer: Story = {
  render: () => (
    <ServerConnectionNotice name="My server" phase="waking" initial loadingScene="quiet" onRetry={() => {}} />
  ),
};

export const Seeded: StoryObj<{ seed: number }> = {
  args: { seed: 7 },
  argTypes: { seed: { control: { type: "number", min: 0, step: 1 } } },
  render: (args) => <AppLoadingScreen seed={args.seed} />,
};

export const HistoryLoading: Story = {
  render: () => <ConversationLoadNotice name="Research agent" loading error={null} onRetry={() => {}} />,
};

export const StartingServer: Story = {
  render: () => <ServerConnectionNotice name="My server" phase="waking" initial onRetry={() => {}} />,
};
export const StartingOpenBot: Story = {
  render: () => (
    <ServerConnectionNotice
      name="My server"
      phase="waking"
      start={{ step: "openbot", startedAt: Date.now() - 4 * 60_000 }}
      initial
      onRetry={() => {}}
    />
  ),
};
export const StartRestoring: Story = {
  render: () => (
    <ServerConnectionNotice
      name="My server"
      phase="waking"
      start={{ step: "restore", startedAt: Date.now() - 3 * 60_000 }}
      initial
      onRetry={() => {}}
    />
  ),
};
export const StartRateLimited: Story = {
  render: () => (
    <ServerConnectionNotice
      name="My server"
      phase="waking"
      start={{ step: "provider_limit", startedAt: Date.now() - 45_000 }}
      initial={false}
      onRetry={() => {}}
    />
  ),
};
export const UpdatingServer: Story = {
  render: () => <ServerConnectionNotice name="My server" phase="updating" initial={false} onRetry={() => {}} />,
};
export const StartFailed: Story = {
  render: () => (
    <ServerConnectionNotice name="My server" phase="blocked" issue="start_timeout" initial onRetry={() => {}} />
  ),
};
export const Reconnecting: Story = {
  render: () => (
    <ServerConnectionNotice name="My server" phase="waiting" remainingSeconds={12} initial={false} onRetry={() => {}} />
  ),
};
