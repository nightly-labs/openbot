import { type AgentProviderId, isAgentProvider } from "./agent-providers";
import { INPUT_LIMITS } from "./input-limits";
import { type AgentModelOption, isAgentModelOption } from "./ipc-agent-identity";
import { isBoundedString, isFiniteNumber, isNullableBoundedString } from "./ipc-bounded-values";
import type { McpSignInRelayPage } from "./ipc-mcp-servers";
import { isDynamicRecord, isOneOf } from "./runtime-values";

export const AGENT_PHASES = ["idle", "starting", "ready", "restarting", "blocked", "stopped"] as const;
export type AgentPhase = (typeof AGENT_PHASES)[number];

export const CAPABILITY_STATES = ["ready", "setup-required", "unavailable"] as const;
export type CapabilityState = (typeof CAPABILITY_STATES)[number];

export { AGENT_PROVIDERS, type AgentProviderId, isAgentProvider } from "./agent-providers";
export type AgentProviderState =
  | "not-started"
  | "checking"
  | "available"
  | "sign-in-required"
  | "not-installed"
  | "outdated"
  | "error";

export interface AgentProviderStatus {
  off?: boolean;
  id: AgentProviderId;
  displayName?: string;
  state: AgentProviderState;
  version: string | null;
  message: string | null;
  email?: string | null;
  connectionState?: "connecting";
  signInPending?: boolean;
  checkError?: string | null;
  cliSource?: "system" | "managed";
  cliIncomplete?: boolean;
  otherCliVersion?: string;
  restartPending?: boolean;
  endpointsPending?: boolean;
  apiKeyInUse?: boolean;
  lastError?: string | null;
  lastErrorAt?: number;
  accounts?: ProviderAccountStatus[];
  accountPool?: ProviderAccountPool;
  liveVoiceAccount?: string;
  modelSource?: ProviderModelSource;
}

export const PROVIDER_MODEL_SOURCE_NAME_LIMIT = 80;

export type ProviderModelSource = { kind: "provider"; name: string } | { kind: "catalog" };

export function isProviderModelSource(value: unknown): value is ProviderModelSource {
  if (!isDynamicRecord(value)) return false;
  if (value.kind === "catalog") return true;
  return (
    value.kind === "provider" &&
    isBoundedString(value.name, PROVIDER_MODEL_SOURCE_NAME_LIMIT) &&
    value.name.trim().length > 0
  );
}

export interface ProviderModelSourceEntry {
  provider: string;
  source: ProviderModelSource;
}

const AGENT_PROVIDER_LIMIT = 64;

export function decodeProviderModelSources(value: unknown): ProviderModelSourceEntry[] {
  if (
    !isDynamicRecord(value) ||
    !Array.isArray(value.sources) ||
    value.sources.length > AGENT_PROVIDER_LIMIT ||
    !value.sources.every(
      (entry: unknown) =>
        isDynamicRecord(entry) &&
        isBoundedString(entry.provider, INPUT_LIMITS.identifier) &&
        isProviderModelSource(entry.source),
    )
  )
    throw new Error("Invalid model source list.");
  return value.sources.map((entry: ProviderModelSourceEntry) => ({
    provider: entry.provider,
    source: entry.source.kind === "provider" ? { kind: "provider", name: entry.source.name } : { kind: "catalog" },
  }));
}

export function withModelSources(status: AgentStatus, sources: readonly ProviderModelSourceEntry[]): AgentStatus {
  if (!status.providers || sources.length === 0) return status;
  const byProvider = new Map(sources.map((entry) => [entry.provider, entry.source]));
  return {
    ...status,
    providers: status.providers.map((row) => {
      const source = byProvider.get(row.id);
      return source ? { ...row, modelSource: source } : row;
    }),
  };
}

export interface ProviderAccountPool {
  leftOut: string[];
  inUse: string | null;
}

export const DEFAULT_PROVIDER_ACCOUNT_ID = "default";

const PROVIDER_ACCOUNT_ID = /^(?:default|a[0-9a-f]{16})$/u;

export function isProviderAccountId(value: unknown): value is string {
  return typeof value === "string" && PROVIDER_ACCOUNT_ID.test(value);
}

export const MAX_PROVIDER_ACCOUNTS = 20;

export const PROVIDER_ACCOUNT_STATES = ["connected", "connecting", "checking", "signed-out", "error"] as const;
export type ProviderAccountState = (typeof PROVIDER_ACCOUNT_STATES)[number];

