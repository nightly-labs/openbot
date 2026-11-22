import { HOST_VOICE_MODEL_ACTIONS, LOCAL_VOICE_MODEL_IDS } from "../ipc-voice";
import {
  type AdminDecoder,
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

export const HOST_VOICE_MODEL_CAPABILITY = "host-voice-model-v1";

export const HOST_VOICE_MODEL_ROUTES = {
  settings: "/v1/admin/host/voice-model",
  change: "/v1/admin/host/voice-model/change",
} as const;

const progress: AdminDecoder = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100)
    throw new Error("Invalid admin progress.");
  return value;
};

const status = fields({
  modelId: identifier,
  phase: oneOf("missing", "downloading", "ready", "error"),
  progress: nullable(progress),
  message: nullable(string(10_000)),
});

const snapshot = fields({ modelId: identifier, models: list(status, 64) });

const change = fields({ action: oneOf(...HOST_VOICE_MODEL_ACTIONS), modelId: oneOf(...LOCAL_VOICE_MODEL_IDS) });

export const HOST_VOICE_MODEL_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [HOST_VOICE_MODEL_ROUTES.settings, adminRoute(empty, snapshot)],
  [HOST_VOICE_MODEL_ROUTES.change, adminRoute(change, snapshot)],
]);
