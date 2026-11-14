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
  type ProviderApiKeyStatus,
  type ProviderCodeLoginStart,
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
import { MODEL_VISIBILITY_CAPABILITY } from "@openbot/contracts/team-protocol/model-visibility-v1";
import { PROMPT_CACHE_TTL_CAPABILITY } from "@openbot/contracts/team-protocol/prompt-cache-ttl-v1";
import { PROVIDER_ACCOUNT_KEYS_CAPABILITY } from "@openbot/contracts/team-protocol/provider-account-keys-v1";
import { PROVIDER_ACCOUNT_POOL_CAPABILITY } from "@openbot/contracts/team-protocol/provider-account-pool-v1";
import { providerAccountRelay } from "@openbot/contracts/team-protocol/provider-account-relays";
import { PROVIDER_ACCOUNTS_CAPABILITY } from "@openbot/contracts/team-protocol/provider-accounts-v1";
import { PROVIDER_DEFAULT_CAPABILITY } from "@openbot/contracts/team-protocol/provider-default-v1";
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
  getProviderApiKeyState,
  getProviderRuntimes,
  type HostProviderDefault,
  listCustomAgents,
  listCustomProviders,
  listProviderAccountsWithModels,
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
  setProviderAccountPool,
  setProviderApiKey,
  signInRelayStatus,
  signOutProvider,
  startProviderAccountSignInRelay,
  startProviderCodeLogin,
  startProviderSignInRelay,
  submitProviderCodeLogin,
  updateCustomProvider,
} from "@openbot/team-client/team-admin-requests";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { runTeamRequest } from "@/features/workspace/model/team-request";
import { currentText } from "@/shared/lib/text";

/** The runtimes that `providers-v1` reads and downloads. Later route sets add providers. */
const V1_RUNTIME_PROVIDERS = ["codex", "claude", "grok", "opencode"] as const;
const V2_RUNTIME_PROVIDERS = [...V1_RUNTIME_PROVIDERS, "antigravity"] as const;

/**
 * How Connect signs in a provider of the host. A phone cannot take a sign-in callback.
 *
 * - `code`: the host's code route. The host shows a device code, a page for a pasted code, or a link.
 * - `relay`: the host starts the sign-in and the phone opens the page (`sign-in-relay-v1`). A page that
 *   returns to the host's loopback address needs that address pasted back.
 */
type ProviderSignInMethod = "code" | "relay";

function codeSignInProviders(capabilities: readonly string[]): readonly AgentProviderId[] {
  if (capabilities.includes(PROVIDERS_V4_CAPABILITY)) {
    const paste = capabilities.includes(PROVIDERS_SIGN_IN_V3_CAPABILITY);
    const v4 = PROVIDERS_V4_SIGN_IN_PROVIDERS.filter(
      (provider) => paste || agentProviderDescriptor(provider).localCodeSignIn !== "paste",
    );
    if (!capabilities.includes(PROVIDERS_V8_CAPABILITY)) return v4;
    // `providers-v8` also signs in the later providers that have a device code, such as Kimi and
    // Hermes. A provider that the relay already signs in, such as Muse, keeps the relay.
    return AGENT_PROVIDERS.filter(
      (provider) =>
        isOneOf(v4, provider) ||
        (agentProviderDescriptor(provider).localCodeSignIn === "device" &&
          !isOneOf(PROVIDERS_V4_SIGN_IN_PROVIDERS, provider) &&
          !isOneOf(SIGN_IN_RELAY_PROVIDERS, provider)),
    );
  }
  if (capabilities.includes(PROVIDERS_SIGN_IN_V3_CAPABILITY)) return PROVIDERS_SIGN_IN_V3_PROVIDERS;
  return PROVIDERS_ADMIN_CODE_SIGN_IN_PROVIDERS;
}

/**
 * The one sign-in that Connect runs, or null when the phone cannot sign the provider in: the code
 * route first, because it needs nothing pasted back, then the relayed page. The host's own browser
 * page needs the live view, which the phone does not show.
 */
function providerSignInMethod(provider: AgentProviderId, capabilities: readonly string[]): ProviderSignInMethod | null {
  if (codeSignInProviders(capabilities).includes(provider)) return "code";
  return capabilities.includes(SIGN_IN_RELAY_CAPABILITY) && isOneOf(SIGN_IN_RELAY_PROVIDERS, provider) ? "relay" : null;
}