export interface ProviderAccountStatus {
  id: string;
  label: string | null;
  email: string | null;
  state: ProviderAccountState;
  message: string | null;
  models?: AgentModelOption[];
}

export const PROVIDER_ACCOUNT_LABEL_MAX_LENGTH = 60;

export function isProviderAccountStatus(value: unknown): value is ProviderAccountStatus {
  return (
    isDynamicRecord(value) &&
    isProviderAccountId(value.id) &&
    isNullableBoundedString(value.label, PROVIDER_ACCOUNT_LABEL_MAX_LENGTH) &&
    isNullableBoundedString(value.email, INPUT_LIMITS.email) &&
    isBoundedString(value.state, INPUT_LIMITS.identifier) &&
    isNullableBoundedString(value.message, INPUT_LIMITS.messageText) &&
    (value.models === undefined || (Array.isArray(value.models) && value.models.every(isAgentModelOption)))
  );
}

function isAgentProviderStatus(value: unknown): value is AgentProviderStatus {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.id, INPUT_LIMITS.identifier) &&
    isBoundedString(value.state, INPUT_LIMITS.identifier) &&
    (value.displayName === undefined || isBoundedString(value.displayName, 80)) &&
    isNullableBoundedString(value.version, 160) &&
    isNullableBoundedString(value.message, INPUT_LIMITS.messageText) &&
    (value.email === undefined || isNullableBoundedString(value.email, INPUT_LIMITS.email)) &&
    (value.connectionState === undefined || isBoundedString(value.connectionState, INPUT_LIMITS.identifier)) &&
    (value.signInPending === undefined || typeof value.signInPending === "boolean") &&
    (value.checkError === undefined || isNullableBoundedString(value.checkError, INPUT_LIMITS.messageText)) &&
    (value.cliSource === undefined || isBoundedString(value.cliSource, INPUT_LIMITS.identifier)) &&
    (value.cliIncomplete === undefined || typeof value.cliIncomplete === "boolean") &&
    (value.otherCliVersion === undefined || isBoundedString(value.otherCliVersion, 160)) &&
    (value.off === undefined || typeof value.off === "boolean") &&
    (value.restartPending === undefined || typeof value.restartPending === "boolean") &&
    (value.endpointsPending === undefined || typeof value.endpointsPending === "boolean") &&
    (value.apiKeyInUse === undefined || typeof value.apiKeyInUse === "boolean") &&
    (value.lastError === undefined || isNullableBoundedString(value.lastError, INPUT_LIMITS.messageText)) &&
    (value.lastErrorAt === undefined || isFiniteNumber(value.lastErrorAt)) &&
    (value.accounts === undefined ||
      (Array.isArray(value.accounts) &&
        value.accounts.length <= MAX_PROVIDER_ACCOUNTS &&
        value.accounts.every(isProviderAccountStatus))) &&
    (value.accountPool === undefined || isProviderAccountPool(value.accountPool)) &&
    (value.liveVoiceAccount === undefined || isProviderAccountId(value.liveVoiceAccount)) &&
    (value.modelSource === undefined || isProviderModelSource(value.modelSource))
  );
}

export function isProviderAccountPool(value: unknown): value is ProviderAccountPool {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.leftOut) &&
    value.leftOut.length <= MAX_PROVIDER_ACCOUNTS &&
    value.leftOut.every(isProviderAccountId) &&
    (value.inUse === null || isProviderAccountId(value.inUse))
  );
}

export type AgentAuthState =
  | { kind: "unknown" }
  | { kind: "signed-out" }
  | { kind: "unsupported"; accountType: string }
  | { kind: "chatgpt"; email: string | null }
  | { kind: "claude"; email: string | null }
  | { kind: "grok"; email: string | null }
  | { kind: "opencode"; email: string | null }
  | { kind: "antigravity"; email: string | null }
  | { kind: "cursor"; email: string | null }
  | { kind: "cline"; email: string | null }
  | { kind: "kimi"; email: string | null }
  | { kind: "devin"; email: string | null }
  | { kind: "copilot"; email: string | null }
  | { kind: "mistral"; email: string | null }
  | { kind: "pi"; email: string | null }
  | { kind: "muse"; email: string | null }
  | { kind: "inception"; email: string | null }
  | { kind: "deepseek"; email: string | null }
  | { kind: "openrouter"; email: string | null }
  | { kind: "hermes"; email: string | null }
  | { kind: "acp"; email: string | null };

export interface AccountUsageWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

