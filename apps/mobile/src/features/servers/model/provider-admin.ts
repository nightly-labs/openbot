import {
  type AcpRegistryEntry,
  type AcpRegistryInstallInput,
  type AcpRegistryOperation,
  AGENT_PROVIDERS,
  type AgentModelId,
  type AgentProviderId,
  type AgentProviderStatus,
  type AgentStatus,
  agentProviderDescriptor,
  agentProviderName,
  type ClaudeCompactWindowSetting,
  type CustomAgentResult,
  type CustomAgentSummary,
  type CustomProviderResult,
  type CustomProviderSummary,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  type DownloadableProviderId,
  decodeRegistryEntries,
  decodeRegistryInstallResult,
  decodeRegistryOperations,
  type HostProviderAccounts,
  INSTALLER_PROVIDERS,
  isAgentStatus,
  isKeyOnlyProvider,
  isLocalOnlyProvider,
  loopbackCallback,
  MANAGED_RUNTIME_PROVIDERS,
  type PromptCacheTtl,
  type PromptCacheTtlSetting,
  type ProviderAccountCodeLoginStart,
  type ProviderAccountCodeLoginStatus,
  type ProviderApiKeyStatus,
  type ProviderCodeLoginStart,
  type ProviderEnvironment,
  type ProviderEnvironmentProvider,
  type ProviderEnvironmentUpdate,
  type ProviderModelVisibility,
  type ProviderRuntimeSnapshot,
  type ProviderRuntimeStatus,
  type ProviderUsageResetOutcome,
  type ProviderUsageResets,
  type SaveCustomAgentInput,
  type SaveCustomProviderInput,
  type SignInRelayStatus,
  type UpdateCustomProviderInput,
} from "@openbot/contracts/ipc";
import { isOneOf } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { ACP_REGISTRY_CAPABILITY, ACP_REGISTRY_ROUTES } from "@openbot/contracts/team-protocol/acp-registry-v1";
import { CLAUDE_API_KEY_CAPABILITY } from "@openbot/contracts/team-protocol/claude-api-key-v1";
import { CLAUDE_COMPACT_WINDOW_CAPABILITY } from "@openbot/contracts/team-protocol/claude-compact-window-v1";
import { CODEX_API_KEY_CAPABILITY } from "@openbot/contracts/team-protocol/codex-api-key-v1";
import { CUSTOM_AGENTS_CAPABILITY } from "@openbot/contracts/team-protocol/custom-agents-v1";
import {
  CUSTOM_PROVIDER_EDIT_CAPABILITY,
  CUSTOM_PROVIDER_EDIT_ROUTES,
} from "@openbot/contracts/team-protocol/custom-provider-edit-v1";
import {
  CUSTOM_PROVIDER_HARNESS_CAPABILITY,
  CUSTOM_PROVIDER_HARNESS_ROUTES,
} from "@openbot/contracts/team-protocol/custom-provider-harness-v1";
import { DEVIN_CODE_SIGN_IN_CAPABILITY } from "@openbot/contracts/team-protocol/devin-code-sign-in-v1";
import { MISTRAL_CODE_SIGN_IN_CAPABILITY } from "@openbot/contracts/team-protocol/mistral-code-sign-in-v1";
import { MODEL_VISIBILITY_CAPABILITY } from "@openbot/contracts/team-protocol/model-visibility-v1";
import { PROMPT_CACHE_TTL_CAPABILITY } from "@openbot/contracts/team-protocol/prompt-cache-ttl-v1";
import { PROVIDER_ACCOUNT_CODE_CAPABILITY } from "@openbot/contracts/team-protocol/provider-account-code-v1";
import { PROVIDER_ACCOUNT_KEYS_CAPABILITY } from "@openbot/contracts/team-protocol/provider-account-keys-v1";
import { PROVIDER_ACCOUNT_POOL_CAPABILITY } from "@openbot/contracts/team-protocol/provider-account-pool-v1";
import { providerAccountRelay } from "@openbot/contracts/team-protocol/provider-account-relays";
import { PROVIDER_ACCOUNTS_CAPABILITY } from "@openbot/contracts/team-protocol/provider-accounts-v1";
import { PROVIDER_DEFAULT_CAPABILITY } from "@openbot/contracts/team-protocol/provider-default-v1";
import { PROVIDER_ENVIRONMENT_CAPABILITY } from "@openbot/contracts/team-protocol/provider-environment-v1";
import { PROVIDER_SIGN_OUT_CAPABILITY } from "@openbot/contracts/team-protocol/provider-sign-out-v1";
import { PROVIDER_USAGE_RESET_CAPABILITY } from "@openbot/contracts/team-protocol/provider-usage-reset-v1";
import {
  PROVIDERS_ADMIN_CODE_SIGN_IN_PROVIDERS,
  PROVIDERS_ADMIN_ROUTES,
} from "@openbot/contracts/team-protocol/providers-v1";
import {
  PROVIDERS_RUNTIMES_V2_CAPABILITY,
  PROVIDERS_RUNTIMES_V2_ROUTES,
} from "@openbot/contracts/team-protocol/providers-v2";
import {
  PROVIDERS_SIGN_IN_V3_CAPABILITY,
  PROVIDERS_SIGN_IN_V3_PROVIDERS,
  PROVIDERS_SIGN_IN_V3_ROUTES,
} from "@openbot/contracts/team-protocol/providers-v3";
import {
  PROVIDERS_V4_CAPABILITY,
  PROVIDERS_V4_ROUTES,
  PROVIDERS_V4_RUNTIME_PROVIDERS,
  PROVIDERS_V4_SIGN_IN_PROVIDERS,
} from "@openbot/contracts/team-protocol/providers-v4";
import {
  PROVIDERS_V5_CAPABILITY,
  PROVIDERS_V5_ROUTES,
  PROVIDERS_V5_RUNTIME_PROVIDERS,
} from "@openbot/contracts/team-protocol/providers-v5";
import { PROVIDERS_V8_CAPABILITY, PROVIDERS_V8_ROUTES } from "@openbot/contracts/team-protocol/providers-v8";
import { SIGN_IN_RELAY_CAPABILITY, SIGN_IN_RELAY_PROVIDERS } from "@openbot/contracts/team-protocol/sign-in-relay-v1";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import {
  cancelProviderAccountCodeLogin,
  cancelProviderCodeLogin,
  cancelProviderRuntime,
  cancelProviderSignInRelay,
  checkProviderRuntimeUpdates,
  clearProviderApiKey,
  completeSignInRelay,
  connectProviderAccountKey,
  deleteCustomAgent,
  deleteCustomProvider,
  downloadProviderRuntime,
  getHostClaudeCompactWindow,
  getHostModelVisibility,
  getHostPromptCacheTtl,
  getHostProviderDefault,
  getHostProviderEnvironment,
  getProviderApiKeyState,
  getProviderRuntimes,
  type HostProviderDefault,
  listCustomAgents,
  listCustomProviders,
  listProviderAccountsWithModels,
  providerAccountCodeLoginStatus,
  providerUsageResets,
  removeProviderAccount,
  renameProviderAccount,
  resetProviderUsage,
  saveCustomAgent,
  saveCustomProvider,
  setHostClaudeCompactWindow,
  setHostModelVisibility,
  setHostPromptCacheTtl,
  setHostProviderDefault,
  setHostProviderEnvironment,
  setProviderAccountPool,
  setProviderApiKey,
  signInRelayStatus,
  signOutProvider,
  startProviderAccountCodeLogin,
  startProviderAccountSignInRelay,
  startProviderCodeLogin,
  startProviderSignInRelay,
  submitProviderAccountCodeLogin,
  submitProviderCodeLogin,
  updateCustomProvider,
} from "@openbot/team-client/team-admin-requests";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { runTeamRequest } from "@/features/workspace/model/team-request";
import { currentText } from "@/shared/lib/text";

