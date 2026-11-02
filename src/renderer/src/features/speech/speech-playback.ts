import type { SpeechAudio, SpeechLanguage } from "@openbot/contracts/ipc";
import { createStore } from "solid-js";
import { speechPort } from "./speech-port";
import { speechParts } from "./speech-text";

/**
 * How many level samples a speaking waveform keeps, and how often a new one arrives. There are as many
 * as the voice player has bars, so that all of its bars move while a reply is read.
 */
export const SPEECH_LEVEL_COUNT = 40;
const SPEECH_LEVEL_INTERVAL_MS = 80;
/** The loudness of synthesized speech that fills the waveform. The model output is normalized. */
const SPEECH_FULL_RMS = 0.12;

/**
 * Whose words a reading reads: the agent on its server, and its message when the reading started
 * from one. Agent ids repeat across servers.
 */
export interface SpeechSource {
  serverId: string;
  agentId: string;
  messageId: string | null;
}

/** What is read aloud now, for the speaking bar, the voice pane and the message that plays. */
export interface SpeechReading {
  /** Null for a text of no agent, such as the voice sample in Settings. */
  serverId: string | null;
  agentId: string | null;
  messageId: string | null;
  /** The part that plays now, or the first part while it is synthesized. */
  part: string;
  /** The loudness of the voice, oldest first, from 0 to 1. */
  levels: number[];
  paused: boolean;
  /** For a recording: its length, in seconds. Null for a reading, which is synthesized as it plays. */
  duration: number | null;
  /** How far the recording or the reading played, in seconds. */
  elapsed: number;
}

/** A recording of a spoken message, decoded for playback, and its shape for the waveform. */
export interface VoiceRecordingSummary {
  duration: number;
  /** The loudness of each slice of the recording, from 0 to 1. */
  peaks: number[];
}

/** How many bars the waveform of a recording has. */
const RECORDING_PEAK_COUNT = 40;
/**
 * How many replies keep their audio after a full reading, and how long they can be together, in
 * seconds. One minute of speech is about 10 MB.
 */
const SPOKEN_AUDIO_LIMIT = 12;
const SPOKEN_AUDIO_SECONDS = 10 * 60;
/**
 * How many recordings stay decoded for playback. A decoded recording can be 20 MB; its waveform
 * stays after it is dropped, and a new play decodes it again.
 */
const DECODED_RECORDING_LIMIT = 4;

/** One text that is read aloud. Stopping it ends the part that plays and skips the rest. */
interface Reading {
  stopped: boolean;
  /** A plain copy of the paused state, because a store read can lag behind its write. */
  paused: boolean;
  source: AudioBufferSourceNode | undefined;
  stopMeter: (() => void) | undefined;
  /** Where the buffer that plays now started, in the recording and on the audio clock. */
  offset: number;
  startedAt: number;
  /** Set by a seek: the position the recording plays from next. */
  seekTo: number | undefined;
  /** For a reading: the length of the parts that played before the part that plays now. */
  before: number;
  /** For a reading: the audio of the parts that played, kept to play the message again. */
  played: AudioBuffer[];
}

let audioContext: AudioContext | undefined;
let analyser: AnalyserNode | undefined;
let reading: Reading | undefined;
const [state, setState] = createStore<{
  reading: SpeechReading | null;
  recordings: Record<string, VoiceRecordingSummary>;
  /** Recordings that the user deleted, for example in Storage: their file is gone. */
  goneRecordings: Record<string, true>;
  /** The duration and waveform of each message that was read aloud to its end. */
  spokenReplies: Record<string, VoiceRecordingSummary>;
}>({ reading: null, recordings: {}, goneRecordings: {}, spokenReplies: {} });
const decoded = new Map<string, Promise<AudioBuffer>>();
/** The audio of the messages in `spokenReplies`, oldest first. It is not saved, so a reload loses it. */
const spokenAudio = new Map<string, AudioBuffer>();

/** The reading that plays now, or null. */
export function speechReading(): SpeechReading | null {
  return state.reading;
}

/** The duration and waveform of a recording, once `loadRecording` decoded it. */
export function recordingSummary(url: string): VoiceRecordingSummary | undefined {
  return state.recordings[url];
}

