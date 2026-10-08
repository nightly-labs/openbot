import type { HostUpdateSettingsChange, HostUpdateStatus, UpdateRestartMode } from "@openbot/contracts/ipc";
import { HOST_RELEASE_CAPABILITY, HOST_RELEASE_ROUTES } from "@openbot/contracts/team-protocol/host-release-v1";
import {
  HOST_UPDATE_CAPABILITY,
  HOST_UPDATE_RESTART_MODES,
  HOST_UPDATE_ROUTES,
  HOST_UPDATE_WAIT_REASON_LIMIT,
  HOST_UPDATE_WAIT_REASONS,
} from "@openbot/contracts/team-protocol/host-update-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { RequestedUpdateRefusal } from "../requested-update";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

const ROUTES = new Set<string>(Object.values(HOST_UPDATE_ROUTES));
const WAIT_REASONS = new Set<string>(HOST_UPDATE_WAIT_REASONS);

/**
 * The app update of this computer, asked for from a joined server. The update is the one the local
 * user runs; the restart waits for idle unless the admin asks for `now`. Frozen by `host-update-v1`.
 */
export async function routeHostUpdate(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (
    method === "POST" &&
    (url.pathname === HOST_RELEASE_ROUTES.status || url.pathname === HOST_RELEASE_ROUTES.check)
  ) {
    if (!admin?.release || !capabilities.has(HOST_RELEASE_CAPABILITY))
      throw new HttpError(400, sourceText("error.team.hostUpdateUnsupported"));
    requireAdmin(member);
    return json(
      200,
      url.pathname === HOST_RELEASE_ROUTES.status
        ? admin.release.snapshot()
        : await runCauseEffect(admin.release.check()),
    );
  }
  if (method !== "POST" || !ROUTES.has(url.pathname)) return "unmatched";
  const update = admin?.update;
  if (!update || !capabilities.has(HOST_UPDATE_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.hostUpdateUnsupported"));
  requireAdmin(member);
  try {
    if (url.pathname === HOST_UPDATE_ROUTES.status) return json(200, wireSnapshot(update.snapshot()));
    if (url.pathname === HOST_UPDATE_ROUTES.check) return json(200, wireSnapshot(await runCauseEffect(update.check())));
    if (url.pathname === HOST_UPDATE_ROUTES.cancel) return json(200, wireSnapshot(update.cancel()));
    const body = await readJson(request);
    if (url.pathname === HOST_UPDATE_ROUTES.settings)
      return json(
        200,
        wireSnapshot(await runCauseEffect(update.changeSettings(settingsChange(body.autoDownload, body.autoInstall)))),
      );
    const mode = restartMode(body.restart);
    const name = (member.name ?? member.username).slice(0, 128);
    return json(200, wireSnapshot(await runCauseEffect(update.start({ id: member.id, name }, mode))));
  } catch (error) {
    if (error instanceof RequestedUpdateRefusal)
      throw new HttpError(error.reason === "disabled" ? 403 : 409, error.message);
    throw error;
  }
}

/** `readJson` has checked the body against the codec; this only narrows the type. */
function restartMode(value: unknown): UpdateRestartMode {
  const mode = HOST_UPDATE_RESTART_MODES.find((candidate) => candidate === value);
  if (!mode) throw new HttpError(400, "A valid JSON object is required.");
  return mode;
}

/** `readJson` has checked the body against the codec; this keeps only the two switches. */
function settingsChange(autoDownload: unknown, autoInstall: unknown): HostUpdateSettingsChange {
  return {
    ...(typeof autoDownload === "boolean" ? { autoDownload } : {}),
    ...(typeof autoInstall === "boolean" ? { autoInstall } : {}),
  };
}

/** A reason this contract does not list travels as `"other"`, so a new blocker never breaks a client. */
function wireSnapshot(status: HostUpdateStatus): HostUpdateStatus {
  if (!status.restart) return status;
  const waitingFor = [
    ...new Set(status.restart.waitingFor.map((reason) => (WAIT_REASONS.has(reason) ? reason : "other"))),
  ].slice(0, HOST_UPDATE_WAIT_REASON_LIMIT);
  return {
    ...status,
    restart: { ...status.restart, requestedBy: status.restart.requestedBy?.slice(0, 128) ?? null, waitingFor },
  };
}
