import { VOICE_AUDIO_LIMITS } from "@openbot/contracts/ipc";
import {
  VOICE_TRANSCRIPTION_CAPABILITY,
  VOICE_TRANSCRIPTION_ROUTES,
} from "@openbot/contracts/team-protocol/voice-transcription-v1";
import { isFixedSourceText, sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import { parseVoiceTranscription } from "../ipc/voice-inputs";
import type { TeamApiVoiceTranscription } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readBinary } from "./request-helpers";

export async function routeVoiceTranscription(
  context: TeamApiRequestContext,
  voice: TeamApiVoiceTranscription | undefined,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (method !== "POST" || url.pathname !== VOICE_TRANSCRIPTION_ROUTES.transcribe) return "unmatched";
  if (!voice || !capabilities.has(VOICE_TRANSCRIPTION_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.voiceTranscriptionUnsupported"));
  const audio = await readBinary(request, VOICE_AUDIO_LIMITS.maximumWavBytes).catch((error: unknown) => {
    if (error instanceof HttpError && error.status === 413)
      throw new HttpError(413, sourceText("error.voice.host.tooLong"));
    throw error;
  });
  try {
    parseVoiceTranscription({ audio });
  } catch {
    throw new HttpError(400, sourceText("error.voice.host.invalidRecording"));
  }
  try {
    return json(200, await runCauseEffect(voice.transcribe(audio)));
  } catch (error) {
    if (error instanceof Error && isFixedSourceText(error.message)) throw new HttpError(409, error.message);
    throw error;
  }
}