function runtimeProviders(capabilities: readonly string[]): readonly DownloadableProviderId[] {
  // `providers-v8` lists every runtime of the host as a row; a row that a host before Kimi does not
  // send reads as not downloaded, and the page lists that provider only when the host status names it.
  // An installer provider has a row only while the host can install it, so the row shows Download
  // only then.
  if (capabilities.includes(PROVIDERS_V8_CAPABILITY)) return [...MANAGED_RUNTIME_PROVIDERS, ...INSTALLER_PROVIDERS];
  if (capabilities.includes(PROVIDERS_V5_CAPABILITY)) return PROVIDERS_V5_RUNTIME_PROVIDERS;
  if (capabilities.includes(PROVIDERS_V4_CAPABILITY)) return PROVIDERS_V4_RUNTIME_PROVIDERS;
  if (capabilities.includes(PROVIDERS_RUNTIMES_V2_CAPABILITY)) return V2_RUNTIME_PROVIDERS;
  return V1_RUNTIME_PROVIDERS;
}

/**
 * The other way in that the provider page offers, as the desktop ⋯ menu of a joined server does: the
 * relayed page, when Connect is the host's code route.
 */
function providerSignInAlternative(provider: AgentProviderId, capabilities: readonly string[]): "relay" | null {
  return providerSignInMethod(provider, capabilities) === "code" &&
    capabilities.includes(SIGN_IN_RELAY_CAPABILITY) &&
    isOneOf(SIGN_IN_RELAY_PROVIDERS, provider)
    ? "relay"
    : null;
}

/**
 * The providers whose API key the host saves: OpenCode Go, Muse and Gemini from `providers-v5`,
 * Inception, DeepSeek and OpenRouter from `providers-v8`, and Claude and ChatGPT when the host reads
 * their key (`claude-api-key-v1`, `codex-api-key-v1`). An older host stores such a key and never
 * reads it.
 */
function providerHasApiKey(provider: AgentProviderId, capabilities: readonly string[]): boolean {
  if (provider === "opencode") return true;
  if (provider === "claude") return capabilities.includes(CLAUDE_API_KEY_CAPABILITY);
  if (provider === "codex") return capabilities.includes(CODEX_API_KEY_CAPABILITY);
  if (isKeyOnlyProvider(provider)) return capabilities.includes(PROVIDERS_V8_CAPABILITY);
  return capabilities.includes(PROVIDERS_V5_CAPABILITY) && (provider === "muse" || provider === "antigravity");
}

/**
 * The providers whose CLI signs its own sign-in out (`signOut` in `src/backend/provider-drivers.ts`),
 * as the desktop page offers Disconnect. Muse is left out: its key state decides, and a joined
 * server's desktop page does not offer it either.
 */
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

/** Whether the phone can sign the host's own sign-in of the provider out. A saved key keeps it connected. */
export function providerSignOutOffered(row: ProviderRow): boolean {
  return (
    isOneOf(SIGN_OUT_PROVIDERS, row.id) &&
    row.status?.state === "available" &&
    row.status.connectionState !== "connecting" &&
    !row.status.apiKeyInUse
  );
}

/**
 * Whether each account of the provider after the first is one API key of the provider
 * (`accountSignIn: "key"`), as for Cursor: its CLI holds one browser sign-in for each computer user.
 */
export function providerAccountsAreKeys(provider: AgentProviderId): boolean {
  return agentProviderDescriptor(provider).accountSignIn === "key";
}

/** An account that is an API key: no browser sign-in, no plan usage, and no place in a pool. */
export function isProviderKeyAccount(provider: AgentProviderId, accountId: string): boolean {
  return providerAccountsAreKeys(provider) && accountId !== DEFAULT_PROVIDER_ACCOUNT_ID;
}

export interface ProviderRow {
  id: AgentProviderId;
  name: string;
  status: AgentProviderStatus | undefined;
  /** Absent when the host's route set does not download this provider. */
  runtime: (ProviderRuntimeStatus & { provider: DownloadableProviderId }) | undefined;
  /** Installed, idle, and the host has a different version. */
  updatable: boolean;
  signIn: ProviderSignInMethod | null;
  /** A second sign-in that differs from `signIn`, or null. */
  alternativeSignIn: "relay" | null;
  apiKey: boolean;
}

