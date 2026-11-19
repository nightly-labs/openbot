import { type AvatarHue, isAvatarHue } from "./ipc-agent-identity";
import { integerInRange, isIdentifier } from "./ipc-bounded-values";
import { type DynamicRecord, isDynamicRecord, isString } from "./runtime-values";

export const BROWSER_PROFILE_NAME_MAX = 60;
export const BROWSER_PROFILE_LIMIT = 100;

const BROWSER_PROFILE_ID = /^[0-9a-f]{32}$/u;

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

export function browserProfileName(value: unknown): string | null {
  if (!isString(value)) return null;
  const name = value.trim();
  return name.length > 0 && name.length <= BROWSER_PROFILE_NAME_MAX ? name : null;
}

export type AgentBrowserProfile = { kind: "shared" } | { kind: "agent" } | { kind: "profile"; profileId: string };

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
  hue: AvatarHue;
  agentIds: string[];
  tabCount: number;
}

export interface BrowserProfileList {
  profiles: BrowserProfileSummary[];
  sharedAgentIds: string[];
}

export type UpdateBrowserProfileInput = {
  profileId: string;
} & ({ name: string; hue?: AvatarHue } | { name?: string; hue: AvatarHue });

export type ClearBrowserDataInput = { profileId: string } | { agentId: string };

export interface UpdateAgentBrowserProfileInput {
  agentId: string;
  profile: AgentBrowserProfile;
}

export interface BrowserTabProfile {
  tabId: string;
  name: string | null;
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
    if (entry.name === null && entry.hue === null) return { tabId: entry.tabId, name: null, hue: null };
    const name = browserProfileName(entry.name);
    if (name === null || !isAvatarHue(entry.hue)) throw new Error("Invalid browser tab profile.");
    return { tabId: entry.tabId, name, hue: entry.hue };
  });
}

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
