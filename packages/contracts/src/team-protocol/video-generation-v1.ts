import { isVideoGenerationInfo, type VideoGenerationInfo } from "../ipc-conversation-messages";
import { isDynamicRecord, isString } from "../runtime-values";
import type { TeamProtocolV7BaseJsonObject, TeamProtocolV7BaseJsonValue } from "./v7-base";

/**
 * Frozen optional video-generation-v1 contract: the request of a video that an agent made with a tool.
 * It adds `videoGeneration` (a `VideoGenerationInfo`, see `ipc-conversation-messages.ts`) beside the
 * frozen keys of a message in:
 *
 * - `messages` and `references` of `GET /v1/agents/:agentId/conversation` and
 *   `GET /v1/agents/:agentId/conversation-page`;
 * - the `snapshot` of a `conversation` event and the `page` of a `conversation-page` event.
 *
 * The host adds it only for a client that advertises the capability, on protocol 9, so the wire of
 * every released client stays as it was. Such a client reads the message as its fallback: a
 * `video_generation` message that shows its mp4 attachment alone. A host without the capability never
 * sends `videoGeneration`, so a client accepts it whenever it is present. A present value that
 * `isVideoGenerationInfo` refuses fails closed. The value goes out with only known keys. Channel
 * messages and the task conversations of agent-tasks-v1 do not carry it. Widening any of it needs a
 * second capability string.
 */
export const TEAM_VIDEO_GENERATION_CAPABILITY = "video-generation-v1";

/**
 * All the video requests of one snapshot, page or event together, as `JSON.stringify` writes them, in
 * UTF-16 code units. The prompt and the error have no length limit, and a page carries up to a hundred
 * messages and their references. The newest values are kept up to this budget, and an older value over
 * it is left out: its message still shows the attachment.
 */
const CONVERSATION_VIDEO_GENERATION_WIRE_BUDGET = 1_000_000;

/** The value as this capability sends it: only the known keys. */
function v1VideoGeneration(value: VideoGenerationInfo): VideoGenerationInfo {
  return {
    ...(value.prompt === undefined ? {} : { prompt: value.prompt }),
    aspectRatio: value.aspectRatio,
    ...(value.durationSeconds === undefined ? {} : { durationSeconds: value.durationSeconds }),
    ...(value.resolution === undefined ? {} : { resolution: value.resolution }),
    ...(value.error === undefined ? {} : { error: value.error }),
  };
}

/** `projected` with the video request of each message of `source` that has one, within the wire budget. */
export function withConversationVideoGeneration(
  projected: TeamProtocolV7BaseJsonValue,
  source: unknown,
): TeamProtocolV7BaseJsonValue {
  if (!isDynamicRecord(projected) || !isDynamicRecord(source)) return projected;
  const fromMessages = Array.isArray(source.messages) ? source.messages : [];
  const fromReferences = isDynamicRecord(source.references) ? Object.values(source.references) : [];
  // Messages run oldest first, so the budget goes to the newest messages first. A page names the
  // messages its replies point at separately; those come last.
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