/** True when a load of the recording found no file, because the user deleted it. */
export function recordingGone(url: string): boolean {
  return state.goneRecordings[url] === true;
}

/** The duration and waveform of a message, once a reading of it played to its end. */
export function spokenReply(messageId: string): VoiceRecordingSummary | undefined {
  return state.spokenReplies[messageId];
}

/**
 * Decodes a recording once, for its waveform and for playback. A failure is forgotten, so the next
 * call tries again.
 */
export function loadRecording(url: string): Promise<AudioBuffer> {
  const known = decoded.get(url);
  if (known) {
    // The newest use goes last, so the oldest is dropped first.
    decoded.delete(url);
    decoded.set(url, known);
    return known;
  }
  const loading = (async () => {
    const response = await fetch(url);
    if (response.status === 404)
      setState((draft) => {
        draft.goneRecordings[url] = true;
      });
    if (!response.ok) throw new Error(`Recording request failed with status ${response.status}.`);
    const bytes = await response.arrayBuffer();
    audioContext ??= new AudioContext();
    const buffer = await audioContext.decodeAudioData(bytes);
    const peaks = recordingPeaks(buffer);
    setState((draft) => {
      draft.recordings[url] = { duration: buffer.duration, peaks };
    });
    return buffer;
  })();
  decoded.set(url, loading);
  loading.catch(() => {
    if (decoded.get(url) === loading) decoded.delete(url);
  });
  if (decoded.size > DECODED_RECORDING_LIMIT) {
    const oldest = decoded.keys().next().value;
    if (oldest !== undefined) decoded.delete(oldest);
  }
  return loading;
}

function recordingPeaks(buffer: AudioBuffer): number[] {
  const samples = buffer.getChannelData(0);
  const size = Math.max(1, Math.floor(samples.length / RECORDING_PEAK_COUNT));
  const peaks: number[] = [];
  for (let bar = 0; bar < RECORDING_PEAK_COUNT; bar += 1) {
    let sum = 0;
    const start = bar * size;
    const stop = Math.min(samples.length, start + size);
    for (let index = start; index < stop; index += 1) sum += (samples[index] ?? 0) ** 2;
    peaks.push(stop > start ? Math.sqrt(sum / (stop - start)) : 0);
  }
  const loudest = Math.max(...peaks, 1e-6);
  return peaks.map((peak) => peak / loudest);
}

/** Pauses the reading that plays now. It holds its place until `resumeSpeech`. */
export function pauseSpeech(): void {
  if (!reading || reading.paused) return;
  reading.paused = true;
  void audioContext?.suspend();
  setState((draft) => {
    if (draft.reading) draft.reading.paused = true;
  });
}

export function resumeSpeech(): void {
  if (!reading?.paused) return;
  reading.paused = false;
  void audioContext?.resume();
  setState((draft) => {
    if (draft.reading) draft.reading.paused = false;
  });
}

/** Moves the recording that plays now to a position, in seconds. A paused recording stays paused. */
export function seekSpeech(seconds: number): void {
  const own = reading;
  const duration = state.reading?.duration;
  if (!own || duration == null) return;
  own.seekTo = Math.min(Math.max(0, seconds), duration);
  setState((draft) => {
    if (draft.reading) draft.reading.elapsed = own.seekTo ?? 0;
  });
  own.source?.stop();
}

/** Ends the reading that plays now, if there is one. */
export function stopSpeech(): void {
  if (!reading) return;
  end(reading);
}

function end(own: Reading): void {
  own.stopped = true;
  own.source?.stop();
  own.stopMeter?.();
  if (reading !== own) return;
  if (own.paused) void audioContext?.resume();
  reading = undefined;
  setState((draft) => {
    draft.reading = null;
  });
}

/** How a reading ended, for analytics. */
export interface ReadAloudResult {
  /** All parts played; false when a new reading or `stopSpeech` ended it. */
  completed: boolean;
  /** From the call to the first part that plays, or null when none played. */
  firstAudioMs: number | null;
  /** The length of the parts that played or started to play. */
  seconds: number;
}

