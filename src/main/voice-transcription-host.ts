import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  VoiceSpeechCheckRequest,
  VoiceTranscriptionEngine,
  VoiceTranscriptionFailure,
  VoiceTranscriptionRequest,
  VoiceTranscriptionResponse,
} from "./voice-transcription-protocol";

const SAMPLE_RATE = 16_000;
const WINDOWED_PARTS = { maximumSamples: 28 * SAMPLE_RATE, splitSearchSamples: 4 * SAMPLE_RATE };
const TRANSDUCER_PARTS = { maximumSamples: 90 * SAMPLE_RATE, splitSearchSamples: 20 * SAMPLE_RATE };
const SPLIT_WINDOW_SAMPLES = SAMPLE_RATE / 50;
const SPEECH_ABOVE_FLOOR_DB = 10;
const SPEECH_BELOW_PEAK_DB = 40;
const SPEECH_MARGIN_SAMPLES = (450 * SAMPLE_RATE) / 1_000;
const SPEECH_END_SILENCE_SAMPLES = SAMPLE_RATE;
const DIGITAL_SILENCE_DB = -90;
const WHISPER_TOKENS_PER_SECOND = "15";
const MAXIMUM_LEADING_SILENCE_SAMPLES = SAMPLE_RATE;
const MAXIMUM_THREADS = 64;
const SESSION_CONFIG_PATTERN = /^(?:[a-z0-9-]+\.cfg)?$/u;
const SPEECH_WINDOW_SAMPLES = 512;
const SPEECH_DETECTOR_CONFIG = {
  threshold: 0.5,
  minSilenceDuration: 0.25,
  minSpeechDuration: 0.1,
  windowSize: SPEECH_WINDOW_SAMPLES,
  maxSpeechDuration: 20,
};
const SPEECH_BUFFER_SECONDS = 30;

interface RecognizerConfig {
  featConfig: { sampleRate: number; featureDim: number };
  modelConfig: {
    transducer?: { encoder: string; decoder: string; joiner: string };
    whisper?: {
      encoder: string;
      decoder: string;
      language: string;
      task: "transcribe";
      tailPaddings: number;
      enableTokenTimestamps: number;
      enableSegmentTimestamps: number;
    };
    cohereTranscribe?: {
      encoder: string;
      decoder: string;
      language: string;
      usePunct: number;
      useItn: number;
    };
    tokens: string;
    numThreads: number;
    provider: string;
    debug: number;
    modelType?: "nemo_transducer";
  };
}

interface SherpaOnnxAddon {
  createOfflineRecognizerAsync(config: RecognizerConfig): Promise<unknown>;
  createOfflineStream(recognizer: unknown): unknown;
  acceptWaveformOffline(stream: unknown, wave: { samples: Float32Array; sampleRate: number }): void;
  decodeOfflineStreamAsync(recognizer: unknown, stream: unknown): Promise<unknown>;
  getOfflineStreamResultAsJson(stream: unknown): string;
  offlineStreamSetOption(stream: unknown, key: string, value: string): void;
  offlineRecognizerSetConfig(recognizer: unknown, config: RecognizerConfig): void;
}

interface SpeechDetectorAddon {
  createVoiceActivityDetector(
    config: {
      sileroVad: typeof SPEECH_DETECTOR_CONFIG & { model: string };
      sampleRate: number;
      numThreads: number;
      provider: string;
      debug: number;
    },
    bufferSizeInSeconds: number,
  ): unknown;
  voiceActivityDetectorAcceptWaveform(detector: unknown, samples: Float32Array): void;
  voiceActivityDetectorIsEmpty(detector: unknown): boolean;
  voiceActivityDetectorFlush(detector: unknown): void;
}

interface LoadedAddon {
  path: string;
  recognizer: SherpaOnnxAddon;
  speechDetector: SpeechDetectorAddon | null;
}

