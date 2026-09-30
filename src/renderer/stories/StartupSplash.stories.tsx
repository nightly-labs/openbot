import type { AppLogoVariant } from "@openbot/brand";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { StartupSplash } from "../src/features/startup/StartupSplash";
import { SplashPlayground } from "./splash-concept";

interface SplashStoryArgs {
  variant: AppLogoVariant;
  readyAfterMs: number;
}

function SplashStory(args: SplashStoryArgs) {
  return (
    <SplashPlayground readyAfterMs={args.readyAfterMs}>
      {(ready, onExited) => <StartupSplash variant={args.variant} ready={ready()} onExited={onExited} />}
    </SplashPlayground>
  );
}

const meta = {
  title: "App/StartupSplash",
  component: SplashStory,
  args: { variant: "production", readyAfterMs: 3200 },
  argTypes: {
    variant: { control: "select", options: ["production", "dev", "preview"] },
    readyAfterMs: { control: { type: "range", min: 0, max: 8000, step: 200 } },
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SplashStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The eyes draw in, the logo blinks while loading, then the splash fades out. */
export const Sequence: Story = {};

/** The splash never finishes, so the loading state can be inspected. */
export const Loading: Story = {
  render: (args) => <StartupSplash variant={args.variant} ready={false} />,
};