/**
 * The rows of the Providers page, as the desktop Providers tab builds them for a joined server: a
 * provider that only newer protocols carry is listed only when the host's status names it.
 */
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
      // As on desktop: a CLI that the user installed reads as ready on its own version, while its
      // managed runtime is idle.
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

/** The status text of a row, in the order of the desktop badge. A download shows its percentage. */
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

/** The status text of an account. A newer host can send a state that this phone shows as an error. */
export function providerAccountStateKey(state: string): MobileTextKey {
  if (state === "connected") return "mobile.server.providers.status.connected";
  if (state === "connecting") return "mobile.server.providers.status.connecting";
  if (state === "checking") return "mobile.server.providers.status.checking";
  if (state === "signed-out") return "mobile.server.providers.status.notConnected";
  return "mobile.server.providers.status.unavailable";
}

/** A download or its setup step runs on the host. */
export function providerRuntimeBusy(row: ProviderRow): boolean {
  return row.runtime?.phase === "downloading" || row.runtime?.phase === "finishing";
}

function decodeAgentStatus(value: unknown): AgentStatus {
  if (!isAgentStatus(value)) throw new Error("The host returned an invalid status.");
  return value;
}

/**
 * The page of a relayed sign-in that the phone can open, or the key of why it cannot. The host
 * chose the page, so only a web page opens, and a page that returns to a loopback address must carry
 * `state`, which the pasted address must repeat.
 */
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

/**
 * The Providers admin of one host (`providers-v1` to `providers-v5` and `providers-v8`,
 * `sign-in-relay-v1`, `provider-default-v1`, `custom-provider-harness-v1`, `custom-provider-edit-v1`, `provider-accounts-v1`,
 * the account relays, `acp-registry-v1`, `custom-agents-v1`, `model-visibility-v1`,
 * `prompt-cache-ttl-v1`, `claude-compact-window-v1`, `provider-sign-out-v1`, `provider-usage-reset-v1`,
 * `provider-account-pool-v1` and `provider-account-keys-v1`), with the newest
 * route set that the host serves. The
 * host checks the role on every route.
 */
