import { DISCONNECTED_WHATSAPP_ACCOUNT_CONNECTOR, type WhatsAppAccountConnectorStatus } from "@openbot/contracts/ipc";
import { WhatsAppAccountConnectorPanel } from "@openbot/ui/features/settings/WhatsAppAccountConnectorPanel";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { SettledArgs } from "./settled-args";

const meta = {
  title: "Settings/WhatsAppAccountConnectorPanel",
  component: WhatsAppAccountConnectorPanel,
  parameters: { layout: "padded", a11y: { test: "error" } },
  render: (args) => <SettledArgs>{() => <WhatsAppAccountConnectorPanel {...args} />}</SettledArgs>,
} satisfies Meta<typeof WhatsAppAccountConnectorPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const ACCOUNT = { name: "Ada Lovelace", phone: "+4860***200" };

const args = (status: Partial<WhatsAppAccountConnectorStatus>, busy = false) => ({
  status: { ...DISCONNECTED_WHATSAPP_ACCOUNT_CONNECTOR, ...status },
  busy,
  onConnect: fn(),
  onSubmit: fn(),
  onCancel: fn(),
  onDisconnect: fn(),
  onSetSending: fn(),
});

/** Not linked: the method choice, the note on the risk, and Link. */
export const Disconnected: Story = { args: args({}) };

/** Main talks to WhatsApp between two steps. */
export const Connecting: Story = { args: args({ state: "connecting", method: "qr" }) };

/** The QR code that the phone scans in Settings › Linked devices. */
export const QrCode: Story = {
  args: args({
    state: "qr",
    method: "qr",
    qrCode:
      "2@Story0Reference0Value,StoryNoiseKey0000000000000000000000000000=,StoryIdentityKey000000000000000000000000000=,StorySecret0000000000000000000000000000000=",
    qrExpiresAt: Date.now() + 60_000,
  }),
};

/** The link with a code: the phone number of the account. */
export const PhoneNumber: Story = { args: args({ state: "phone", method: "phone" }) };

/** The code that the user types on the phone. */
export const PairingCode: Story = { args: args({ state: "code", method: "phone", pairingCode: "ABCD-1234" }) };

/** The QR code expired before the phone scanned it. */
export const QrExpired: Story = {
  args: args({ error: "The code expired before you used it. Start again." }),
};

/** Linked, with the chats that WhatsApp sent so far, and sending off. */
export const Connected: Story = {
  args: args({ state: "connected", account: ACCOUNT, history: { chats: 42, messages: 1_318 } }),
};

/** Linked, with sending on. */
export const SendingOn: Story = {
  args: args({
    state: "connected",
    account: ACCOUNT,
    history: { chats: 42, messages: 1_318 },
    sendingEnabled: true,
  }),
};

/** Linked, while WhatsApp is not reachable: agents can still read the chats on this computer. */
export const Offline: Story = {
  args: args({
    state: "connected",
    account: ACCOUNT,
    history: { chats: 42, messages: 1_318 },
    error: "WhatsApp is not reachable now. OpenBot tries again. Agents can still read the chats on this computer.",
  }),
};

/** The connection of a joined server. */
export const Host: Story = {
  args: {
    ...args({ state: "connected", account: ACCOUNT, history: { chats: 42, messages: 1_318 } }),
    hostName: "Office server",
  },
};