interface LoadedRecognizer {
  key: string;
  addon: SherpaOnnxAddon;
  recognizer: unknown;
  engine: VoiceTranscriptionEngine;
  modelDirectory: string;
  language: string;
  numThreads: number;
  provider: string;
}

class HostFailure extends Error {
  readonly category: VoiceTranscriptionFailure;

  constructor(category: VoiceTranscriptionFailure) {
    super(category);
    this.category = category;
  }
}

let loading: { key: string; promise: Promise<LoadedRecognizer> } | null = null;
let queue: Promise<void> = Promise.resolve();
let loadedAddon: LoadedAddon | null = null;

function isAddon(value: unknown): value is SherpaOnnxAddon {
  return (
    typeof value === "object" &&
    value !== null &&
    "createOfflineRecognizerAsync" in value &&
    typeof value.createOfflineRecognizerAsync === "function" &&
    "createOfflineStream" in value &&
    typeof value.createOfflineStream === "function" &&
    "acceptWaveformOffline" in value &&
    typeof value.acceptWaveformOffline === "function" &&
    "decodeOfflineStreamAsync" in value &&
    typeof value.decodeOfflineStreamAsync === "function" &&
    "getOfflineStreamResultAsJson" in value &&
    typeof value.getOfflineStreamResultAsJson === "function" &&
    "offlineStreamSetOption" in value &&
    typeof value.offlineStreamSetOption === "function" &&
    "offlineRecognizerSetConfig" in value &&
    typeof value.offlineRecognizerSetConfig === "function"
  );
}

function isSpeechDetectorAddon(value: unknown): value is SpeechDetectorAddon {
  return (
    typeof value === "object" &&
    value !== null &&
    "createVoiceActivityDetector" in value &&
    typeof value.createVoiceActivityDetector === "function" &&
    "voiceActivityDetectorAcceptWaveform" in value &&
    typeof value.voiceActivityDetectorAcceptWaveform === "function" &&
    "voiceActivityDetectorIsEmpty" in value &&
    typeof value.voiceActivityDetectorIsEmpty === "function" &&
    "voiceActivityDetectorFlush" in value &&
    typeof value.voiceActivityDetectorFlush === "function"
  );
}

function loadAddon(path: string): LoadedAddon {
  if (loadedAddon?.path === path) return loadedAddon;
  const module: { exports: unknown } = { exports: {} };
  try {
    process.dlopen(module, path);
  } catch {
    throw new HostFailure("runtime-unavailable");
  }
  if (!isAddon(module.exports)) throw new HostFailure("runtime-unavailable");
  loadedAddon = {
    path,
    recognizer: module.exports,
    speechDetector: isSpeechDetectorAddon(module.exports) ? module.exports : null,
  };
  return loadedAddon;
}

function hasSpeech(addonPath: string, speechDetector: string, samples: Float32Array): boolean {
  if (!speechDetector || !existsSync(speechDetector)) return true;
  try {
    const addon = loadAddon(addonPath).speechDetector;
    if (!addon) return true;
    const detector = addon.createVoiceActivityDetector(
      {
        sileroVad: { ...SPEECH_DETECTOR_CONFIG, model: speechDetector },
        sampleRate: SAMPLE_RATE,
        numThreads: 1,
        provider: "cpu",
        debug: 0,
      },
      SPEECH_BUFFER_SECONDS,
    );
    for (let start = 0; start < samples.length; start += SPEECH_WINDOW_SAMPLES) {
      addon.voiceActivityDetectorAcceptWaveform(detector, samples.slice(start, start + SPEECH_WINDOW_SAMPLES));
      if (!addon.voiceActivityDetectorIsEmpty(detector)) return true;
    }
    addon.voiceActivityDetectorFlush(detector);
    return !addon.voiceActivityDetectorIsEmpty(detector);
  } catch {
    return true;
  }
}

