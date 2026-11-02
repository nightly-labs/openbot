import type { VaultItemSummary } from "@openbot/contracts/ipc";
import { VaultPanel } from "@openbot/ui/features/vault/VaultPanel";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const ITEMS: VaultItemSummary[] = [
  {
    id: "login-github",
    kind: "login",
    website: "github.com",
    username: "ada@example.com",
    notes: "",
    hasPassword: true,
  },
  {
    id: "login-linear",
    kind: "login",
    website: "https://linear.app",
    username: "ada",
    notes: "Team workspace",
    hasPassword: true,
  },
  { id: "login-router", kind: "login", website: "192.168.1.1", username: "admin", notes: "", hasPassword: false },
  {
    id: "card-company",
    kind: "card",
    label: "Company card",
    nameOnCard: "Ada Lovelace",
    brand: "visa",
    last4: "4242",
    expMonth: 8,
    expYear: 2029,
    billingContactId: "contact-office",
    fillSites: ["https://shop.example", "https://checkout.example.org"],
  },
  {
    id: "card-travel",
    kind: "card",
    label: "",
    nameOnCard: "Ada Lovelace",
    brand: "mastercard",
    last4: "4444",
    expMonth: 1,
    expYear: 2028,
    billingContactId: null,
    fillSites: [],
  },
  {
    id: "contact-office",
    kind: "contact",
    label: "Office",
    fullName: "Ada Lovelace",
    address: "12 Example Street",
    address2: "",
    city: "London",
    region: "",
    postalCode: "N1 9GU",
    country: "GB",
    phone: "+44 20 7946 0000",
    email: "ada@example.com",
    addedBy: "Atlas",
  },
  {
    id: "key-openai",
    kind: "apiKey",
    name: "OPENAI_API_KEY",
    notes: "Project billing account",
    hasKey: true,
  },
  { id: "key-stripe", kind: "apiKey", name: "STRIPE_SECRET_KEY", notes: "", hasKey: true },
];

const meta = {
  title: "Settings/VaultPanel",
  component: VaultPanel,
  args: {
    state: { status: "ready", items: ITEMS },
    apiKeys: true,
    onSave: fn(async () => undefined),
    onDelete: fn(async () => undefined),
    onReveal: fn(async () => "correct-horse-battery"),
    onCopy: fn(async () => undefined),
    onCopyText: fn(async () => undefined),
    onImportCsv: fn(async () => ({ imported: 3, skipped: 1, state: { status: "ready" as const, items: ITEMS } })),
    onReset: fn(async () => undefined),
  },
  parameters: { layout: "padded", a11y: { test: "error" } },
} satisfies Meta<typeof VaultPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Logins, cards, contact info and API keys, with the filter tabs and search. */
export const Ready: Story = {};

/** Nothing is saved yet. */
export const Empty: Story = { args: { state: { status: "ready", items: [] } } };

/** Linux without a keyring: nothing can be saved. */
export const Unavailable: Story = { args: { state: { status: "unavailable", items: [] } } };

/** The file is there but cannot be decrypted. The user can reset it. */
export const Unreadable: Story = { args: { state: { status: "unreadable", items: [] } } };

/** A joined server, for its owner or admin: the New item menu has no CSV import. */
export const JoinedServer: Story = { args: { onImportCsv: undefined } };

/** A joined server without `vault-v2`: it cannot keep API keys, so the kind and its tab are not offered. */
export const OlderJoinedServer: Story = {
  args: {
    onImportCsv: undefined,
    apiKeys: false,
    state: { status: "ready", items: ITEMS.filter((item) => item.kind !== "apiKey") },
  },
};
