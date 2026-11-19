import { disconnectedPasswordManager, type PasswordManagerStatus } from "@openbot/contracts/ipc";
import { ProtonPassConnectorPanel } from "@openbot/ui/features/settings/ProtonPassConnectorPanel";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { SettledArgs } from "./settled-args";

const meta = {
  title: "Settings/ProtonPassConnectorPanel",
  component: ProtonPassConnectorPanel,
  parameters: { layout: "padded", a11y: { test: "error" } },
  render: (args) => <SettledArgs>{() => <ProtonPassConnectorPanel {...args} />}</SettledArgs>,
} satisfies Meta<typeof ProtonPassConnectorPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const SIGN_IN_URL = "https://account.proton.me/authorize?app=proton-pass-cli";
const NEXT_YEAR = Date.UTC(2027, 10, 5);
const LAST_MONTH = Date.UTC(2026, 9, 5);

const args = (status: Partial<PasswordManagerStatus>, hostName?: string) => ({
  status: { ...disconnectedPasswordManager("protonpass", ["browser", "key"]), ...status },
  busy: false,
  onConnect: fn(),
  onConnectWithKey: fn(),
  onSubmitExtraPassword: fn(),
  onCancel: fn(),
  onDisconnect: fn(),
  onOpenSignIn: fn(),
  hostName,
});

const CONNECTED: Partial<PasswordManagerStatus> = {
  state: "connected",
  vaultNames: ["Shared with OpenBot"],
  loginCount: 12,
  expiresAt: NEXT_YEAR,
};

export const Disconnected: Story = { args: args({}) };

export const BrowserStep: Story = {
  args: args({ state: "signing-in", step: "browser", signInUrl: SIGN_IN_URL }),
};

export const ExtraPassword: Story = {
  args: args({ state: "signing-in", step: "extra-password" }),
};

export const ExtraPasswordWrong: Story = {
  args: args({ state: "signing-in", step: "extra-password", errorCode: "extra-password" }),
};

export const Setup: Story = {
  args: args({ state: "signing-in", step: "setup" }),
};

export const Connected: Story = { args: args(CONNECTED) };

export const PlanError: Story = {
  args: args({ state: "failed", errorCode: "plan" }),
};

export const Expired: Story = {
  args: args({ ...CONNECTED, expiresAt: LAST_MONTH, errorCode: "expired" }),
};

export const OnServer: Story = { args: args({}, "Studio") };

export const OnServerBrowserStep: Story = {
  args: args({ state: "signing-in", step: "browser", signInUrl: SIGN_IN_URL }, "Studio"),
};

export const OnServerConnected: Story = { args: args(CONNECTED, "Studio") };
