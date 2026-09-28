// Frozen optional host-update-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can read the host's app update status, ask the host to check for an update, and ask it to
// download the update and restart into it. The restart waits until the host has no running work, or
// happens as soon as the update is ready when the admin asks for `now`. The admin can cancel a
// restart that has not started. The admin can also set the host's two update switches: download new
// versions automatically, and install them automatically when the host has no running work. A
// restart that the host scheduled itself has `requestedBy: null`. A member cannot use the routes;
// `requireAdmin` on the host is the only role gate. The host user can turn the routes off: the host
// then answers 403 to `check`, `start` and `settings` and reports `remoteUpdates: "disabled"`. A
// host whose updates a Host Manager controls reports `"managed"` and refuses the same routes.
//
// Every route answers with the same snapshot. The host's local status text does not travel: the
// client shows its own text for `errorCode`. The reasons in `waitingFor` are the fixed restart
// blockers of the host; the host sends a reason this contract does not list as `"other"`. The
// schedule lives only in the host's memory, so a host that restarts for another reason forgets it.
//
// The event stream tells every member, not only admins, that the host restarts into an update, so a
// member knows why the connection drops: `waiting` while the restart waits, `restarting` just before
// the host closes, and `none` when the schedule is removed. The host sends the current state again to
// a client that declares the capability later. It does not travel to a member without it.
// Widening any of it needs a second capability string.
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

/** The most reasons one snapshot carries. The host drops duplicates first. */
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
  /** The version the host restarts into, when it knows it. */
  version: string | null;
}

/** Null for any other event. A malformed restart event throws, so the stream fails closed. */
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
