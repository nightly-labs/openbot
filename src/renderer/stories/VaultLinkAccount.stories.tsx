import { VaultLinkAccount } from "@openbot/ui/features/vault/VaultLinkAccount";
import { untrack } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "Settings/VaultLinkAccount",
  component: VaultLinkAccount,
  args: {
    status: { state: "disconnected", email: null, error: null },
    onConnect: fn(async () => undefined),
    onCancel: fn(async () => undefined),
    onDisconnect: fn(async () => undefined),
  },
  // Storybook writes the args store in the same flush as the first render, so a memo in the
  // component would read it empty. The story passes a copy that the render reads at once.
  render: (args) => {
    const status = untrack(() => ({ ...args.status }));
    return (
      <main style={{ width: "100%", "max-width": "640px" }}>
        <VaultLinkAccount
          status={status}
          onConnect={args.onConnect}
          onCancel={args.onCancel}
          onDisconnect={args.onDisconnect}
        />
      </main>
    );
  },
  parameters: { layout: "padded", a11y: { test: "error" } },
} satisfies Meta<typeof VaultLinkAccount>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The Payment accounts group at the top of the Cards tab, before the user connects Link. */
export const Disconnected: Story = {};

/** Connect opened Link in the browser. The row waits for the user to approve there. */
export const Pending: Story = { args: { status: { state: "pending", email: null, error: null } } };

/** Agents can ask to pay with Link. The menu has Disconnect. */
export const Connected: Story = {
  args: { status: { state: "connected", email: "ada@example.com", error: null } },
};

/** Link refused the saved sign-in. The user connects again, or disconnects from the menu. */
export const Expired: Story = {
  args: {
    status: { state: "expired", email: "ada@example.com", error: "The Link connection expired. Connect Link again." },
  },
};

/** The user refused the sign-in in the browser. */
export const Refused: Story = {
  args: { status: { state: "disconnected", email: null, error: "The Link sign-in was refused." } },
};
