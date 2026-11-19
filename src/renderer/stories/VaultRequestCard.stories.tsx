import type { VaultItemKind, VaultSaveInput } from "@openbot/contracts/ipc";
import { cardBrand, vaultExpiryText } from "@openbot/contracts/ipc";
import { UI_API_KEY_SCOPE_FIELD_ID, type UiBlockStatus, type UiVaultSavedItem } from "@openbot/contracts/ui-blocks";
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
  apiKey: {
    title: "Token for the CRM sync",
    prefill: { name: "CRM_API_TOKEN" },
  },
} satisfies Record<VaultItemKind, { title: string; prefill: Record<string, string> }>;

const API_KEY_SCOPE = {
  label: "Save for",
  options: ["All agents (Vault)", "Only this agent"],
  value: "All agents (Vault)",
};

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

function Request(props: {
  kind: VaultItemKind;
  status?: UiBlockStatus;
  saved?: UiVaultSavedItem;
  values?: Record<string, string>;
}) {
  const [status, setStatus] = createSignal<UiBlockStatus>(props.status ?? "pending");
  const [saved, setSaved] = createSignal(props.saved);
  const [values, setValues] = createSignal(props.values);
  const scope = () => (props.kind === "apiKey" ? API_KEY_SCOPE : undefined);
  const keyPlaceholder = () => (props.kind === "apiKey" ? "crm_live_…" : undefined);
  return (
    <VaultRequestCard
      kind={props.kind}
      title={REQUESTS[props.kind].title}
      agentName="Atlas"
      prefill={REQUESTS[props.kind].prefill}
      scope={scope()}
      keyPlaceholder={keyPlaceholder()}
      status={status()}
      saved={saved()}
      values={values()}
      onSave={async (input, scope) => {
        if (input.kind === "apiKey") setValues({ [UI_API_KEY_SCOPE_FIELD_ID]: scope ?? API_KEY_SCOPE.value });
        else {
          const result = savedFrom(input);
          setSaved(result.saved);
          setValues(result.values);
        }
        setStatus("answered");
      }}
      onSkip={() => setStatus("closed")}
    />
  );
}

export const Card: Story = { render: () => <Request kind="card" /> };

export const Address: Story = { render: () => <Request kind="contact" /> };

export const Login: Story = { render: () => <Request kind="login" /> };

export const ApiKey: Story = { render: () => <Request kind="apiKey" /> };

export const ApiKeySaved: Story = {
  render: () => <Request kind="apiKey" status="answered" values={{ [UI_API_KEY_SCOPE_FIELD_ID]: "Only this agent" }} />,
};

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

export const NotNow: Story = { render: () => <Request kind="card" status="closed" /> };
