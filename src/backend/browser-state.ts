import { createHash } from "node:crypto";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { type BrowserBounds, type BrowserEnvironment, isBrowserProfileId } from "@openbot/contracts/ipc";
import { type DynamicRecord, isBoolean, isNumber, isString } from "@openbot/contracts/runtime-values";
import { legacyAgentId } from "@openbot/contracts/validation";
import { Effect } from "effect";
import type { BrowserToolArguments } from "./browser-tools";
import { isRecord } from "./protocol";
import { readVersionedJsonFile, type VersionedJsonFormat } from "./versioned-json-store";

export interface StoredBrowserTab {
  id: string;
  url: string;
  ownerThreadId: string | null;
  ownerAgentId: string | null;
  environment?: BrowserEnvironment;
  agentSession?: string;
  profile?: string;
  sharedThreadIds?: string[];
}

export type BrowserTabSession = { kind: "agent"; key: string } | { kind: "profile"; profileId: string };

export function browserTabPartition(tabSession: BrowserTabSession): string {
  return tabSession.kind === "agent"
    ? `openbot-browser-agent-${tabSession.key}`
    : `openbot-browser-profile-${tabSession.profileId}`;
}

export function storedTabSession(
  tab: Pick<StoredBrowserTab, "agentSession" | "profile">,
): BrowserTabSession | undefined {
  if (tab.profile !== undefined) return { kind: "profile", profileId: tab.profile };
  return tab.agentSession === undefined ? undefined : { kind: "agent", key: tab.agentSession };
}

export function storedSessionFields(
  tabSession: BrowserTabSession | undefined,
): Pick<StoredBrowserTab, "agentSession" | "profile"> {
  if (!tabSession) return {};
  if (tabSession.kind === "agent") return { agentSession: tabSession.key };
  return {
    agentSession: agentBrowserSessionKey(`browser-profile:${tabSession.profileId}`),
    profile: tabSession.profileId,
  };
}

export function agentBrowserSessionKey(agentId: string): string {
  return createHash("sha256").update(agentId).digest("hex").slice(0, 32);
}

function isAgentBrowserSessionKey(value: unknown): value is string {
  return isString(value) && /^[0-9a-f]{32}$/.test(value);
}

const MAX_PHYSICAL_VIEWPORT_PIXELS = 8_388_608;

function isSafeViewportSize(width: number, height: number, deviceScaleFactor: number): boolean {
  return width * height * deviceScaleFactor * deviceScaleFactor <= MAX_PHYSICAL_VIEWPORT_PIXELS;
}

export function defaultBrowserEnvironment(): BrowserEnvironment {
  return {
    viewport: { mode: "fill", width: 1200, height: 800, deviceScaleFactor: 1, preset: null },
    colorScheme: "system",
    reducedMotion: false,
  };
}

function browserEnvironment(value: unknown): BrowserEnvironment | null {
  if (!isRecord(value) || !isRecord(value.viewport)) return null;
  const viewport = value.viewport;
  if (viewport.mode !== "fill" && viewport.mode !== "custom") return null;
  const minimumWidth = viewport.mode === "fill" ? 1 : 320;
  const minimumHeight = viewport.mode === "fill" ? 1 : 240;
  if (!isNumber(viewport.width) || viewport.width < minimumWidth || viewport.width > INPUT_LIMITS.browserDimension) {
    return null;
  }
  if (
    !isNumber(viewport.height) ||
    viewport.height < minimumHeight ||
    viewport.height > INPUT_LIMITS.browserDimension
  ) {
    return null;
  }
  if (!isNumber(viewport.deviceScaleFactor) || viewport.deviceScaleFactor < 0.5 || viewport.deviceScaleFactor > 4) {
    return null;
  }
  if (!isSafeViewportSize(viewport.width, viewport.height, viewport.deviceScaleFactor)) return null;
  if (
    viewport.preset !== null &&
    viewport.preset !== "desktop" &&
    viewport.preset !== "tablet" &&
    viewport.preset !== "mobile"
  ) {
    return null;
  }
  if (value.colorScheme !== "light" && value.colorScheme !== "dark" && value.colorScheme !== "system") return null;
  if (!isBoolean(value.reducedMotion)) return null;
  return {
    viewport: {
      mode: viewport.mode,
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor,
      preset: viewport.preset,
    },
    colorScheme: value.colorScheme,
    reducedMotion: value.reducedMotion,
  };
}

