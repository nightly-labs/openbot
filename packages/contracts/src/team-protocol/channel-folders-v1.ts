import { isDynamicRecord } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const CHANNEL_FOLDERS_CAPABILITY = "channel-folders-v1";
export const CHANNEL_FOLDERS_ROUTES = {
  read: "/v1/admin/channels/folders",
  add: "/v1/admin/channels/folders/add",
  remove: "/v1/admin/channels/folders/remove",
  browse: "/v1/admin/channels/folders/browse",
} as const;

const path = string(4_096);
const folderList = fields({ folders: list(fields({ path, found: boolean }), 8) });
const exact =
  (names: string[], decode: AdminDecoder): AdminDecoder =>
  (input) => {
    if (!isDynamicRecord(input) || Object.keys(input).some((key) => !names.includes(key)))
      throw new Error("Invalid channel folders request.");
    return decode(input);
  };
const changes: ReadonlyMap<string, AdminDecoder> = new Map([
  ["added", fields({ outcome: oneOf("added"), path, replaced: list(path, 8), list: folderList })],
  ["removed", fields({ outcome: oneOf("removed"), path, list: folderList })],
  ["covered", fields({ outcome: oneOf("covered"), path, folder: path, list: folderList })],
  [
    "refused",
    fields({ outcome: oneOf("refused"), path, refusal: oneOf("protected", "missing", "limit"), list: folderList }),
  ],
]);
const folderChange: AdminDecoder = (input) => {
  const decode = isDynamicRecord(input) && typeof input.outcome === "string" ? changes.get(input.outcome) : undefined;
  if (!decode) throw new Error("Invalid channel folder change.");
  return decode(input);
};
const folderInput = exact(["channelId", "path"], fields({ channelId: identifier, path }));

export const CHANNEL_FOLDERS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [CHANNEL_FOLDERS_ROUTES.read, adminRoute(exact(["channelId"], fields({ channelId: identifier })), folderList)],
  [CHANNEL_FOLDERS_ROUTES.add, adminRoute(folderInput, folderChange)],
  [CHANNEL_FOLDERS_ROUTES.remove, adminRoute(folderInput, folderChange)],
  [
    CHANNEL_FOLDERS_ROUTES.browse,
    adminRoute(
      exact(["channelId", "path"], fields({ channelId: identifier, path: nullable(path) })),
      fields({
        path,
        parentPath: nullable(path),
        entries: list(fields({ name: string(1_024), path }), 500),
        truncated: boolean,
        home: path,
        volumes: list(fields({ name: string(1_024), path }), 32),
      }),
    ),
  ],
]);
