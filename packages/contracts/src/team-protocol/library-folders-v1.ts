// Frozen optional library-folders-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: each agent has folders for
// its files in the Library, five levels in all, and a file is in one folder of its agent or in none.
// Each signed-in member reads the folders of each agent that they can see. A member changes the
// folders of an agent only with `chat` access to it, and gets 403 without it; an owner or an admin
// changes all folders. The folders are a layout over the stored files: a folder change moves, copies
// and deletes no file, and it changes no chat. A member gets no
// folder of an agent that they cannot see or that the host no longer has, and no file that is in one;
// the host answers 404 to an action that names an agent or folder that the member cannot see. The
// actions are `create` (the client makes the id, and
// `fileIds` puts files into the new folder), `rename`, `delete` (the folder and the folders in it;
// their files stay with the agent), `move` (into a parent or to the top level, before a sibling),
// `place` (files into a folder, or null: out of their folder) and `restore` (deleted folders back at
// their positions, with their files). Each route answers the full snapshot that the member can see.
// There is no event: a client reads the snapshot again. Bounds and meaning do not follow IPC changes;
// widening any of it needs a second capability string.
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

export const LIBRARY_FOLDERS_CAPABILITY = "library-folders-v1";
export const LIBRARY_FOLDERS_ROUTES = {
  read: "/v1/library-folders",
  actions: "/v1/library-folders/actions",
} as const;

const FOLDER_LIMIT = 500;
const NAME_LIMIT = 80;
const PLACEMENT_LIMIT = 20_000;
const ACTION_FILE_LIMIT = 2_000;

const name: AdminDecoder = (input) => {
  if (typeof input !== "string" || input.length === 0 || input.length > NAME_LIMIT)
    throw new Error("Invalid library folder name.");
  return input;
};
const placement: AdminDecoder = (input) => {
  if (!isDynamicRecord(input) || Object.keys(input).length > PLACEMENT_LIMIT)
    throw new Error("Invalid library folder files.");
  return Object.fromEntries(
    Object.entries(input).map(([fileId, folderId]) => [identifier(fileId), identifier(folderId)]),
  );
};
const folder = fields({ id: identifier, agentId: identifier, name }, { parentId: identifier });
const fileIds = list(identifier, ACTION_FILE_LIMIT);
const snapshot = fields({ revision: count, folders: list(folder, FOLDER_LIMIT), placement });

const exact =
  (names: string[], decode: AdminDecoder): AdminDecoder =>
  (input) => {
    if (!isDynamicRecord(input) || Object.keys(input).some((key) => !names.includes(key)))
      throw new Error("Invalid library folder request.");
    return decode(input);
  };
const type = (value: string) => oneOf(value);
const actions = new Map<string, AdminDecoder>([
  [
    "create",
    exact(
      ["type", "id", "agentId", "name", "parentId", "fileIds"],
      fields({ type: type("create"), id: identifier, agentId: identifier, name }, { parentId: identifier, fileIds }),
    ),
  ],
  ["rename", exact(["type", "folderId", "name"], fields({ type: type("rename"), folderId: identifier, name }))],
  ["delete", exact(["type", "folderId"], fields({ type: type("delete"), folderId: identifier }))],
  [
    "move",
    exact(
      ["type", "folderId", "parentId", "beforeFolderId"],
      fields({
        type: type("move"),
        folderId: identifier,
        parentId: nullable(identifier),
        beforeFolderId: nullable(identifier),
      }),
    ),
  ],
  [
    "place",
    exact(["type", "fileIds", "folderId"], fields({ type: type("place"), fileIds, folderId: nullable(identifier) })),
  ],
  [
    "restore",
    exact(
      ["type", "folders", "placement"],
      fields({
        type: type("restore"),
        folders: list(fields({ index: count, folder }), FOLDER_LIMIT),
        placement,
      }),
    ),
  ],
]);
const action: AdminDecoder = (input) => {
  const decode = isDynamicRecord(input) && typeof input.type === "string" ? actions.get(input.type) : undefined;
  if (!decode) throw new Error("Invalid library folder action.");
  return decode(input);
};

export const LIBRARY_FOLDERS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [LIBRARY_FOLDERS_ROUTES.read, adminRoute(empty, snapshot)],
  [LIBRARY_FOLDERS_ROUTES.actions, adminRoute(action, snapshot)],
]);