const X_HOSTS = new Set(["x.com", "www.x.com"]);
const X_LANDING_URL = "https://x.com/";

export function persistentBrowserUrl(value: string, options: { popup?: boolean } = {}): string {
  const url = new URL(value);
  if (X_HOSTS.has(url.hostname) && url.pathname === "/i/jf/onboarding/web") {
    return X_LANDING_URL;
  }
  if (options.popup) {
    url.username = "";
    url.password = "";
    const fragment = new URLSearchParams(url.hash.slice(1));
    let changedFragment = false;
    for (const key of ["code", "state", "access_token", "id_token", "refresh_token", "oauth_token", "oauth_verifier"]) {
      url.searchParams.delete(key);
      if (fragment.has(key)) {
        fragment.delete(key);
        changedFragment = true;
      }
    }
    if (changedFragment) url.hash = fragment.toString();
  }
  return url.toString();
}

export function isPersistableBrowserUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function storedBrowserTab(value: unknown): StoredBrowserTab | null {
  if (
    !isRecord(value) ||
    !isString(value.id) ||
    !value.id ||
    value.id.length > INPUT_LIMITS.identifier ||
    !isString(value.url) ||
    value.url.length > INPUT_LIMITS.browserUrl
  ) {
    return null;
  }
  const ownerThreadId = value.ownerThreadId;
  if (ownerThreadId !== null && (!isString(ownerThreadId) || ownerThreadId.length > INPUT_LIMITS.identifier)) {
    return null;
  }
  const ownerAgentId = value.ownerAgentId === undefined ? (value.ownerBotId ?? null) : value.ownerAgentId;
  if (ownerAgentId !== null && (!isString(ownerAgentId) || ownerAgentId.length > INPUT_LIMITS.identifier)) {
    return null;
  }
  if (!isPersistableBrowserUrl(value.url)) return null;
  if (value.agentSession !== undefined && !isAgentBrowserSessionKey(value.agentSession)) return null;
  if (value.profile !== undefined && !isBrowserProfileId(value.profile)) return null;
  const environment = browserEnvironment(value.environment);
  const sharedThreadIds = storedSharedThreadIds(value.sharedThreadIds);
  return {
    id: value.id,
    url: value.url,
    ownerThreadId,
    ownerAgentId,
    ...(environment === null ? {} : { environment }),
    ...(value.agentSession === undefined ? {} : { agentSession: value.agentSession }),
    ...(value.profile === undefined ? {} : { profile: value.profile }),
    ...(sharedThreadIds.length === 0 ? {} : { sharedThreadIds }),
  };
}

const SHARED_THREAD_LIMIT = 64;

function storedSharedThreadIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter((id): id is string => isString(id) && id.length > 0 && id.length <= INPUT_LIMITS.identifier);
  return [...new Set(ids)].slice(0, SHARED_THREAD_LIMIT);
}

export interface BrowserTabOwner {
  id: string;
  threadId: string | null;
}

export function reownStoredBrowserTab(tab: StoredBrowserTab, agents: readonly BrowserTabOwner[]): StoredBrowserTab {
  if (tab.ownerAgentId === null && tab.ownerThreadId === null) return tab;
  const owner = tabOwner(tab, agents);
  if (!owner) return tab;
  const ownerThreadId = tab.ownerThreadId === null || owner.threadId === null ? tab.ownerThreadId : owner.threadId;
  const ownerAgentId = tab.ownerAgentId === null ? null : owner.id;
  if (ownerThreadId === tab.ownerThreadId && ownerAgentId === tab.ownerAgentId) return tab;
  return { ...tab, ownerThreadId, ownerAgentId };
}

function tabOwner(tab: StoredBrowserTab, agents: readonly BrowserTabOwner[]): BrowserTabOwner | undefined {
  const claims: ((agent: BrowserTabOwner) => boolean)[] = [
    (agent) => agent.id === tab.ownerAgentId,
    (agent) => tab.ownerThreadId !== null && agent.threadId === tab.ownerThreadId,
    (agent) => tab.ownerAgentId !== null && legacyAgentId(agent.id) === tab.ownerAgentId,
    (agent) => tab.ownerThreadId !== null && legacyThreadId(agent) === tab.ownerThreadId,
  ];
  for (const claim of claims) {
    const owner = agents.find(claim);
    if (owner) return owner;
  }
  return undefined;
}

function legacyThreadId(agent: BrowserTabOwner): string | null {
  if (agent.threadId === null) return null;
  return agent.threadId.replace(agent.id, legacyAgentId(agent.id));
}