const V1_RUNTIME_PROVIDERS = ["codex", "claude", "grok", "opencode"] as const;
const V2_RUNTIME_PROVIDERS = [...V1_RUNTIME_PROVIDERS, "antigravity"] as const;

type ProviderSignInMethod = "code" | "relay";

function codeSignInProviders(capabilities: readonly string[]): readonly AgentProviderId[] {
  if (capabilities.includes(PROVIDERS_V4_CAPABILITY)) {
    const paste = capabilities.includes(PROVIDERS_SIGN_IN_V3_CAPABILITY);
    const v4 = PROVIDERS_V4_SIGN_IN_PROVIDERS.filter(
      (provider) => paste || agentProviderDescriptor(provider).localCodeSignIn !== "paste",
    );
    if (!capabilities.includes(PROVIDERS_V8_CAPABILITY)) return v4;
    return AGENT_PROVIDERS.filter(
      (provider) =>
        isOneOf(v4, provider) ||
        (agentProviderDescriptor(provider).localCodeSignIn === "device" &&
          !isOneOf(PROVIDERS_V4_SIGN_IN_PROVIDERS, provider) &&
          !isOneOf(SIGN_IN_RELAY_PROVIDERS, provider)) ||
        (provider === "mistral" && capabilities.includes(MISTRAL_CODE_SIGN_IN_CAPABILITY)) ||
        (provider === "devin" && capabilities.includes(DEVIN_CODE_SIGN_IN_CAPABILITY)),
    );
  }
  if (capabilities.includes(PROVIDERS_SIGN_IN_V3_CAPABILITY)) return PROVIDERS_SIGN_IN_V3_PROVIDERS;
  return PROVIDERS_ADMIN_CODE_SIGN_IN_PROVIDERS;
}