function providerFor(addonPath: string, sessionConfig: string): string {
  if (sessionConfig === "") return "cpu";
  const directory = dirname(addonPath);
  if (!existsSync(join(directory, sessionConfig))) return "cpu";
  try {
    process.chdir(directory);
  } catch {
    return "cpu";
  }
  return `cpu:${sessionConfig}`;
}

function recognizerConfig(
  engine: VoiceTranscriptionEngine,
  modelDirectory: string,
  language: string,
  session: { numThreads: number; provider: string },
): RecognizerConfig {
  const file = (name: string) => join(modelDirectory, name);
  const common = { numThreads: session.numThreads, provider: session.provider, debug: 0 };
  if (engine === "whisper") {
    return {
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        whisper: {
          encoder: file("turbo-encoder.int8.onnx"),
          decoder: file("turbo-decoder.onnx"),
          language,
          task: "transcribe",
          tailPaddings: -1,
          enableTokenTimestamps: 0,
          enableSegmentTimestamps: 0,
        },
        tokens: file("turbo-tokens.txt"),
        ...common,
      },
    };
  }
  if (engine === "cohere-transcribe") {
    return {
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 128 },
      modelConfig: {
        cohereTranscribe: {
          encoder: file("encoder.int8.onnx"),
          decoder: file("decoder.int8.onnx"),
          language: language || "en",
          usePunct: 1,
          useItn: 1,
        },
        tokens: file("tokens.txt"),
        ...common,
      },
    };
  }
  return {
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: file("encoder.int8.onnx"),
        decoder: file("decoder.int8.onnx"),
        joiner: file("joiner.int8.onnx"),
      },
      tokens: file("tokens.txt"),
      ...common,
      modelType: "nemo_transducer",
    },
  };
}

function recognizerKey(request: VoiceTranscriptionRequest): string {
  return [request.addonPath, request.modelDirectory, request.engine, request.numThreads, request.sessionConfig].join(
    "\n",
  );
}

async function createRecognizer(request: VoiceTranscriptionRequest): Promise<LoadedRecognizer> {
  const addon = loadAddon(request.addonPath).recognizer;
  const session = { numThreads: request.numThreads, provider: providerFor(request.addonPath, request.sessionConfig) };
  try {
    const recognizer = await addon.createOfflineRecognizerAsync(
      recognizerConfig(request.engine, request.modelDirectory, request.language, session),
    );
    return {
      key: recognizerKey(request),
      addon,
      recognizer,
      engine: request.engine,
      modelDirectory: request.modelDirectory,
      language: request.language,
      ...session,
    };
  } catch {
    throw new HostFailure("model-load-failed");
  }
}

function recognizerFor(request: VoiceTranscriptionRequest): Promise<LoadedRecognizer> {
  const key = recognizerKey(request);
  if (loading?.key === key) return loading.promise;
  const promise = createRecognizer(request);
  loading = { key, promise };
  promise.catch(() => {
    if (loading?.promise === promise) loading = null;
  });
  return promise;
}

function useLanguage(loaded: LoadedRecognizer, language: string): void {
  if (loaded.engine === "cohere-transcribe") {
    loaded.language = language;
    return;
  }
  if (loaded.engine !== "whisper" || loaded.language === language) return;
  try {
    loaded.addon.offlineRecognizerSetConfig(
      loaded.recognizer,
      recognizerConfig(loaded.engine, loaded.modelDirectory, language, loaded),
    );
  } catch {
    throw new HostFailure("model-load-failed");
  }
  loaded.language = language;
}

function toSamples(pcm: Uint8Array, leadingSilence: number): Float32Array {
  const aligned = pcm.byteOffset % 2 === 0 ? pcm : pcm.slice();
  const input = new Int16Array(aligned.buffer, aligned.byteOffset, aligned.byteLength >> 1);
  const samples = new Float32Array(leadingSilence + input.length);
  for (let index = 0; index < input.length; index += 1) samples[leadingSilence + index] = (input[index] ?? 0) / 32_768;
  return samples;
}

