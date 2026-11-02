// The process that runs local speech recognition (NVIDIA Parakeet TDT, Underdog Bark or OpenAI
// Whisper turbo through sherpa-onnx).
//
// It is separate from the main process because the loaded model holds about 2 GB of memory and
// a decode cannot be interrupted. The main process ends this process when it is idle, when a
// request times out, and at shutdown; the memory returns to the system with it.
//
// Runtime imports are limited to node:* builtins. The addon is loaded with `process.dlopen` from
// the path in the request, and the protocol is type-only, so this process cannot load Electron,
// the application database, or any module of the main bundle.

import { join } from "node:path";
import type {
  VoiceTranscriptionEngine,
  VoiceTranscriptionFailure,
  VoiceTranscriptionRequest,
  VoiceTranscriptionResponse,
} from "./voice-transcription-protocol";

const SAMPLE_RATE = 16_000;
/**
 * Whisper reads at most 30 s; sherpa-onnx cuts a longer input to its first 29.5 s. Longer audio is
 * decoded in parts of at most this many samples.
 */
const WHISPER_MAXIMUM_SAMPLES = 28 * SAMPLE_RATE;
/** A part ends at the quietest moment in its last seconds, so a cut seldom splits a word. */
const WHISPER_SPLIT_SEARCH_SAMPLES = 4 * SAMPLE_RATE;
const SPLIT_WINDOW_SAMPLES = SAMPLE_RATE / 50;
/** The most leading silence a request can ask for. */
const MAXIMUM_LEADING_SILENCE_SAMPLES = SAMPLE_RATE;

/** The part of the sherpa-onnx offline recognizer configuration that OpenBot sets. */
interface RecognizerConfig {
  featConfig: { sampleRate: number; featureDim: number };
  modelConfig: {
    transducer?: { encoder: string; decoder: string; joiner: string };
    whisper?: {
      encoder: string;
      decoder: string;
      /** An empty language makes Whisper find the spoken language itself. */
      language: string;
      task: "transcribe";
      tailPaddings: number;
      enableTokenTimestamps: number;
      enableSegmentTimestamps: number;
    };
    tokens: string;
    numThreads: number;
    provider: "cpu";
    debug: number;
    modelType?: "nemo_transducer";
  };
}

/** The subset of the sherpa-onnx N-API addon that offline recognition uses. */
interface SherpaOnnxAddon {
  createOfflineRecognizerAsync(config: RecognizerConfig): Promise<unknown>;
  createOfflineStream(recognizer: unknown): unknown;
  acceptWaveformOffline(stream: unknown, wave: { samples: Float32Array; sampleRate: number }): void;
  decodeOfflineStreamAsync(recognizer: unknown, stream: unknown): Promise<unknown>;
  getOfflineStreamResultAsJson(stream: unknown): string;
  /** Replaces the decoding settings of a loaded recognizer. Whisper reads its language from them. */
  offlineRecognizerSetConfig(recognizer: unknown, config: RecognizerConfig): void;
}

interface LoadedRecognizer {
  key: string;
  addon: SherpaOnnxAddon;
  recognizer: unknown;
  engine: VoiceTranscriptionEngine;
  modelDirectory: string;
  /** The Whisper language the recognizer uses now. */
  language: string;
}

class HostFailure extends Error {
  readonly category: VoiceTranscriptionFailure;

  constructor(category: VoiceTranscriptionFailure) {
    super(category);
    this.category = category;
  }
}

let loading: { key: string; promise: Promise<LoadedRecognizer> } | null = null;
/** Requests run one at a time; the main process also never sends a second one before a reply. */
let queue: Promise<void> = Promise.resolve();

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
    "offlineRecognizerSetConfig" in value &&
    typeof value.offlineRecognizerSetConfig === "function"
  );
}

function loadAddon(path: string): SherpaOnnxAddon {
  const module: { exports: unknown } = { exports: {} };
  try {
    process.dlopen(module, path);
  } catch {
    throw new HostFailure("runtime-unavailable");
  }
  if (!isAddon(module.exports)) throw new HostFailure("runtime-unavailable");
  return module.exports;
}