function providerSignInMethod(provider: AgentProviderId, capabilities: readonly string[]): ProviderSignInMethod | null {
  if (codeSignInProviders(capabilities).includes(provider)) return "code";
  return capabilities.includes(SIGN_IN_RELAY_CAPABILITY) && isOneOf(SIGN_IN_RELAY_PROVIDERS, provider) ? "relay" : null;
}

function runtimeProviders(capabilities: readonly string[]): readonly DownloadableProviderId[] {
  if (capabilities.includes(PROVIDERS_V8_CAPABILITY)) return [...MANAGED_RUNTIME_PROVIDERS, ...INSTALLER_PROVIDERS];
  if (capabilities.includes(PROVIDERS_V5_CAPABILITY)) return PROVIDERS_V5_RUNTIME_PROVIDERS;
  if (capabilities.includes(PROVIDERS_V4_CAPABILITY)) return PROVIDERS_V4_RUNTIME_PROVIDERS;
  if (capabilities.includes(PROVIDERS_RUNTIMES_V2_CAPABILITY)) return V2_RUNTIME_PROVIDERS;
  return V1_RUNTIME_PROVIDERS;
}

function providerSignInAlternative(provider: AgentProviderId, capabilities: readonly string[]): "relay" | null {
  return providerSignInMethod(provider, capabilities) === "code" &&
    capabilities.includes(SIGN_IN_RELAY_CAPABILITY) &&
    isOneOf(SIGN_IN_RELAY_PROVIDERS, provider)
    ? "relay"
    : null;
}

function providerHasApiKey(provider: AgentProviderId, capabilities: readonly string[]): boolean {
  if (provider === "opencode") return true;
  if (provider === "claude") return capabilities.includes(CLAUDE_API_KEY_CAPABILITY);
  if (provider === "codex") return capabilities.includes(CODEX_API_KEY_CAPABILITY);
  if (isKeyOnlyProvider(provider)) return capabilities.includes(PROVIDERS_V8_CAPABILITY);
  return capabilities.includes(PROVIDERS_V5_CAPABILITY) && (provider === "muse" || provider === "antigravity");
}

const SIGN_OUT_PROVIDERS: readonly AgentProviderId[] = [
  "claude",
  "codex",
  "grok",
  "cursor",
  "devin",
  "copilot",
  "mistral",
  "antigravity",
];

export function providerSignOutOffered(row: ProviderRow): boolean {
  return (
    isOneOf(SIGN_OUT_PROVIDERS, row.id) &&
    row.status?.state === "available" &&
    row.status.connectionState !== "connecting" &&
    !row.status.apiKeyInUse
  );
}

export function providerAccountsAreKeys(provider: AgentProviderId): boolean {
  return agentProviderDescriptor(provider).accountSignIn === "key";
}

export function isProviderKeyAccount(provider: AgentProviderId, accountId: string): boolean {
  return providerAccountsAreKeys(provider) && accountId !== DEFAULT_PROVIDER_ACCOUNT_ID;
}

export interface ProviderRow {
  id: AgentProviderId;
  name: string;
  status: AgentProviderStatus | undefined;
  runtime: (ProviderRuntimeStatus & { provider: DownloadableProviderId }) | undefined;
  updatable: boolean;
  signIn: ProviderSignInMethod | null;
  alternativeSignIn: "relay" | null;
  apiKey: boolean;
}

