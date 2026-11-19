// Frozen optional model-steering-v1 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: every member reads, for each
// model of the released model list whose provider reports per agent whether it steers (a custom ACP
// agent), whether the agent that serves it takes a message into its running turn. The route lists
// only those models. A model that is not listed, on a provider that reports it, does not steer: the
// client shows "Send now" for it, and the host queues a steer. It holds no more than the model list
// that the member reads. Widening any of it needs a second capability string.
import { adminRoute, empty, fields, identifier, list, type OptionalRouteCodec, string } from "./admin-wire";

export const MODEL_STEERING_CAPABILITY = "model-steering-v1";

export const MODEL_STEERING_ROUTES = {
  list: "/v1/model-steering/list",
} as const;

const steeringModel = fields({ provider: identifier, id: string(160) });

export const MODEL_STEERING_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [MODEL_STEERING_ROUTES.list, adminRoute(empty, fields({ models: list(steeringModel, 10_000) }))],
]);
