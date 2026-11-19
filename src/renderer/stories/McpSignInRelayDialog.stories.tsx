import { McpSignInRelayDialog } from "@openbot/ui/features/settings/McpSignInPage";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "Auth/McpSignInRelayDialog",
  component: McpSignInRelayDialog,
  args: {
    name: "Linear",
    hostName: "Cloud server",
    page: {
      authorizeHost: "mcp.linear.app",
      url: "https://mcp.linear.app/authorize?state=example",
      listening: true,
      pasteable: true,
    },
    onOpen: fn(),
    onPaste: fn(async () => undefined),
    onCancel: fn(),
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof McpSignInRelayDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Listening: Story = {};

export const NoLink: Story = {
  args: {
    page: { authorizeHost: "mcp.linear.app", url: null, listening: true, pasteable: true },
  },
};
