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
