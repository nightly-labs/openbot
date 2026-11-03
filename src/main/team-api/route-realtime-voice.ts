import {
  parseRealtimeVoiceCall,
  parseRealtimeVoiceEnabled,
  parseRealtimeVoiceOffer,
  parseRealtimeVoiceReply,
  realtimeVoiceChoices,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import {
  REALTIME_VOICE_CAPABILITY,
  REALTIME_VOICE_ROUTES,
  REALTIME_VOICE_SELECTION_CAPABILITY,
  REALTIME_VOICE_SELECTION_ROUTE,
} from "@openbot/contracts/team-protocol/realtime-voice-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { RealtimeVoiceService } from "../realtime-voice-service";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, requireAgentLevel } from "./request-helpers";

export async function routeRealtimeVoice(
  context: TeamApiRequestContext,
  service: RealtimeVoiceService | undefined,
  agents: Pick<TeamApiAgents, "listAgents">,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json, member } = context;
  if (
    method !== "POST" ||
    (url.pathname !== REALTIME_VOICE_SELECTION_ROUTE &&
      !Object.values(REALTIME_VOICE_ROUTES).some((path) => path === url.pathname))
  )
    return "unmatched";
  if (!service || !capabilities.has(REALTIME_VOICE_CAPABILITY))
    throw new HttpError(400, sourceText("error.voice.realtime.disabled"));
  const body = await readJson(request);
  if (url.pathname === REALTIME_VOICE_SELECTION_ROUTE) {
    requireAdmin(member);
    if (
      !capabilities.has(REALTIME_VOICE_SELECTION_CAPABILITY) ||
      !isDynamicRecord(body) ||
      typeof body.voice !== "string" ||
      !realtimeVoiceChoices(service.status().model).includes(body.voice)
    )
      throw new HttpError(400, sourceText("error.voice.realtime.invalid"));
    return json(200, await runCauseEffect(service.setVoice(body.voice)));
  }
  if (url.pathname === REALTIME_VOICE_ROUTES.status) return json(200, service.status());
  if (url.pathname === REALTIME_VOICE_ROUTES.settings) {
    requireAdmin(member);
    let input: ReturnType<typeof parseRealtimeVoiceEnabled>;
    try {
      input = parseRealtimeVoiceEnabled(body);
    } catch {
      throw new HttpError(400, sourceText("error.voice.realtime.invalid"));
    }
    return json(200, await runCauseEffect(service.setEnabled(input.enabled)));
  }
  if (url.pathname !== REALTIME_VOICE_ROUTES.connect) {
    let input: ReturnType<typeof parseRealtimeVoiceCall>;
    try {
      input = parseRealtimeVoiceCall(body);
    } catch {
      throw new HttpError(400, sourceText("error.voice.realtime.invalid"));
    }
    if (url.pathname === REALTIME_VOICE_ROUTES.end) {
      await runCauseEffect(service.end(input, member.id));
      return json(200, {});
    }
    const canChat = () =>
      agents.listAgents().some((agent) => agent.id === input.agentId) &&
      ["chat", "manage"].includes(context.agentLevel(input.agentId));
    if (url.pathname === REALTIME_VOICE_ROUTES.poll)
      return json(200, await runCauseEffect(service.poll(input, member.id, canChat)));
    let reply: ReturnType<typeof parseRealtimeVoiceReply>;
    try {
      reply = parseRealtimeVoiceReply(body);
    } catch {
      throw new HttpError(400, sourceText("error.voice.realtime.invalid"));
    }
    await runCauseEffect(service.reply(reply, member.id, canChat));
    return json(200, {});
  }
  let offer: ReturnType<typeof parseRealtimeVoiceOffer>;
  try {
    offer = parseRealtimeVoiceOffer(body);
  } catch {
    throw new HttpError(400, sourceText("error.voice.realtime.invalid"));
  }
  const canChat = () =>
    agents.listAgents().some((agent) => agent.id === offer.agentId) &&
    ["chat", "manage"].includes(context.agentLevel(offer.agentId));
  requireAgentLevel(context, offer.agentId, "chat");
  const answer = await runCauseEffect(service.connect(offer, member.id, canChat));
  // The service checks access again after the provider round trip.
  return json(200, answer);
}
