import {
  type NearDepositAddress,
  type NearOwnerAction,
  type NearPendingPayment,
  type NearWalletDesktopApi,
  type NearWalletStatus,
  NO_NEAR_WALLET,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { NearPaymentCard } from "@openbot/ui/features/vault/NearPaymentCard";
import { NearAddFundsDialog, NearSetupDialog, VaultNearWalletPage } from "@openbot/ui/features/vault/VaultNearWallet";
import { onSettled } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createNearWalletStore } from "../src/features/vault/stores/near-wallet-store";
import { createVaultStore } from "../src/features/vault/stores/vault-store";
import { STORY_AGENTS } from "../src/preview/fixtures";
import { STORY_DEPOSIT_ASSETS } from "./near-deposit-assets";
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
  depositAssets: STORY_DEPOSIT_ASSETS,
  allAgents: false,
  agentIds: STORY_AGENTS.slice(0, 2).map((agent) => agent.id),
  rules: [
    { domain: "api.exa.ai", recipients: ["exa.near"], dailyUsd: 10, spentTodayUsd: 4.2 },
    { domain: "api.firecrawl.dev", recipients: ["firecrawl.near"], dailyUsd: 5, spentTodayUsd: 0 },
  ],
  payments: [PAYMENT],
  signing: null,
  ownerBackup: { state: "notSynced", checkedAt: new Date(Date.now() - DAY_MS).toISOString() },
  error: null,
};

const STORY_ADDRESSES: Readonly<Record<string, string>> = {
  btc: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
  near: "4f1d7a3e9b2c8d6f0a5e7c1b3d9f2a6e8c4b0d7f1e3a5c9b2d6f8e0a4c7b1d3f",
  sol: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  stellar: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
  ton: "UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG",
  tron: "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7",
  xrp: "rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh",
};

function storyDepositAddress(assetId: string): Promise<NearDepositAddress> {
  const blockchain = STORY_DEPOSIT_ASSETS.find((asset) => asset.assetId === assetId)?.blockchain ?? "eth";
  const memo = blockchain === "stellar" || blockchain === "xrp" ? "2048117" : null;
  return Promise.resolve({
    address: STORY_ADDRESSES[blockchain] ?? "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
    memo,
    minAmount: "1",
    expiresAt: null,
  });
}

type SetupStory = { deviceOnly?: boolean; waitAt?: NearOwnerAction; stopAt?: NearOwnerAction };

function stopSigning(set: (change: Partial<NearWalletStatus>) => NearWalletStatus, action: NearOwnerAction) {
  const status = set({ signing: { action, requestId: null } });
  return { ...status, signing: null, error: sourceText("error.connector.nearSigningCanceled") };
}

function storyNearApi(initial: NearWalletStatus, setup: SetupStory = {}): NearWalletDesktopApi {
  const { deviceOnly = false, waitAt, stopAt } = setup;
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
    create: async ({ passkey }) => {
      if (waitAt) return new Promise<NearWalletStatus>(() => set({ signing: { action: waitAt, requestId: null } }));
      if (stopAt) return stopSigning(set, stopAt);
      if (deviceOnly && passkey !== "keep") {
        return set({ state: "no-wallet", ownerBackup: { state: "deviceOnly", checkedAt: new Date().toISOString() } });
      }
      return set({ ...READY, allAgents: true, agentIds: [], payments: [] });
    },
    setBudget: async ({ dailyBudgetUsd }) => set(account({ dailyBudgetUsd })),
    setAgents: async ({ allAgents, agentIds }) => set({ allAgents, agentIds }),
    renewGrant: async () => set(account({ grantExpiresAt: new Date(Date.now() + 30 * DAY_MS).toISOString() })),
    freeze: async () => set({ state: "frozen" }),
    unfreeze: async () => set({ state: "ready" }),
    deposit: async ({ assetId }) => storyDepositAddress(assetId),
    saveRule: async (rule) =>
      set({ rules: [...status.rules.filter((item) => item.domain !== rule.domain), { ...rule, spentTodayUsd: 0 }] }),
    removeRule: async ({ domain }) => set({ rules: status.rules.filter((item) => item.domain !== domain) }),
    allowPayment: async () => set({}),
    openSigning: async () => undefined,
    cancelSigning: async () => set({ signing: null }),
    checkBackup: async () => set({ ownerBackup: { state: "synced", checkedAt: new Date().toISOString() } }),
    disconnect: async () => set(structuredClone(NO_NEAR_WALLET)),
    onChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function storyStore(initial: NearWalletStatus, setup: SetupStory = {}) {
  const api = storyNearApi(initial, setup);
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

function Setup(props: SetupStory) {
  const store = storyStore(NO_NEAR_WALLET, props);
  return <NearSetupDialog status={store.state.status} actions={store.actions} onClose={fn()} />;
}

function AddFundsView(props: { status: NearWalletStatus }) {
  const store = storyStore(props.status);
  return <NearAddFundsDialog status={store.state.status} actions={store.actions} onClose={fn()} />;
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

export const Vault: Story = {
  parameters: { layout: "fullscreen" },
  render: () => <InVault status={READY} />,
};

export const VaultNotConnected: Story = {
  parameters: { layout: "fullscreen" },
  render: () => <InVault status={NO_NEAR_WALLET} />,
};

export const VaultSignedOut: Story = {
  parameters: { layout: "fullscreen" },
  render: () => <InVault status={{ ...NO_NEAR_WALLET, state: "signed-out" }} />,
};

export const GuidedSetup: Story = { render: () => <Setup /> };

export const GuidedSetupDeviceOnlyPasskey: Story = { render: () => <Setup deviceOnly /> };

export const GuidedSetupSigning: Story = {
  render: () => <Setup waitAt="create" />,
};

export const GuidedSetupStopped: Story = {
  render: () => <Setup stopAt="create" />,
};

export const AddFunds: Story = { render: () => <AddFundsView status={READY} /> };

export const WalletPage: Story = { render: () => <WalletPageView status={READY} /> };

export const WalletPagePaused: Story = { render: () => <WalletPageView status={{ ...READY, state: "frozen" }} /> };

export const WalletPageSigning: Story = {
  render: () => <WalletPageView status={{ ...READY, signing: { action: "budget", requestId: null } }} />,
};

export const WalletPageGrantEnded: Story = {
  render: () => <WalletPageView status={{ ...READY, account: null }} />,
};

export const Payment: Story = { render: () => <PaymentCard payment={PAYMENT} status={READY} /> };

export const PaymentOverLimit: Story = {
  render: () => <PaymentCard payment={{ ...PAYMENT, overLimit: true }} status={READY} />,
};

export const PaymentSigning: Story = {
  render: () => (
    <PaymentCard
      payment={PAYMENT}
      status={{ ...READY, signing: { action: "auto-pay", requestId: PAYMENT.requestId } }}
    />
  ),
};
