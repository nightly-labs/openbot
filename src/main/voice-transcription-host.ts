// The process that runs local speech recognition (NVIDIA Parakeet TDT through sherpa-onnx).
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
  VoiceTranscriptionFailure,
  VoiceTranscriptionRequest,
  VoiceTranscriptionResponse,
} from "./voice-transcription-protocol";

const SAMPLE_RATE = 16_000;

/** The subset of the sherpa-onnx N-API addon that offline recognition uses. */
interface SherpaOnnxAddon {
  createOfflineRecognizerAsync(config: unknown): Promise<unknown>;
  createOfflineStream(recognizer: unknown): unknown;
  acceptWaveformOffline(stream: unknown, wave: { samples: Float32Array; sampleRate: number }): void;
  decodeOfflineStreamAsync(recognizer: unknown, stream: unknown): Promise<unknown>;
  getOfflineStreamResultAsJson(stream: unknown): string;
}

interface LoadedRecognizer {
  key: string;
  addon: SherpaOnnxAddon;
  recognizer: unknown;
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
    typeof value.getOfflineStreamResultAsJson === "function"
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

async function createRecognizer(addonPath: string, modelDirectory: string): Promise<LoadedRecognizer> {
  const addon = loadAddon(addonPath);
  const file = (name: string) => join(modelDirectory, name);
  try {
    const recognizer = await addon.createOfflineRecognizerAsync({
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: file("encoder.int8.onnx"),
          decoder: file("decoder.int8.onnx"),
          joiner: file("joiner.int8.onnx"),
        },
        tokens: file("tokens.txt"),
        numThreads: 4,
        provider: "cpu",
        debug: 0,
        modelType: "nemo_transducer",
      },
    });
    return { key: `${addonPath}\n${modelDirectory}`, addon, recognizer };
  } catch {
    throw new HostFailure("model-load-failed");
  }
}

/** Loads the model once per process. A failed load is not kept, so the next request tries again. */
function recognizerFor(addonPath: string, modelDirectory: string): Promise<LoadedRecognizer> {
  const key = `${addonPath}\n${modelDirectory}`;
  if (loading?.key === key) return loading.promise;
  const promise = createRecognizer(addonPath, modelDirectory);
  loading = { key, promise };
  promise.catch(() => {
    if (loading?.promise === promise) loading = null;
  });
  return promise;
}

function toSamples(pcm: Uint8Array): Float32Array {
  const aligned = pcm.byteOffset % 2 === 0 ? pcm : pcm.slice();
  const input = new Int16Array(aligned.buffer, aligned.byteOffset, aligned.byteLength >> 1);
  const samples = new Float32Array(input.length);
  for (let index = 0; index < input.length; index += 1) samples[index] = (input[index] ?? 0) / 32_768;
  return samples;
}

async function transcribe(request: VoiceTranscriptionRequest): Promise<string> {
  const { addon, recognizer } = await recognizerFor(request.addonPath, request.modelDirectory);
  const samples = toSamples(request.pcm);
  if (samples.length === 0) return "";
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
