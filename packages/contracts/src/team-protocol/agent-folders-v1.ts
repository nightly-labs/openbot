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

export const AGENT_FOLDERS_CAPABILITY = "agent-folders-v1";
export const AGENT_FOLDERS_ROUTES = {
  read: "/v1/admin/agents/folders",
  add: "/v1/admin/agents/folders/add",
  remove: "/v1/admin/agents/folders/remove",
  exclude: "/v1/admin/agents/folders/exclude",
  include: "/v1/admin/agents/folders/include",
  browse: "/v1/admin/agents/folders/browse",
} as const;

const path = string(4_096);
const paths = list(path, 32);
const folderList = fields({
  workspace: path,
  shared: path,
  folders: list(fields({ path, found: boolean }), 32),
  excluded: paths,
});
const exact =
  (names: string[], decode: AdminDecoder): AdminDecoder =>
  (input) => {
    if (!isDynamicRecord(input) || Object.keys(input).some((key) => !names.includes(key)))
      throw new Error("Invalid agent folders request.");
    return decode(input);
  };
const byOutcome =
  (cases: Record<string, AdminDecoder>): AdminDecoder =>
  (input) => {
    const decode =
      isDynamicRecord(input) && typeof input.outcome === "string"
        ? new Map(Object.entries(cases)).get(input.outcome)
        : undefined;
    if (!decode) throw new Error("Invalid agent folder change.");
    return decode(input);
  };
const folderChange = byOutcome({
  added: fields({ outcome: oneOf("added"), path, replaced: paths, list: folderList }),
  replaced: fields({ outcome: oneOf("replaced"), path, list: folderList }),
  removed: fields({ outcome: oneOf("removed"), path, list: folderList }),
  covered: fields({
    outcome: oneOf("covered"),
    path,
    coverage: fields({ reason: oneOf("already-added", "in-workspace", "in-shared", "in-folder"), folder: path }),
    list: folderList,
  }),
  refused: fields({
    outcome: oneOf("refused"),
    path,
    refusal: oneOf("protected", "missing", "limit"),
    list: folderList,
  }),
});
const exclusionChange = byOutcome({
  excluded: fields({ outcome: oneOf("excluded"), path, replaced: paths, list: folderList }),
  included: fields({ outcome: oneOf("included"), path, list: folderList }),
  covered: fields({ outcome: oneOf("covered"), path, folder: path, list: folderList }),
  refused: fields({
    outcome: oneOf("refused"),
    path,
    refusal: oneOf("outside", "root", "missing", "limit"),
    list: folderList,
  }),
});
const folderInput = exact(["agentId", "path"], fields({ agentId: identifier, path }));

export const AGENT_FOLDERS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_FOLDERS_ROUTES.read, adminRoute(exact(["agentId"], fields({ agentId: identifier })), folderList)],
  [
    AGENT_FOLDERS_ROUTES.add,
    adminRoute(
      exact(["agentId", "path", "replace"], fields({ agentId: identifier, path }, { replace: path })),
      folderChange,
    ),
  ],
  [AGENT_FOLDERS_ROUTES.remove, adminRoute(folderInput, folderChange)],
  [AGENT_FOLDERS_ROUTES.exclude, adminRoute(folderInput, exclusionChange)],
  [AGENT_FOLDERS_ROUTES.include, adminRoute(folderInput, exclusionChange)],
  [
    AGENT_FOLDERS_ROUTES.browse,
    adminRoute(
      exact(["agentId", "path"], fields({ agentId: identifier, path: nullable(path) })),
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
