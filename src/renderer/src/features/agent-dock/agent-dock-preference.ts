import {
  AGENT_DOCK_LIMITS,
  AGENT_DOCK_SIZE_LIMITS,
  type AgentDockDisplay,
  type AgentDockEdge,
  type AgentDockOffset,
  type AgentDockSeatRef,
} from "@openbot/contracts/ipc";
import { agentDockSeatKey } from "@openbot/ui/features/agent-dock/AgentDock";
import { createSignal } from "solid-js";
import { z } from "zod";

export type AgentDockPlacement = "screen" | "window";

export interface AgentDockPreference {
  shown: boolean;
  placement: AgentDockPlacement;
  display: AgentDockDisplay;
  edge: AgentDockEdge;
  autoHide: boolean;
  edgeStrip: boolean;
  sizePercent: number;
  results: boolean;
  activeSeats: boolean;
  offsets: AgentDockOffset[];
}

const DEFAULT_PREFERENCE: AgentDockPreference = {
  shown: !import.meta.env.DEV,
  placement: "screen",
  display: { kind: "window" },
  edge: "right",
  autoHide: false,
  edgeStrip: false,
  sizePercent: AGENT_DOCK_SIZE_LIMITS.default,
  results: true,
  activeSeats: false,
  offsets: [],
};

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
    edgeStrip: z.boolean().catch(DEFAULT_PREFERENCE.edgeStrip),
    sizePercent: z
      .number()
      .int()
      .min(AGENT_DOCK_SIZE_LIMITS.min)
      .max(AGENT_DOCK_SIZE_LIMITS.max)
      .catch(DEFAULT_PREFERENCE.sizePercent),
    results: z.boolean().catch(DEFAULT_PREFERENCE.results),
    activeSeats: z.boolean().catch(DEFAULT_PREFERENCE.activeSeats),
    offsets: z
      .array(z.object({ displayId: z.number().int().nonnegative(), offset: z.number().min(0).max(1) }))
      .max(AGENT_DOCK_LIMITS.displays)
      .catch(DEFAULT_PREFERENCE.offsets),
  })
  .catch(DEFAULT_PREFERENCE);
const seatsSchema = z.array(
  z
    .union([z.string().trim().min(1), z.object({ channel: z.string().trim().min(1) })])
    .nullable()
    .catch(null),
);
type SavedSeat = string | { channel: string };

function savedSeat(seat: AgentDockSeatRef): SavedSeat {
  return seat.kind === "agent" ? seat.id : { channel: seat.id };
}

function seatOf(saved: SavedSeat): AgentDockSeatRef {
  return typeof saved === "string" ? { kind: "agent", id: saved } : { kind: "channel", id: saved.channel };
}

function uniqueSeats(seats: readonly AgentDockSeatRef[]): AgentDockSeatRef[] {
  const seen = new Set<string>();
  return seats.filter((seat) => {
    const key = agentDockSeatKey(seat);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

let unsavedPreference: AgentDockPreference | undefined;
const unsavedSeats = new Map<string, AgentDockSeatRef[]>();

function readPreference(): AgentDockPreference {
  if (unsavedPreference) return unsavedPreference;
  try {
    const raw = window.localStorage.getItem(PREFERENCE_KEY);
    return raw === null ? DEFAULT_PREFERENCE : preferenceSchema.parse(JSON.parse(raw));
  } catch {
    return DEFAULT_PREFERENCE;
  }
}

function readSeats(serverId: string): AgentDockSeatRef[] | null {
  const unsaved = unsavedSeats.get(serverId);
  if (unsaved) return unsaved;
  try {
    const raw = window.localStorage.getItem(SEATS_PREFIX + serverId);
    if (raw === null) return null;
    const parsed = seatsSchema.parse(JSON.parse(raw));
    return uniqueSeats(parsed.flatMap((saved) => (saved ? [seatOf(saved)] : [])));
  } catch {
    return null;
  }
}

const [preference, setPreferenceSignal] = createSignal(readPreference());
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
  window.addEventListener("storage", readStorage);
  import.meta.hot?.dispose(() => {
    window.removeEventListener("storage", readStorage);
  });
}

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

export function saveAgentDockOffset(moved: AgentDockOffset): void {
  const others = preference().offsets.filter((item) => item.displayId !== moved.displayId);
  setAgentDockPreference({
    offsets: [...others, { displayId: moved.displayId, offset: moved.offset }].slice(-AGENT_DOCK_LIMITS.displays),
  });
}

const AGENT_DOCK_DEFAULT_SEATS = 3;

export function agentDockSeats(
  serverId: string,
  sidebarOrder: () => readonly string[],
  hiddenAgentIds: ReadonlySet<string>,
): AgentDockSeatRef[] {
  seatsVersion();
  return (
    readSeats(serverId) ??
    sidebarOrder()
      .filter((id) => !hiddenAgentIds.has(id))
      .slice(0, AGENT_DOCK_DEFAULT_SEATS)
      .map((id) => ({ kind: "agent", id }))
  );
}

export function sameAgentDockSeats(a: readonly AgentDockSeatRef[], b: readonly AgentDockSeatRef[]): boolean {
  return a.length === b.length && a.every((seat, index) => seat.kind === b[index]?.kind && seat.id === b[index]?.id);
}

export function setAgentDockSeats(serverId: string, seats: readonly AgentDockSeatRef[]): void {
  const next = uniqueSeats(seats);
  try {
    window.localStorage.setItem(SEATS_PREFIX + serverId, JSON.stringify(next.map(savedSeat)));
    unsavedSeats.delete(serverId);
  } catch {
    unsavedSeats.set(serverId, next);
  }
  setSeatsVersion((version) => version + 1);
}
