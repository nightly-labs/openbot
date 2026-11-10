import {
  type NearPendingPayment,
  type NearWalletDesktopApi,
  type NearWalletStatus,
  NO_NEAR_WALLET,
} from "@openbot/contracts/ipc";
import { NearPaymentCard } from "@openbot/ui/features/vault/NearPaymentCard";
import { NearSetupDialog, VaultNearWalletPage } from "@openbot/ui/features/vault/VaultNearWallet";
import { onSettled } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createNearWalletStore } from "../src/features/vault/stores/near-wallet-store";
import { createVaultStore } from "../src/features/vault/stores/vault-store";
import { STORY_AGENTS } from "../src/preview/fixtures";
import { ServerSettingsStory, serverSettingsArgs } from "./server-settings-story";

const DAY_MS = 24 * 60 * 60_000;

const PAYMENT: NearPendingPayment = {
  requestId: "approval-1",
  threadId: "main",
  agentId: STORY_AGENTS[0]?.id ?? "agent",
  domain: "api.exa.ai",
  recipient: "exa.near",
  amount: "0.40",
  symbol: "USDC",
  amountUsd: 0.4,
  reason: "Search credits for the source check",
  overLimit: false,
};

const READY: NearWalletStatus = {
  state: "ready",
  account: {
    accountId: "7f3c2a9e41b8d6c05e12f4a3b7c9d8e1f0a2b4c6d8e0f1a3b5c7d9e1f2a4b6c8",
    ownerMethod: "passkey",
    ownerApproval: false,
    dailyBudgetUsd: "25",
    spentTodayUsd: "4.20",
    policyChangeAvailableAt: null,
    grantExpiresAt: new Date(Date.now() + 30 * DAY_MS).toISOString(),
  },
  balances: [
    { assetId: "nep141:usdc.near", symbol: "USDC", amount: "42.50", usd: "42.50" },
    { assetId: "nep141:wrap.near", symbol: "NEAR", amount: "3.2", usd: "9.60" },
  ],
  depositAssets: [
    { assetId: "nep141:usdc.near", symbol: "USDC", blockchain: "near" },
    { assetId: "nep141:wrap.near", symbol: "NEAR", blockchain: "near" },
  ],
  agentIds: STORY_AGENTS.slice(0, 2).map((agent) => agent.id),
  rules: [
    { domain: "api.exa.ai", recipients: ["exa.near"], dailyUsd: 10, spentTodayUsd: 4.2 },
    { domain: "api.firecrawl.dev", recipients: ["firecrawl.near"], dailyUsd: 5, spentTodayUsd: 0 },
  ],
  payments: [PAYMENT],
  signing: null,
  error: null,
};