async function transcribe(request: VoiceTranscriptionRequest): Promise<string> {
  const loaded = await recognizerFor(request);
  useLanguage(loaded, request.language);
  if (request.pcm.byteLength < 2) return "";
  const recording = toSamples(request.pcm, request.leadingSilenceSamples);
  if (loaded.engine === "whisper" && !hasSpeech(request.addonPath, request.speechDetector, recording)) return "";
  const speech = loaded.engine === "whisper" ? speechOnly(recording) : undefined;
  const samples = speech ?? recording;
  const parts = splitIntoParts(samples, loaded.engine === "nemo-transducer" ? TRANSDUCER_PARTS : WINDOWED_PARTS);
  let text = "";
  for (const part of parts) text = joinText(text, await decode(loaded, speech ? withEndSilence(part) : part));
  return text;
}

async function decode(
  { addon, recognizer, engine, language }: LoadedRecognizer,
  samples: Float32Array,
): Promise<string> {
  try {
    const stream = addon.createOfflineStream(recognizer);
    if (engine === "cohere-transcribe") addon.offlineStreamSetOption(stream, "language", language || "en");
    if (engine === "whisper") addon.offlineStreamSetOption(stream, "max_tokens_per_second", WHISPER_TOKENS_PER_SECOND);
    addon.acceptWaveformOffline(stream, { samples, sampleRate: SAMPLE_RATE });
    await addon.decodeOfflineStreamAsync(recognizer, stream);
    return resultText(JSON.parse(addon.getOfflineStreamResultAsJson(stream))).trim();
  } catch (error) {
    if (error instanceof HostFailure) throw error;
    throw new HostFailure("inference-failed");
  }
}

function windowEnergy(samples: Float32Array, start: number): number {
  let energy = 0;
  for (let index = start; index < start + SPLIT_WINDOW_SAMPLES; index += 1) {
    const sample = samples[index] ?? 0;
    energy += sample * sample;
  }
  return energy;
}

function speechOnly(samples: Float32Array): Float32Array | undefined {
  const frames = Math.floor(samples.length / SPLIT_WINDOW_SAMPLES);
  const loudness = new Float64Array(frames);
  for (let frame = 0; frame < frames; frame += 1)
    loudness[frame] =
      10 * Math.log10(windowEnergy(samples, frame * SPLIT_WINDOW_SAMPLES) / SPLIT_WINDOW_SAMPLES + 1e-12);
  const sound = loudness.filter((value) => value > DIGITAL_SILENCE_DB).sort();
  if (sound.length === 0) return undefined;
  const floor = sound[Math.floor(sound.length * 0.1)] ?? 0;
  const peak = sound[Math.floor(sound.length * 0.95)] ?? 0;
  const threshold = Math.max(floor + SPEECH_ABOVE_FLOOR_DB, peak - SPEECH_BELOW_PEAK_DB);
  const first = loudness.findIndex((value) => value > threshold);
  if (first < 0) return undefined;
  const last = loudness.findLastIndex((value) => value > threshold);
  const start = Math.max(0, first * SPLIT_WINDOW_SAMPLES - SPEECH_MARGIN_SAMPLES);
  const end = Math.min(samples.length, (last + 1) * SPLIT_WINDOW_SAMPLES + SPEECH_MARGIN_SAMPLES);
  return samples.subarray(start, end);
}

function withEndSilence(part: Float32Array): Float32Array {
  const padded = new Float32Array(part.length + SPEECH_END_SILENCE_SAMPLES);
  padded.set(part);
  return padded;
}

