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

export interface ProviderPickerAccount extends ProviderAccountStatus {
  usedBy?: readonly string[] | undefined;
}

export interface ProviderAccountActions {
  connect: (provider: AgentProviderId, accountId: string | null) => Promise<void>;
  connectKey?: ((provider: AgentProviderId, accountId: string | null, key: string) => Promise<void>) | undefined;
  connectWithCode?: ((provider: AgentProviderId, accountId: string | null) => Promise<void>) | undefined;
  pasteCodeSignIn?: boolean | undefined;
  cancel: (provider: AgentProviderId, accountId: string) => Promise<void>;
  rename: (provider: AgentProviderId, accountId: string, label: string | null) => Promise<void>;
  remove: (provider: AgentProviderId, accountId: string) => Promise<void>;
  usageResets?: ((provider: AgentProviderId) => Promise<readonly ProviderUsageResets[]>) | undefined;
  resetUsage?: ((provider: AgentProviderId, accountId: string) => Promise<ProviderUsageResetOutcome>) | undefined;
  signOut?: ((provider: AgentProviderId) => Promise<void>) | undefined;
  setPool?: ((provider: AgentProviderId, enabled: boolean, leftOut: readonly string[]) => Promise<void>) | undefined;
  setLiveVoiceAccount?: ((accountId: string | null) => Promise<void>) | undefined;
  maxAccounts?: number | undefined;
  local?: boolean | undefined;
}

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

export function isAgentAccount(agentAccountId: string | undefined | null, accountId: string): boolean {
  return (agentAccountId || DEFAULT_PROVIDER_ACCOUNT_ID) === accountId;
}

export function isApiKeyAccount(accountId: string, provider?: string): boolean {
  return (
    accountId === CLAUDE_API_KEY_ACCOUNT_ID || (provider !== undefined && isProviderKeyAccount(provider, accountId))
  );
}

export function hasKeyAccounts(provider: string): boolean {
  return isAgentProvider(provider) && agentProviderDescriptor(provider).accountSignIn === "key";
}

export function accountCodeSignInOffered(provider: string, actions: ProviderAccountActions | undefined): boolean {
  if (!actions?.connectWithCode || !isAgentProvider(provider)) return false;
  const codeSignIn = agentProviderDescriptor(provider).accountCodeSignIn;
  return codeSignIn === "device" || (codeSignIn === "paste" && actions.pasteCodeSignIn === true);
}

export function isProviderKeyAccount(provider: string, accountId: string): boolean {
  return accountId !== DEFAULT_PROVIDER_ACCOUNT_ID && hasKeyAccounts(provider);
}

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