export function createProviderAdmin(request: TeamApiRequest, capabilities: readonly string[]) {
  const has = (capability: string) => capabilities.includes(capability);
  // As on the web client: `providers-v8` names a provider by any id, so it downloads and signs in Kimi.
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
  // As on the web client: `providers-v8` keeps every key that `providers-v5` keeps, and the key-only providers.
  const keyRoutes = has(PROVIDERS_V8_CAPABILITY)
    ? PROVIDERS_V8_ROUTES
    : has(PROVIDERS_V5_CAPABILITY)
      ? PROVIDERS_V5_ROUTES
      : PROVIDERS_ADMIN_ROUTES;
  // As on the web client: the edit routes also name the header names of each endpoint and can edit
  // one, and the harness routes name the provider that runs each endpoint.
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
    /** The host asks for the newest version of each runtime that it manages. */
    checkUpdates: () => runTeamRequest(checkProviderRuntimeUpdates(request, runtimeRoutes)),
    cancelDownload: (provider: DownloadableProviderId) =>
      runTeamRequest(cancelProviderRuntime(request, provider, runtimeRoutes)),
    startCodeSignIn: (provider: AgentProviderId): Promise<ProviderCodeLoginStart> =>
      runTeamRequest(startProviderCodeLogin(request, provider, signInRoutes)),
    /** The code is a credential: it goes to the host in the body, and no reply carries it. */
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
    /** `query` holds a grant. It goes only to the host, on the encrypted Team channel. */
    completeRelay: (flowId: string, query: string): Promise<SignInRelayStatus> =>
      runTeamRequest(completeSignInRelay(request, flowId, query)),
    cancelRelay: (flowId: string): Promise<AgentStatus> => runTeamRequest(cancelProviderSignInRelay(request, flowId)),
    keyState: async (provider: AgentProviderId): Promise<ProviderApiKeyStatus> =>
      (await runTeamRequest(getProviderApiKeyState(request, provider, keyRoutes))).status,
    /** Only the key's state comes back. The phone does not keep the key. */
    setKey: (provider: AgentProviderId, key: string): Promise<AgentStatus> =>
      runTeamRequest(setProviderApiKey(request, { provider, key }, keyRoutes)),
    clearKey: (provider: AgentProviderId): Promise<AgentStatus> =>
      runTeamRequest(clearProviderApiKey(request, provider, keyRoutes)),
    /** The endpoints of the host. A list says only whether an endpoint has a key. */
    listCustom: (): Promise<CustomProviderSummary[]> => runTeamRequest(listCustomProviders(request, customRoutes)),
    /**
     * The key and the header values go to the host in the body, and no reply carries them. A save adds
     * an endpoint, and the host runs it on OpenCode.
     */
    saveCustom: (input: SaveCustomProviderInput): Promise<CustomProviderResult> =>
      runTeamRequest(saveCustomProvider(request, input, customRoutes)),
    /**
     * Changes a saved endpoint in place (`custom-provider-edit-v1`), or null when the host has no edit
     * route. An absent key or a header with a `null` value keeps the saved secret. The host keeps the
     * harness and the settings of each kept model, so agents on a kept model stay on it.
     */
    updateCustom:
      customRoutes === CUSTOM_PROVIDER_EDIT_ROUTES
        ? (input: UpdateCustomProviderInput): Promise<CustomProviderResult> =>
            runTeamRequest(updateCustomProvider(request, input, CUSTOM_PROVIDER_EDIT_ROUTES))
        : null,
    deleteCustom: (id: string): Promise<CustomProviderResult> =>
      runTeamRequest(deleteCustomProvider(request, { id }, customRoutes)),
    /**
     * The accounts of the host's providers (`provider-accounts-v1`), or null when the host has none. A
     * new account signs in on the page that the host relays (`provider-account-relay-v1` or `-v2`); the
     * released `sign-in-relay-v1` routes then run the flow, as Connect does. With
     * `provider-account-pool-v1`, the list also has the pools that are on.
     */
    accounts: has(PROVIDER_ACCOUNTS_CAPABILITY)
      ? {
          list: (): Promise<HostProviderAccounts> =>
            runTeamRequest(listProviderAccountsWithModels(request, false, has(PROVIDER_ACCOUNT_POOL_CAPABILITY))),
          /**
           * Turns the pool of the provider's accounts on or off (`provider-account-pool-v1`), or null on
           * an older host. `leftOut` is the full list of the accounts that the pool does not use.
           */
          setPool: has(PROVIDER_ACCOUNT_POOL_CAPABILITY)
            ? (provider: AgentProviderId, enabled: boolean, leftOut: readonly string[]): Promise<void> =>
                runTeamRequest(setProviderAccountPool(request, { provider, enabled, leftOut: [...leftOut] }))
            : null,
          rename: (provider: AgentProviderId, accountId: string, label: string | null): Promise<void> =>
            runTeamRequest(renameProviderAccount(request, { provider, accountId, label })),
          remove: (provider: AgentProviderId, accountId: string): Promise<void> =>
            runTeamRequest(removeProviderAccount(request, { provider, accountId })),
          /**
           * The phone signs in an account of the provider only on a page that the host relays. A
           * provider whose accounts are keys has no such page.
           */
          canSignIn: (provider: AgentProviderId): boolean =>
            !providerAccountsAreKeys(provider) && accountRelay !== null && isOneOf(accountRelay.providers, provider),
          /**
           * Gives an account of a provider whose accounts are keys its API key
           * (`provider-account-keys-v1`), or null on an older host. `accountId: null` adds an account.
           * It fails with the host's reason when the provider refuses the key. The phone does not keep
           * the key.
           */
          connectKey: has(PROVIDER_ACCOUNT_KEYS_CAPABILITY)
            ? (provider: AgentProviderId, accountId: string | null, key: string): Promise<void> =>
                runTeamRequest(connectProviderAccountKey(request, { provider, accountId, key }))
            : null,
          /** `accountId: null` adds an account. A cancel removes a new account that did not sign in. */
          startRelay: async (provider: AgentProviderId, accountId: string | null): Promise<string> => {
            if (!accountRelay || !isOneOf(accountRelay.providers, provider))
              throw new Error(currentText().t("mobile.server.providers.signInUnsupported"));
            return (
              await runTeamRequest(startProviderAccountSignInRelay(request, accountRelay, { provider, accountId }))
            ).flowId;
          },
        }
      : null,
    /**
     * The custom ACP agents of the host (`custom-agents-v1`), or null. The host starts each command on
     * its computer. An environment value goes to the host only, and the phone does not keep it.
     */
    customAgents: has(CUSTOM_AGENTS_CAPABILITY)
      ? {
          list: (): Promise<CustomAgentSummary[]> => runTeamRequest(listCustomAgents(request)),
          save: (input: SaveCustomAgentInput): Promise<CustomAgentResult> =>
            runTeamRequest(saveCustomAgent(request, input)),
          remove: (id: string): Promise<CustomAgentResult> => runTeamRequest(deleteCustomAgent(request, id)),
        }
      : null,
    /** The ACP registry of the host (`acp-registry-v1`), or null. The host installs the command it names. */
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
    /**
     * Every model of a provider and the ones the model picker of the server shows
     * (`model-visibility-v1`), or null. `shown: null` gives each model back the host's default.
     */
    models: has(MODEL_VISIBILITY_CAPABILITY)
      ? {
          read: (provider: AgentProviderId): Promise<ProviderModelVisibility> =>
            runTeamRequest(getHostModelVisibility(request, provider)),
          set: (provider: AgentProviderId, shown: AgentModelId[] | null): Promise<ProviderModelVisibility> =>
            runTeamRequest(setHostModelVisibility(request, { provider, shown })),
        }
      : null,
    /** How long Claude keeps the prompt cache of the host's agents (`prompt-cache-ttl-v1`), or null. */
    promptCache: has(PROMPT_CACHE_TTL_CAPABILITY)
      ? {
          read: (): Promise<PromptCacheTtlSetting> => runTeamRequest(getHostPromptCacheTtl(request)),
          set: (ttl: PromptCacheTtl): Promise<PromptCacheTtlSetting> =>
            runTeamRequest(setHostPromptCacheTtl(request, ttl)),
        }
      : null,
    /**
     * The size at which Claude Code compacts the chats of the host's agents (`claude-compact-window-v1`),
     * or null. `tokens: null` is Claude Code's own size for each model.
     */
    compactWindow: has(CLAUDE_COMPACT_WINDOW_CAPABILITY)
      ? {
          read: (): Promise<ClaudeCompactWindowSetting> => runTeamRequest(getHostClaudeCompactWindow(request)),
          set: (tokens: number | null): Promise<ClaudeCompactWindowSetting> =>
            runTeamRequest(setHostClaudeCompactWindow(request, tokens)),
        }
      : null,
    /** Signs the host's own sign-in of a provider out (`provider-sign-out-v1`), or null. Its agents wait. */
    signOut: has(PROVIDER_SIGN_OUT_CAPABILITY)
      ? (provider: AgentProviderId): Promise<void> => runTeamRequest(signOutProvider(request, provider))
      : null,
    /** The usage reset credits of the host's accounts, and the spend of one (`provider-usage-reset-v1`), or null. */
    usageResets: has(PROVIDER_USAGE_RESET_CAPABILITY)
      ? {
          list: (provider: AgentProviderId): Promise<ProviderUsageResets[]> =>
            runTeamRequest(providerUsageResets(request, provider)),
          reset: (provider: AgentProviderId, accountId: string): Promise<ProviderUsageResetOutcome> =>
            runTeamRequest(resetProviderUsage(request, { provider, accountId })),
        }
      : null,
    /** Null when the host does not serve `provider-default-v1`. */
    defaultProvider: has(PROVIDER_DEFAULT_CAPABILITY)
      ? {
          read: (): Promise<HostProviderDefault> => runTeamRequest(getHostProviderDefault(request)),
          /** The provider's own default model, as the desktop Settings choice of a provider. */
          set: (provider: AgentProviderId): Promise<HostProviderDefault> =>
            runTeamRequest(setHostProviderDefault(request, provider, null)),
        }
      : null,
  };
}

export type ProviderAdmin = ReturnType<typeof createProviderAdmin>;
