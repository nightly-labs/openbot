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

/** The window on this computer is open. OpenBot sends the sign-in when the site looks signed in. */
export const WindowOpen: Story = {};

/** The person closed the window before the sign-in was complete. */
export const WindowClosed: Story = { args: { windowOpen: false } };

/** OpenBot sends the sign-in and checks the server tab. */
export const Sending: Story = { args: { pending: true } };

/** The server tab still shows a sign-in page, so the window stays open. */
export const StillSignedOut: Story = {
  args: { error: "hello still shows a sign-in page for x.com. Finish the sign-in in the window." },
};
