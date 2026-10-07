// Frozen optional contract. Owners and admins can browse host directory names and set the
// working directory of a visible agent. It grants no file download or filesystem mutation.
import { adminRoute, boolean, fields, identifier, list, nullable, type OptionalRouteCodec, string } from "./admin-wire";
export const AGENT_WORKING_DIRECTORY_CAPABILITY = "agent-working-directory-v1";
export const AGENT_WORKING_DIRECTORY_ROUTES = {
  settings: "/v1/admin/agents/working-directory",
  update: "/v1/admin/agents/working-directory/update",
  browse: "/v1/admin/agents/working-directory/browse",
} as const;
const boundedOffset = (value: unknown) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 100_000)
    throw new Error("Invalid admin count.");
  return value;
};
const path = (value: unknown) => {
  if (typeof value !== "string" || value.length > 4096 || value.includes("\0")) {
    throw new Error("Invalid admin path.");
  }
  return value;
};
const entry = fields({ name: string(1024), path });
const settings = fields({ workingDirectory: nullable(path), effectivePath: path, busy: boolean });
export const AGENT_WORKING_DIRECTORY_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_WORKING_DIRECTORY_ROUTES.settings, adminRoute(fields({ agentId: identifier }), settings)],
  [AGENT_WORKING_DIRECTORY_ROUTES.update, adminRoute(fields({ agentId: identifier, path: nullable(path) }), settings)],
  [
    AGENT_WORKING_DIRECTORY_ROUTES.browse,
    adminRoute(
      fields({ agentId: identifier, path: nullable(path), showHidden: boolean, offset: boundedOffset }),
      fields({
        path,
        parentPath: nullable(path),
        roots: list(entry, 64),
        entries: list(entry, 100),
        nextOffset: nullable(boundedOffset),
      }),
    ),
  ],
]);
