import { isDynamicRecord, isString } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  string,
} from "./admin-wire";
import type { TeamProtocolV2Json } from "./webrtc-framing";

export const WORKFLOWS_STEP_SETTINGS_CAPABILITY = "workflows-step-settings-v1";

export const WORKFLOWS_STEP_SETTINGS_ROUTES = {
  read: "/v1/workflows/step-settings",
} as const;

export const WORKFLOWS_STEP_SOURCE_MAX = 400;

const fieldValue: AdminDecoder = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (isString(value) && value.length <= 20_000) return value;
  throw new Error("Invalid workflow step setting.");
};
const settings: AdminDecoder = (value) => {
  if (!isDynamicRecord(value)) throw new Error("Invalid workflow step settings.");
  const entries = Object.entries(value);
  if (entries.length > 32 || entries.some(([name]) => !name.length || name.length > 64))
    throw new Error("Invalid workflow step settings.");
  const decoded: Record<string, TeamProtocolV2Json> = {};
  for (const [name, field] of entries) decoded[name] = fieldValue(field);
  return decoded;
};
const source = fields({
  from: identifier,
  type: string(32),
  stepId: nullable(identifier),
  attachmentId: nullable(identifier),
});

export const WORKFLOWS_STEP_SETTINGS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    WORKFLOWS_STEP_SETTINGS_ROUTES.read,
    adminRoute(
      fields({ stepId: identifier }),
      fields({ settings: nullable(settings), sources: nullable(list(source, WORKFLOWS_STEP_SOURCE_MAX)) }),
    ),
  ],
]);
