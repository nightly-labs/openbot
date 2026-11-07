import {
  AGENT_DOCK_LIMITS,
  type AgentDockDisplay,
  type AgentDockEdge,
  type AgentDockOffset,
} from "@openbot/contracts/ipc";
import { createSignal } from "solid-js";
import { z } from "zod";

/** Where the dock shows: in a window of its own above the other apps, or in the main window. */
export type AgentDockPlacement = "screen" | "window";

export interface AgentDockPreference {
  shown: boolean;
  placement: AgentDockPlacement;
  /** The display of the dock above the other apps. */
  display: AgentDockDisplay;
  edge: AgentDockEdge;
  /** The dock slides into the edge while nobody uses it. */
  autoHide: boolean;
  /** Work that the agents finished shows beside the dock for a short time. */
  results: boolean;
  /** Where the user dragged the dock on each display, the newest last. */
  offsets: AgentDockOffset[];
}

const DEFAULT_PREFERENCE: AgentDockPreference = {
  // Development builds start with the dock hidden; the user can show it in Settings.
  shown: !import.meta.env.DEV,
  placement: "screen",
  display: { kind: "window" },
  edge: "right",
  autoHide: false,
  results: true,
  offsets: [],
};

/* The dock is a choice of this computer, like the sidebar width, so it stays in this profile's storage. */
const PREFERENCE_KEY = "openbot:agent-dock-preference";
const SEATS_PREFIX = "openbot:agent-dock:";

const preferenceSchema = z
  .object({
    shown: z.boolean().catch(DEFAULT_PREFERENCE.shown),
    placement: z.enum(["screen", "window"]).catch(DEFAULT_PREFERENCE.placement),
    display: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("window") }),
        z.object({ kind: z.literal("primary") }),
        z.object({ kind: z.literal("all") }),
        z.object({ kind: z.literal("display"), id: z.number().int().nonnegative() }),
      ])
      .catch(DEFAULT_PREFERENCE.display),
    edge: z.enum(["left", "right"]).catch(DEFAULT_PREFERENCE.edge),
    autoHide: z.boolean().catch(DEFAULT_PREFERENCE.autoHide),
    results: z.boolean().catch(DEFAULT_PREFERENCE.results),
    offsets: z
      .array(z.object({ displayId: z.number().int().nonnegative(), offset: z.number().min(0).max(1) }))
      .max(AGENT_DOCK_LIMITS.displays)
      .catch(DEFAULT_PREFERENCE.offsets),
  })
  .catch(DEFAULT_PREFERENCE);
const seatsSchema = z.array(z.string().trim().min(1).nullable().catch(null));

/* The values that blocked or full storage did not save. They win over older saved values. */
let unsavedPreference: AgentDockPreference | undefined;
const unsavedSeats = new Map<string, string[]>();

function readPreference(): AgentDockPreference {
  if (unsavedPreference) return unsavedPreference;
  try {
    const raw = window.localStorage.getItem(PREFERENCE_KEY);
    return raw === null ? DEFAULT_PREFERENCE : preferenceSchema.parse(JSON.parse(raw));
  } catch {
    return DEFAULT_PREFERENCE;
  }
}

/** The saved agents of a server's dock. Null when the user never changed that dock. */
function readSeats(serverId: string): string[] | null {
  const unsaved = unsavedSeats.get(serverId);
  if (unsaved) return unsaved;
  try {
    const raw = window.localStorage.getItem(SEATS_PREFIX + serverId);
    if (raw === null) return null;
    const parsed = seatsSchema.parse(JSON.parse(raw));
    return [...new Set(parsed.flatMap((id) => (id ? [id] : [])))];
  } catch {
    // Blocked storage or a damaged value: the dock shows the default agents.
    return null;
  }
}

const [preference, setPreferenceSignal] = createSignal(readPreference());
/* A change of any server's seats. A reader reads its own server's list again. */
const [seatsVersion, setSeatsVersion] = createSignal(0);

function readStorage(event: StorageEvent): void {
  if (event.key === null || event.key === PREFERENCE_KEY) {
    unsavedPreference = undefined;
    setPreferenceSignal(readPreference());
  }
  if (event.key === null || event.key.startsWith(SEATS_PREFIX)) {
    if (event.key === null) unsavedSeats.clear();
    else unsavedSeats.delete(event.key.slice(SEATS_PREFIX.length));
    setSeatsVersion((version) => version + 1);
  }
}

if (typeof window !== "undefined") {
  // One registration per page: HMR disposal removes it when this module is replaced.
  window.addEventListener("storage", readStorage);
  import.meta.hot?.dispose(() => {
    window.removeEventListener("storage", readStorage);
  });
}

/** The shared reactive preference: a Settings change reaches the dock at once. */
export function useAgentDockPreference(): () => AgentDockPreference {
  return preference;
}

export function setAgentDockPreference(patch: Partial<AgentDockPreference>): void {
  const next = { ...preference(), ...patch };
  try {
    window.localStorage.setItem(PREFERENCE_KEY, JSON.stringify(next));
    unsavedPreference = undefined;
  } catch {
    unsavedPreference = next;
  }
  setPreferenceSignal(next);
}

/** Saves where a drag left the dock on a display. The oldest position goes when the list is full. */
export function saveAgentDockOffset(moved: AgentDockOffset): void {
  const others = preference().offsets.filter((item) => item.displayId !== moved.displayId);
  setAgentDockPreference({
    offsets: [...others, { displayId: moved.displayId, offset: moved.offset }].slice(-AGENT_DOCK_LIMITS.displays),
  });
}

/** The number of agents on a dock that the user never changed. */
const AGENT_DOCK_DEFAULT_SEATS = 3;

/**
 * The agents on the dock of a server, in order. Until the user adds or removes an agent, the dock
 * shows the first agents of the sidebar that the user did not hide. `sidebarOrder` runs only then.
 * Read it in a memo: each read parses the saved list.
 */
export function agentDockSeats(
  serverId: string,
  sidebarOrder: () => readonly string[],
  hiddenAgentIds: ReadonlySet<string>,
): string[] {
  seatsVersion();
  return (
    readSeats(serverId) ??
    sidebarOrder()
      .filter((id) => !hiddenAgentIds.has(id))
      .slice(0, AGENT_DOCK_DEFAULT_SEATS)
  );
}

/** Two seat lists with the same agents in the same order. */
export function sameAgentDockSeats(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export function setAgentDockSeats(serverId: string, seats: readonly string[]): void {
  const next = [...new Set(seats)];
  try {
    window.localStorage.setItem(SEATS_PREFIX + serverId, JSON.stringify(next));
    unsavedSeats.delete(serverId);
  } catch {
    unsavedSeats.set(serverId, next);
  }
  setSeatsVersion((version) => version + 1);
}
