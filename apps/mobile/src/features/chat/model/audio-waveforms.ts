import { File, Paths } from "expo-file-system";
import { useEffect, useSyncExternalStore } from "react";

export const WAVEFORM_BARS = 48;
const SAVED_LIMIT = 200;
const SAVE_DELAY_MS = 1_000;
const STORAGE_NAME = "chat-audio-waveforms-v1.json";

export interface WaveformJob {
  id: string;
}

export interface WaveformResult {
  id: string;
  peaks: number[] | null;
}

export type Waveform = readonly number[] | "failed" | undefined;

const waveforms = new Map<string, readonly number[] | "failed">();
const sources = new Map<string, string>();
const listeners = new Set<() => void>();
let jobs: readonly WaveformJob[] = [];
let loaded = false;
let savePending = false;

function storage() {
  return new File(Paths.cache, STORAGE_NAME);
}

function isPeaks(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === WAVEFORM_BARS &&
    value.every((peak) => typeof peak === "number" && peak >= 0 && peak <= 1)
  );
}

function decodeSaved(value: unknown): [string, number[]][] {
  if (!Array.isArray(value)) return [];
  return value.slice(-SAVED_LIMIT).flatMap((entry): [string, number[]][] => {
    if (!Array.isArray(entry)) return [];
    const [key, peaks] = entry;
    return typeof key === "string" && key.length <= 300 && isPeaks(peaks) ? [[key, peaks]] : [];
  });
}

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const file = storage();
    if (!file.exists) return;
    for (const [key, peaks] of decodeSaved(JSON.parse(file.textSync()))) waveforms.set(key, peaks);
  } catch {
    waveforms.clear();
  }
}

function scheduleSave() {
  if (savePending) return;
  savePending = true;
  setTimeout(() => {
    savePending = false;
    const entries = [...waveforms].filter(([, peaks]) => peaks !== "failed").slice(-SAVED_LIMIT);
    try {
      storage().writeSync(JSON.stringify(entries));
    } catch {}
  }, SAVE_DELAY_MS);
}

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWaveformJobs(): readonly WaveformJob[] {
  return useSyncExternalStore(subscribe, () => jobs);
}

export async function readWaveformSource(id: string): Promise<string> {
  const uri = sources.get(id);
  if (!uri) return "";
  try {
    return await new File(uri).base64();
  } catch {
    return "";
  }
}

export function receiveWaveformResult(result: WaveformResult) {
  sources.delete(result.id);
  jobs = jobs.filter((job) => job.id !== result.id);
  if (result.peaks && isPeaks(result.peaks)) {
    waveforms.delete(result.id);
    waveforms.set(result.id, result.peaks);
    scheduleSave();
  } else waveforms.set(result.id, "failed");
  emit();
}

export function useAudioWaveform(key: string, uri: string | null): Waveform {
  load();
  const waveform = useSyncExternalStore(subscribe, () => waveforms.get(key));
  useEffect(() => {
    if (!uri || waveforms.has(key) || sources.has(key)) return;
    sources.set(key, uri);
    jobs = [...jobs, { id: key }];
    emit();
  }, [key, uri]);
  return waveform;
}
