import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";

/** A change of a realtime v3 turn: the user or the voice starts or ends speaking. */
export interface GptLiveTurn {
  step: "user-started" | "user-done" | "reply-started" | "reply-done";
  id: string;
}

/**
 * The turn change in a message of the `oai-events` data channel, or null for any other message. The
 * channel carries text from OpenAI, so a message that does not parse is not a turn.
 */
export function gptLiveTurn(data: unknown): GptLiveTurn | null {
  if (!isString(data)) return null;
  let event: unknown;
  try {
    event = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isDynamicRecord(event) || !isDynamicRecord(event.turn)) return null;
  const { id, role } = event.turn;
  if (!isString(id)) return null;
  const done = event.type === "turn.done";
  if (!done && event.type !== "turn.created") return null;
  if (role === "user") return { step: done ? "user-done" : "user-started", id };
  if (role === "assistant") return { step: done ? "reply-done" : "reply-started", id };
  return null;
}

/** The call bar shows one line, so a long transcript shows its end. */
const CAPTION_LENGTH = 120;

/** The end of `text` that fits the call bar, from the start of a word. */
export function gptLiveCaption(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= CAPTION_LENGTH) return trimmed;
  const tail = trimmed.slice(-CAPTION_LENGTH);
  const space = tail.indexOf(" ");
  return space >= 0 && space < CAPTION_LENGTH / 2 ? tail.slice(space + 1) : tail;
}

/**
 * The level of the call bar, from 0 to 1, in the WebRTC statistics of the call: the reply while the
 * voice speaks, else the microphone. The level is a linear amplitude; its square root makes a quiet
 * voice still move the bars.
 */
export function gptLiveLevel(reports: Iterable<unknown>, speaking: boolean): number {
  const source = speaking ? "inbound-rtp" : "media-source";
  let loudness = 0;
  for (const report of reports) {
    if (!isDynamicRecord(report) || report.kind !== "audio" || report.type !== source) continue;
    if (typeof report.audioLevel === "number" && Number.isFinite(report.audioLevel))
      loudness = Math.max(loudness, report.audioLevel);
  }
  return Math.min(1, Math.sqrt(loudness) * 1.4);
}
