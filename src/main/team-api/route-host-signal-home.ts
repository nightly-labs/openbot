import { parseSignalHomeChoice } from "@openbot/contracts/ipc";
import {
  HOST_SIGNAL_HOME_CAPABILITY,
  HOST_SIGNAL_HOME_ROUTES,
} from "@openbot/contracts/team-protocol/host-signal-home-v1";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";
import { SignalHomeUnknownError } from "../host-signal-home";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

export async function routeHostSignalHome(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (
    method !== "POST" ||
    (url.pathname !== HOST_SIGNAL_HOME_ROUTES.settings && url.pathname !== HOST_SIGNAL_HOME_ROUTES.update)
  )
    return "unmatched";
  const signalHome = admin?.signalHome;
  if (!signalHome || !capabilities.has(HOST_SIGNAL_HOME_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.hostSignalHomeUnsupported"));
  const body = await readJson(request);
  if (url.pathname === HOST_SIGNAL_HOME_ROUTES.settings) return json(200, await runCauseEffect(signalHome.snapshot()));
  requireAdmin(member);
  let home: string | null;
  try {
    home = parseSignalHomeChoice(body.home);
  } catch {
    throw new HttpError(400, sourceText("error.host.signalHomeUnknown"));
  }
  return json(
    200,
    await runCauseEffect(
      signalHome
        .set(home)
        .pipe(
          Effect.mapError((failure) =>
            failure instanceof SignalHomeUnknownError
              ? { cause: new HttpError(400, sourceText("error.host.signalHomeUnknown")) }
              : failure,
          ),
        ),
    ),
  );
}
