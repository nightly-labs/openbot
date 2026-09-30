import { APP_LOADING_FPS, APP_LOADING_LOOP_S, AppLoadingScreen } from "@openbot/ui/features/account/AppLoadingScreen";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { SplashPlayground } from "./splash-concept";

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

/** The crew hops while the app loads, then jumps out of the screen. */
export const Sequence: Story = {};

/** The app is ready at once, so the screen only fades. */
export const FastLoad: Story = { args: { readyAfterMs: 300 } };

/** The screen never finishes, so the loop and every status line can be inspected. */
export const Loading: Story = {
  render: () => <AppLoadingScreen />,
};

/** One frame of the loop. The same time always shows the same frame. */
export const Scrub: StoryObj<{ at: number }> = {
  args: { at: 1.5 },
  argTypes: {
    at: { control: { type: "range", min: 0, max: APP_LOADING_LOOP_S * 3, step: 1 / APP_LOADING_FPS } },
  },
  render: (args) => <AppLoadingScreen at={args.at} />,
};