function splitIntoParts(
  samples: Float32Array,
  { maximumSamples, splitSearchSamples }: typeof WINDOWED_PARTS,
): Float32Array[] {
  const parts: Float32Array[] = [];
  let start = 0;
  while (samples.length - start > maximumSamples) {
    const limit = start + maximumSamples;
    let end = limit;
    let quietest = Number.POSITIVE_INFINITY;
    for (
      let windowStart = limit - SPLIT_WINDOW_SAMPLES;
      windowStart >= limit - splitSearchSamples;
      windowStart -= SPLIT_WINDOW_SAMPLES
    ) {
      const energy = windowEnergy(samples, windowStart);
      if (energy < quietest) {
        quietest = energy;
        end = windowStart + SPLIT_WINDOW_SAMPLES / 2;
      }
    }
    parts.push(samples.subarray(start, end));
    start = end;
  }
  parts.push(samples.subarray(start));
  return parts;
}

const NO_SPACE_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

function joinText(left: string, right: string): string {
  if (!left || !right) return left || right;
  const noSpace = NO_SPACE_SCRIPT.test(left.at(-1) ?? "") && NO_SPACE_SCRIPT.test(right[0] ?? "");
  return noSpace ? `${left}${right}` : `${left} ${right}`;
}

function resultText(result: unknown): string {
  if (typeof result !== "object" || result === null || !("text" in result) || typeof result.text !== "string") {
    throw new HostFailure("inference-failed");
  }
  return result.text;
}

function isRequest(value: unknown): value is VoiceTranscriptionRequest {
  return (
    isSpeechCheck(value) &&
    "modelDirectory" in value &&
    typeof value.modelDirectory === "string" &&
    "engine" in value &&
    (value.engine === "nemo-transducer" || value.engine === "whisper" || value.engine === "cohere-transcribe") &&
    "language" in value &&
    typeof value.language === "string" &&
    "leadingSilenceSamples" in value &&
    typeof value.leadingSilenceSamples === "number" &&
    Number.isInteger(value.leadingSilenceSamples) &&
    value.leadingSilenceSamples >= 0 &&
    value.leadingSilenceSamples <= MAXIMUM_LEADING_SILENCE_SAMPLES &&
    "numThreads" in value &&
    typeof value.numThreads === "number" &&
    Number.isInteger(value.numThreads) &&
    value.numThreads >= 1 &&
    value.numThreads <= MAXIMUM_THREADS &&
    "sessionConfig" in value &&
    typeof value.sessionConfig === "string" &&
    SESSION_CONFIG_PATTERN.test(value.sessionConfig)
  );
}

function isSpeechCheck(value: unknown): value is VoiceSpeechCheckRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "number" &&
    "addonPath" in value &&
    typeof value.addonPath === "string" &&
    "speechDetector" in value &&
    typeof value.speechDetector === "string" &&
    "pcm" in value &&
    value.pcm instanceof Uint8Array
  );
}

function accept(value: unknown, respond: (response: VoiceTranscriptionResponse) => void): void {
  if (!isRequest(value)) {
    if (isSpeechCheck(value))
      queue = queue.then(() =>
        respond({ id: value.id, speech: hasSpeech(value.addonPath, value.speechDetector, toSamples(value.pcm, 0)) }),
      );
    return;
  }
  queue = queue.then(async () => {
    try {
      respond({ id: value.id, text: await transcribe(value) });
    } catch (error) {
      respond({ id: value.id, error: error instanceof HostFailure ? error.category : "inference-failed" });
    }
  });
}

interface ParentPort {
  on(event: "message", listener: (message: { data: unknown }) => void): void;
  postMessage(value: unknown): void;
  start(): void;
}

function isParentPort(value: unknown): value is ParentPort {
  return typeof value === "object" && value !== null && "postMessage" in value && "start" in value;
}

const parentPort: ParentPort | undefined = isParentPort(process.parentPort) ? process.parentPort : undefined;

if (parentPort) {
  parentPort.on("message", (message) => accept(message.data, (response) => parentPort.postMessage(response)));
  parentPort.start();
} else if (process.send) {
  const send = process.send.bind(process);
  process.on("message", (message: unknown) => accept(message, (response) => send(response)));
  process.on("disconnect", () => process.exit(0));
}
