import { isCodexLiveVoice, type VoiceLiveEvent, type VoiceLiveSession } from "@openbot/contracts/ipc";
import {
  decodeLiveVoiceStartRequest,
  decodeLiveVoiceStopRequest,
  LIVE_VOICE_CAPABILITY,
  LIVE_VOICE_EVENT,
  LIVE_VOICE_REASON_LIMIT,
  LIVE_VOICE_ROUTES,
  LIVE_VOICE_TRANSCRIPT_LIMIT,
  type LiveVoiceEvent,
} from "@openbot/contracts/team-protocol/live-voice-v1";
import { isFixedSourceText, sourceText, sourceTextValues } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiAgents, TeamApiLiveVoice } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { memberSender, readJson, requireAgentLevel } from "./request-helpers";

export class TeamLiveVoiceSessions {
  readonly #owners = new Map<
    string,
    { readonly memberId: string; readonly agentId: string; readonly teamSessionId: string }
  >();

  add(sessionId: string, memberId: string, agentId: string, teamSessionId: string): void {
    this.#owners.set(sessionId, { memberId, agentId, teamSessionId });
  }

  remove(sessionId: string): void {
    this.#owners.delete(sessionId);
  }

  ofTeamSession(teamSessionId: string): { readonly sessionId: string; readonly memberId: string }[] {
    return [...this.#owners]
      .filter(([, owner]) => owner.teamSessionId === teamSessionId)
      .map(([sessionId, owner]) => ({ sessionId, memberId: owner.memberId }));
  }

  all(): { readonly sessionId: string; readonly memberId: string; readonly agentId: string }[] {
    return [...this.#owners].map(([sessionId, owner]) => ({
      sessionId,
      memberId: owner.memberId,
      agentId: owner.agentId,
    }));
  }
}

export function liveVoiceWireEvent(event: VoiceLiveEvent): LiveVoiceEvent {
  return event.type === "transcript"
    ? {
        type: LIVE_VOICE_EVENT,
        kind: "transcript",
        sessionId: event.sessionId,
        role: event.role,
        text: event.text.slice(0, LIVE_VOICE_TRANSCRIPT_LIMIT),
        final: event.final,
      }
    : {
        type: LIVE_VOICE_EVENT,
        kind: "ended",
        sessionId: event.sessionId,
        error: event.error === null ? null : event.error.slice(0, LIVE_VOICE_REASON_LIMIT),
      };
}

export function voiceLiveEventFromWire(event: LiveVoiceEvent): VoiceLiveEvent {
  return event.kind === "transcript"
    ? { type: "transcript", sessionId: event.sessionId, role: event.role, text: event.text, final: event.final }
    : { type: "ended", sessionId: event.sessionId, error: event.error };
}

function isUserStartFailure(message: string): boolean {
  return isFixedSourceText(message) || sourceTextValues(message, "error.voice.live.startFailed") !== null;
}

export interface LiveVoiceRouteOptions {
  liveVoice: TeamApiLiveVoice | undefined;
  agents: Pick<TeamApiAgents, "listAgents">;
  hiddenAgentIds: ReadonlySet<string>;
  sessions: TeamLiveVoiceSessions;
  hasEventConnection(teamSessionId: string, memberId: string): boolean;
}

export async function routeLiveVoice(
  context: TeamApiRequestContext,
  options: LiveVoiceRouteOptions,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json, member, sessionId } = context;
  if (method !== "POST" || (url.pathname !== LIVE_VOICE_ROUTES.start && url.pathname !== LIVE_VOICE_ROUTES.stop))
    return "unmatched";
  const liveVoice = options.liveVoice;
  if (!liveVoice || !capabilities.has(LIVE_VOICE_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.liveVoiceUnsupported"));
  const body = await readJson(request);
  if (url.pathname === LIVE_VOICE_ROUTES.stop) {
    let voiceSessionId: string;
    try {
      voiceSessionId = decodeLiveVoiceStopRequest(body);
    } catch {
      throw new HttpError(400, sourceText("error.team.requestFailed"));
    }
    await runCauseEffect(liveVoice.stopLiveVoice(voiceSessionId, member.id));
    return json(200, {});
  }
  let input: ReturnType<typeof decodeLiveVoiceStartRequest>;
  try {
    input = decodeLiveVoiceStartRequest(body);
  } catch {
    throw new HttpError(400, sourceText("error.team.requestFailed"));
  }
  if (
    options.hiddenAgentIds.has(input.agentId) ||
    !options.agents.listAgents().some((agent) => agent.id === input.agentId)
  )
    throw new HttpError(404, sourceText("error.team.agentNotFound"));
  requireAgentLevel(context, input.agentId, "chat");
  if (!options.hasEventConnection(sessionId, member.id))
    throw new HttpError(409, sourceText("error.voice.live.disconnected"));
  let session: VoiceLiveSession;
  try {
    session = await runCauseEffect(
      liveVoice.startLiveVoice(
        { agentId: input.agentId, sdp: input.sdp },
        isCodexLiveVoice(input.voice) ? input.voice : null,
        { memberId: member.id, sender: memberSender(member) },
      ),
    );
  } catch (error) {
    if (error instanceof Error && isUserStartFailure(error.message)) throw new HttpError(409, error.message);
    throw error;
  }
  if (!options.hasEventConnection(sessionId, member.id)) {
    await runCauseEffect(liveVoice.stopLiveVoice(session.sessionId, member.id));
    throw new HttpError(409, sourceText("error.voice.live.disconnected"));
  }
  options.sessions.add(session.sessionId, member.id, input.agentId, sessionId);
  return json(200, { sessionId: session.sessionId, sdp: session.sdp });
}
