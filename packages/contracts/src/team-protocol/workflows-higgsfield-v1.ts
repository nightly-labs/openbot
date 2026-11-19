// Frozen optional workflows-higgsfield-v1 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: a host that advertises it
// runs the `image` node of `workflows-media-v1` with the Higgsfield models of `WORKFLOW_MEDIA_MODELS`
// (the ids that start with "higgsfield-"). The host makes the file with the tools of Higgsfield's MCP
// server, on the Higgsfield sign-in of an enabled Higgsfield row in the host's Apps, and the credits of
// that Higgsfield account pay for it; the host never spends an unlimited-generation allowance. The
// node fields and the step output stay as `workflows-media-v1` sets them, and a Higgsfield model
// ignores the `account` field of `workflows-media-account-v1`. The `background` field of
// `workflows-media-transparent-v1` applies to the Higgsfield models that `WORKFLOW_MEDIA_MODELS` marks
// as `transparent` (GPT Image 2.6 and Seedream 5.0 Pro): the host asks Higgsfield for a transparent
// background, and GPT Image 2.6 gets an opaque one for "solid".
//
// It adds two routes. `providers` tells each member who can use workflows whether the host can use
// Higgsfield now: `{ higgsfield: true }` when an enabled Higgsfield row of the host is signed in.
// `credits` tells the same members how many credits that sign-in can spend now:
// `{ higgsfield: { available, quota } }`, where `available` is rounded down and `quota` is the limit of
// a team member, or null for an account with no limit of its own. `higgsfield` is null when the host
// has no Higgsfield sign-in or Higgsfield did not answer. Both are reads only; they never give a token
// or the Higgsfield account. A client shows the Higgsfield models only while `providers` is true, and a
// host without this capability gets none. Widening any of it needs a second capability string.
import { adminRoute, boolean, count, empty, fields, nullable, type OptionalRouteCodec } from "./admin-wire";

export const WORKFLOWS_HIGGSFIELD_CAPABILITY = "workflows-higgsfield-v1";

export const WORKFLOWS_HIGGSFIELD_ROUTES = {
  providers: "/v1/workflows/media/higgsfield/providers",
  credits: "/v1/workflows/media/higgsfield/credits",
} as const;

export const WORKFLOWS_HIGGSFIELD_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [WORKFLOWS_HIGGSFIELD_ROUTES.providers, adminRoute(empty, fields({ higgsfield: boolean }))],
  [
    WORKFLOWS_HIGGSFIELD_ROUTES.credits,
    adminRoute(empty, fields({ higgsfield: nullable(fields({ available: count, quota: nullable(count) })) })),
  ],
]);
