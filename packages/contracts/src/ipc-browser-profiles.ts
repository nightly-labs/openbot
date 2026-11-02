/**
 * Browser profiles: named, persistent browser sessions on the computer that runs the agents. Each
 * agent uses one of them, its own session, or the shared session. The name is only a label; the
 * random id names the Chromium partition, so a rename does not move data.
 */

import { type AvatarHue, isAvatarHue } from "./ipc-agent-identity";
import { integerInRange, isIdentifier } from "./ipc-bounded-values";
import { type DynamicRecord, isDynamicRecord, isString } from "./runtime-values";

export const BROWSER_PROFILE_NAME_MAX = 60;
export const BROWSER_PROFILE_LIMIT = 100;

const BROWSER_PROFILE_ID = /^[0-9a-f]{32}$/u;

/**
 * The colors that a new profile gets, in order: the first one with the fewest profiles. Neighbors
 * are far apart on the color wheel, so the first profiles are easy to tell apart. Red is last,
 * because it also marks errors.
 */
export const BROWSER_PROFILE_HUES = [215, 30, 150, 320, 55, 185, 245, 0] as const satisfies readonly AvatarHue[];

export function nextBrowserProfileHue(used: readonly AvatarHue[]): AvatarHue {
  const count = (hue: AvatarHue) => used.filter((candidate) => candidate === hue).length;
  return BROWSER_PROFILE_HUES.reduce<AvatarHue>(
    (best, hue) => (count(hue) < count(best) ? hue : best),
    BROWSER_PROFILE_HUES[0],
  );
}

export function isBrowserProfileId(value: unknown): value is string {
  return isString(value) && BROWSER_PROFILE_ID.test(value);
}

/** The trimmed name, or null when it is empty or too long. */
export function browserProfileName(value: unknown): string | null {
  if (!isString(value)) return null;
  const name = value.trim();
  return name.length > 0 && name.length <= BROWSER_PROFILE_NAME_MAX ? name : null;
}

/**
 * The session that the browser tabs of one agent use. `shared`: the session of every agent and of
 * the user. `agent`: a session of this agent only. `profile`: a named profile that other agents can
 * also use.
 */
export type AgentBrowserProfile = { kind: "shared" } | { kind: "agent" } | { kind: "profile"; profileId: string };

/** The choice that the stored agent fields give. A named profile comes before the agent session. */
export function agentBrowserProfile(agent: {
  ownBrowserSession?: boolean | undefined;
  browserProfileId?: string | undefined;
}): AgentBrowserProfile {
  if (agent.browserProfileId !== undefined) return { kind: "profile", profileId: agent.browserProfileId };
  return agent.ownBrowserSession === true ? { kind: "agent" } : { kind: "shared" };
}

export function sameAgentBrowserProfile(left: AgentBrowserProfile, right: AgentBrowserProfile): boolean {
  return (
    left.kind === right.kind &&
    (left.kind !== "profile" || right.kind !== "profile" || left.profileId === right.profileId)
  );
}

export function isAgentBrowserProfile(value: unknown): value is AgentBrowserProfile {
  if (!isDynamicRecord(value)) return false;
  if (value.kind === "shared" || value.kind === "agent") return Object.keys(value).length === 1;
  return value.kind === "profile" && isBrowserProfileId(value.profileId) && Object.keys(value).length === 2;
}

export interface BrowserProfileSummary {
  id: string;
  name: string;
  /** The color of the profile's labels. */
  hue: AvatarHue;
  /** The agents that use the profile. */
  agentIds: string[];
  /** The open tabs in the profile. */
  tabCount: number;
}

/** The named profiles of one computer, and the agents that use its shared session. */
export interface BrowserProfileList {
  profiles: BrowserProfileSummary[];
  sharedAgentIds: string[];
}

/** A new name, a new color, or both. */
export type UpdateBrowserProfileInput = {
  profileId: string;
} & ({ name: string; hue?: AvatarHue } | { name?: string; hue: AvatarHue });

/** Which data to clear: a named profile, or the session of one agent. */
export type ClearBrowserDataInput = { profileId: string } | { agentId: string };

export interface UpdateAgentBrowserProfileInput {
  agentId: string;
  profile: AgentBrowserProfile;
}

/** The profile of one open tab. A tab in the shared session has no entry. */
export interface BrowserTabProfile {
  tabId: string;
  /** Null for the session of one agent: it has no name. */
  name: string | null;
  /** Null for the session of one agent: it has no color. */
  hue: AvatarHue | null;
}

