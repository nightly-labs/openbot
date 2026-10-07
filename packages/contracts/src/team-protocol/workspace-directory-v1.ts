// Frozen optional workspace-directory-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: any member of a server can
// list one folder in the workspace of an agent that the member can see, as the member can already
// download any file in it through `/v1/workspace-files`. The host refuses a folder outside the
// workspace, and leaves out a link whose target is outside it. Each entry has its name, kind, size
// and modification time, and a path that `/v1/workspace-files` and this route accept again: inside the
// workspace it starts with `./` and percent-encodes each segment. The
// response also names the workspace root, which the agent summary already carries. At most 500
// entries cross; `truncated` says that there were more. Widening any of it needs a second
// capability string.
import {
  adminRoute,
  boolean,
  count,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const WORKSPACE_DIRECTORY_CAPABILITY = "workspace-directory-v1";

export const WORKSPACE_DIRECTORY_ROUTES = {
  list: "/v1/workspace-directory",
} as const;

const path = string(4_096);

export const WORKSPACE_DIRECTORY_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    WORKSPACE_DIRECTORY_ROUTES.list,
    adminRoute(
      fields({ agentId: identifier, path }),
      fields({
        name: string(1_024),
        path,
        root: path,
        parentPath: nullable(path),
        entries: list(
          fields({
            name: string(1_024),
            path,
            kind: oneOf("file", "directory"),
            size: count,
            modifiedAt: count,
          }),
          500,
        ),
        truncated: boolean,
      }),
    ),
  ],
]);
