import { isVideoGenerationInfo, type VideoGenerationInfo } from "../ipc-conversation-messages";
import { isDynamicRecord, isString } from "../runtime-values";
import type { TeamProtocolV7BaseJsonObject, TeamProtocolV7BaseJsonValue } from "./v7-base";

export const TEAM_VIDEO_GENERATION_CAPABILITY = "video-generation-v1";

const CONVERSATION_VIDEO_GENERATION_WIRE_BUDGET = 1_000_000;

function v1VideoGeneration(value: VideoGenerationInfo): VideoGenerationInfo {
  return {
    ...(value.prompt === undefined ? {} : { prompt: value.prompt }),
    aspectRatio: value.aspectRatio,
    ...(value.durationSeconds === undefined ? {} : { durationSeconds: value.durationSeconds }),
    ...(value.resolution === undefined ? {} : { resolution: value.resolution }),
    ...(value.error === undefined ? {} : { error: value.error }),
  };
}

export function withConversationVideoGeneration(
  projected: TeamProtocolV7BaseJsonValue,
  source: unknown,
): TeamProtocolV7BaseJsonValue {
  if (!isDynamicRecord(projected) || !isDynamicRecord(source)) return projected;
  const fromMessages = Array.isArray(source.messages) ? source.messages : [];
  const fromReferences = isDynamicRecord(source.references) ? Object.values(source.references) : [];
  const candidates: Array<{ id: string; value: TeamProtocolV7BaseJsonValue; size: number }> = [];
  for (const message of [...[...fromMessages].reverse(), ...fromReferences]) {
    if (!isDynamicRecord(message) || message.videoGeneration === undefined) continue;
    if (!isVideoGenerationInfo(message.videoGeneration)) throw new Error("Invalid conversation video generation.");
    const json = JSON.stringify(v1VideoGeneration(message.videoGeneration));
    if (isString(message.id)) candidates.push({ id: message.id, value: JSON.parse(json), size: json.length });
  }
  if (candidates.length === 0) return projected;
  const values = new Map<string, TeamProtocolV7BaseJsonValue>();
  let used = 0;
  for (const candidate of candidates) {
    if (values.has(candidate.id) || used + candidate.size > CONVERSATION_VIDEO_GENERATION_WIRE_BUDGET) continue;
    values.set(candidate.id, candidate.value);
    used += candidate.size;
  }
  const withVideoGeneration = (message: TeamProtocolV7BaseJsonValue): TeamProtocolV7BaseJsonValue => {
    if (!isDynamicRecord(message) || !isString(message.id)) return message;
    const videoGeneration = values.get(message.id);
    return videoGeneration === undefined ? message : { ...message, videoGeneration };
  };
  const result: TeamProtocolV7BaseJsonObject = { ...projected };
  if (Array.isArray(result.messages)) result.messages = result.messages.map(withVideoGeneration);
  if (isDynamicRecord(result.references)) {
    result.references = Object.fromEntries(
      Object.entries(result.references).map(([id, value]) => [id, withVideoGeneration(value)]),
    );
  }
  return result;
}
