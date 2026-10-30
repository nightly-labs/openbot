import {
  type AgentProviderId,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  type ProviderAccountStatus,
  type ProviderUsageResetOutcome,
  type ProviderUsageResets,
} from "@openbot/contracts/ipc";
import { CLAUDE_API_KEY_ACCOUNT_ID } from "@openbot/contracts/team-protocol/claude-api-key-v1";
import type { AppTranslate } from "@openbot/i18n";

/** One account of a provider row, with the agents that use it. */
export interface ProviderPickerAccount extends ProviderAccountStatus {
  usedBy?: readonly string[] | undefined;
}

/**
 * The account actions of the computer that runs the providers. Each answer is the new status; a
 * rejection is shown beside the account.
 */
export interface ProviderAccountActions {
  /** Signs a new account in when `accountId` is null, or signs that account in again. */
  connect: (provider: AgentProviderId, accountId: string | null) => Promise<void>;
  /** Stops a `connecting` account's sign-in. A new account goes; another one shows as signed out. */
  cancel: (provider: AgentProviderId, accountId: string) => Promise<void>;
  /** A null label returns the account to its email. */
  rename: (provider: AgentProviderId, accountId: string, label: string | null) => Promise<void>;
  /** Removes the account and its credentials. Its agents move to the provider's first account. */
  remove: (provider: AgentProviderId, accountId: string) => Promise<void>;
  /**
   * The usage reset credits of each connected account of a provider that gives them. Absent where
   * the computer that runs the providers cannot spend one.
   */
  usageResets?: ((provider: AgentProviderId) => Promise<readonly ProviderUsageResets[]>) | undefined;
  /** Spends one usage reset credit of an account, and answers what the provider did. */
  resetUsage?: ((provider: AgentProviderId, accountId: string) => Promise<ProviderUsageResetOutcome>) | undefined;
  /**
   * Signs the provider's own sign-in out. Its agents wait until it connects again. Absent where the
   * computer that runs the providers cannot.
   */
  signOut?: ((provider: AgentProviderId) => Promise<void>) | undefined;
  /** True for this computer's providers, whose own sign-in a terminal CLI shares. */
  local?: boolean | undefined;
}

/** The name an account shows: the user's name for it, its email, "API key", or its place in the list. */
export function providerAccountName(
  t: AppTranslate,
  accounts: readonly Pick<ProviderAccountStatus, "id" | "label" | "email">[],
  accountId: string,
): string {
  const index = Math.max(
    0,
    accounts.findIndex((account) => account.id === accountId),
  );
  const account = accounts[index];
  return (
    account?.label ||
    account?.email ||
    (account && isApiKeyAccount(account.id) ? t("provider.account.apiKey") : null) ||
    t("provider.account.numbered", { number: index + 1 })
  );
}

/** Whether an agent's account is this one. An agent with no account uses the provider's first. */
export function isAgentAccount(agentAccountId: string | undefined | null, accountId: string): boolean {
  return (agentAccountId || DEFAULT_PROVIDER_ACCOUNT_ID) === accountId;
}

/** Whether the account is the one of the saved Claude key: it has no sign-in and no plan usage. */
export function isApiKeyAccount(accountId: string): boolean {
  return accountId === CLAUDE_API_KEY_ACCOUNT_ID;
}
