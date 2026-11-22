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