export interface StoredBrowserStateV2 {
  version: 2;
  activeTabId: string | null;
  tabs: Array<StoredBrowserTab & { environment: BrowserEnvironment }>;
}
const BROWSER_STATE_FORMAT: VersionedJsonFormat<StoredBrowserStateV2> = {
  current: 2,
  releases: { 1: (file) => browserStateFromFile(file, 1), 2: (file) => browserStateFromFile(file, 2) },
};

export const readBrowserState = Effect.fn("Browser.readState")(function* (path: string) {
  const loaded = yield* readVersionedJsonFile(path, BROWSER_STATE_FORMAT);
  const state: StoredBrowserStateV2 = loaded.value ?? { version: 2, activeTabId: null, tabs: [] };
  return { state, writePath: loaded.writePath };
});

function browserStateFromFile(file: DynamicRecord, version: 1 | 2): StoredBrowserStateV2 {
  const tabs = Array.isArray(file.tabs)
    ? file.tabs
        .map(storedBrowserTab)
        .filter((tab) => tab !== null)
        .map((tab) => ({
          ...tab,
          url: persistentBrowserUrl(tab.url),
          environment: (version === 2 ? tab.environment : undefined) ?? defaultBrowserEnvironment(),
        }))
    : [];
  return {
    version: 2,
    activeTabId: isString(file.activeTabId) ? file.activeTabId : null,
    tabs: tabs.filter((tab, index) => tabs.findIndex((candidate) => candidate.id === tab.id) === index),
  };
}

export function resolveEnvironment(
  value: BrowserToolArguments<"set_environment">,
  current: BrowserEnvironment,
  bounds: BrowserBounds,
): BrowserEnvironment {
  const preset = value.preset;
  const presetSize = presetDimensions(preset);
  const explicitScale = value.deviceScaleFactor !== undefined;
  const scaleConvertsFill =
    explicitScale && (preset === "fill" || (preset === undefined && current.viewport.mode === "fill"));
  const requestedWidth =
    value.width ??
    presetSize?.width ??
    (preset === "fill" || scaleConvertsFill ? bounds.width : current.viewport.width);
  const requestedHeight =
    value.height ??
    presetSize?.height ??
    (preset === "fill" || scaleConvertsFill ? bounds.height : current.viewport.height);
  const width = Math.round(requestedWidth);
  const height = Math.round(requestedHeight);
  const mode =
    preset === "fill" && !explicitScale
      ? "fill"
      : preset || value.width !== undefined || value.height !== undefined || explicitScale
        ? "custom"
        : current.viewport.mode;
  const minimumWidth = mode === "fill" ? 1 : 320;
  const minimumHeight = mode === "fill" ? 1 : 240;
  if (
    width < minimumWidth ||
    width > INPUT_LIMITS.browserDimension ||
    height < minimumHeight ||
    height > INPUT_LIMITS.browserDimension
  ) {
    throw new Error("Viewport dimensions are outside the supported range.");
  }
  const scale =
    mode === "fill" ? 1 : (value.deviceScaleFactor ?? presetSize?.scale ?? current.viewport.deviceScaleFactor);
  if (scale < 0.5 || scale > 4) throw new Error("deviceScaleFactor must be between 0.5 and 4.");
  if (!isSafeViewportSize(width, height, scale)) {
    throw new Error(`The physical viewport must not exceed ${MAX_PHYSICAL_VIEWPORT_PIXELS.toLocaleString()} pixels.`);
  }
  const resolvedPreset =
    preset === "desktop" || preset === "tablet" || preset === "mobile"
      ? preset
      : preset === "custom" || preset === "fill"
        ? null
        : current.viewport.preset;
  return {
    viewport: {
      mode,
      width,
      height,
      deviceScaleFactor: scale,
      preset: resolvedPreset,
    },
    colorScheme: value.colorScheme ?? current.colorScheme,
    reducedMotion: value.reducedMotion ?? current.reducedMotion,
  };
}

function presetDimensions(preset: "fill" | "desktop" | "tablet" | "mobile" | "custom" | undefined) {
  switch (preset) {
    case "desktop":
      return { width: 1440, height: 900, scale: 1 };
    case "tablet":
      return { width: 820, height: 1180, scale: 2 };
    case "mobile":
      return { width: 390, height: 844, scale: 3 };
    default:
      return null;
  }
}
