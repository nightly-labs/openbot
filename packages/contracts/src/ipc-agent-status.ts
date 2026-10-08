import type { AgentProviderId } from "./agent-providers";
import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isFiniteNumber, isNullableBoundedString } from "./ipc-bounded-values";
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
  /**
   * One of `AgentProviderId`, but treated as an open string at the trust boundary for the same
   * reason as `state`. Consumers look this up in a map or compare it, so one they do not know
   * misses rather than throws.
   */
  id: AgentProviderId;
  /**
   * One of `AgentProviderState`, but treated as an open string at the trust boundary: a remote
   * server one release ahead may send a member we do not know yet.
   */
  state: AgentProviderState;
  version: string | null;
  message: string | null;
  email?: string | null;
  connectionState?: "connecting";
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
   * The last failure of the provider, redacted, kept after its toast is gone and cleared by the next
   * good model list. Only the computer that runs the provider sends it; the Team API does not.
   */
  lastError?: string | null;
  /** When `lastError` happened, in milliseconds since the epoch. */
  lastErrorAt?: number;
}

function isAgentProviderStatus(value: unknown): value is AgentProviderStatus {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.id, INPUT_LIMITS.identifier) &&
    isBoundedString(value.state, INPUT_LIMITS.identifier) &&
    isNullableBoundedString(value.version, 160) &&
    isNullableBoundedString(value.message, INPUT_LIMITS.messageText) &&
    (value.email === undefined || isNullableBoundedString(value.email, INPUT_LIMITS.email)) &&
    (value.connectionState === undefined || isBoundedString(value.connectionState, INPUT_LIMITS.identifier)) &&
    (value.checkError === undefined || isNullableBoundedString(value.checkError, INPUT_LIMITS.messageText)) &&
    (value.cliSource === undefined || isBoundedString(value.cliSource, INPUT_LIMITS.identifier)) &&
    (value.restartPending === undefined || typeof value.restartPending === "boolean") &&
    (value.lastError === undefined || isNullableBoundedString(value.lastError, INPUT_LIMITS.messageText)) &&
    (value.lastErrorAt === undefined || isFiniteNumber(value.lastErrorAt))
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

/**
 * What a named window counts: the whole plan (`window`), one model or model family (`model`), or
 * paid usage over the plan (`extra`).
 */
export const ACCOUNT_USAGE_WINDOW_KINDS = ["window", "model", "extra"] as const;
export type AccountUsageWindowKind = (typeof ACCOUNT_USAGE_WINDOW_KINDS)[number];

/** One quota window as the provider reports it, beside the two that `primary` and `secondary` keep. */
export interface AccountUsageNamedWindow extends AccountUsageWindow {
  kind: AccountUsageWindowKind;
  /** The provider's own name for the bucket, such as a model name. It is shown as sent. */
  label: string | null;
  /** Spend in US dollars, for an `extra` window that reports it. */
  spentUsd?: number | null;
  limitUsd?: number | null;
}

/** A credit balance. `credits` counts provider credits. */
export interface AccountUsageCredits {
  kind: "credits";
  balance: number | null;
  unlimited: boolean;
}

const ACCOUNT_USAGE_DETAIL_LIMIT = 32;
const ACCOUNT_USAGE_LABEL_LIMIT = 160;

export interface AccountUsageLimit {
  id: string;
  primary: AccountUsageWindow | null;
  secondary: AccountUsageWindow | null;
  /**
   * Every window the provider reports, in its order. Optional: an older host, and the Team API,
   * send only `primary` and `secondary`, which stay the reading that gates turns.
   */
  windows?: AccountUsageNamedWindow[];
  credits?: AccountUsageCredits[];
}

export interface AccountUsage {
  limits: AccountUsageLimit[];
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || value === null || isFiniteNumber(value);
}

function isAccountUsageNamedWindow(value: unknown): value is AccountUsageNamedWindow {
  return (
    isAccountUsageWindow(value) &&
    isDynamicRecord(value) &&
    isOneOf(ACCOUNT_USAGE_WINDOW_KINDS, value.kind) &&
    isNullableBoundedString(value.label, ACCOUNT_USAGE_LABEL_LIMIT) &&
    isOptionalFiniteNumber(value.spentUsd) &&
    isOptionalFiniteNumber(value.limitUsd)
  );
}

function isAccountUsageCredits(value: unknown): value is AccountUsageCredits {
  return (
    isDynamicRecord(value) &&
    value.kind === "credits" &&
    (value.balance === null || isFiniteNumber(value.balance)) &&
    typeof value.unlimited === "boolean"
  );
}

function isAccountUsageLimit(limit: unknown): limit is AccountUsageLimit {
  return (
    isDynamicRecord(limit) &&
    isBoundedString(limit.id, INPUT_LIMITS.identifier) &&
    (limit.primary === null || isAccountUsageWindow(limit.primary)) &&
    (limit.secondary === null || isAccountUsageWindow(limit.secondary)) &&
    (limit.windows === undefined ||
      (Array.isArray(limit.windows) &&
        limit.windows.length <= ACCOUNT_USAGE_DETAIL_LIMIT &&
        limit.windows.every(isAccountUsageNamedWindow))) &&
    (limit.credits === undefined ||
      (Array.isArray(limit.credits) &&
        limit.credits.length <= ACCOUNT_USAGE_DETAIL_LIMIT &&
        limit.credits.every(isAccountUsageCredits)))
  );
}

export function isAccountUsage(value: unknown): value is AccountUsage {
  return isDynamicRecord(value) && Array.isArray(value.limits) && value.limits.every(isAccountUsageLimit);
}

/**
 * Checks a usage reading at a trust boundary. `primary` and `secondary` stay strict, as before.
 * The optional `windows` and `credits` are details only: a member this build cannot read, such as a
 * kind a newer host added, is dropped, and does not reject the reading that gates turns.
 */
export function decodeAccountUsage(value: unknown): AccountUsage | null {
  if (!isDynamicRecord(value) || !Array.isArray(value.limits)) return null;
  const limits = value.limits.map((limit: unknown) => {
    if (!isDynamicRecord(limit)) return limit;
    const { windows, credits, ...rest } = limit;
    return {
      ...rest,
      ...(Array.isArray(windows)
        ? { windows: windows.filter(isAccountUsageNamedWindow).slice(0, ACCOUNT_USAGE_DETAIL_LIMIT) }
        : {}),
      ...(Array.isArray(credits)
        ? { credits: credits.filter(isAccountUsageCredits).slice(0, ACCOUNT_USAGE_DETAIL_LIMIT) }
        : {}),
    };
  });
  const decoded = { ...value, limits };
  return isAccountUsage(decoded) ? decoded : null;
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
  providers?: AgentProviderStatus[];
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