export function providerRows(
  status: AgentStatus | undefined,
  snapshot: ProviderRuntimeSnapshot | undefined,
  capabilities: readonly string[],
): ProviderRow[] {
  const runtimes = runtimeProviders(capabilities);
  return AGENT_PROVIDERS.filter(
    (provider) =>
      provider !== "acp" &&
      (!isLocalOnlyProvider(provider) || status?.providers?.some((candidate) => candidate.id === provider) === true),
  )
    .sort((left, right) => agentProviderDescriptor(left).pickerOrder - agentProviderDescriptor(right).pickerOrder)
    .map((provider) => {
      const agent = status?.providers?.find((candidate) => candidate.id === provider);
      const managed = isOneOf(runtimes, provider) ? provider : undefined;
      const raw = managed && snapshot ? snapshot.providers[managed] : undefined;
      const runtime =
        raw &&
        (raw.phase === "ready" || raw.phase === "not-downloaded") &&
        (agent?.state === "available" || agent?.state === "sign-in-required") &&
        (agent.cliSource === "system" || (raw.phase === "not-downloaded" && !raw.availableVersion))
          ? { ...raw, phase: "ready" as const, version: agent.version ?? null }
          : raw;
      const availableVersion = runtime?.availableVersion ?? null;
      return {
        id: provider,
        name: agentProviderName(provider),
        status: agent,
        runtime: managed && runtime ? { ...runtime, provider: managed } : undefined,
        updatable: Boolean(
          runtime &&
            (runtime.phase === "ready" || (runtime.phase === "not-downloaded" && runtime.version !== null)) &&
            availableVersion !== null &&
            availableVersion !== runtime.version,
        ),
        signIn: providerSignInMethod(provider, capabilities),
        alternativeSignIn: providerSignInAlternative(provider, capabilities),
        apiKey: providerHasApiKey(provider, capabilities),
      };
    });
}

export function providerStatusText(row: ProviderRow): { key: MobileTextKey } | { percent: number } {
  const { runtime, updatable } = row;
  const state = row.status?.state ?? "not-installed";
  if (runtime?.phase === "downloading" && runtime.message)
    return { key: "mobile.server.providers.status.updateWaiting" };
  if (runtime?.phase === "downloading") return { percent: Math.max(0, Math.min(100, runtime.progress ?? 0)) / 100 };
  if (runtime?.phase === "finishing") return { key: "mobile.server.providers.status.settingUp" };
  if (row.status?.connectionState === "connecting" && state !== "available")
    return { key: "mobile.server.providers.status.connecting" };
  if (updatable) return { key: "mobile.server.providers.status.updateAvailable" };
  if (runtime?.phase === "download-error")
    return {
      key: runtime.version
        ? "mobile.server.providers.status.updateFailed"
        : "mobile.server.providers.status.setupFailed",
    };
  if (state === "available") return { key: "mobile.server.providers.status.connected" };
  if (runtime?.phase === "not-downloaded") return { key: "mobile.server.providers.status.notDownloaded" };
  if (state === "sign-in-required") return { key: "mobile.server.providers.status.notConnected" };
  if (state === "outdated") return { key: "mobile.server.providers.status.updateRequired" };
  if (state === "error") return { key: "mobile.server.providers.status.unavailable" };
  if (runtime?.phase === "ready") return { key: "mobile.server.providers.status.ready" };
  if (state === "not-installed") return { key: "mobile.server.providers.status.notInstalled" };
  return { key: "mobile.server.providers.status.checking" };
}

export function providerAccountStateKey(state: string): MobileTextKey {
  if (state === "connected") return "mobile.server.providers.status.connected";
  if (state === "connecting") return "mobile.server.providers.status.connecting";
  if (state === "checking") return "mobile.server.providers.status.checking";
  if (state === "signed-out") return "mobile.server.providers.status.notConnected";
  return "mobile.server.providers.status.unavailable";
}

export function providerRuntimeBusy(row: ProviderRow): boolean {
  return row.runtime?.phase === "downloading" || row.runtime?.phase === "finishing";
}

function decodeAgentStatus(value: unknown): AgentStatus {
  if (!isAgentStatus(value)) throw new Error("The host returned an invalid status.");
  return value;
}

