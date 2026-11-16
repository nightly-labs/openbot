// Frozen optional workflows-sunra-v1 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: a host that advertises it
// runs the `image` node of `workflows-media-v1` with the Sunra models of `WORKFLOW_MEDIA_MODELS`
// (the ids that start with "sunra-"). The host makes the file with the tools of Sunra's MCP server, on
// the Sunra sign-in of an enabled Sunra row in the host's Apps, and the credits of the Sunra account
// that this sign-in has selected pay for it. The node fields and the step output stay as
// `workflows-media-v1` sets them.
//
// It adds two routes. `providers` tells each member who can use workflows whether the host can use
// Sunra now: `{ sunra: true }` when an enabled Sunra row of the host is signed in. `credits` tells the
// same members how many credits that sign-in can spend now: `{ sunra: { available, quota } }`, where
// `quota` is the limit of a Sunra team member, or null for an account with no limit of its own.
// `sunra` is null when the host has no Sunra sign-in or Sunra did not answer. Both are reads only;
// they never give a token or the Sunra account. A client shows the Sunra models only while `providers`
// is true, and a host without this capability gets none. Widening any of it needs a second capability
// string.
import { adminRoute, boolean, count, empty, fields, nullable, type OptionalRouteCodec } from "./admin-wire";

export const WORKFLOWS_SUNRA_CAPABILITY = "workflows-sunra-v1";

export const WORKFLOWS_SUNRA_ROUTES = {
  providers: "/v1/workflows/media/providers",
  credits: "/v1/workflows/media/credits",
} as const;

export const WORKFLOWS_SUNRA_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [WORKFLOWS_SUNRA_ROUTES.providers, adminRoute(empty, fields({ sunra: boolean }))],
  [
    WORKFLOWS_SUNRA_ROUTES.credits,
    adminRoute(empty, fields({ sunra: nullable(fields({ available: count, quota: nullable(count) })) })),
  ],
]);
