"use dom";

import { base64ToBytes } from "@openbot/team-client/base64";
import { useEffect, useRef } from "react";
import type { WaveformJob, WaveformResult } from "../model/audio-waveforms";

interface AudioWaveformReaderProps {
  jobs: readonly WaveformJob[];
  bars: number;
  readSource: (id: string) => Promise<string>;
  onResult: (result: WaveformResult) => Promise<void>;
  dom?: import("expo/dom").DOMProps;
}

const DECODE_SAMPLE_RATE = 8000;

const NO_JOBS: readonly WaveformJob[] = [];

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
    const bytes = base64ToBytes(base64);
    const context = new OfflineAudioContext(1, 1, DECODE_SAMPLE_RATE);
    const buffer = await context.decodeAudioData(bytes.buffer);
    return peaks(buffer, count);
  } catch {
    return null;
  }
}

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
