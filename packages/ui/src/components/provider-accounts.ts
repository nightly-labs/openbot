import { agentProviderDescriptor, isAgentProvider } from "@openbot/contracts/agent-providers";
import {
  type AgentProviderId,
  type ClientAgentModelOption,
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
  /**
   * Gives an account of a provider whose accounts are API keys its key: a new account when
   * `accountId` is null. It answers when the provider accepted the key, and rejects with the reason
   * when it did not. Absent where the computer that runs the providers cannot take such a key.
   */
  connectKey?: ((provider: AgentProviderId, accountId: string | null, key: string) => Promise<void>) | undefined;
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
  /**
   * Turns the provider's account pool on or off and sets the accounts that it leaves out. Absent where
   * the computer that runs the providers has no pool.
   */
  setPool?: ((provider: AgentProviderId, enabled: boolean, leftOut: readonly string[]) => Promise<void>) | undefined;
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

/**
 * Whether the account is an API key: it has no sign-in and no plan usage. That is the account of the
 * saved Claude key, and each account after the first of a `provider` whose accounts are keys.
 */
export function isApiKeyAccount(accountId: string, provider?: string): boolean {
  return (
    accountId === CLAUDE_API_KEY_ACCOUNT_ID || (provider !== undefined && isProviderKeyAccount(provider, accountId))
  );
}

/** Whether each account after the first of the provider is one API key (`accountSignIn: "key"`). */
export function hasKeyAccounts(provider: string): boolean {
  return isAgentProvider(provider) && agentProviderDescriptor(provider).accountSignIn === "key";
}

/** Whether the account is one API key of such a provider. The user adds, changes and removes it. */
export function isProviderKeyAccount(provider: string, accountId: string): boolean {
  return accountId !== DEFAULT_PROVIDER_ACCOUNT_ID && hasKeyAccounts(provider);
}

/**
 * A model of a provider: from the list of models, or one that only an account after the first
 * serves. A plan can serve models that the provider's own sign-in does not (#5217).
 */
export function findModelOption(
  options: readonly ClientAgentModelOption[],
  providers: readonly { id: string; accounts?: readonly ProviderAccountStatus[] | undefined }[] | undefined,
  provider: string,
  model: string,
): ClientAgentModelOption | undefined {
  return (
    options.find((option) => option.provider === provider && option.id === model) ??
    providers
      ?.find((status) => status.id === provider)
      ?.accounts?.flatMap((account) => account.models ?? [])
      .find((option) => option.id === model)
  );
}
