import { decodeMachineAlertSettings } from "@openbot/contracts/ipc";
import {
  MACHINE_RESOURCES_CAPABILITY,
  MACHINE_RESOURCES_ROUTES,
} from "@openbot/contracts/team-protocol/machine-resources-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiMachine } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

/** The machine use of this host and its alert settings, read and set from a joined server. Frozen by `machine-resources-v1`. */
export async function routeMachineResources(
  context: TeamApiRequestContext,
  machine: TeamApiMachine | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const path = url.pathname;
  if (
    method !== "POST" ||
    (path !== MACHINE_RESOURCES_ROUTES.metrics &&
      path !== MACHINE_RESOURCES_ROUTES.alerts &&
      path !== MACHINE_RESOURCES_ROUTES.updateAlerts)
  )
    return "unmatched";
  if (!machine || !capabilities.has(MACHINE_RESOURCES_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.machineResourcesUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  if (path === MACHINE_RESOURCES_ROUTES.metrics) return json(200, await runCauseEffect(machine.metrics()));
  if (path === MACHINE_RESOURCES_ROUTES.alerts) return json(200, machine.alerts());
  let settings: ReturnType<typeof decodeMachineAlertSettings>;
  try {
    settings = decodeMachineAlertSettings(body);
  } catch {
    throw new HttpError(400, "Machine alert settings are invalid.");
  }
  if (!machine.canBeResponsible(settings.responsibleMemberId))
    throw new HttpError(400, sourceText("error.team.machineAlertMemberInvalid"));
  return json(200, await runCauseEffect(machine.setAlerts(settings)));
}
