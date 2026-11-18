import {
  PARAKEET_MODEL_DIRECTORY,
  PARAKEET_MODEL_FILES,
  PARAKEET_UNIFIED_MODEL_DIRECTORY,
  PARAKEET_UNIFIED_MODEL_FILES,
  QWEN3_ASR_MODEL_DIRECTORY,
  QWEN3_ASR_MODEL_FILES,
} from "@openbot/contracts/speech-models";
import * as Device from "expo-device";
import { createModelDownload, type ModelDownload } from "./model-download";
import { speechNative } from "./speech-native";

const unload = async () => {
  await speechNative?.unloadRecognizer?.();
};

/**
 * Parakeet TDT 0.6B v3, the speech recognition model of desktop. It finds the spoken language itself,
 * in 25 European languages, and runs on the phone.
 */
const parakeetModel = createModelDownload({
  directory: PARAKEET_MODEL_DIRECTORY,
  files: PARAKEET_MODEL_FILES,
  unload,
});

/**
 * Parakeet Unified EN 0.6B, as on desktop: English only, with punctuation and fewer errors than v3.
 * It is a Parakeet transducer of the same size, so the phone loads it with the same recognizer.
 */
const parakeetUnifiedModel = createModelDownload({
  directory: PARAKEET_UNIFIED_MODEL_DIRECTORY,
  files: PARAKEET_UNIFIED_MODEL_FILES,
  unload,
});

/**
 * Qwen3-ASR 0.6B, on the phone only. It finds the spoken language itself, in 30 languages and 22
 * Chinese dialects, also when one sentence mixes Chinese and English.
 */
const qwenModel = createModelDownload({
  directory: QWEN3_ASR_MODEL_DIRECTORY,
  files: QWEN3_ASR_MODEL_FILES,
  unload,
});

export const useParakeetModel = parakeetModel.useModel;
export const useParakeetUnifiedModel = parakeetUnifiedModel.useModel;
export const useQwenModel = qwenModel.useModel;

/** The recognizers that run on the phone, each with a model to download. */
export type LocalRecognition = "parakeet" | "parakeet-unified" | "qwen3-asr";

const MODELS: Record<LocalRecognition, ModelDownload> = {
  parakeet: parakeetModel,
  "parakeet-unified": parakeetUnifiedModel,
  "qwen3-asr": qwenModel,
};

export const isLocalRecognition = (engine: string): engine is LocalRecognition => Object.hasOwn(MODELS, engine);

export function localModelOf(engine: LocalRecognition): ModelDownload {
  return MODELS[engine];
}

/** Reads once whether each recognition model is on the phone. */
export function checkRecognitionModels(): void {
  for (const model of Object.values(MODELS)) if (model.useModel.getState().phase === "unknown") model.check();
}

/**
 * A loaded model needs about 1 GB, next to Supertonic 3 and the app. A phone with 4 GB stops the
 * app when it runs out of memory, so a model on the phone needs 6 GB; the system reports a little
 * less than the installed memory. An unknown size, as on some Android phones, is allowed. Desktop's
 * Whisper turbo (1 GB, a slow decoder) and Cohere Transcribe (2.9 GB, about 4.3 GB loaded) are too
 * heavy for a phone, so the phone does not offer them.
 */
const LOCAL_MODEL_MINIMUM_MEMORY_BYTES = 5 * 1024 ** 3;

const loaderOf = (engine: LocalRecognition) =>
  engine === "qwen3-asr" ? speechNative?.loadQwenRecognizer : speechNative?.loadRecognizer;

/** The app binary has this recognizer. An update can reach a binary from before Qwen3-ASR. */
export const localRecognitionInBinary = (engine: LocalRecognition): boolean => typeof loaderOf(engine) === "function";

/** The app binary has this recognizer, and the phone has the memory for it. */
export function localRecognitionSupported(engine: LocalRecognition): boolean {
  if (!localRecognitionInBinary(engine)) return false;
  return Device.totalMemory === null || Device.totalMemory >= LOCAL_MODEL_MINIMUM_MEMORY_BYTES;
}

/** Loads the recognizer from its downloaded model. The same model stays loaded. */
export async function loadLocalRecognizer(engine: LocalRecognition, threads: number): Promise<void> {
  const directory = localModelOf(engine).uri();
  const load = loaderOf(engine);
  if (!directory || !load) throw new Error("The model is not downloaded.");
  await load.call(speechNative, directory, threads);
}