function recognizerConfig(
  engine: VoiceTranscriptionEngine,
  modelDirectory: string,
  language: string,
): RecognizerConfig {
  const file = (name: string) => join(modelDirectory, name);
  const common = { numThreads: 4, provider: "cpu", debug: 0 } as const;
  if (engine === "whisper") {
    return {
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        whisper: {
          encoder: file("turbo-encoder.int8.onnx"),
          decoder: file("turbo-decoder.int8.onnx"),
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
  return `${request.addonPath}\n${request.modelDirectory}\n${request.engine}`;
}

async function createRecognizer(request: VoiceTranscriptionRequest): Promise<LoadedRecognizer> {
  const addon = loadAddon(request.addonPath);
  try {
    const recognizer = await addon.createOfflineRecognizerAsync(
      recognizerConfig(request.engine, request.modelDirectory, request.language),
    );
    return {
      key: recognizerKey(request),
      addon,
      recognizer,
      engine: request.engine,
      modelDirectory: request.modelDirectory,
      language: request.language,
    };
  } catch {
    throw new HostFailure("model-load-failed");
  }
}

/**
 * Loads one model per process: a request for the other model replaces it. A failed load is not
 * kept, so the next request tries again.
 */
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

/** A language change reuses the loaded Whisper model: only its decoding settings change. */
function useLanguage(loaded: LoadedRecognizer, language: string): void {
  if (loaded.engine !== "whisper" || loaded.language === language) return;
  try {
    loaded.addon.offlineRecognizerSetConfig(
      loaded.recognizer,
      recognizerConfig(loaded.engine, loaded.modelDirectory, language),
    );
  } catch {
    throw new HostFailure("model-load-failed");
  }
  loaded.language = language;
}

/** Converts the PCM to samples after `leadingSilence` zero samples. */
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
  const samples = toSamples(request.pcm, request.leadingSilenceSamples);
  const parts = loaded.engine === "whisper" ? splitForWhisper(samples) : [samples];
  let text = "";
  for (const part of parts) text = joinText(text, await decode(loaded, part));
  return text;
}

async function decode({ addon, recognizer }: LoadedRecognizer, samples: Float32Array): Promise<string> {
  try {
    const stream = addon.createOfflineStream(recognizer);
    addon.acceptWaveformOffline(stream, { samples, sampleRate: SAMPLE_RATE });
    await addon.decodeOfflineStreamAsync(recognizer, stream);
    return resultText(JSON.parse(addon.getOfflineStreamResultAsJson(stream))).trim();
  } catch (error) {
    if (error instanceof HostFailure) throw error;
    throw new HostFailure("inference-failed");
  }
}

/** Splits audio into parts that Whisper reads whole, each cut at the quietest point near its end. */
function splitForWhisper(samples: Float32Array): Float32Array[] {
  const parts: Float32Array[] = [];
  let start = 0;
  while (samples.length - start > WHISPER_MAXIMUM_SAMPLES) {
    const limit = start + WHISPER_MAXIMUM_SAMPLES;
    let end = limit;
    let quietest = Number.POSITIVE_INFINITY;
    for (
      let windowStart = limit - SPLIT_WINDOW_SAMPLES;
      windowStart >= limit - WHISPER_SPLIT_SEARCH_SAMPLES;
      windowStart -= SPLIT_WINDOW_SAMPLES
    ) {
      let energy = 0;
      for (let index = windowStart; index < windowStart + SPLIT_WINDOW_SAMPLES; index += 1) {
        const sample = samples[index] ?? 0;
        energy += sample * sample;
      }
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

/** Scripts that write no space between words. */
const NO_SPACE_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

function joinText(left: string, right: string): string {
  if (!left || !right) return left || right;
  const noSpace = NO_SPACE_SCRIPT.test(left.at(-1) ?? "") && NO_SPACE_SCRIPT.test(right[0] ?? "");
  return noSpace ? `${left}${right}` : `${left} ${right}`;
}

/** Reads `text` from the result JSON of the addon. */
function resultText(result: unknown): string {
  if (typeof result !== "object" || result === null || !("text" in result) || typeof result.text !== "string") {
    throw new HostFailure("inference-failed");
  }
  return result.text;
}

function isRequest(value: unknown): value is VoiceTranscriptionRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "number" &&
    "addonPath" in value &&
    typeof value.addonPath === "string" &&
    "modelDirectory" in value &&
    typeof value.modelDirectory === "string" &&
    "engine" in value &&
    (value.engine === "nemo-transducer" || value.engine === "whisper") &&
    "language" in value &&
    typeof value.language === "string" &&
    "leadingSilenceSamples" in value &&
    typeof value.leadingSilenceSamples === "number" &&
    Number.isInteger(value.leadingSilenceSamples) &&
    value.leadingSilenceSamples >= 0 &&
    value.leadingSilenceSamples <= MAXIMUM_LEADING_SILENCE_SAMPLES &&
    "pcm" in value &&
    value.pcm instanceof Uint8Array
  );
}

function accept(value: unknown, respond: (response: VoiceTranscriptionResponse) => void): void {
  if (!isRequest(value)) return;
  queue = queue.then(async () => {
    try {
      respond({ id: value.id, text: await transcribe(value) });
    } catch (error) {
      respond({ id: value.id, error: error instanceof HostFailure ? error.category : "inference-failed" });
    }
  });
}

/**
 * The part of Electron's `process.parentPort` this host uses. It is read through a guard rather than
 * Electron's own type, because this file must not import Electron.
 */
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
  // Started by `child_process.fork` with `serialization: "advanced"`: plain Node, outside Electron.
  // This is how the host can be run against the real addon and model without the app.
  const send = process.send.bind(process);
  process.on("message", (message: unknown) => accept(message, (response) => send(response)));
  process.on("disconnect", () => process.exit(0));
}
