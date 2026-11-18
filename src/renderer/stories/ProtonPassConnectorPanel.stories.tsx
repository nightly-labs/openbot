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
/** A fixed date, so the story does not change from day to day. */
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

/** Connect opens the steps. The ⋯ menu has the access key. */
export const Disconnected: Story = { args: args({}) };

/** The Proton sign-in is open in the browser. × closes the dialog, and the sign-in goes on. */
export const BrowserStep: Story = {
  args: args({ state: "signing-in", step: "browser", signInUrl: SIGN_IN_URL }),
};

/** Proton Pass asks for the extra password of the account. */
export const ExtraPassword: Story = {
  args: args({ state: "signing-in", step: "extra-password" }),
};

/** The last try had the wrong extra password, and Proton Pass asks again. */
export const ExtraPasswordWrong: Story = {
  args: args({ state: "signing-in", step: "extra-password", errorCode: "extra-password" }),
};

/** The host makes the shared vault and its read-only key. */
export const Setup: Story = {
  args: args({ state: "signing-in", step: "setup" }),
};

export const Connected: Story = { args: args(CONNECTED) };

/** The Proton Pass CLI needs a paid plan. */
export const PlanError: Story = {
  args: args({ state: "failed", errorCode: "plan" }),
};

/** The access key expired: Reconnect signs in again. */
export const Expired: Story = {
  args: args({ ...CONNECTED, expiresAt: LAST_MONTH, errorCode: "expired" }),
};

/** A joined server: only the text names the server. */
export const OnServer: Story = { args: args({}, "Studio") };

export const OnServerBrowserStep: Story = {
  args: args({ state: "signing-in", step: "browser", signInUrl: SIGN_IN_URL }, "Studio"),
};

export const OnServerConnected: Story = { args: args(CONNECTED, "Studio") };
