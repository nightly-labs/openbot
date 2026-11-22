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
