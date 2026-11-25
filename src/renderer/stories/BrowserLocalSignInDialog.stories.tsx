import BrowserLocalSignInDialog from "@openbot/ui/features/browser/BrowserLocalSignInDialog";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "Conversation/BrowserLocalSignInDialog",
  component: BrowserLocalSignInDialog,
  args: {
    open: true,
    site: "x.com",
    server: "hello",
    windowOpen: true,
    pending: false,
    onReopen: fn(),
    onCancel: fn(),
    onDone: fn(async () => undefined),
  },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof BrowserLocalSignInDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WindowOpen: Story = {};

export const WindowClosed: Story = { args: { windowOpen: false } };

export const Sending: Story = { args: { pending: true } };

export const StillSignedOut: Story = {
  args: { error: "hello still shows a sign-in page for x.com. Finish the sign-in in the window." },
};
