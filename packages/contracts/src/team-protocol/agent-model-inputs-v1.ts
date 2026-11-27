import { adminRoute, empty, fields, identifier, list, type OptionalRouteCodec, oneOf, string } from "./admin-wire";

export const AGENT_MODEL_INPUTS_CAPABILITY = "agent-model-inputs-v1";

export const AGENT_MODEL_INPUTS_ROUTES = {
  list: "/v1/agent-model-inputs/list",
} as const;

const modelInputs = fields({ provider: identifier, id: string(160), inputs: list(oneOf("image", "pdf"), 2) });

export const AGENT_MODEL_INPUTS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_MODEL_INPUTS_ROUTES.list, adminRoute(empty, fields({ models: list(modelInputs, 10_000) }))],
]);