export function decodeBrowserProfileSummary(value: unknown): BrowserProfileSummary {
  const name = isDynamicRecord(value) ? browserProfileName(value.name) : null;
  if (
    !isDynamicRecord(value) ||
    !isBrowserProfileId(value.id) ||
    name === null ||
    !isAvatarHue(value.hue) ||
    !Array.isArray(value.agentIds) ||
    !value.agentIds.every(isIdentifier) ||
    !integerInRange(value.tabCount, 0, Number.MAX_SAFE_INTEGER)
  )
    throw new Error("Invalid browser profile.");
  return { id: value.id, name, hue: value.hue, agentIds: [...value.agentIds], tabCount: value.tabCount };
}

export function decodeBrowserProfileList(value: unknown): BrowserProfileList {
  if (
    !isDynamicRecord(value) ||
    !Array.isArray(value.profiles) ||
    value.profiles.length > BROWSER_PROFILE_LIMIT ||
    !Array.isArray(value.sharedAgentIds) ||
    !value.sharedAgentIds.every(isIdentifier)
  )
    throw new Error("Invalid browser profiles.");
  return { profiles: value.profiles.map(decodeBrowserProfileSummary), sharedAgentIds: [...value.sharedAgentIds] };
}

export function decodeAgentBrowserProfile(value: unknown): AgentBrowserProfile {
  if (!isAgentBrowserProfile(value)) throw new Error("Invalid browser profile.");
  return value.kind === "profile" ? { kind: "profile", profileId: value.profileId } : { kind: value.kind };
}

export function decodeBrowserTabProfiles(value: unknown): BrowserTabProfile[] {
  if (!Array.isArray(value)) throw new Error("Invalid browser tab profiles.");
  return value.map((entry): BrowserTabProfile => {
    if (!isDynamicRecord(entry) || !isIdentifier(entry.tabId)) throw new Error("Invalid browser tab profile.");
    // The session of one agent has neither a name nor a color; a named profile has both.
    if (entry.name === null && entry.hue === null) return { tabId: entry.tabId, name: null, hue: null };
    const name = browserProfileName(entry.name);
    if (name === null || !isAvatarHue(entry.hue)) throw new Error("Invalid browser tab profile.");
    return { tabId: entry.tabId, name, hue: entry.hue };
  });
}

/** The answer of the `browser-profiles-v1` tab route, `{ tabs }`. */
export function decodeHostBrowserTabProfiles(value: unknown): BrowserTabProfile[] {
  if (!isDynamicRecord(value)) throw new Error("Invalid browser tab profiles.");
  return decodeBrowserTabProfiles(value.tabs);
}

function requireName(value: DynamicRecord, key: string): string {
  const name = browserProfileName(value[key]);
  if (name === null) throw new Error("Invalid browser profile name.");
  return name;
}

export function parseBrowserProfileName(value: unknown): string {
  return requireName({ name: value }, "name");
}

export function parseBrowserProfileId(value: unknown): string {
  if (!isBrowserProfileId(value)) throw new Error("Invalid browser profile.");
  return value;
}

export function parseUpdateBrowserProfileInput(value: unknown): UpdateBrowserProfileInput {
  if (!isDynamicRecord(value)) throw new Error("Invalid browser profile.");
  const profileId = parseBrowserProfileId(value.profileId);
  if (value.hue !== undefined && !isAvatarHue(value.hue)) throw new Error("Invalid browser profile color.");
  if (value.name === undefined) {
    if (value.hue === undefined) throw new Error("Invalid browser profile.");
    return { profileId, hue: value.hue };
  }
  const name = requireName(value, "name");
  return value.hue === undefined ? { profileId, name } : { profileId, name, hue: value.hue };
}

export function parseClearBrowserDataInput(value: unknown): ClearBrowserDataInput {
  if (isDynamicRecord(value) && Object.keys(value).length === 1) {
    if (isBrowserProfileId(value.profileId)) return { profileId: value.profileId };
    if (isIdentifier(value.agentId)) return { agentId: value.agentId };
  }
  throw new Error("Invalid browser data target.");
}

export function parseUpdateAgentBrowserProfileInput(value: unknown): UpdateAgentBrowserProfileInput {
  if (!isDynamicRecord(value) || !isIdentifier(value.agentId)) throw new Error("Invalid browser profile.");
  return { agentId: value.agentId, profile: decodeAgentBrowserProfile(value.profile) };
}