export function isAccountUsageWindow(value: unknown): value is AccountUsageWindow {
  return (
    isDynamicRecord(value) &&
    isFiniteNumber(value.usedPercent) &&
    (value.windowDurationMins === null ||
      (isFiniteNumber(value.windowDurationMins) &&
        Number.isInteger(value.windowDurationMins) &&
        value.windowDurationMins >= 0)) &&
    (value.resetsAt === null || isFiniteNumber(value.resetsAt))
  );
}

export interface AccountUsageGroup {
  name: string;
  models: string[];
  primary: AccountUsageWindow | null;
  secondary: AccountUsageWindow | null;
}

export interface AccountUsageLimit {
  id: string;
  accountId?: string;
  primary: AccountUsageWindow | null;
  secondary: AccountUsageWindow | null;
  tertiary?: AccountUsageWindow;
  groups?: AccountUsageGroup[];
  sharedQuotaWith?: AgentProviderId;
  creditsAvailable?: boolean;
  readFailed?: true;
}

export interface AccountUsage {
  limits: AccountUsageLimit[];
}

export function isAccountUsage(value: unknown): value is AccountUsage {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.limits) &&
    value.limits.every(
      (limit) =>
        isDynamicRecord(limit) &&
        isBoundedString(limit.id, INPUT_LIMITS.identifier) &&
        (limit.accountId === undefined || isProviderAccountId(limit.accountId)) &&
        (limit.primary === null || isAccountUsageWindow(limit.primary)) &&
        (limit.secondary === null || isAccountUsageWindow(limit.secondary)) &&
        (limit.tertiary === undefined || isAccountUsageWindow(limit.tertiary)) &&
        (limit.groups === undefined ||
          (Array.isArray(limit.groups) &&
            limit.groups.length <= MAX_USAGE_GROUPS &&
            limit.groups.every(isAccountUsageGroup))) &&
        (limit.sharedQuotaWith === undefined || isAgentProvider(limit.sharedQuotaWith)) &&
        (limit.creditsAvailable === undefined || typeof limit.creditsAvailable === "boolean") &&
        (limit.readFailed === undefined || limit.readFailed === true),
    )
  );
}

export interface UsageCredits {
  provider: AgentProviderId;
  accountId: string;
  available: boolean;
}

export function decodeUsageCredits(value: unknown): UsageCredits[] {
  const invalid = () => new Error("Invalid usage credits.");
  if (!Array.isArray(value)) throw invalid();
  return value.flatMap((row: unknown) => {
    if (!isDynamicRecord(row) || !isProviderAccountId(row.accountId) || typeof row.available !== "boolean")
      throw invalid();
    return isAgentProvider(row.provider)
      ? [{ provider: row.provider, accountId: row.accountId, available: row.available }]
      : [];
  });
}

export function withUsageCredits(usage: AccountUsage, credits: readonly UsageCredits[]): AccountUsage {
  const byAccount = new Map(credits.map((row) => [JSON.stringify([row.provider, row.accountId]), row.available]));
  return {
    limits: usage.limits.map((limit) => {
      const available = byAccount.get(JSON.stringify([limit.id, limit.accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID]));
      return available === undefined ? limit : { ...limit, creditsAvailable: available };
    }),
  };
}

export function keepUsageCredits(previous: AccountUsageLimit | undefined, next: AccountUsageLimit): AccountUsageLimit {
  return next.creditsAvailable !== undefined || previous?.creditsAvailable === undefined
    ? next
    : { ...next, creditsAvailable: previous.creditsAvailable };
}

export function withReadCredits(read: AccountUsageLimit | undefined, limit: AccountUsageLimit): AccountUsageLimit {
  return read?.creditsAvailable === undefined ? limit : { ...limit, creditsAvailable: read.creditsAvailable };
}

export const MAX_USAGE_GROUPS = 16;

export function isAccountUsageGroup(value: unknown): value is AccountUsageGroup {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.name, INPUT_LIMITS.identifier) &&
    Array.isArray(value.models) &&
    value.models.length <= MAX_USAGE_GROUPS &&
    value.models.every((model) => isBoundedString(model, INPUT_LIMITS.identifier)) &&
    (value.primary === null || isAccountUsageWindow(value.primary)) &&
    (value.secondary === null || isAccountUsageWindow(value.secondary))
  );
}

export interface AgentStatus {
  phase: AgentPhase;
  cliVersion: string | null;
  auth: AgentAuthState;
  providers?: AgentProviderStatus[] | undefined;
  capabilities: {
    chat: CapabilityState;
    browser: CapabilityState;
    computerUse: CapabilityState;
  };
  message: string | null;
  fullAccess: true;
}

