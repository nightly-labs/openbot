// Frozen optional sidebar-pins-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: any signed-in member reads
// and replaces, for themselves only, the ordered list of agents and channels that they pinned on this
// server. `kind` is "agent" or "channel"; a list holds each pin once and at most 1000 pins. `updatedAt`
// is the ISO time of the last saved list, or null when the member never saved one. `set` replaces the
// list. `seed` saves the list only when the member has none yet, and otherwise changes nothing; both
// answer with the list that the host keeps. The host keeps the list of each member on its own
// computer, keeps the owner's list for the desktop app of that computer too, and forgets the list of
// a removed member. A pin can name an agent or a channel that is gone; each client leaves it out and
// may save the list without it. The read leaves out the agents that the member cannot see, and a save
// keeps them. A member cannot read or set the list of
// another member. After each change, the host sends `sidebar-pins-changed` with the whole list to each
// connection of that member that advertises this capability, and to no other member. The list holds
// ids only. Widening any of it needs a second capability string.
import { isDynamicRecord } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const SIDEBAR_PINS_CAPABILITY = "sidebar-pins-v1";

export const SIDEBAR_PINS_ROUTES = {
  read: "/v1/sidebar-pins",
  set: "/v1/sidebar-pins/set",
  seed: "/v1/sidebar-pins/seed",
} as const;

const pins = list(fields({ kind: oneOf("agent", "channel"), id: identifier }), 1000);
const updatedAt: AdminDecoder = (input) => {
  const value = nullable(string(64))(input);
  if (value === "" || (typeof value === "string" && Number.isNaN(Date.parse(value))))
    throw new Error("Invalid pinned chats time.");
  return value;
};
const snapshot = fields({ items: pins, updatedAt });
const save: AdminDecoder = (input) => {
  if (!isDynamicRecord(input) || Object.keys(input).some((key) => key !== "items"))
    throw new Error("Invalid pinned chats request.");
  return fields({ items: pins })(input);
};

export const SIDEBAR_PINS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [SIDEBAR_PINS_ROUTES.read, adminRoute(empty, snapshot)],
  [SIDEBAR_PINS_ROUTES.set, adminRoute(save, snapshot)],
  [SIDEBAR_PINS_ROUTES.seed, adminRoute(save, snapshot)],
]);

export type SidebarPinsEvent = {
  type: "sidebar-pins-changed";
  items: { kind: "agent" | "channel"; id: string }[];
  updatedAt: string | null;
};

/** The pins event in `input`, or null for another event. A malformed pins event throws. */
export function sidebarPinsEvent(input: unknown): SidebarPinsEvent | null {
  if (!isDynamicRecord(input) || input.type !== "sidebar-pins-changed") return null;
  const decoded = snapshot({ items: input.items, updatedAt: input.updatedAt });
  if (!isDynamicRecord(decoded) || !Array.isArray(decoded.items)) throw new Error("Invalid pinned chats event.");
  return {
    type: "sidebar-pins-changed",
    items: decoded.items.map((entry) => {
      if (
        !isDynamicRecord(entry) ||
        (entry.kind !== "agent" && entry.kind !== "channel") ||
        typeof entry.id !== "string"
      )
        throw new Error("Invalid pinned chats event.");
      return { kind: entry.kind, id: entry.id };
    }),
    updatedAt: typeof decoded.updatedAt === "string" ? decoded.updatedAt : null,
  };
}
