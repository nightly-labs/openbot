import {
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

/** Registry administration installs commands on the selected host. Every route requires an admin. */
export const ACP_REGISTRY_CAPABILITY = "acp-registry-v1";
export const ACP_REGISTRY_ROUTES = {
  search: "/v1/admin/acp-registry/search",
  installed: "/v1/admin/acp-registry/installed",
  status: "/v1/admin/acp-registry/status",
  install: "/v1/admin/acp-registry/install",
  cancel: "/v1/admin/acp-registry/cancel",
  remove: "/v1/admin/acp-registry/remove",
} as const;
const distribution = oneOf("binary", "npx", "uvx");
const registryId = string(128);
const customAgentId = identifier;
const version = string(128);
const entry = fields({
  id: registryId,
  name: string(160),
  version,
  description: string(4096),
  website: nullable(string(2048)),
  license: nullable(string(128)),
  distributions: list(distribution, 3),
  installedVersion: nullable(version),
  customAgentId: nullable(customAgentId),
});
const agent = fields({
  id: customAgentId,
  name: string(80),
  command: string(4096),
  args: list(string(4096), 128),
  envNames: list(string(128), 128),
  resolvedCommand: nullable(string(4096)),
});
export const ACP_REGISTRY_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [ACP_REGISTRY_ROUTES.search, adminRoute(fields({ query: string(256) }), list(entry, 4096))],
  [
    ACP_REGISTRY_ROUTES.installed,
    adminRoute(empty, list(fields({ registryId, customAgentId, version, distribution }), 4096)),
  ],
  [
    ACP_REGISTRY_ROUTES.status,
    adminRoute(
      empty,
      list(fields({ registryId, state: oneOf("installing", "failed"), message: nullable(string(2048)) }), 4096),
    ),
  ],
  [
    ACP_REGISTRY_ROUTES.install,
    adminRoute(
      fields({ registryId, customAgentId }, { name: string(80), distribution }),
      fields({ agents: list(agent, 256), restart: oneOf("restarted", "skipped-busy", "not-running") }),
    ),
  ],
  [ACP_REGISTRY_ROUTES.cancel, adminRoute(fields({ registryId }), empty)],
  [ACP_REGISTRY_ROUTES.remove, adminRoute(fields({ registryId }), empty)],
]);
