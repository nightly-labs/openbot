import type { VaultSaveInput } from "@openbot/contracts/ipc";
import { cardBrand, vaultExpiryText } from "@openbot/contracts/ipc";
import type { UiBlockStatus, UiVaultRequestKind, UiVaultSavedItem } from "@openbot/contracts/ui-blocks";
import { VaultRequestCard } from "@openbot/ui/features/vault/VaultRequestCard";
import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "Conversation/VaultRequestCard",
  parameters: { a11y: { test: "error" } },
  decorators: [
    (Story) => (
      <main class="foundation-story">
        <Story />
      </main>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const REQUESTS = {
  card: {
    title: "Card for the Lisbon hotel booking",
    prefill: { label: "Travel card", nameOnCard: "Ada Lovelace" },
  },
  contact: {
    title: "Delivery address for the standing desk",
    prefill: { label: "Home", fullName: "Ada Lovelace", city: "Lisbon", country: "PT" },
  },
  login: {
    title: "Login for the Hetzner console",
    prefill: { website: "https://console.hetzner.com", username: "ada@example.com" },
  },
} satisfies Record<UiVaultRequestKind, { title: string; prefill: Record<string, string> }>;

/** The item and its summary values, as the host stores them: no secret value. */
function savedFrom(input: VaultSaveInput): { saved: UiVaultSavedItem; values: Record<string, string> } {
  switch (input.kind) {
    case "card": {
      const digits = (input.number ?? "").replace(/\D/gu, "");
      const brand = cardBrand(digits);
      return {
        saved: {
          id: "card-new",
          name: input.label || input.nameOnCard,
          ...(brand ? { brand } : {}),
          last4: digits.slice(-4),
        },
        values: { label: input.label, expiry: vaultExpiryText(input.expMonth, input.expYear) },
      };
    }
    case "login":
      return {
        saved: { id: "login-new", name: input.website },
        values: { website: input.website, username: input.username },
      };
    case "contact":
      return {
        saved: { id: "contact-new", name: input.label || input.fullName },
        values: { fullName: input.fullName, address: input.address, city: input.city, postalCode: input.postalCode },
      };
    case "apiKey":
      return { saved: { id: "key-new", name: input.name }, values: {} };
  }
}

/** A request that the dialog saves and the Not now button closes, as in the chat. */
function Request(props: {
  kind: UiVaultRequestKind;
  status?: UiBlockStatus;
  saved?: UiVaultSavedItem;
  values?: Record<string, string>;
}) {
  const [status, setStatus] = createSignal<UiBlockStatus>(props.status ?? "pending");
  const [saved, setSaved] = createSignal(props.saved);
  const [values, setValues] = createSignal(props.values);
  return (
    <VaultRequestCard
      kind={props.kind}
      title={REQUESTS[props.kind].title}
      agentName="Atlas"
      prefill={REQUESTS[props.kind].prefill}
      status={status()}
      saved={saved()}
      values={values()}
      onSave={async (input) => {
        const result = savedFrom(input);
        setSaved(result.saved);
        setValues(result.values);
        setStatus("answered");
      }}
      onSkip={() => setStatus("closed")}
    />
  );
}

/** The agent asks for a card. It filled in the label and the name; the user types the rest. */
export const Card: Story = { render: () => <Request kind="card" /> };

/** The agent asks for an address. */
export const Address: Story = { render: () => <Request kind="contact" /> };

/** The agent asks for a login. It filled in the site and the username. */
export const Login: Story = { render: () => <Request kind="login" /> };

/** The user saved the card. The row shows the item, not the request. */
export const Saved: Story = {
  render: () => (
    <Request
      kind="card"
      status="answered"
      saved={{ id: "card-travel", name: "Travel card", brand: "visa", last4: "4242" }}
      values={{ label: "Travel card", expiry: "08/29" }}
    />
  ),
};

/** The user chose Not now. */
export const NotNow: Story = { render: () => <Request kind="card" status="closed" /> };
