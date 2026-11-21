import type { SpeechAudio, SpeechLanguage } from "@openbot/contracts/ipc";
import { createStore } from "solid-js";
import { speechPort } from "./speech-port";
import { partBudget, SpeechParts } from "./speech-text";

export const SPEECH_LEVEL_COUNT = 40;
const SPEECH_LEVEL_INTERVAL_MS = 80;
const SPEECH_FULL_RMS = 0.12;

export interface SpeechSource {
  serverId: string;
  agentId: string;
  messageId: string | null;
}

export interface SpeechReading {
  serverId: string | null;
  agentId: string | null;
  messageId: string | null;
  part: string;
  levels: number[];
  paused: boolean;
  duration: number | null;
  elapsed: number;
}

export interface VoiceRecordingSummary {
  duration: number;
  peaks: number[];
}

const RECORDING_PEAK_COUNT = 40;
const SPOKEN_AUDIO_LIMIT = 12;
const SPOKEN_AUDIO_SECONDS = 3 * 60;
const DECODED_RECORDING_LIMIT = 4;
const SYNTHESIS_AHEAD_SECONDS = 30;

export type SpeechAgent = Pick<SpeechSource, "serverId" | "agentId">;

interface Reading {
  stopped: boolean;
  agent: SpeechAgent | null;
  held: boolean;
  paused: boolean;
  reply: boolean;
  element: HTMLAudioElement | undefined;
  finish: (() => void) | undefined;
  stopMeter: (() => void) | undefined;
  seekTo: number | undefined;
  before: number;
  played: AudioBuffer[];
  lastPartAsked: boolean;
  askNext: (() => void) | undefined;
  failure: Error | undefined;
}

interface SpokenPart {
  audio: SpeechAudio;
  synthesisMs: number | undefined;
}

export interface UpcomingReading {
  text: string;
  language: SpeechLanguage;
  first?: Promise<SpeechAudio>;
}

let audioContext: AudioContext | undefined;
let analyser: AnalyserNode | undefined;
let reading: Reading | undefined;
let upcoming: UpcomingReading | undefined;
let heldAgent: SpeechAgent | undefined;
let replyRate = 1;
const [state, setState] = createStore<{
  reading: SpeechReading | null;
  recordings: Record<string, VoiceRecordingSummary>;
  goneRecordings: Record<string, true>;
  spokenReplies: Record<string, VoiceRecordingSummary>;
}>({ reading: null, recordings: {}, goneRecordings: {}, spokenReplies: {} });
const decoded = new Map<string, Promise<AudioBuffer>>();
const spokenAudio = new Map<string, AudioBuffer>();

export function speechReading(): SpeechReading | null {
  return state.reading;
}

export function recordingSummary(url: string): VoiceRecordingSummary | undefined {
  return state.recordings[url];
}

export function recordingGone(url: string): boolean {
  return state.goneRecordings[url] === true;
}

export function spokenReply(messageId: string): VoiceRecordingSummary | undefined {
  return state.spokenReplies[messageId];
}

