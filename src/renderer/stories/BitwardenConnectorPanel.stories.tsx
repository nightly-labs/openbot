import { type BitwardenConnectorStatus, DISCONNECTED_BITWARDEN_CONNECTOR } from "@openbot/contracts/ipc";
import { BitwardenConnectorPanel } from "@openbot/ui/features/settings/BitwardenConnectorPanel";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { SettledArgs } from "./settled-args";

const meta = {
  title: "Settings/BitwardenConnectorPanel",
  component: BitwardenConnectorPanel,
  parameters: { layout: "padded", a11y: { test: "error" } },
  render: (args) => <SettledArgs>{() => <BitwardenConnectorPanel {...args} />}</SettledArgs>,
} satisfies Meta<typeof BitwardenConnectorPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const args = (status: Partial<BitwardenConnectorStatus>, hostName?: string) => ({
  status: { ...DISCONNECTED_BITWARDEN_CONNECTOR, ...status },
  busy: false,
  onConnect: fn(),
  onConnectHost: fn(),
  onDisconnect: fn(),
  hostName,
});

/** This computer: the user pastes a session key from `bw unlock --raw`. */
export const SessionKey: Story = { args: args({}) };

export const SessionKeyConnected: Story = { args: args({ connected: true }) };

/** A joined server signs in with its own CLI, so the page asks for an API key and the master password. */
export const HostApiKey: Story = { args: args({}, "Studio") };

/** The host downloads `bw`, signs in and syncs; the page reads the status until it changes. */
export const HostConnecting: Story = {
  args: args({ connecting: true, serverUrl: "https://vault.example.com" }, "Studio"),
};

export const HostFailed: Story = {
  args: args(
    {
      error:
        "Could not open Bitwarden on this server. Check the server address, the API key and the master password, and make sure that one folder is named Shared with OpenBot. Then connect again.",
    },
    "Studio",
  ),
};

export const HostConnected: Story = {
  args: args({ connected: true, serverUrl: "https://vault.example.com" }, "Studio"),
};