export function relayPage(
  address: string,
): { url: string; state: string | null; paste: boolean } | { error: MobileTextKey } {
  let page: URL;
  try {
    page = new URL(address);
  } catch {
    return { error: "mobile.server.providers.relayNotWebPage" };
  }
  if (page.protocol !== "https:") return { error: "mobile.server.providers.relayNotWebPage" };
  const state = page.searchParams.get("state");
  const returns = loopbackCallback(page.toString()) !== null;
  if (!state && returns) return { error: "mobile.server.providers.relayNoState" };
  return { url: page.toString(), state, paste: returns || state !== null };
}

export function createProviderAdmin(request: TeamApiRequest, capabilities: readonly string[]) {
  const has = (capability: string) => capabilities.includes(capability);
  const runtimeRoutes = has(PROVIDERS_V8_CAPABILITY)
    ? PROVIDERS_V8_ROUTES
    : has(PROVIDERS_V5_CAPABILITY)
      ? PROVIDERS_V5_ROUTES
      : has(PROVIDERS_V4_CAPABILITY)
        ? PROVIDERS_V4_ROUTES
        : has(PROVIDERS_RUNTIMES_V2_CAPABILITY)
          ? PROVIDERS_RUNTIMES_V2_ROUTES
          : PROVIDERS_ADMIN_ROUTES;
  const signInRoutes = has(PROVIDERS_V8_CAPABILITY)
    ? PROVIDERS_V8_ROUTES
    : has(PROVIDERS_V4_CAPABILITY)
      ? PROVIDERS_V4_ROUTES
      : has(PROVIDERS_SIGN_IN_V3_CAPABILITY)
        ? PROVIDERS_SIGN_IN_V3_ROUTES
        : PROVIDERS_ADMIN_ROUTES;
  const keyRoutes = has(PROVIDERS_V8_CAPABILITY)
    ? PROVIDERS_V8_ROUTES
    : has(PROVIDERS_V5_CAPABILITY)
      ? PROVIDERS_V5_ROUTES
      : PROVIDERS_ADMIN_ROUTES;
  const customRoutes = has(CUSTOM_PROVIDER_EDIT_CAPABILITY)
    ? CUSTOM_PROVIDER_EDIT_ROUTES
    : has(CUSTOM_PROVIDER_HARNESS_CAPABILITY)
      ? CUSTOM_PROVIDER_HARNESS_ROUTES
      : PROVIDERS_ADMIN_ROUTES;
  const accountRelay = providerAccountRelay(has);
  const ignore = () => undefined;
  return {
    capabilities,
    readStatus: (): Promise<AgentStatus> => request("GET", TEAM_API_ROUTES.agents.status, decodeAgentStatus),
    readRuntimes: (): Promise<ProviderRuntimeSnapshot> => runTeamRequest(getProviderRuntimes(request, runtimeRoutes)),
    download: (provider: DownloadableProviderId) =>
      runTeamRequest(downloadProviderRuntime(request, provider, runtimeRoutes)),
    checkUpdates: () => runTeamRequest(checkProviderRuntimeUpdates(request, runtimeRoutes)),
    cancelDownload: (provider: DownloadableProviderId) =>
      runTeamRequest(cancelProviderRuntime(request, provider, runtimeRoutes)),
    startCodeSignIn: (provider: AgentProviderId): Promise<ProviderCodeLoginStart> =>
      runTeamRequest(startProviderCodeLogin(request, provider, signInRoutes)),
    submitCode: (provider: AgentProviderId, code: string): Promise<AgentStatus> =>
      runTeamRequest(
        submitProviderCodeLogin(
          request,
          { provider, code },
          signInRoutes === PROVIDERS_V8_ROUTES || signInRoutes === PROVIDERS_V4_ROUTES
            ? signInRoutes
            : PROVIDERS_SIGN_IN_V3_ROUTES,
        ),
      ),
    cancelCodeSignIn: (provider: AgentProviderId): Promise<AgentStatus> =>
      runTeamRequest(cancelProviderCodeLogin(request, provider, signInRoutes)),
    startRelay: async (provider: AgentProviderId): Promise<string> => {
      if (!isOneOf(SIGN_IN_RELAY_PROVIDERS, provider))
        throw new Error(currentText().t("mobile.server.providers.signInUnsupported"));
      return (await runTeamRequest(startProviderSignInRelay(request, provider))).flowId;
    },
    relayStatus: (flowId: string): Promise<SignInRelayStatus> => runTeamRequest(signInRelayStatus(request, flowId)),
    completeRelay: (flowId: string, query: string): Promise<SignInRelayStatus> =>
      runTeamRequest(completeSignInRelay(request, flowId, query)),
    cancelRelay: (flowId: string): Promise<AgentStatus> => runTeamRequest(cancelProviderSignInRelay(request, flowId)),
    keyState: async (provider: AgentProviderId): Promise<ProviderApiKeyStatus> =>
      (await runTeamRequest(getProviderApiKeyState(request, provider, keyRoutes))).status,
    setKey: (provider: AgentProviderId, key: string): Promise<AgentStatus> =>
      runTeamRequest(setProviderApiKey(request, { provider, key }, keyRoutes)),
    clearKey: (provider: AgentProviderId): Promise<AgentStatus> =>
      runTeamRequest(clearProviderApiKey(request, provider, keyRoutes)),
    listCustom: (): Promise<CustomProviderSummary[]> => runTeamRequest(listCustomProviders(request, customRoutes)),
    saveCustom: (input: SaveCustomProviderInput): Promise<CustomProviderResult> =>
      runTeamRequest(saveCustomProvider(request, input, customRoutes)),
    updateCustom:
      customRoutes === CUSTOM_PROVIDER_EDIT_ROUTES
        ? (input: UpdateCustomProviderInput): Promise<CustomProviderResult> =>
            runTeamRequest(updateCustomProvider(request, input, CUSTOM_PROVIDER_EDIT_ROUTES))
        : null,
    deleteCustom: (id: string): Promise<CustomProviderResult> =>
      runTeamRequest(deleteCustomProvider(request, { id }, customRoutes)),
    accounts: has(PROVIDER_ACCOUNTS_CAPABILITY)
      ? {
          list: (): Promise<HostProviderAccounts> =>
            runTeamRequest(listProviderAccountsWithModels(request, false, has(PROVIDER_ACCOUNT_POOL_CAPABILITY))),
          setPool: has(PROVIDER_ACCOUNT_POOL_CAPABILITY)
            ? (provider: AgentProviderId, enabled: boolean, leftOut: readonly string[]): Promise<void> =>
                runTeamRequest(setProviderAccountPool(request, { provider, enabled, leftOut: [...leftOut] }))
            : null,
          rename: (provider: AgentProviderId, accountId: string, label: string | null): Promise<void> =>
            runTeamRequest(renameProviderAccount(request, { provider, accountId, label })),
          remove: (provider: AgentProviderId, accountId: string): Promise<void> =>
            runTeamRequest(removeProviderAccount(request, { provider, accountId })),
          canSignIn: (provider: AgentProviderId): boolean =>
            !providerAccountsAreKeys(provider) && accountRelay !== null && isOneOf(accountRelay.providers, provider),
          connectKey: has(PROVIDER_ACCOUNT_KEYS_CAPABILITY)
            ? (provider: AgentProviderId, accountId: string | null, key: string): Promise<void> =>
                runTeamRequest(connectProviderAccountKey(request, { provider, accountId, key }))
            : null,
          startRelay: async (provider: AgentProviderId, accountId: string | null): Promise<string> => {
            if (!accountRelay || !isOneOf(accountRelay.providers, provider))
              throw new Error(currentText().t("mobile.server.providers.signInUnsupported"));
            return (
              await runTeamRequest(startProviderAccountSignInRelay(request, accountRelay, { provider, accountId }))
            ).flowId;
          },
          code: has(PROVIDER_ACCOUNT_CODE_CAPABILITY)
            ? {
                offered: (provider: AgentProviderId): boolean => {
                  const codeSignIn = agentProviderDescriptor(provider).accountCodeSignIn;
                  return codeSignIn === "device" || (codeSignIn === "paste" && has(PROVIDERS_SIGN_IN_V3_CAPABILITY));
                },
                start: (provider: AgentProviderId, accountId: string | null): Promise<ProviderAccountCodeLoginStart> =>
                  runTeamRequest(startProviderAccountCodeLogin(request, { provider, accountId })),
                submit: (provider: AgentProviderId, accountId: string, code: string): Promise<void> =>
                  runTeamRequest(submitProviderAccountCodeLogin(request, { provider, accountId, code })),
                status: (provider: AgentProviderId, accountId: string): Promise<ProviderAccountCodeLoginStatus> =>
                  runTeamRequest(providerAccountCodeLoginStatus(request, { provider, accountId })),
                cancel: (provider: AgentProviderId, accountId: string): Promise<void> =>
                  runTeamRequest(cancelProviderAccountCodeLogin(request, { provider, accountId })),
              }
            : null,
        }
      : null,
    customAgents: has(CUSTOM_AGENTS_CAPABILITY)
      ? {
          list: (): Promise<CustomAgentSummary[]> => runTeamRequest(listCustomAgents(request)),
          save: (input: SaveCustomAgentInput): Promise<CustomAgentResult> =>
            runTeamRequest(saveCustomAgent(request, input)),
          remove: (id: string): Promise<CustomAgentResult> => runTeamRequest(deleteCustomAgent(request, id)),
        }
      : null,
    registry: has(ACP_REGISTRY_CAPABILITY)
      ? {
          search: (query: string): Promise<AcpRegistryEntry[]> =>
            request("POST", ACP_REGISTRY_ROUTES.search, decodeRegistryEntries, { query }),
          status: (): Promise<AcpRegistryOperation[]> =>
            request("POST", ACP_REGISTRY_ROUTES.status, decodeRegistryOperations, {}),
          install: (input: AcpRegistryInstallInput): Promise<CustomAgentResult> =>
            request("POST", ACP_REGISTRY_ROUTES.install, decodeRegistryInstallResult, { ...input }),
          cancel: (registryId: string): Promise<void> =>
            request("POST", ACP_REGISTRY_ROUTES.cancel, ignore, { registryId }),
          remove: (registryId: string): Promise<void> =>
            request("POST", ACP_REGISTRY_ROUTES.remove, ignore, { registryId }),
        }
      : null,
    models: has(MODEL_VISIBILITY_CAPABILITY)
      ? {
          read: (provider: AgentProviderId): Promise<ProviderModelVisibility> =>
            runTeamRequest(getHostModelVisibility(request, provider)),
          set: (provider: AgentProviderId, shown: AgentModelId[] | null): Promise<ProviderModelVisibility> =>
            runTeamRequest(setHostModelVisibility(request, { provider, shown })),
        }
      : null,
    promptCache: has(PROMPT_CACHE_TTL_CAPABILITY)
      ? {
          read: (): Promise<PromptCacheTtlSetting> => runTeamRequest(getHostPromptCacheTtl(request)),
          set: (ttl: PromptCacheTtl): Promise<PromptCacheTtlSetting> =>
            runTeamRequest(setHostPromptCacheTtl(request, ttl)),
        }
      : null,
    compactWindow: has(CLAUDE_COMPACT_WINDOW_CAPABILITY)
      ? {
          read: (): Promise<ClaudeCompactWindowSetting> => runTeamRequest(getHostClaudeCompactWindow(request)),
          set: (tokens: number | null): Promise<ClaudeCompactWindowSetting> =>
            runTeamRequest(setHostClaudeCompactWindow(request, tokens)),
        }
      : null,
    environment: has(PROVIDER_ENVIRONMENT_CAPABILITY)
      ? {
          read: (provider: ProviderEnvironmentProvider): Promise<ProviderEnvironment> =>
            runTeamRequest(getHostProviderEnvironment(request, provider)),
          set: (update: ProviderEnvironmentUpdate): Promise<ProviderEnvironment> =>
            runTeamRequest(setHostProviderEnvironment(request, update)),
        }
      : null,
    signOut: has(PROVIDER_SIGN_OUT_CAPABILITY)
      ? (provider: AgentProviderId): Promise<void> => runTeamRequest(signOutProvider(request, provider))
      : null,
    usageResets: has(PROVIDER_USAGE_RESET_CAPABILITY)
      ? {
          list: (provider: AgentProviderId): Promise<ProviderUsageResets[]> =>
            runTeamRequest(providerUsageResets(request, provider)),
          reset: (provider: AgentProviderId, accountId: string): Promise<ProviderUsageResetOutcome> =>
            runTeamRequest(resetProviderUsage(request, { provider, accountId })),
        }
      : null,
    defaultProvider: has(PROVIDER_DEFAULT_CAPABILITY)
      ? {
          read: (): Promise<HostProviderDefault> => runTeamRequest(getHostProviderDefault(request)),
          set: (provider: AgentProviderId): Promise<HostProviderDefault> =>
            runTeamRequest(setHostProviderDefault(request, provider, null)),
        }
      : null,
  };
}

export type ProviderAdmin = ReturnType<typeof createProviderAdmin>;
