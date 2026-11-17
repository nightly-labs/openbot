/**
 * The sign-in of a joined server's MCP server that the user finishes in their own browser. The
 * dialog opens the page, lets the user copy its link for another browser or device, and takes the
 * address that the browser shows when this computer cannot take the callback.
 */

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

/** This computer takes the callback, so the address field is only the way back when the browser does not return. */
export const Listening: Story = {};

/** An address that is too long to send has no copy button. */
export const NoLink: Story = {
  args: {
    page: { authorizeHost: "mcp.linear.app", url: null, listening: true, pasteable: true },
  },
};