/** Each change applies at once, as if the owner signed in the browser. */
function storyNearApi(initial: NearWalletStatus): NearWalletDesktopApi {
  let status = structuredClone(initial);
  const listeners = new Set<(status: NearWalletStatus) => void>();
  const set = (change: Partial<NearWalletStatus>) => {
    status = { ...status, ...change, error: null };
    for (const listener of listeners) listener(structuredClone(status));
    return structuredClone(status);
  };
  const account = (change: Partial<NonNullable<NearWalletStatus["account"]>>) =>
    status.account ? { account: { ...status.account, ...change } } : {};
  return {
    status: async () => structuredClone(status),
    setKey: async () => set({ state: "no-wallet" }),
    create: async ({ agentIds }) => set({ ...READY, agentIds, payments: [] }),
    setBudget: async ({ dailyBudgetUsd }) => set(account({ dailyBudgetUsd })),
    setAgents: async ({ agentIds }) => set({ agentIds }),
    renewGrant: async () => set(account({ grantExpiresAt: new Date(Date.now() + 30 * DAY_MS).toISOString() })),
    freeze: async () => set({ state: "frozen" }),
    unfreeze: async () => set({ state: "ready" }),
    deposit: async () => ({ address: READY.account?.accountId ?? "", memo: null, minAmount: "1", expiresAt: null }),
    saveRule: async (rule) =>
      set({ rules: [...status.rules.filter((item) => item.domain !== rule.domain), { ...rule, spentTodayUsd: 0 }] }),
    removeRule: async ({ domain }) => set({ rules: status.rules.filter((item) => item.domain !== domain) }),
    allowPayment: async () => set({}),
    openSigning: async () => undefined,
    cancelSigning: async () => set({ signing: null }),
    disconnect: async () => set(structuredClone(NO_NEAR_WALLET)),
    onChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** A store on the story API, loaded before the first paint. */
function storyStore(initial: NearWalletStatus) {
  const api = storyNearApi(initial);
  const store = createNearWalletStore(() => api);
  onSettled(() => {
    const stop = store.subscribe();
    void store.refresh();
    return stop;
  });
  return store;
}

function WalletPageView(props: { status: NearWalletStatus }) {
  const store = storyStore(props.status);
  return (
    <main style={{ width: "100%", "max-width": "720px" }}>
      <VaultNearWalletPage status={store.state.status} agents={STORY_AGENTS} actions={store.actions} />
    </main>
  );
}

function InVault(props: { status: NearWalletStatus }) {
  const near = storyStore(props.status);
  const store = createVaultStore({
    list: async () => ({ status: "ready", items: [] }),
    save: async () => ({ status: "ready", items: [] }),
    remove: async () => ({ status: "ready", items: [] }),
    reveal: async () => "",
    copy: async () => undefined,
    reset: async () => ({ status: "ready", items: [] }),
    codes: async () => ({ codes: [] }),
    onChanged: () => () => undefined,
  });
  return (
    <ServerSettingsStory
      settings={{
        ...serverSettingsArgs(),
        initialSection: "vault",
        vault: { store, apiKeys: true, twoStep: true, near, nearAgents: () => STORY_AGENTS },
      }}
    />
  );
}

function Setup() {
  const store = storyStore(NO_NEAR_WALLET);
  return <NearSetupDialog status={store.state.status} agents={STORY_AGENTS} actions={store.actions} onClose={fn()} />;
}

function PaymentCard(props: { payment: NearPendingPayment; status: NearWalletStatus }) {
  const store = storyStore(props.status);
  return (
    <main style={{ width: "100%", "max-width": "720px" }}>
      <NearPaymentCard
        payment={props.payment}
        status={store.state.status}
        actions={store.actions}
        onApprove={fn(async () => true)}
        onReject={fn(async () => true)}
      />
    </main>
  );
}

const meta = {
  title: "Vault/NEAR wallet",
  parameters: { layout: "padded", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The Crypto tab of the Vault on this computer. The row opens the wallet page. */
export const Vault: Story = {
  parameters: { layout: "fullscreen" },
  render: () => <InVault status={READY} />,
};

/** The Crypto tab before the user connects a wallet. Connect opens the guided setup. */
export const VaultNotConnected: Story = {
  parameters: { layout: "fullscreen" },
  render: () => <InVault status={NO_NEAR_WALLET} />,
};

/** The guided setup, from the partner key to the first funds. */
export const GuidedSetup: Story = { render: () => <Setup /> };

/** The wallet page: funds, the daily budget, the domains that agents pay without asking, and the agents. */
export const WalletPage: Story = { render: () => <WalletPageView status={READY} /> };

/** Payments are paused. Resume starts them again. */
export const WalletPagePaused: Story = { render: () => <WalletPageView status={{ ...READY, state: "frozen" }} /> };

/** A change waits for the owner's signature in the browser. */
export const WalletPageSigning: Story = {
  render: () => <WalletPageView status={{ ...READY, signing: { action: "budget", requestId: null } }} />,
};

/** The grant of the agent key ended. Renew asks the owner to sign again. */
export const WalletPageGrantEnded: Story = {
  render: () => <WalletPageView status={{ ...READY, account: null }} />,
};

/** A payment in the chat. "Always allow" lets agents pay this domain up to a daily limit. */
export const Payment: Story = { render: () => <PaymentCard payment={PAYMENT} status={READY} /> };

/** A payment over the daily limit of its domain: the owner approves it once. */
export const PaymentOverLimit: Story = {
  render: () => <PaymentCard payment={{ ...PAYMENT, overLimit: true }} status={READY} />,
};

/** The owner signs the payment in the browser. */
export const PaymentSigning: Story = {
  render: () => (
    <PaymentCard
      payment={PAYMENT}
      status={{ ...READY, signing: { action: "auto-pay", requestId: PAYMENT.requestId } }}
    />
  ),
};
