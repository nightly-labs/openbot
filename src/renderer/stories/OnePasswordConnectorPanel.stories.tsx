import {
  DISCONNECTED_ONEPASSWORD_CONNECTOR,
  type OnePasswordConnectorStatus,
  type OnePasswordSetup,
} from "@openbot/contracts/ipc";
import { OnePasswordConnectorPanel } from "@openbot/ui/features/settings/OnePasswordConnectorPanel";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { SettledArgs } from "./settled-args";

const meta = {
  title: "Settings/OnePasswordConnectorPanel",
  component: OnePasswordConnectorPanel,
  parameters: { layout: "padded", a11y: { test: "error" } },
  render: (args) => <SettledArgs>{() => <OnePasswordConnectorPanel {...args} />}</SettledArgs>,
} satisfies Meta<typeof OnePasswordConnectorPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const MISSING: OnePasswordSetup = { cli: "missing", cliVersion: null, canInstall: true, appIntegration: null };
const INSTALLED: OnePasswordSetup = { cli: "ready", cliVersion: "2.39.0", canInstall: true, appIntegration: false };
const READY: OnePasswordSetup = { ...INSTALLED, appIntegration: true };

const args = (status: Partial<OnePasswordConnectorStatus>, busy = false) => ({
  status: { ...DISCONNECTED_ONEPASSWORD_CONNECTOR, setup: MISSING, ...status },
  busy,
  onWatchSetup: fn(() => () => undefined),
  onCheckSetup: fn(),
  onInstallCli: fn(),
  onOpenApp: fn(),
  onConnect: fn(),
  onConnectWithToken: fn(),
  onCancel: fn(),
  onDisconnect: fn(),
});

export const CliMissing: Story = { args: args({}) };

export const CliInstalling: Story = { args: args({ setup: { ...MISSING, cli: "installing" } }) };

export const CliManualInstall: Story = { args: args({ setup: { ...MISSING, canInstall: false } }) };

export const AppIntegrationOff: Story = { args: args({ setup: INSTALLED }) };

export const ReadyToConnect: Story = { args: args({ setup: READY }) };

export const Connecting: Story = { args: args({ state: "connecting", setup: READY }, true) };

export const ChooseAccount: Story = {
  args: args({
    state: "choose-account",
    setup: READY,
    accounts: [
      { id: "personal", label: "ada@example.com (my.1password.com)" },
      { id: "work", label: "ada@example.org (example.1password.com)" },
    ],
  }),
};

export const Connected: Story = {
  args: args({ state: "connected", setup: READY, vaultNames: ["Shared with OpenBot"], loginCount: 3 }),
};

export const ConnectedLoading: Story = {
  args: args({ state: "connected", setup: READY, vaultNames: ["Shared with OpenBot"], loginCount: null }),
};

export const InstallFailed: Story = {
  args: args({
    error: "OpenBot could not install the 1Password CLI. Check the connection to the internet, then try again.",
  }),
};

export const HostTokenOnly: Story = { args: { ...args({}), hostName: "Studio" } };

export const HostTokenRejected: Story = {
  args: { ...args({ error: "1Password did not accept the service account token." }), hostName: "Studio" },
};

export const HostConnected: Story = {
  args: {
    ...args({ state: "connected", vaultNames: ["Shared with OpenBot"], loginCount: 3 }),
    hostName: "Studio",
  },
};