export function loadRecording(url: string): Promise<AudioBuffer> {
  const known = decoded.get(url);
  if (known) {
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

export function setReplyPlaybackRate(rate: number): void {
  replyRate = rate;
  if (reading?.reply && reading.element) setRate(reading.element, rate);
}

function setRate(element: HTMLAudioElement, rate: number): void {
  element.defaultPlaybackRate = rate;
  element.playbackRate = rate;
}

export function pauseSpeech(): void {
  if (!reading || reading.paused) return;
  reading.paused = true;
  reading.element?.pause();
  setState((draft) => {
    if (draft.reading) draft.reading.paused = true;
  });
}

export function resumeSpeech(): void {
  const own = reading;
  if (!own?.paused) return;
  own.paused = false;
  if (own.element) startElement(own, own.element);
  own.askNext?.();
  setState((draft) => {
    if (draft.reading) draft.reading.paused = false;
  });
}

function sameAgent(first: SpeechAgent | null | undefined, second: SpeechAgent | undefined): boolean {
  return !!first && !!second && first.serverId === second.serverId && first.agentId === second.agentId;
}

export function holdSpeech(agent: SpeechAgent): void {
  heldAgent = agent;
  if (!reading || reading.paused || !sameAgent(reading.agent, agent)) return;
  reading.held = true;
  pauseSpeech();
}

export function releaseSpeech(agent: SpeechAgent, resume: boolean): void {
  if (!sameAgent(heldAgent, agent)) return;
  heldAgent = undefined;
  const own = reading;
  if (!own?.held) return;
  own.held = false;
  if (resume) resumeSpeech();
}

export function seekSpeech(seconds: number): void {
  const own = reading;
  const duration = state.reading?.duration;
  if (!own || duration == null) return;
  const to = Math.min(Math.max(0, seconds), duration);
  setState((draft) => {
    if (draft.reading) draft.reading.elapsed = to;
  });
  if (own.element) own.element.currentTime = to;
  else own.seekTo = to;
}

export function setUpcomingReading(next: UpcomingReading | undefined): void {
  upcoming = next;
  if (reading?.lastPartAsked) prepareUpcoming();
}

function prepareUpcoming(): void {
  const next = upcoming;
  if (!next || next.first) return;
  const first = new SpeechParts(next.text, next.language).next();
  if (first === undefined) return;
  next.first = speechPort().voice.speak({ text: first, language: next.language });
  next.first.catch(() => undefined);
}

export function stopSpeech(): void {
  if (!reading) return;
  end(reading);
}

function end(own: Reading): void {
  own.stopped = true;
  own.finish?.();
  own.stopMeter?.();
  if (reading !== own) return;
  reading = undefined;
  setState((draft) => {
    draft.reading = null;
  });
}

export interface ReadAloudResult {
  completed: boolean;
  firstAudioMs: number | null;
  seconds: number;
}

export async function readAloud(
  text: string,
  language: SpeechLanguage,
  source: SpeechSource | null = null,
  prepared?: UpcomingReading,
): Promise<ReadAloudResult> {
  const calledAt = performance.now();
  const result: ReadAloudResult = { completed: false, firstAudioMs: null, seconds: 0 };
  stopSpeech();
  const parts = new SpeechParts(text, language, replyRate);
  const first = parts.next();
  if (first === undefined) return result;
  const own = newReading(true, source);
  if (sameAgent(own.agent, heldAgent)) {
    own.paused = true;
    own.held = true;
  }
  setState((draft) => {
    draft.reading = {
      serverId: source?.serverId ?? null,
      agentId: source?.agentId ?? null,
      messageId: source?.messageId ?? null,
      part: first,
      levels: new Array(SPEECH_LEVEL_COUNT).fill(0),
      paused: own.paused,
      duration: null,
      elapsed: 0,
    };
  });
  const voice = speechPort().voice;
  const preparedFirst = prepared?.text === text && prepared.language === language ? prepared.first : undefined;
  const ask = (part: string): Promise<SpokenPart> => {
    const askedAt = performance.now();
    return voice.speak({ text: part, language }).then((audio) => ({ audio, synthesisMs: performance.now() - askedAt }));
  };
  const queue: Promise<SpokenPart & { text: string; seconds: number }>[] = [];
  let ahead = 0;
  let asking = false;
  let lastPart = first;
  let lastSynthesisMs: number | undefined;
  const enqueue = (part: string, spoken: Promise<SpokenPart>) => {
    asking = true;
    const ready = spoken.then((answer) => {
      const seconds = answer.audio.pcm.byteLength / 2 / answer.audio.sampleRate;
      ahead += seconds;
      asking = false;
      lastSynthesisMs = answer.synthesisMs;
      own.askNext?.();
      return { ...answer, text: part, seconds };
    });
    ready.catch(() => undefined);
    queue.push(ready);
  };
  const askNext = (playing = 0) => {
    if (own.stopped || own.paused || own.lastPartAsked || asking || ahead >= SYNTHESIS_AHEAD_SECONDS) return;
    const budget =
      lastSynthesisMs === undefined ? undefined : partBudget(lastPart, ahead + playing, lastSynthesisMs, replyRate);
    const following = parts.next(budget);
    if (following === undefined) {
      own.lastPartAsked = true;
      prepareUpcoming();
      return;
    }
    lastPart = following;
    enqueue(following, ask(following));
  };
  own.askNext = () => {
    const element = own.element;
    askNext(element ? element.duration - element.currentTime || 0 : 0);
  };
  enqueue(
    first,
    preparedFirst
      ? preparedFirst.then((audio) => ({ audio, synthesisMs: undefined })).catch(() => ask(first))
      : ask(first),
  );
  try {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const { audio, text: current, seconds } = await next;
      if (own.stopped) return result;
      ahead -= seconds;
      askNext(seconds);
      setState((draft) => {
        if (!draft.reading) return;
        draft.reading.part = current;
      });
      result.firstAudioMs ??= Math.round(performance.now() - calledAt);
      result.seconds += seconds;
      await play(own, audio);
      if (own.failure) throw own.failure;
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

export async function playRecording(messageId: string, url: string, from = 0): Promise<void> {
  stopSpeech();
  const own = newReading(false);
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

export function playSpokenReply(messageId: string, from = 0): boolean {
  const buffer = spokenAudio.get(messageId);
  if (!buffer) return false;
  stopSpeech();
  const own = newReading(true);
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

async function playSeekable(own: Reading, buffer: AudioBuffer, from: number): Promise<void> {
  let offset = Math.min(own.seekTo ?? from, buffer.duration);
  for (;;) {
    own.seekTo = undefined;
    await playBuffer(own, buffer, offset);
    if (own.stopped || own.seekTo === undefined) return;
    offset = own.seekTo;
  }
}

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

function newReading(reply: boolean, agent: SpeechAgent | null = null): Reading {
  const own: Reading = {
    stopped: false,
    agent: agent && { serverId: agent.serverId, agentId: agent.agentId },
    held: false,
    paused: false,
    reply,
    element: undefined,
    finish: undefined,
    stopMeter: undefined,
    seekTo: undefined,
    before: 0,
    played: [],
    lastPartAsked: false,
    askNext: undefined,
    failure: undefined,
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
  if (context.state === "suspended") await context.resume();
  if (own.stopped || own.seekTo !== undefined) return;
  if (!analyser) {
    analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.connect(context.destination);
  }
  const output = analyser;
  const url = URL.createObjectURL(new Blob([wavFile(buffer)], { type: "audio/wav" }));
  const element = new Audio();
  element.preservesPitch = true;
  setRate(element, own.reply ? replyRate : 1);
  element.src = url;
  element.currentTime = offset;
  const node = context.createMediaElementSource(element);
  node.connect(output);
  own.stopMeter ??= startMeter(own, output);
  await new Promise<void>((resolve) => {
    const finish = () => {
      element.removeEventListener("ended", finish);
      element.removeEventListener("error", failed);
      element.pause();
      node.disconnect();
      element.removeAttribute("src");
      element.load();
      URL.revokeObjectURL(url);
      if (own.element === element) {
        own.element = undefined;
        own.finish = undefined;
      }
      resolve();
    };
    const failed = () => {
      const cause = element.error;
      finish();
      fail(own, cause);
    };
    element.addEventListener("ended", finish);
    element.addEventListener("error", failed);
    own.element = element;
    own.finish = finish;
    if (!own.paused) startElement(own, element);
  });
}

function startElement(own: Reading, element: HTMLAudioElement): void {
  element.play().catch((error: unknown) => {
    if (own.stopped || (error instanceof DOMException && error.name === "AbortError")) return;
    fail(own, error);
  });
}

function fail(own: Reading, cause: unknown): void {
  own.failure ??= new Error("", { cause });
  end(own);
}

function wavFile(buffer: AudioBuffer): ArrayBuffer {
  const channels = buffer.numberOfChannels;
  const bytes = buffer.length * channels * 2;
  const file = new DataView(new ArrayBuffer(44 + bytes));
  const ascii = (at: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) file.setUint8(at + index, text.charCodeAt(index));
  };
  ascii(0, "RIFF");
  file.setUint32(4, 36 + bytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  file.setUint32(16, 16, true);
  file.setUint16(20, 1, true);
  file.setUint16(22, channels, true);
  file.setUint32(24, buffer.sampleRate, true);
  file.setUint32(28, buffer.sampleRate * channels * 2, true);
  file.setUint16(32, channels * 2, true);
  file.setUint16(34, 16, true);
  ascii(36, "data");
  file.setUint32(40, bytes, true);
  const pcm = new Int16Array(file.buffer, 44, buffer.length * channels);
  for (let channel = 0; channel < channels; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let index = 0; index < buffer.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
      pcm[index * channels + channel] = sample < 0 ? sample * 32_768 : sample * 32_767;
    }
  }
  return file.buffer;
}

function startMeter(own: Reading, output: AnalyserNode): () => void {
  const samples = new Float32Array(output.fftSize);
  let shown = 0;
  const timer = setInterval(() => {
    if (own.paused || own.seekTo !== undefined) return;
    const element = own.element;
    const elapsed = element ? own.before + element.currentTime : undefined;
    output.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    const level = Math.min(1, Math.sqrt(sum / samples.length) / SPEECH_FULL_RMS);
    shown += (level - shown) * (level > shown ? 0.7 : 0.45);
    const value = shown;
    setState((draft) => {
      if (!draft.reading) return;
      draft.reading.levels = [...draft.reading.levels.slice(1), value];
      if (elapsed !== undefined) draft.reading.elapsed = Math.min(elapsed, draft.reading.duration ?? elapsed);
    });
  }, SPEECH_LEVEL_INTERVAL_MS);
  return () => clearInterval(timer);
}