export function isAgentStatus(value: unknown): value is AgentStatus {
  if (!isDynamicRecord(value) || !isDynamicRecord(value.auth) || !isDynamicRecord(value.capabilities)) {
    return false;
  }
  return (
    isOneOf(AGENT_PHASES, value.phase) &&
    isNullableBoundedString(value.cliVersion, 160) &&
    isBoundedString(value.auth.kind, INPUT_LIMITS.identifier) &&
    isOneOf(CAPABILITY_STATES, value.capabilities.chat) &&
    isOneOf(CAPABILITY_STATES, value.capabilities.browser) &&
    isOneOf(CAPABILITY_STATES, value.capabilities.computerUse) &&
    (value.providers === undefined ||
      (Array.isArray(value.providers) && value.providers.every(isAgentProviderStatus))) &&
    isNullableBoundedString(value.message, INPUT_LIMITS.messageText) &&
    value.fullAccess === true
  );
}

export interface SetProviderApiKeyInput {
  provider: AgentProviderId;
  key: string;
}

export interface ConnectProviderAccountInput {
  provider: AgentProviderId;
  accountId: string | null;
}

export interface ConnectProviderAccountKeyInput extends ConnectProviderAccountInput {
  key: string;
}

export interface RenameProviderAccountInput {
  provider: AgentProviderId;
  accountId: string;
  label: string | null;
}

export interface SetProviderAccountPoolInput {
  provider: AgentProviderId;
  enabled: boolean;
  leftOut: string[];
}

export interface SetLiveVoiceAccountInput {
  accountId: string | null;
}

export interface RemoveProviderAccountInput {
  provider: AgentProviderId;
  accountId: string;
}

export interface ResetProviderUsageInput {
  provider: AgentProviderId;
  accountId: string;
}

export interface ProviderUsageResetCredit {
  id: string;
  grantedAt: number;
  expiresAt: number | null;
  title?: string | null;
  description?: string | null;
}

export interface ProviderUsageResets {
  provider: AgentProviderId;
  accountId: string;
  available: number;
  credits?: readonly ProviderUsageResetCredit[];
}

export const PROVIDER_USAGE_RESET_OUTCOMES = ["reset", "nothingToReset", "noCredit", "alreadyRedeemed"] as const;
export type ProviderUsageResetOutcome = (typeof PROVIDER_USAGE_RESET_OUTCOMES)[number];

export interface HostProviderAccounts {
  providers: { provider: AgentProviderId; accounts: ProviderAccountStatus[] }[];
  pools?: { provider: AgentProviderId; pool: ProviderAccountPool }[];
  liveVoiceAccount?: string | null;
  agents: { agentId: string; accountId: string }[];
}

export interface HostProviderAccountModels {
  providers: { provider: AgentProviderId; accounts: { accountId: string; models: AgentModelOption[] }[] }[];
}

export interface SetAgentProviderAccountInput {
  agentId: string;
  accountId: string | null;
}

export interface SubmitProviderCodeLoginInput {
  provider: AgentProviderId;
  code: string;
}

export interface SubmitProviderAccountCodeLoginInput extends SubmitProviderCodeLoginInput {
  accountId: string;
}

export type ProviderApiKeyStatus = "missing" | "saved" | "unreadable";

export interface ProviderApiKeyState {
  provider: AgentProviderId;
  status: ProviderApiKeyStatus;
}

export type ProviderCodeLoginStart =
  | {
      kind: "code";
      userCode: string;
      verificationUrl: string;
      verificationUrlComplete?: string;
      expiresAt: number;
    }
  | {
      kind: "paste";
      verificationUrl: string;
      expiresAt: number;
    }
  | {
      kind: "link";
      verificationUrl: string;
      expiresAt: number;
    }
  | { kind: "connected" };

export interface ProviderAccountCodeLoginStart {
  accountId: string;
  start: ProviderCodeLoginStart;
}

export interface ProviderAccountCodeLoginStatus {
  result: { error: string | null } | null;
}

export interface ProviderHostSignInStatus {
  tabId: string | null;
  result: { error: string | null } | null;
}

export interface ProviderRelaySignInStatus {
  page: McpSignInRelayPage | null;
  result: { error: string | null } | null;
}

export interface PasteProviderRelaySignInInput {
  provider: AgentProviderId;
  address: string;
}
