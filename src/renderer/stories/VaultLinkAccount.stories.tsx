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

export const Disconnected: Story = {};

export const Pending: Story = { args: { status: { state: "pending", email: null, error: null } } };

export const Connected: Story = {
  args: { status: { state: "connected", email: "ada@example.com", error: null } },
};

export const Expired: Story = {
  args: {
    status: { state: "expired", email: "ada@example.com", error: "The Link connection expired. Connect Link again." },
  },
};

export const Refused: Story = {
  args: { status: { state: "disconnected", email: null, error: "The Link sign-in was refused." } },
};
