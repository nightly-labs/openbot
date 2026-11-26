import { adminRoute, boolean, empty, fields, list, type OptionalRouteCodec, string } from "./admin-wire";

export const WORKFLOWS_GITHUB_RELAY_CAPABILITY = "workflows-github-relay-v1";

export const WORKFLOWS_GITHUB_RELAY_ROUTES = {
  status: "/v1/workflows/github/relay",
} as const;

const REPOSITORIES = 1_000;
const repository = string(140);

export const WORKFLOWS_GITHUB_RELAY_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    WORKFLOWS_GITHUB_RELAY_ROUTES.status,
    adminRoute(
      empty,
      fields({ ready: boolean, watched: list(repository, REPOSITORIES), routed: list(repository, REPOSITORIES) }),
    ),
  ],
]);