/**
 * Reads a text aloud in parts, and synthesizes each part while the part before it plays. A new
 * reading, or `stopSpeech`, ends this one; the answer then comes at once. A failed part ends the
 * reading with its error.
 */
export async function readAloud(
  text: string,
  language: SpeechLanguage,
  source: SpeechSource | null = null,
): Promise<ReadAloudResult> {
  const calledAt = performance.now();
  const result: ReadAloudResult = { completed: false, firstAudioMs: null, seconds: 0 };
  stopSpeech();
  const parts = speechParts(text, language);
  const first = parts[0];
  if (first === undefined) return result;
  const own = newReading();
  setState((draft) => {
    draft.reading = {
      serverId: source?.serverId ?? null,
      agentId: source?.agentId ?? null,
      messageId: source?.messageId ?? null,
      part: first,
      levels: new Array(SPEECH_LEVEL_COUNT).fill(0),
      paused: false,
      duration: null,
      elapsed: 0,
    };
  });
  const voice = speechPort().voice;
  let next: Promise<SpeechAudio> | undefined = voice.speak({ text: first, language });
  try {
    for (let index = 1; next; index += 1) {
      const audio = await next;
      if (own.stopped) return result;
      const part = parts[index - 1];
      if (part !== undefined)
        setState((draft) => {
          if (!draft.reading) return;
          draft.reading.part = part;
        });
      const following = parts[index];
      next = following === undefined ? undefined : voice.speak({ text: following, language });
      // A reading that stops before this part plays never reads its answer.
      next?.catch(() => undefined);
      result.firstAudioMs ??= Math.round(performance.now() - calledAt);
      result.seconds += audio.pcm.byteLength / 2 / audio.sampleRate;
      await play(own, audio);
      if (own.stopped) return result;
    }
    const messageId = source?.messageId;
    if (messageId) keepSpokenAudio(messageId, own.played);
    result.completed = true;
    return result;
  } finally {
    end(own);
  }
}

/**
 * Plays the user's own recording of a spoken message from a position, in seconds, with the same
 * waveform as a reading. It has no agent, so the speaking bar and the voice pane do not show it.
 */
export async function playRecording(messageId: string, url: string, from = 0): Promise<void> {
  stopSpeech();
  const own = newReading();
  setState((draft) => {
    draft.reading = {
      serverId: null,
      agentId: null,
      messageId,
      part: "",
      levels: new Array(SPEECH_LEVEL_COUNT).fill(0),
      paused: false,
      duration: state.recordings[url]?.duration ?? null,
      elapsed: from,
    };
  });
  try {
    const buffer = await loadRecording(url);
    if (own.stopped) return;
    setState((draft) => {
      if (draft.reading) draft.reading.duration = buffer.duration;
    });
    await playSeekable(own, buffer, from);
  } finally {
    end(own);
  }
}

/**
 * Plays the kept audio of a message that was read aloud to its end, from a position, in seconds.
 * Returns false when no audio is kept, so the caller reads the message again.
 */
export function playSpokenReply(messageId: string, from = 0): boolean {
  const buffer = spokenAudio.get(messageId);
  if (!buffer) return false;
  stopSpeech();
  const own = newReading();
  setState((draft) => {
    draft.reading = {
      serverId: null,
      agentId: null,
      messageId,
      part: "",
      levels: new Array(SPEECH_LEVEL_COUNT).fill(0),
      paused: false,
      duration: buffer.duration,
      elapsed: from,
    };
  });
  void playSeekable(own, buffer, from).finally(() => end(own));
  return true;
}

/** Plays a buffer from a position. A seek stops the buffer and starts it again at the new position. */
async function playSeekable(own: Reading, buffer: AudioBuffer, from: number): Promise<void> {
  let offset = Math.min(own.seekTo ?? from, buffer.duration);
  for (;;) {
    own.seekTo = undefined;
    await playBuffer(own, buffer, offset);
    if (own.stopped || own.seekTo === undefined) return;
    offset = own.seekTo;
  }
}

