// The process that reads replies aloud with Supertonic 3 through sherpa-onnx.
//
// It is separate from the main process because a synthesis cannot be interrupted, and separate from
// the transcription host so that dictation does not wait behind speech. The main process ends this
// process when it is idle, when a request times out, and at shutdown.
//
// Runtime imports are limited to node:* builtins. The addon is loaded with `process.dlopen` from
// the path in the request, and the protocol is type-only, so this process cannot load Electron,
// the application database, or any module of the main bundle.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { VoiceSpeechFailure, VoiceSpeechRequest, VoiceSpeechResponse } from "./voice-speech-protocol";

/**
 * More denoising steps sound cleaner and take longer; 8 still reads about five times real time.
 * The same value as `SUPERTONIC_DENOISING_STEPS` in `@openbot/contracts/speech-models`, which the
 * phone uses. This host imports only `node:*` at runtime, so the number is repeated here.
 */
const DENOISING_STEPS = 8;
/** The most ONNX Runtime threads a request can ask for. */
const MAXIMUM_THREADS = 64;
/** A settings file is a plain name in the runtime directory; empty is the default settings. */
const SESSION_CONFIG_PATTERN = /^(?:[a-z0-9-]+\.cfg)?$/u;

/** The part of the sherpa-onnx offline TTS configuration that OpenBot sets. */
interface TtsConfig {
  model: {
    supertonic: {
      durationPredictor: string;
      textEncoder: string;
      vectorEstimator: string;
      vocoder: string;
      ttsJson: string;
      unicodeIndexer: string;
      voiceStyle: string;
    };
    numThreads: number;
    /** `cpu`, or `cpu:<file>` with ONNX Runtime session settings. */
    provider: string;
    debug: number;
  };
  maxNumSentences: number;
}

interface GenerationRequest {
  text: string;
  generationConfig: { sid: number; speed: number; numSteps: number; extra: { lang: string } };
  /**
   * Electron's V8 memory cage rejects an external ArrayBuffer, so the addon must copy the samples
   * into a buffer that V8 owns. With the default, every synthesis fails in Electron and works in Node.
   */
  enableExternalBuffer: false;
}

/** The subset of the sherpa-onnx N-API addon that speech uses. */
interface SherpaOnnxAddon {
  createOfflineTtsAsync(config: TtsConfig): Promise<unknown>;
  offlineTtsGenerateAsyncWithConfig(
    tts: unknown,
    request: GenerationRequest,
  ): Promise<{ samples: Float32Array; sampleRate: number }>;
}

interface LoadedTts {
  key: string;
  addon: SherpaOnnxAddon;
  tts: unknown;
}

class HostFailure extends Error {
  readonly category: VoiceSpeechFailure;

  constructor(category: VoiceSpeechFailure) {
    super(category);
    this.category = category;
  }
}

let loading: { key: string; promise: Promise<LoadedTts> } | null = null;
/** Requests run one at a time; the main process also never sends a second one before a reply. */
let queue: Promise<void> = Promise.resolve();

function isAddon(value: unknown): value is SherpaOnnxAddon {
  return (
    typeof value === "object" &&
    value !== null &&
    "createOfflineTtsAsync" in value &&
    typeof value.createOfflineTtsAsync === "function" &&
    "offlineTtsGenerateAsyncWithConfig" in value &&
    typeof value.offlineTtsGenerateAsyncWithConfig === "function"
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

/**
 * The provider string. sherpa-onnx opens a settings file with a narrow path and ends the process
 * when the file is missing, so the path is relative to the runtime directory, and a missing file
 * gives the default settings.
 */
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

function ttsConfig(request: VoiceSpeechRequest): TtsConfig {
  const file = (name: string) => join(request.modelDirectory, name);
  return {
    model: {
      supertonic: {
        durationPredictor: file("duration_predictor.int8.onnx"),
        textEncoder: file("text_encoder.int8.onnx"),
        vectorEstimator: file("vector_estimator.int8.onnx"),
        vocoder: file("vocoder.int8.onnx"),
        ttsJson: file("tts.json"),
        unicodeIndexer: file("unicode_indexer.bin"),
        voiceStyle: file("voice.bin"),
      },
      numThreads: request.numThreads,
      provider: providerFor(request.addonPath, request.sessionConfig),
      debug: 0,
    },
    maxNumSentences: 1,
  };
}

async function createTts(request: VoiceSpeechRequest, key: string): Promise<LoadedTts> {
  const addon = loadAddon(request.addonPath);
  try {
    return { key, addon, tts: await addon.createOfflineTtsAsync(ttsConfig(request)) };
  } catch {
    throw new HostFailure("model-load-failed");
  }
}

/** A failed load is not kept, so the next request tries again. */
function ttsFor(request: VoiceSpeechRequest): Promise<LoadedTts> {
  const key = [request.addonPath, request.modelDirectory, request.numThreads, request.sessionConfig].join("\n");
  if (loading?.key === key) return loading.promise;
  const promise = createTts(request, key);
  loading = { key, promise };
  promise.catch(() => {
    if (loading?.promise === promise) loading = null;
  });
  return promise;
}

function toPcm(samples: Float32Array): Uint8Array {
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    pcm[index] = Math.round(sample < 0 ? sample * 32_768 : sample * 32_767);
  }
  return new Uint8Array(pcm.buffer);
}

async function speak(request: VoiceSpeechRequest): Promise<{ pcm: Uint8Array; sampleRate: number }> {
  const { addon, tts } = await ttsFor(request);
  if (request.loadOnly) return { pcm: new Uint8Array(0), sampleRate: 0 };
  try {
    const audio = await addon.offlineTtsGenerateAsyncWithConfig(tts, {
      text: request.text,
      generationConfig: {
        sid: request.speakerId,
        speed: 1,
        numSteps: DENOISING_STEPS,
        extra: { lang: request.language },
      },
      enableExternalBuffer: false,
    });
    return { pcm: toPcm(audio.samples), sampleRate: audio.sampleRate };
  } catch {
    throw new HostFailure("inference-failed");
  }
}

function isRequest(value: unknown): value is VoiceSpeechRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "number" &&
    "addonPath" in value &&
    typeof value.addonPath === "string" &&
    "modelDirectory" in value &&
    typeof value.modelDirectory === "string" &&
    "text" in value &&
    typeof value.text === "string" &&
    "language" in value &&
    typeof value.language === "string" &&
    "speakerId" in value &&
    typeof value.speakerId === "number" &&
    "loadOnly" in value &&
    typeof value.loadOnly === "boolean" &&
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

function accept(value: unknown, respond: (response: VoiceSpeechResponse) => void): void {
  if (!isRequest(value)) return;
  queue = queue.then(async () => {
    try {
      respond({ id: value.id, ...(await speak(value)) });
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
