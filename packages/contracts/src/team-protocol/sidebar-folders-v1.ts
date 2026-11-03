// Frozen optional sidebar-folders-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a sidebar section can hold
// other sections, three levels in all. Each section can carry `parentId`; a section without it is at
// the top of the list. Any signed-in member reads the layout and changes it, as with
// `/v1/sidebar-layout`, and the host refuses an agent that the member cannot see the same way.
// The actions route takes every `/v1/sidebar-layout/actions` action, `parentId` on `create`, and
// `nest`, which puts a section with its sections in a parent before a sibling. Each route answers the
// whole layout with the parents. A peer that negotiated this capability gets
// `sidebar-folders-changed` with the whole layout in place of `sidebar-layout-changed`, which drops
// `parentId`. Bounds and meaning do not follow IPC changes; widening any of it needs a second
// capability string.
import { isSidebarLayoutSnapshot, type SidebarLayoutSnapshot } from "../ipc-sidebar-layout";
import { isDynamicRecord } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  count,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
} from "./admin-wire";

export const SIDEBAR_FOLDERS_CAPABILITY = "sidebar-folders-v1";
export const SIDEBAR_FOLDERS_ROUTES = {
  read: "/v1/sidebar-folders",
  actions: "/v1/sidebar-folders/actions",
} as const;

const SECTION_LIMIT = 100;
const NAME_LIMIT = 40;
const CHAT_LIMIT = 10_000;

const name: AdminDecoder = (input) => {
  if (typeof input !== "string" || input.length === 0 || input.length > NAME_LIMIT)
    throw new Error("Invalid sidebar folder name.");
  return input;
};
const steps: AdminDecoder = (input) => {
  const value = count(input);
  if (typeof value !== "number" || value < 1 || value > SECTION_LIMIT + 2) throw new Error("Invalid sidebar move.");
  return value;
};
const assignments: AdminDecoder = (input) => {
  if (!isDynamicRecord(input) || Object.keys(input).length > CHAT_LIMIT)
    throw new Error("Invalid sidebar assignments.");
  return Object.fromEntries(
    Object.entries(input).map(([chatId, sectionId]) => [identifier(chatId), identifier(sectionId)]),
  );
};
const layout = fields({
  revision: count,
  sections: list(fields({ id: identifier, name }, { parentId: identifier }), SECTION_LIMIT),
  order: list(identifier, SECTION_LIMIT + 2),
  agentAssignments: assignments,
  agentOrder: list(identifier, CHAT_LIMIT),
});

const exact =
  (names: string[], decode: AdminDecoder): AdminDecoder =>
  (input) => {
    if (!isDynamicRecord(input) || Object.keys(input).some((key) => !names.includes(key)))
      throw new Error("Invalid sidebar folder request.");
    return decode(input);
  };
const type = (value: string) => oneOf(value);
const actions = new Map<string, AdminDecoder>([
  [
    "create",
    exact(
      ["type", "name", "agentId", "parentId"],
      fields({ type: type("create"), name }, { agentId: identifier, parentId: identifier }),
    ),
  ],
  ["rename", exact(["type", "sectionId", "name"], fields({ type: type("rename"), sectionId: identifier, name }))],
  ["delete", exact(["type", "sectionId"], fields({ type: type("delete"), sectionId: identifier }))],
  [
    "move",
    exact(
      ["type", "sectionId", "direction", "steps"],
      fields({ type: type("move"), sectionId: identifier, direction: oneOf("up", "down") }, { steps }),
    ),
  ],
  [
    "assign",
    exact(
      ["type", "agentId", "sectionId"],
      fields({ type: type("assign"), agentId: identifier, sectionId: nullable(identifier) }),
    ),
  ],
  [
    "move-agent",
    exact(
      ["type", "agentId", "sectionId", "beforeAgentId"],
      fields({
        type: type("move-agent"),
        agentId: identifier,
        sectionId: nullable(identifier),
        beforeAgentId: nullable(identifier),
      }),
    ),
  ],
  [
    "nest",
    exact(
      ["type", "sectionId", "parentId", "beforeSectionId"],
      fields({
        type: type("nest"),
        sectionId: identifier,
        parentId: nullable(identifier),
        beforeSectionId: nullable(identifier),
      }),
    ),
  ],
]);
const action: AdminDecoder = (input) => {
  const decode = isDynamicRecord(input) && typeof input.type === "string" ? actions.get(input.type) : undefined;
  if (!decode) throw new Error("Invalid sidebar folder action.");
  return decode(input);
};

export const SIDEBAR_FOLDERS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [SIDEBAR_FOLDERS_ROUTES.read, adminRoute(empty, layout)],
  [SIDEBAR_FOLDERS_ROUTES.actions, adminRoute(action, layout)],
]);

export type SidebarFoldersEvent = {
  type: "sidebar-folders-changed";
  layout: SidebarLayoutSnapshot;
};
export function sidebarFoldersEvent(input: unknown): SidebarFoldersEvent | null {
  if (!isDynamicRecord(input) || input.type !== "sidebar-folders-changed") return null;
  // The wire bounds above, then the order and assignment rules of the IPC layout.
  const decoded = layout(input.layout);
  if (!isSidebarLayoutSnapshot(decoded)) throw new Error("Invalid sidebar folders event.");
  return { type: "sidebar-folders-changed", layout: decoded };
}
