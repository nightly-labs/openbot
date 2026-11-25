import { isSignalHomeId, SIGNAL_HOME_LIST_LIMIT } from "../ipc-host-signal-home";
import {
  type AdminDecoder,
  adminRoute,
  count,
  empty,
  fields,
  list,
  nullable,
  type OptionalRouteCodec,
} from "./admin-wire";

export const HOST_SIGNAL_HOME_CAPABILITY = "host-signal-home-v1";

export const HOST_SIGNAL_HOME_ROUTES = {
  settings: "/v1/admin/host/signal-home",
  update: "/v1/admin/host/signal-home/update",
} as const;

const homeId: AdminDecoder = (value) => {
  if (!isSignalHomeId(value)) throw new Error("Invalid admin identifier.");
  return value;
};

const snapshot = fields({
  preferred: nullable(homeId),
  current: nullable(homeId),
  homes: list(fields({ id: homeId, latencyMs: nullable(count) }), SIGNAL_HOME_LIST_LIMIT),
});

export const HOST_SIGNAL_HOME_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [HOST_SIGNAL_HOME_ROUTES.settings, adminRoute(empty, snapshot)],
  [HOST_SIGNAL_HOME_ROUTES.update, adminRoute(fields({ home: nullable(homeId) }), snapshot)],
]);
