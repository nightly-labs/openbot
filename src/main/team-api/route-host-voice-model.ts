import { type HostVoiceModelChange, parseHostVoiceModelChange } from "@openbot/contracts/ipc";
import {
  HOST_VOICE_MODEL_CAPABILITY,
  HOST_VOICE_MODEL_ROUTES,
} from "@openbot/contracts/team-protocol/host-voice-model-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin } from "./request-helpers";

export async function routeHostVoiceModel(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  if (
    method !== "POST" ||
    (url.pathname !== HOST_VOICE_MODEL_ROUTES.settings && url.pathname !== HOST_VOICE_MODEL_ROUTES.change)
  )
    return "unmatched";
  const voiceModel = admin?.voiceModel;
  if (!voiceModel || !capabilities.has(HOST_VOICE_MODEL_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.hostVoiceModelUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  if (url.pathname === HOST_VOICE_MODEL_ROUTES.settings) return json(200, await runCauseEffect(voiceModel.snapshot()));
  let change: HostVoiceModelChange;
  try {
    change = parseHostVoiceModelChange(body);
  } catch {
    throw new HttpError(400, sourceText("error.team.requestFailed"));
  }
  return json(200, await runCauseEffect(voiceModel.change(change)));
}
