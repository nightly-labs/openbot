import { DISCONNECTED_TELEGRAM_ACCOUNT_CONNECTOR, type TelegramAccountConnectorStatus } from "@openbot/contracts/ipc";
import { TelegramAccountConnectorPanel } from "@openbot/ui/features/settings/TelegramAccountConnectorPanel";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { SettledArgs } from "./settled-args";

const meta = {
  title: "Settings/TelegramAccountConnectorPanel",
  component: TelegramAccountConnectorPanel,
  parameters: { layout: "padded", a11y: { test: "error" } },
  render: (args) => <SettledArgs>{() => <TelegramAccountConnectorPanel {...args} />}</SettledArgs>,
} satisfies Meta<typeof TelegramAccountConnectorPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const ACCOUNT = { name: "Ada Lovelace", username: "ada", phone: "+4860***200" };

const args = (status: Partial<TelegramAccountConnectorStatus>, busy = false) => ({
  status: { ...DISCONNECTED_TELEGRAM_ACCOUNT_CONNECTOR, ...status },
  busy,
  onConnect: fn(),
  onSubmit: fn(),
  onCancel: fn(),
  onDisconnect: fn(),
  onSetSending: fn(),
  onOpenApps: fn(),
});

/** Not connected: the method choice, the api_id and api_hash row, and Connect. */
export const Disconnected: Story = { args: args({}) };

/** The first sign-in of this computer ended at once: Telegram needs the user's api_id and api_hash. */
export const CredentialsMissing: Story = {
  args: args({
    error: "Enter the api_id and api_hash of your Telegram app. You get them at my.telegram.org.",
  }),
};

/** Main talks to Telegram between two steps. */
export const Connecting: Story = { args: args({ state: "connecting", method: "qr" }) };

export const Qr: Story = {
  args: args({
    state: "qr",
    method: "qr",
    qrUrl: "tg://login?token=AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA",
    qrExpiresAt: 1_900_000_000_000,
  }),
};

export const Phone: Story = { args: args({ state: "phone", method: "phone" }) };

/** Telegram sent the code to the Telegram app on another device. */
export const Code: Story = { args: args({ state: "code", method: "phone", codeViaApp: true }) };

export const CodeBySms: Story = { args: args({ state: "code", method: "phone", codeViaApp: false }) };

/** A wrong code does not end the sign-in: the step stays, with the error. */
export const CodeWrong: Story = {
  args: args({
    state: "code",
    method: "phone",
    codeViaApp: true,
    error: "This code is not correct. Check it and try again.",
  }),
};

/** The account has two-step verification, with a hint. */
export const Password: Story = {
  args: args({ state: "password", method: "phone", passwordHint: "first pet" }),
};

/** Connected, with sending off: agents only read. */
export const Connected: Story = { args: args({ state: "connected", account: ACCOUNT }) };

export const ConnectedSending: Story = {
  args: args({ state: "connected", account: ACCOUNT, sendingEnabled: true }),
};

/** Telegram ended the session, for example in Settings › Devices. */
export const SessionEnded: Story = {
  args: args({
    error: "Telegram ended this session, for example in Settings > Devices. Connect your Telegram account again.",
  }),
};

/** A joined server runs the sign-in; this computer only shows the QR code. */
export const HostQr: Story = {
  args: {
    ...args({
      state: "qr",
      method: "qr",
      qrUrl: "tg://login?token=AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA",
      qrExpiresAt: 1_900_000_000_000,
    }),
    hostName: "Studio",
  },
};

export const HostConnected: Story = {
  args: { ...args({ state: "connected", account: ACCOUNT }), hostName: "Studio" },
};

/** The host could not be read: the page shows the reason and Retry, and no sign-in. */
export const ReadFailed: Story = {
  args: { ...args({}), hostName: "Studio", statusError: "Studio did not answer.", onRetry: fn() },
};
