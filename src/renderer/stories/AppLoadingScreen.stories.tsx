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

/** A new crew falls into a pile while the app loads, then hops out of the screen. */
export const Sequence: Story = {};

/** The app is ready at once, so the screen only fades. */
export const FastLoad: Story = { args: { readyAfterMs: 300 } };

/** The screen never finishes, so the loop and every status line can be inspected. */
export const Loading: Story = {
  render: () => <AppLoadingScreen />,
};

/** One crew. The same seed always makes the same pile. */
export const Seeded: StoryObj<{ seed: number }> = {
  args: { seed: 7 },
  argTypes: { seed: { control: { type: "number", min: 0, step: 1 } } },
  render: (args) => <AppLoadingScreen seed={args.seed} />,
};

/** The history of an agent loads: the lilac plush watches its balls. */
export const HistoryLoading: Story = {
  render: () => <ConversationLoadNotice name="Research agent" loading error={null} onRetry={() => {}} />,
};

export const StartingServer: Story = {
  render: () => <ServerConnectionNotice name="My server" phase="waking" initial onRetry={() => {}} />,
};
/** The machine runs and OpenBot on it starts. The time counts from the wake. */
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
/** The provider refused the start for a short time, and the account server tries again. */
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
