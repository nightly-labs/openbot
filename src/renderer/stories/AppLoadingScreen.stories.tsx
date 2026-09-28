import { AppLoadingScreen } from "@openbot/ui/features/account/AppLoadingScreen";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "Auth/AppLoadingScreen",
  component: AppLoadingScreen,
  args: { variant: "production" },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AppLoadingScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {};
