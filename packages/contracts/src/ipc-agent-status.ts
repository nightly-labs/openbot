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
    (value.cliSource === undefined || isBoundedString(value.cliSource, INPUT_LIMITS.identifier))
  );
}

export type AgentAuthState =
  | { kind: "unknown" }
  | { kind: "signed-out" }
  | { kind: "unsupported"; accountType: string }
  | { kind: "chatgpt"; email: string | null }
  | { kind: "claude"; email: string | null }
  | { kind: "grok"; email: string | null };

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

export interface AccountUsageLimit {
  id: string;
  primary: AccountUsageWindow | null;
  secondary: AccountUsageWindow | null;
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
        (limit.primary === null || isAccountUsageWindow(limit.primary)) &&
        (limit.secondary === null || isAccountUsageWindow(limit.secondary)),
    )
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
