import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { BrowserEnvironment } from "@openbot/contracts/ipc";
import { isBoolean, isNumber, isString } from "@openbot/contracts/runtime-values";
import { legacyAgentId } from "@openbot/contracts/validation";
import { isRecord } from "./protocol";

export interface StoredBrowserTab {
  id: string;
  url: string;
  ownerThreadId: string | null;
  ownerAgentId: string | null;
  /** Absent in a v1 file, and in a v2 file whose environment did not survive validation. */
  environment?: BrowserEnvironment;
}

/**
 * A viewport this large would allocate a backing store big enough to take the whole app down, and the
 * bound is on the *physical* pixels, so a modest CSS size with a 4x scale factor still trips it.
 */
export const MAX_PHYSICAL_VIEWPORT_PIXELS = 8_388_608;

export function isSafeViewportSize(width: number, height: number, deviceScaleFactor: number): boolean {
  return width * height * deviceScaleFactor * deviceScaleFactor <= MAX_PHYSICAL_VIEWPORT_PIXELS;
}

export function defaultBrowserEnvironment(): BrowserEnvironment {
  return {
    viewport: { mode: "fill", width: 1200, height: 800, deviceScaleFactor: 1, preset: null },
    colorScheme: "system",
    reducedMotion: false,
  };
}

/**
 * A per-tab environment read back from the user's own file. Every bound is re-checked rather than
 * trusted, because a hand-edited or truncated file would otherwise hand a viewport straight to
 * `Emulation.setDeviceMetricsOverride`.
 */
export function browserEnvironment(value: unknown): BrowserEnvironment | null {
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
export const X_LANDING_URL = "https://x.com/";

export function persistentBrowserUrl(value: string): string {
  const url = new URL(value);
  if (X_HOSTS.has(url.hostname) && url.pathname === "/i/jf/onboarding/web") {
    return X_LANDING_URL;
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

/**
 * A tab a released build wrote spells the owner key `ownerBotId`, and rejecting it would filter out every
 * tab open at the moment of the upgrade, so the user's browser would come back empty. Only the key is
 * translated here. The id *values* beside it are left exactly as they were found, because syntax cannot
 * tell which of them migration v13 rewrote -- it declines on a collision, and an agent imported from
 * `bots.json` after the migrations ran never went through it at all. `reownStoredBrowserTab` does that
 * part against the roster, which knows.
 */
export function storedBrowserTab(value: unknown): StoredBrowserTab | null {
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
  const environment = browserEnvironment(value.environment);
  return {
    id: value.id,
    url: value.url,
    ownerThreadId,
    ownerAgentId,
    ...(environment === null ? {} : { environment }),
  };
}

/** Enough of an agent to say which of two spellings of an id is the one it answers to now. */
export interface BrowserTabOwner {
  id: string;
  threadId: string | null;
}

/**
 * Points a tab a released build wrote at the agent that owns it now. Migration v13 renamed agents inside
 * the database and rewrote their thread ids with them, but a JSON file outside the database kept the old
 * spellings -- so the tab's owner matches nothing, and `#canUseToolTab` compares a thread id that no
 * longer exists and refuses every tool call against the tab the agent itself opened.
 *
 * The mapping comes from the roster rather than from the shape of the id, because the shape does not know
 * which agents v13 actually renamed: it declines when the `agent-` spelling is already taken, and an agent
 * imported from `bots.json` after the migrations ran never went through it. An owner that resolves to
 * nobody keeps the id it was found with -- inventing one hands the tab to a stranger.
 */
export function reownStoredBrowserTab(tab: StoredBrowserTab, agents: readonly BrowserTabOwner[]): StoredBrowserTab {
  if (tab.ownerAgentId === null && tab.ownerThreadId === null) return tab;
  const owner = tabOwner(tab, agents);
  if (!owner) return tab;
  // Both fields are brought to the owner, not just the one that failed to match. A generated agent's
  // thread id is `openbot-thread-<uuid>` with no agent id inside it, so v13 never touched it and it
  // matches on its own -- while the owner id beside it is still the pre-rename spelling. Stopping at the
  // first match would call that tab correct and leave `#canUseToolTab`, which checks both, refusing it.
  const ownerThreadId = tab.ownerThreadId === null || owner.threadId === null ? tab.ownerThreadId : owner.threadId;
  const ownerAgentId = tab.ownerAgentId === null ? null : owner.id;
  if (ownerThreadId === tab.ownerThreadId && ownerAgentId === tab.ownerAgentId) return tab;
  return { ...tab, ownerThreadId, ownerAgentId };
}

/**
 * The roster entry a tab belongs to. Both current spellings are asked before either historical one,
 * because v13 declines to rename onto an id that is taken: a `bot-<uuid>` agent can be sitting beside the
 * `agent-<uuid>` it would otherwise have become, and the one that literally holds the id owns the tab.
 */
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

/**
 * The thread id this agent's thread carried before the rename. A thread id either embeds the agent id, in
 * which case migration v13 rewrote it along with the id, or is a bare UUID it never touched -- so
 * substituting the agent's own id is the whole of the difference.
 */
function legacyThreadId(agent: BrowserTabOwner): string | null {
  if (agent.threadId === null) return null;
  return agent.threadId.replace(agent.id, legacyAgentId(agent.id));
}
