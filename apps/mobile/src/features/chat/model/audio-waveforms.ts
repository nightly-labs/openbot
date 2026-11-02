import { File, Paths } from "expo-file-system";
import { useEffect, useSyncExternalStore } from "react";

/** How many bars a waveform has. The card draws fewer when it is narrow. */
export const WAVEFORM_BARS = 48;
/** The saved waveforms. Each is small, and an audio file that scrolls back shows its shape at once. */
const SAVED_LIMIT = 200;
const SAVE_DELAY_MS = 1_000;
const STORAGE_NAME = "chat-audio-waveforms-v1.json";

export interface WaveformJob {
  id: string;
}

export interface WaveformResult {
  id: string;
  /** The loudness of each part of the file, from 0 to 1, or null when the web view cannot decode it. */
  peaks: number[] | null;
}

/** A waveform: its bars, `failed` when the file cannot be decoded, or undefined while it is read. */
export type Waveform = readonly number[] | "failed" | undefined;

// One hidden web view decodes each audio file once, as desktop does with the Web Audio API, and
// each card reads the result from here. A file the web view cannot decode keeps flat bars.
const waveforms = new Map<string, readonly number[] | "failed">();
/** The file of each waiting job, by its key. */
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

/** The saved entries a later launch can trust, oldest first. Anything else is dropped. */
function decodeSaved(value: unknown): [string, number[]][] {
  if (!Array.isArray(value)) return [];
  return value.slice(-SAVED_LIMIT).flatMap((entry): [string, number[]][] => {
    if (!Array.isArray(entry)) return [];
    const [key, peaks] = entry;
    return typeof key === "string" && key.length <= 300 && isPeaks(peaks) ? [[key, peaks]] : [];
  });
}

/** Reads the saved waveforms once. A file that fails to read only costs the saved shapes. */
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
    } catch {
      // The shapes are read again from the files next time.
    }
  }, SAVE_DELAY_MS);
}

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The audio files that wait for the web view. */
export function useWaveformJobs(): readonly WaveformJob[] {
  return useSyncExternalStore(subscribe, () => jobs);
}

/** The file of a job, as Base64, for the web view to decode. Empty when the file cannot be read. */
export async function readWaveformSource(id: string): Promise<string> {
  const uri = sources.get(id);
  if (!uri) return "";
  try {
    return await new File(uri).base64();
  } catch {
    return "";
  }
}

/** Stores what the web view read and removes its job. */
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

/**
 * The waveform of an audio attachment. `key` names the file across launches; `uri` is the local
 * file, and the web view reads it once it is there.
 */
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
