import type { VaultItemSummary, VaultTwoStepCodes } from "@openbot/contracts/ipc";
import { parseTwoStepKey, twoStepCode, twoStepRemainingMs } from "@openbot/contracts/two-step-code";
import { VaultPanel } from "@openbot/ui/features/vault/VaultPanel";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { MANY_AGENTS } from "./marketplace-story-support";

/** The ids of the first agents of the server, for the items that only some agents can use. */
const chosen = (count: number) => MANY_AGENTS.slice(0, count).map((agent) => agent.id);

const ITEMS: VaultItemSummary[] = [
  {
    id: "login-github",
    kind: "login",
    website: "github.com",
    username: "ada@example.com",
    notes: "",
    hasPassword: true,
    hasTwoStep: true,
    agents: chosen(3),
  },
  {
    id: "login-linear",
    kind: "login",
    website: "https://linear.app",
    username: "ada",
    notes: "Team workspace",
    hasPassword: true,
    hasTwoStep: true,
  },
  {
    id: "login-router",
    kind: "login",
    website: "192.168.1.1",
    username: "admin",
    notes: "",
    hasPassword: false,
    hasTwoStep: false,
  },
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
  { id: "key-stripe", kind: "apiKey", name: "STRIPE_SECRET_KEY", notes: "", hasKey: true, agents: chosen(1) },
];

/** Demo keys. In the app, main makes the codes and the keys never come to the window. */
const DEMO_KEYS: Readonly<Record<string, string>> = {
  "login-github": "JBSWY3DPEHPK3PXP",
  "login-linear": "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
};

async function demoCodes(): Promise<VaultTwoStepCodes> {
  const at = Date.now();
  const codes = await Promise.all(
    Object.entries(DEMO_KEYS).map(async ([id, text]) => {
      const key = parseTwoStepKey(text);
      if (!key) throw new Error(`Invalid demo key for ${id}.`);
      return {
        id,
        code: await twoStepCode(key, at),
        period: key.period,
        remainingMs: twoStepRemainingMs(key.period, at),
      };
    }),
  );
  return { codes };
}

const meta = {
  title: "Settings/VaultPanel",
  component: VaultPanel,
  args: {
    state: { status: "ready", items: ITEMS, agentScope: true },
    apiKeys: true,
    agents: MANY_AGENTS,
    onSave: fn(async () => undefined),
    onDelete: fn(async () => undefined),
    onReveal: fn(async () => "correct-horse-battery"),
    onCopy: fn(async () => undefined),
    onCopyText: fn(async () => undefined),
    onCodes: fn(demoCodes),
    onImportCsv: fn(async () => ({ imported: 3, skipped: 1, state: { status: "ready" as const, items: ITEMS } })),
    onReset: fn(async () => undefined),
  },
  parameters: { layout: "padded", a11y: { test: "error" } },
} satisfies Meta<typeof VaultPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Logins, cards, contact info and API keys, with the filter tabs, search, and the agents of each item. */
export const Ready: Story = {};

/** A server that does not keep the agents of an item: each item is for every agent, with no choice. */
export const WithoutAgentChoice: Story = { args: { state: { status: "ready", items: ITEMS } } };

/** Nothing is saved yet. */
export const Empty: Story = { args: { state: { status: "ready", items: [] } } };

/** Linux without a keyring: nothing can be saved. */
export const Unavailable: Story = { args: { state: { status: "unavailable", items: [] } } };

/** The file is there but cannot be decrypted. The user can reset it. */
export const Unreadable: Story = { args: { state: { status: "unreadable", items: [] } } };

/** A joined server, for its owner or admin: the New item menu has no CSV import. */
export const JoinedServer: Story = { args: { onImportCsv: undefined } };

/** A joined server without `vault-v3`: it cannot keep two-step keys, so logins show no code. */
export const JoinedServerWithoutTwoStep: Story = { args: { onImportCsv: undefined, onCodes: undefined } };

/** A joined server without `vault-v2`: it cannot keep API keys, so the kind and its tab are not offered. */
export const OlderJoinedServer: Story = {
  args: {
    onImportCsv: undefined,
    onCodes: undefined,
    apiKeys: false,
    state: { status: "ready", items: ITEMS.filter((item) => item.kind !== "apiKey") },
  },
};
