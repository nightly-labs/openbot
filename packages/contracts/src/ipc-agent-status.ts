import { type AgentProviderId, isAgentProvider } from "./agent-providers";
import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isFiniteNumber, isNullableBoundedString } from "./ipc-bounded-values";
import type { McpSignInRelayPage } from "./ipc-mcp-servers";
import { isDynamicRecord, isOneOf } from "./runtime-values";

export const AGENT_PHASES = ["idle", "starting", "ready", "restarting", "blocked", "stopped"] as const;
export type AgentPhase = (typeof AGENT_PHASES)[number];

export const CAPABILITY_STATES = ["ready", "setup-required", "unavailable"] as const;
export type CapabilityState = (typeof CAPABILITY_STATES)[number];

// The provider list lives in `agent-providers.ts` with everything else that is per-provider. It is
// re-exported here because this module was its home first and about forty files import it from
// here; the re-export keeps those imports where they are.
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
  /** Local switch only. Released Team API adapters omit it. */
  off?: boolean;
  /**
   * One of `AgentProviderId`, but treated as an open string at the trust boundary for the same
   * reason as `state`. Consumers look this up in a map or compare it, so one they do not know
   * misses rather than throws.
   */
  id: AgentProviderId;
  /**
   * The host's name for the provider. Only a Team API v8 host sends it, so a client that does not
   * know `id` can still show the provider. The local status omits it.
   */
  displayName?: string;
  /**
   * One of `AgentProviderState`, but treated as an open string at the trust boundary: a remote
   * server one release ahead may send a member we do not know yet.
   */
  state: AgentProviderState;
  version: string | null;
  message: string | null;
  email?: string | null;
  connectionState?: "connecting";
  /**
   * Sent with `connectionState`: true while a sign-in waits for the user, false while OpenBot checks
   * the provider again after a key change, a restart or an update, when no browser page opens. A
   * status without it, such as a joined server's, does not say.
   */
  signInPending?: boolean;
  checkError?: string | null;
  /**
   * Who owns the CLI binary in use. `system` is an install the user made and can update themselves,
   * with the CLI's own updater; `managed` is the pinned copy OpenBot downloaded, which only an
   * OpenBot release moves. The two have different update stories, so the picker has to tell them
   * apart, and only the provider that resolved a CLI reports one at all.
   */
  cliSource?: "system" | "managed";
  /** A restart the user asked for waits for the provider's turns to end. New turns wait for it. */
  restartPending?: boolean;
  /**
   * A saved API key serves the provider's turns in place of the plan sign-in, so the plan's usage
   * does not apply. Gemini: its saved key comes before the Google account. Codex: its own login is
   * an OpenAI API key. Local only: released Team API adapters omit it.
   */
  apiKeyInUse?: boolean;
  /**
   * The last failure of the provider, redacted, kept after its toast is gone and cleared by the next
   * good model list. Only the computer that runs the provider sends it; the Team API does not.
   */
  lastError?: string | null;
  /** When `lastError` happened, in milliseconds since the epoch. */
  lastErrorAt?: number;
  /**
   * The accounts of a provider that can hold more than one, the provider's own sign-in first as
   * `DEFAULT_PROVIDER_ACCOUNT_ID`. Absent when the provider holds one account only. Local only:
   * released Team API adapters omit it.
   */
  accounts?: ProviderAccountStatus[];
}

/** The account a provider signed in first, in the CLI's own folder. An agent with no account uses it. */
export const DEFAULT_PROVIDER_ACCOUNT_ID = "default";

const PROVIDER_ACCOUNT_ID = /^(?:default|a[0-9a-f]{16})$/u;

/** The provider's own sign-in, or an account after the first as the account store names it. */
export function isProviderAccountId(value: unknown): value is string {
  return typeof value === "string" && PROVIDER_ACCOUNT_ID.test(value);
}

/** The most accounts one provider can hold, its own sign-in included. */
export const MAX_PROVIDER_ACCOUNTS = 10;

export const PROVIDER_ACCOUNT_STATES = ["connected", "connecting", "checking", "signed-out", "error"] as const;
export type ProviderAccountState = (typeof PROVIDER_ACCOUNT_STATES)[number];

/** One account of a provider. Its credentials stay in its own folder on the computer that runs it. */
export interface ProviderAccountStatus {
  id: string;
  /** The name the user gave it. Null shows the email. */
  label: string | null;
  email: string | null;
  /** One of `ProviderAccountState`, open at the trust boundary like the provider `state`. */
  state: ProviderAccountState;
  message: string | null;
}

