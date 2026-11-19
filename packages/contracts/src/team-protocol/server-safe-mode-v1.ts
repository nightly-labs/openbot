import { type AdminDecoder, adminRoute, count, fields, type OptionalRouteCodec, oneOf, string } from "./admin-wire";

export const SERVER_SAFE_MODE_CAPABILITY = "server-safe-mode-v1";

export const SERVER_SAFE_MODE_ROUTES = {
  reason: "/v1/server/safe-mode",
} as const;

export const SERVER_SAFE_MODE_REASONS = ["newer_database", "start_failed"] as const;
export type ServerSafeModeReasonCode = (typeof SERVER_SAFE_MODE_REASONS)[number];

export interface ServerSafeModeReason {
  reason: ServerSafeModeReasonCode;
  appVersion: string;
  haltedAt: number;
}

const noBody: AdminDecoder = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) return null;
  throw new Error("Invalid server safe mode request.");
};

const reasonResponse = fields({
  reason: oneOf(...SERVER_SAFE_MODE_REASONS),
  appVersion: string(64),
  haltedAt: count,
});

export const SERVER_SAFE_MODE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [SERVER_SAFE_MODE_ROUTES.reason, adminRoute(noBody, reasonResponse)],
]);

function isReasonCode(value: unknown): value is ServerSafeModeReasonCode {
  return SERVER_SAFE_MODE_REASONS.some((code) => code === value);
}

export function decodeServerSafeModeReason(value: unknown): ServerSafeModeReason {
  const decoded = reasonResponse(value);
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded))
    throw new Error("Invalid server safe mode reason.");
  const { reason, appVersion, haltedAt } = decoded;
  if (!isReasonCode(reason) || typeof appVersion !== "string" || typeof haltedAt !== "number")
    throw new Error("Invalid server safe mode reason.");
  return { reason, appVersion, haltedAt };
}
