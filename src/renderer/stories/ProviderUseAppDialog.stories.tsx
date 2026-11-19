import { ProviderUseAppDialog } from "@openbot/ui/components/ProviderUseAppDialog";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "Auth/ProviderUseAppDialog",
  component: ProviderUseAppDialog,
  args: {
    open: true,
    providerName: "Claude",
    onDownload: fn(),
    onClose: fn(),
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ProviderUseAppDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Claude: Story = {};

export const Antigravity: Story = { args: { providerName: "Antigravity" } };
