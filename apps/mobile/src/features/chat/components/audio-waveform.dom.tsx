"use dom";

import { useEffect, useRef } from "react";
import type { WaveformJob, WaveformResult } from "../model/audio-waveforms";

interface AudioWaveformReaderProps {
  jobs: readonly WaveformJob[];
  /** How many bars a waveform has. A prop, so this bundle does not load the native file module. */
  bars: number;
  readSource: (id: string) => Promise<string>;
  onResult: (result: WaveformResult) => Promise<void>;
  dom?: import("expo/dom").DOMProps;
}

/** A low rate is enough for loudness, and it keeps a long file small in memory. */
const DECODE_SAMPLE_RATE = 8000;

// See `mermaid-renderer.dom.tsx`: the first render in Expo Go on Android can have no props.
const NO_JOBS: readonly WaveformJob[] = [];

/**
 * The one web view that reads the loudness of audio files, as desktop does. An offline audio
 * context decodes without playing, so it does not touch the app's audio session. Files are read
 * one after another; the native side sends a file only when its job starts.
 */
export default function AudioWaveformReader({
  jobs = NO_JOBS,
  bars = 0,
  readSource,
  onResult,
}: AudioWaveformReaderProps) {
  const started = useRef(new Set<string>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const callbacks = useRef({ readSource, onResult, bars });
  callbacks.current = { readSource, onResult, bars };

  useEffect(() => {
    for (const job of jobs) {
      if (started.current.has(job.id)) continue;
      started.current.add(job.id);
      queue.current = queue.current
        .then(async () => {
          const { bars: count } = callbacks.current;
          const peaks = count > 0 ? await read(await callbacks.current.readSource(job.id), count) : null;
          await callbacks.current.onResult({ id: job.id, peaks });
        })
        .catch(() => undefined);
    }
    const current = new Set(jobs.map((job) => job.id));
    for (const id of started.current) if (!current.has(id)) started.current.delete(id);
  }, [jobs]);

  return null;
}

async function read(base64: string, count: number): Promise<number[] | null> {
  if (!base64) return null;
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const context = new OfflineAudioContext(1, 1, DECODE_SAMPLE_RATE);
    const buffer = await context.decodeAudioData(bytes.buffer);
    return peaks(buffer, count);
  } catch {
    return null;
  }
}

/** The root mean square of each part, scaled so the loudest part is 1. */
function peaks(buffer: AudioBuffer, count: number): number[] {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const size = Math.max(1, Math.floor(buffer.length / count));
  const result: number[] = [];
  for (let bar = 0; bar < count; bar += 1) {
    const start = bar * size;
    const stop = Math.min(buffer.length, start + size);
    let sum = 0;
    for (const data of channels)
      for (let index = start; index < stop; index += 1) {
        const sample = data[index] ?? 0;
        sum += sample * sample;
      }
    const count = (stop - start) * channels.length;
    result.push(count > 0 ? Math.sqrt(sum / count) : 0);
  }
  const loudest = Math.max(...result, 1e-6);
  return result.map((peak) => Math.min(1, peak / loudest));
}