/** Joins the parts of a full reading, so that the message can play again without synthesis. */
function keepSpokenAudio(messageId: string, parts: AudioBuffer[]): void {
  const first = parts[0];
  if (!audioContext || !first || parts.some((part) => part.sampleRate !== first.sampleRate)) return;
  const joined = audioContext.createBuffer(
    1,
    parts.reduce((total, part) => total + part.length, 0),
    first.sampleRate,
  );
  const channel = joined.getChannelData(0);
  let at = 0;
  for (const part of parts) {
    channel.set(part.getChannelData(0), at);
    at += part.length;
  }
  // A reply longer than the whole limit is not kept: it is read again when it plays.
  if (joined.duration > SPOKEN_AUDIO_SECONDS) return;
  spokenAudio.delete(messageId);
  spokenAudio.set(messageId, joined);
  const evicted: string[] = [];
  let seconds = 0;
  for (const buffer of spokenAudio.values()) seconds += buffer.duration;
  for (const [id, buffer] of spokenAudio) {
    if (spokenAudio.size <= SPOKEN_AUDIO_LIMIT && seconds <= SPOKEN_AUDIO_SECONDS) break;
    spokenAudio.delete(id);
    seconds -= buffer.duration;
    evicted.push(id);
  }
  const peaks = recordingPeaks(joined);
  setState((draft) => {
    draft.spokenReplies[messageId] = { duration: joined.duration, peaks };
    for (const id of evicted) delete draft.spokenReplies[id];
  });
}

function newReading(): Reading {
  const own: Reading = {
    stopped: false,
    paused: false,
    source: undefined,
    stopMeter: undefined,
    offset: 0,
    startedAt: 0,
    seekTo: undefined,
    before: 0,
    played: [],
  };
  reading = own;
  return own;
}

async function play(own: Reading, audio: SpeechAudio): Promise<void> {
  audioContext ??= new AudioContext();
  const length = audio.pcm.byteLength / 2;
  const buffer = audioContext.createBuffer(1, length, audio.sampleRate);
  const channel = buffer.getChannelData(0);
  const view = new DataView(audio.pcm.buffer, audio.pcm.byteOffset, audio.pcm.byteLength);
  for (let index = 0; index < length; index += 1) channel[index] = view.getInt16(index * 2, true) / 32_768;
  await playBuffer(own, buffer);
  if (own.stopped) return;
  own.before += buffer.duration;
  own.played.push(buffer);
}

async function playBuffer(own: Reading, buffer: AudioBuffer, offset = 0): Promise<void> {
  audioContext ??= new AudioContext();
  const context = audioContext;
  if (context.state === "suspended" && !own.paused) await context.resume();
  // A seek while the clock resumed plays from the new position instead.
  if (own.stopped || own.seekTo !== undefined) return;
  if (!analyser) {
    analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.connect(context.destination);
  }
  const output = analyser;
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(output);
  own.stopMeter ??= startMeter(own, output);
  await new Promise<void>((resolve) => {
    source.addEventListener(
      "ended",
      () => {
        source.disconnect();
        if (own.source === source) own.source = undefined;
        resolve();
      },
      { once: true },
    );
    own.source = source;
    own.offset = offset;
    own.startedAt = context.currentTime;
    source.start(0, offset);
  });
}

/** Samples the loudness of the voice for the waveform while a reading plays. */
function startMeter(own: Reading, output: AnalyserNode): () => void {
  const samples = new Float32Array(output.fftSize);
  let shown = 0;
  const timer = setInterval(() => {
    // A paused reading keeps its waveform and its position.
    if (own.paused || own.seekTo !== undefined) return;
    // Between two parts, nothing plays and the position holds.
    const playing = own.source !== undefined;
    const elapsed = own.before + own.offset + (output.context.currentTime - own.startedAt);
    output.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    const level = Math.min(1, Math.sqrt(sum / samples.length) / SPEECH_FULL_RMS);
    // Rise quickly with a word and fall back gently, as the recording waveform does.
    shown += (level - shown) * (level > shown ? 0.7 : 0.45);
    const value = shown;
    setState((draft) => {
      if (!draft.reading) return;
      draft.reading.levels = [...draft.reading.levels.slice(1), value];
      if (playing) draft.reading.elapsed = Math.min(elapsed, draft.reading.duration ?? elapsed);
    });
  }, SPEECH_LEVEL_INTERVAL_MS);
  return () => clearInterval(timer);
}