/** The longest name a user can give a provider account. */
export const PROVIDER_ACCOUNT_LABEL_MAX_LENGTH = 60;

export function isProviderAccountStatus(value: unknown): value is ProviderAccountStatus {
  return (
    isDynamicRecord(value) &&
    isProviderAccountId(value.id) &&
    isNullableBoundedString(value.label, PROVIDER_ACCOUNT_LABEL_MAX_LENGTH) &&
    isNullableBoundedString(value.email, INPUT_LIMITS.email) &&
    isBoundedString(value.state, INPUT_LIMITS.identifier) &&
    isNullableBoundedString(value.message, INPUT_LIMITS.messageText)
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
    (value.off === undefined || typeof value.off === "boolean") &&
    (value.restartPending === undefined || typeof value.restartPending === "boolean") &&
    (value.apiKeyInUse === undefined || typeof value.apiKeyInUse === "boolean") &&
    (value.lastError === undefined || isNullableBoundedString(value.lastError, INPUT_LIMITS.messageText)) &&
    (value.lastErrorAt === undefined || isFiniteNumber(value.lastErrorAt)) &&
    (value.accounts === undefined ||
      (Array.isArray(value.accounts) &&
        value.accounts.length <= MAX_PROVIDER_ACCOUNTS &&
        value.accounts.every(isProviderAccountStatus)))
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
  | { kind: "pi"; email: string | null }
  | { kind: "muse"; email: string | null }
  | { kind: "inception"; email: string | null }
  | { kind: "deepseek"; email: string | null }
  | { kind: "openrouter"; email: string | null }
  | { kind: "acp"; email: string | null };

export interface AccountUsageWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

function isAccountUsageWindow(value: unknown): value is AccountUsageWindow {
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

/** A quota that the provider names and that limits only some of its models, such as Gemini 4 Argon. */
export interface AccountUsageGroup {
  /** The provider's name for the group, such as "Gemini Models". */
  name: string;
  /** The model names that the provider lists for the group, such as "Gemini Flash". */
  models: string[];
  primary: AccountUsageWindow | null;
  secondary: AccountUsageWindow | null;
}

export interface AccountUsageLimit {
  id: string;
  /** The provider account the reading is for. Absent for the provider's own sign-in. */
  accountId?: string;
  primary: AccountUsageWindow | null;
  secondary: AccountUsageWindow | null;
  /**
   * Antigravity only: each quota group of the plan. `primary` and `secondary` are then the group of
   * the model that was read, or the "Gemini Models" group. The Team API does not send this field.
   */
  groups?: AccountUsageGroup[];
  /**
   * The provider whose plan quota this reading also counts: Grok for Cursor on a merged plan. The
   * rail then shows the ring of that provider alone. The Team API does not send this field.
   */
  sharedQuotaWith?: AgentProviderId;
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
        (limit.groups === undefined ||
          (Array.isArray(limit.groups) &&
            limit.groups.length <= MAX_USAGE_GROUPS &&
            limit.groups.every(isAccountUsageGroup))) &&
        (limit.sharedQuotaWith === undefined || isAgentProvider(limit.sharedQuotaWith)),
    )
  );
}

/** The most groups in one reading, and the most models in one group. */
export const MAX_USAGE_GROUPS = 16;

function isAccountUsageGroup(value: unknown): value is AccountUsageGroup {
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
  /**
   * `kind` is one of the members above, but treated as an open string at the trust boundary: a
   * remote server one release ahead may send a member we do not know yet, and rejecting the whole
   * status would stop every update from it.
   */
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

/** Signs a provider account in: a new one when `accountId` is null, or one that is signed out. */
export interface ConnectProviderAccountInput {
  provider: AgentProviderId;
  accountId: string | null;
}

/** A null label returns the account to its email. */
export interface RenameProviderAccountInput {
  provider: AgentProviderId;
  accountId: string;
  label: string | null;
}

/** Removes an account and its credentials. Its agents move to the provider's own sign-in. */
export interface RemoveProviderAccountInput {
  provider: AgentProviderId;
  accountId: string;
}

/** Spends one usage reset credit of a provider account, which restores its spent limits now. */
export interface ResetProviderUsageInput {
  provider: AgentProviderId;
  accountId: string;
}

/**
 * The usage reset credits that a provider gave one account, as its last usage reading counted them.
 * Codex gives them; an account of another provider has none.
 */
export interface ProviderUsageResets {
  provider: AgentProviderId;
  /** `DEFAULT_PROVIDER_ACCOUNT_ID` for the provider's own sign-in. */
  accountId: string;
  available: number;
}

/**
 * What the provider did with a reset. `nothingToReset` and `alreadyRedeemed` spend no new credit;
 * `noCredit` means the account had none left.
 */
export const PROVIDER_USAGE_RESET_OUTCOMES = ["reset", "nothingToReset", "noCredit", "alreadyRedeemed"] as const;
export type ProviderUsageResetOutcome = (typeof PROVIDER_USAGE_RESET_OUTCOMES)[number];

/**
 * The accounts of a joined server's host (`provider-accounts-v1`). The host's released status and
 * agent list do not carry them, so the client adds them to its copy.
 */
export interface HostProviderAccounts {
  providers: { provider: AgentProviderId; accounts: ProviderAccountStatus[] }[];
  /** The agents on an account after the first. Every other agent uses the provider's own sign-in. */
  agents: { agentId: string; accountId: string }[];
}

/** Moves an agent of a joined server to an account of its provider. Null is the provider's own sign-in. */
export interface SetAgentProviderAccountInput {
  agentId: string;
  accountId: string | null;
}

/** The code a `paste` sign-in's page showed. It is a credential: it only travels towards the host. */
export interface SubmitProviderCodeLoginInput {
  provider: AgentProviderId;
  code: string;
}

/**
 * Whether a key is stored. `unreadable` is a key file OpenBot could not decrypt or parse: the
 * provider then runs with no key, and the file stays on disk until the user replaces or removes it.
 */
export type ProviderApiKeyStatus = "missing" | "saved" | "unreadable";

/** What the renderer may know about a stored key: its status. Never the key. */
export interface ProviderApiKeyState {
  provider: AgentProviderId;
  status: ProviderApiKeyStatus;
}

/**
 * What a started code sign-in gives the renderer: a code to show, or nothing left to do.
 *
 * `connected` is the provider that turned out to be signed in already, which the user reaches by
 * asking for a code on a computer where the account arrived some other way. The token traded for
 * the code never crosses this boundary; how the sign-in ends arrives as a provider status, the same
 * way the browser sign-in's does.
 */
export type ProviderCodeLoginStart =
  | {
      kind: "code";
      /** The one-time code the user types on the other device. Safe to show and to read out. */
      userCode: string;
      /** The page to type it on. Always https. */
      verificationUrl: string;
      /** The same page with the code filled in, when the provider gives one. The dialog's QR code opens it. */
      verificationUrlComplete?: string;
      /** Epoch milliseconds. When OpenBot gives up on this code, which is what the dialog counts down to. */
      expiresAt: number;
    }
  | {
      /**
       * The user signs in on the page, which then shows a code for them to copy back. OpenBot types
       * it into the provider's CLI with `submitProviderCodeLogin`.
       */
      kind: "paste";
      /** The provider's sign-in page. Always https. */
      verificationUrl: string;
      /** Epoch milliseconds, as for `code`. */
      expiresAt: number;
    }
  | {
      /** The user signs in on the page, and the provider's CLI sees it by itself. No code is shown or copied. */
      kind: "link";
      /** The provider's sign-in page. Always https. */
      verificationUrl: string;
      /** Epoch milliseconds, as for `code`. */
      expiresAt: number;
    }
  | { kind: "connected" };

/**
 * A sign-in that a joined server's host runs in its own browser (`provider-host-sign-in-v1`). `tabId`
 * is the host tab with the page while it is open, and `result` says how the sign-in ended. Both are
 * `null` while the host waits for the page.
 */
export interface ProviderHostSignInStatus {
  tabId: string | null;
  result: { error: string | null } | null;
}

/**
 * A sign-in that a joined server's host started and that opens in this computer's browser
 * (`sign-in-relay-v1`). `page` is set while the page waits for the user, and `result` says how the
 * sign-in ended. Both are `null` while the host has no page address.
 */
export interface ProviderRelaySignInStatus {
  page: McpSignInRelayPage | null;
  result: { error: string | null } | null;
}

/** The address that the browser of a relayed provider sign-in shows. It holds a grant. */
export interface PasteProviderRelaySignInInput {
  provider: AgentProviderId;
  address: string;
}
