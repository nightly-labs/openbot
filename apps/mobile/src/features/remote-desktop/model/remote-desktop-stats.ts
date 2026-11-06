import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { useSyncExternalStore } from "react";

// The connection stats of the open remote desktop, for the stats sheet. The viewer page sends
// Moonlight's stats once a second while the sheet is open. Moonlight names WebRTC's running totals
// "…Ms", but they are seconds summed over all frames, so the time for one frame is read from the
// change between two samples.

export interface RemoteDesktopStats {
  width: number | null;
  height: number | null;
  codec: string | null;
  /** Frames a second that the phone gets. */
  fps: number | null;
  /** Frames a second that the phone asked for. */
  requestedFps: number | null;
  /** Average milliseconds to decode one frame, over the last second. */
  decodeMs: number | null;
  /** Average milliseconds that a frame waited in the jitter buffer, over the last second. */
  bufferMs: number | null;
  /** Milliseconds from the computer's capture to the streamer, as Sunshine reports them. */
  hostMs: number | null;
  /** Milliseconds that the streamer on the computer took for a frame. */
  streamerMs: number | null;
  packetsLost: number | null;
  framesDropped: number | null;
  /** Lost packets that the phone asked for again. */
  nacks: number | null;
  /** Moonlight's own values, for a support report. */
  raw: string;
}

interface Totals {
  at: number;
  decode: number | null;
  buffer: number | null;
}

let current: RemoteDesktopStats | null = null;
let previous: Totals | null = null;
let open = false;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function numberAt(record: unknown, key: string): number | null {
  if (!isDynamicRecord(record)) return null;
  const value = record[key];
  return isNumber(value) && Number.isFinite(value) ? value : null;
}

/** Milliseconds for one frame: the change of a total in seconds over the frames of that time. */
function perFrame(total: number | null, before: number | null, seconds: number, fps: number | null): number | null {
  if (total === null || before === null || !fps || seconds <= 0 || total < before) return null;
  return ((total - before) * 1000) / (fps * seconds);
}

/** One sample from the page. A value that is not Moonlight's shape is dropped. */
export function receiveRemoteDesktopStats(value: unknown, now = Date.now()): void {
  if (!open || !isDynamicRecord(value)) return;
  const transport = value.transport;
  const fps = numberAt(transport, "webrtcFps");
  const decode = numberAt(transport, "webrtcTotalDecodeTimeMs");
  const buffer = numberAt(transport, "webrtcJitterBufferDelayMs");
  const seconds = previous ? (now - previous.at) / 1000 : 0;
  current = {
    width: numberAt(value, "videoWidth"),
    height: numberAt(value, "videoHeight"),
    codec: isString(value.videoCodec) ? value.videoCodec.slice(0, 32) : null,
    fps,
    requestedFps: numberAt(value, "videoFps"),
    decodeMs: perFrame(decode, previous?.decode ?? null, seconds, fps),
    bufferMs: perFrame(buffer, previous?.buffer ?? null, seconds, fps),
    hostMs: numberAt(value, "avgHostProcessingLatencyMs"),
    streamerMs: numberAt(value, "avgStreamerProcessingTimeMs"),
    packetsLost: numberAt(transport, "webrtcPacketsLost"),
    framesDropped: numberAt(transport, "webrtcFramesDropped"),
    nacks: numberAt(transport, "webrtcNackCount"),
    raw: JSON.stringify(value, null, 2).slice(0, 16_384),
  };
  previous = { at: now, decode, buffer };
  notify();
}

/** The sheet is open: the screen asks the page for samples while this is true. */
export function setRemoteDesktopStatsOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  current = null;
  previous = null;
  notify();
}

export function useRemoteDesktopStats(): RemoteDesktopStats | null {
  return useSyncExternalStore(subscribe, () => current);
}

export function useRemoteDesktopStatsOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open);
}
