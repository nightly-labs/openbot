import {
  type NearOwnerAction,
  type NearWalletDesktopApi,
  type NearWalletStatus,
  NO_NEAR_WALLET,
} from "@openbot/contracts/ipc";

/** How long the mock waits, as for the owner's signature in the browser. */
const MOCK_SIGNATURE_MS = 2_000;

const MOCK_ACCOUNT_ID = "7f3c2a9e41b8d6c05e12f4a3b7c9d8e1f0a2b4c6d8e0f1a3b5c7d9e1f2a4b6c8";

/** Starts with no key. Each owner action waits a moment, as for a signature, then applies. */
export function createMockNearWallet(): NearWalletDesktopApi {
  let status: NearWalletStatus = structuredClone(NO_NEAR_WALLET);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<(status: NearWalletStatus) => void>();
  const set = (next: NearWalletStatus): NearWalletStatus => {
    status = next;
    for (const listener of listeners) listener(structuredClone(status));
    return structuredClone(status);
  };
  const stopTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  /** Shows the signing state, then applies `change`. */
  const sign = (action: NearOwnerAction, change: (current: NearWalletStatus) => NearWalletStatus) => {
    stopTimer();
    timer = setTimeout(() => {
      timer = null;
      set({ ...change(status), signing: null, error: null });
    }, MOCK_SIGNATURE_MS);
    return set({ ...status, signing: { action, requestId: null }, error: null });
  };
  const withAccount = (current: NearWalletStatus, change: Partial<NonNullable<NearWalletStatus["account"]>>) =>
    current.account ? { ...current, account: { ...current.account, ...change } } : current;
  return {
    status: async () => structuredClone(status),
    setKey: async () => set({ ...status, state: "no-wallet", error: null }),
    create: async (input) =>
      sign("create", (current) => ({
        ...current,
        state: "ready",
        agentIds: input.agentIds,
        account: {
          accountId: MOCK_ACCOUNT_ID,
          ownerMethod: input.ownerMethod,
          ownerApproval: true,
          dailyBudgetUsd: input.dailyBudgetUsd,
          spentTodayUsd: "0",
          policyChangeAvailableAt: null,
          grantExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
        },
        balances: [{ assetId: "nep141:usdc.near", symbol: "USDC", amount: "0", usd: "0.00" }],
        depositAssets: [
          { assetId: "nep141:usdc.near", symbol: "USDC", blockchain: "near" },
          { assetId: "nep141:wrap.near", symbol: "NEAR", blockchain: "near" },
        ],
      })),
    setBudget: async ({ dailyBudgetUsd }) => sign("budget", (current) => withAccount(current, { dailyBudgetUsd })),
    setAgents: async ({ agentIds }) => set({ ...status, agentIds }),
    renewGrant: async () =>
      sign("grant", (current) =>
        withAccount(current, { grantExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString() }),
      ),
    freeze: async () => sign("freeze", (current) => ({ ...current, state: "frozen" })),
    unfreeze: async () => sign("unfreeze", (current) => ({ ...current, state: "ready" })),
    deposit: async () => ({ address: MOCK_ACCOUNT_ID, memo: null, minAmount: null, expiresAt: null }),
    saveRule: async (input) => {
      const save = (current: NearWalletStatus): NearWalletStatus => ({
        ...withAccount(current, { ownerApproval: false }),
        rules: [...current.rules.filter((rule) => rule.domain !== input.domain), { ...input, spentTodayUsd: 0 }],
      });
      return status.account?.ownerApproval ? sign("auto-pay", save) : set(save(status));
    },
    removeRule: async ({ domain }) => set({ ...status, rules: status.rules.filter((rule) => rule.domain !== domain) }),
    allowPayment: async ({ requestId, dailyUsd }) => {
      const payment = status.payments.find((candidate) => candidate.requestId === requestId);
      if (!payment) return structuredClone(status);
      const allow = (current: NearWalletStatus): NearWalletStatus => {
        const rule = current.rules.find((candidate) => candidate.domain === payment.domain);
        const recipients = [...new Set([...(rule?.recipients ?? []), payment.recipient])];
        return {
          ...withAccount(current, { ownerApproval: false }),
          rules: [
            ...current.rules.filter((candidate) => candidate.domain !== payment.domain),
            { domain: payment.domain, recipients, dailyUsd, spentTodayUsd: rule?.spentTodayUsd ?? 0 },
          ],
        };
      };
      return status.account?.ownerApproval ? sign("auto-pay", allow) : set(allow(status));
    },
    openSigning: async () => {},
    cancelSigning: async () => {
      stopTimer();
      return set({ ...status, signing: null });
    },
    disconnect: async () => {
      stopTimer();
      return set(structuredClone(NO_NEAR_WALLET));
    },
    onChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
