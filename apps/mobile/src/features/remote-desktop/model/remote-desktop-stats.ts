import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { useSyncExternalStore } from "react";

export interface RemoteDesktopStats {
  width: number | null;
  height: number | null;
  codec: string | null;
  fps: number | null;
  requestedFps: number | null;
  decodeMs: number | null;
  bufferMs: number | null;
  hostMs: number | null;
  streamerMs: number | null;
  packetsLost: number | null;
  framesDropped: number | null;
  nacks: number | null;
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

function perFrame(total: number | null, before: number | null, seconds: number, fps: number | null): number | null {
  if (total === null || before === null || !fps || seconds <= 0 || total < before) return null;
  return ((total - before) * 1000) / (fps * seconds);
}

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
