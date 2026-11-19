import { isDynamicRecord, isOneOf, isString } from "../runtime-values";
import {
  adminRoute,
  boolean,
  count,
  empty,
  fields,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const HOST_UPDATE_CAPABILITY = "host-update-v1";

export const HOST_UPDATE_ROUTES = {
  status: "/v1/admin/host/update/status",
  check: "/v1/admin/host/update/check",
  start: "/v1/admin/host/update/start",
  cancel: "/v1/admin/host/update/cancel",
  settings: "/v1/admin/host/update/settings",
} as const;

export const HOST_UPDATE_PHASES = [
  "idle",
  "checking",
  "available",
  "downloading",
  "ready",
  "installing",
  "up-to-date",
  "error",
  "unsupported",
] as const;

export const HOST_UPDATE_ERROR_CODES = ["check_failed", "download_failed", "install_failed"] as const;

export const HOST_UPDATE_REMOTE_STATES = ["allowed", "disabled", "managed"] as const;

export const HOST_UPDATE_RESTART_MODES = ["when-idle", "now"] as const;

export const HOST_UPDATE_WAIT_REASONS = [
  "agent-turn",
  "queued-delivery",
  "drain-task",
  "routine-run",
  "channel-work",
  "provider-process",
  "remote-desktop",
  "browser-view",
  "file-transfer",
  "browser-control",
  "update-operation",
  "initialization",
  "other",
] as const;

export const HOST_UPDATE_WAIT_REASON_LIMIT = 16;

const snapshot = fields({
  phase: oneOf(...HOST_UPDATE_PHASES),
  currentVersion: string(64),
  availableVersion: nullable(string(64)),
  progress: nullable(count),
  errorCode: nullable(oneOf(...HOST_UPDATE_ERROR_CODES)),
  remoteUpdates: oneOf(...HOST_UPDATE_REMOTE_STATES),
  autoDownload: boolean,
  autoInstall: boolean,
  restart: nullable(
    fields({
      requestedBy: nullable(string(128)),
      mode: oneOf(...HOST_UPDATE_RESTART_MODES),
      waitingFor: list(oneOf(...HOST_UPDATE_WAIT_REASONS), HOST_UPDATE_WAIT_REASON_LIMIT),
    }),
  ),
});

export const HOST_UPDATE_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [HOST_UPDATE_ROUTES.status, adminRoute(empty, snapshot)],
  [HOST_UPDATE_ROUTES.check, adminRoute(empty, snapshot)],
  [HOST_UPDATE_ROUTES.start, adminRoute(fields({ restart: oneOf(...HOST_UPDATE_RESTART_MODES) }), snapshot)],
  [HOST_UPDATE_ROUTES.cancel, adminRoute(empty, snapshot)],
  [HOST_UPDATE_ROUTES.settings, adminRoute(fields({}, { autoDownload: boolean, autoInstall: boolean }), snapshot)],
]);

export const HOST_RESTART_EVENT = "host-restart";

export const HOST_RESTART_STATES = ["none", "waiting", "restarting"] as const;

export type HostRestartState = (typeof HOST_RESTART_STATES)[number];

export interface HostRestartEvent {
  type: typeof HOST_RESTART_EVENT;
  state: HostRestartState;
  version: string | null;
}

export function hostRestartEvent(value: unknown): HostRestartEvent | null {
  if (!isDynamicRecord(value) || value.type !== HOST_RESTART_EVENT) return null;
  const { state, version } = value;
  if (
    !isOneOf(HOST_RESTART_STATES, state) ||
    (version !== null && (!isString(version) || !version.length || version.length > 64))
  )
    throw new Error("Invalid host restart event.");
  return { type: HOST_RESTART_EVENT, state, version };
}
