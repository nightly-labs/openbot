import { INPUT_LIMITS } from "../input-limits";
import {
  adminRoute,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
  variant,
} from "./admin-wire";

export const WORKFLOWS_PORTABLE_CAPABILITY = "workflows-portable-v1";

export const WORKFLOWS_PORTABLE_ROUTES = {
  export: "/v1/workflows/export",
} as const;

const NAME = string(255);
const FILE_TEXT_LIMIT = 2 * INPUT_LIMITS.workflowGraphBytes;

const problem = variant({
  secret: fields({
    kind: oneOf("secret"),
    fields: list(fields({ node: NAME, step: NAME, field: NAME }), INPUT_LIMITS.workflowNodes * 32),
  }),
  "asset-missing": fields({ kind: oneOf("asset-missing"), node: NAME, step: NAME }),
  "asset-too-large": fields({ kind: oneOf("asset-too-large"), node: NAME, step: NAME }),
  "too-large": fields({ kind: oneOf("too-large") }),
});

const exported = fields({
  text: nullable(string(FILE_TEXT_LIMIT)),
  assets: list(fields({ key: identifier, fileId: identifier, node: NAME, step: NAME }), INPUT_LIMITS.workflowNodes),
  problem: nullable(problem),
});

export const WORKFLOWS_PORTABLE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [WORKFLOWS_PORTABLE_ROUTES.export, adminRoute(fields({ workflowId: identifier }), exported)],
]);
