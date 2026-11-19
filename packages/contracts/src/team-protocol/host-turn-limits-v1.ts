import { type AdminDecoder, adminRoute, empty, fields, nullable, type OptionalRouteCodec } from "./admin-wire";

export const HOST_TURN_LIMITS_CAPABILITY = "host-turn-limits-v1";

export const HOST_TURN_LIMITS_ROUTES = {
  settings: "/v1/admin/host/turn-limits",
  update: "/v1/admin/host/turn-limits/update",
} as const;

const between =
  (maximum: number): AdminDecoder =>
  (input) => {
    if (typeof input !== "number" || !Number.isInteger(input) || input < 1 || input > maximum)
      throw new Error("Invalid turn limit.");
    return input;
  };
const turnLimit = nullable((input) => (input === "unlimited" ? input : between(128)(input)));
const agentTaskLimit = nullable(between(64));
const automaticTurnLimit = nullable(between(1_024));
const snapshot = fields({ turnLimit, automaticTurnLimit, agentTaskLimit, defaultAgentTaskLimit: between(64) });

export const HOST_TURN_LIMITS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [HOST_TURN_LIMITS_ROUTES.settings, adminRoute(empty, snapshot)],
  [HOST_TURN_LIMITS_ROUTES.update, adminRoute(fields({ turnLimit, agentTaskLimit }), snapshot)],
]);
