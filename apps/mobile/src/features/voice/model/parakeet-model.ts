import {
  PARAKEET_MODEL_DIRECTORY,
  PARAKEET_MODEL_FILES,
  PARAKEET_UNIFIED_MODEL_DIRECTORY,
  PARAKEET_UNIFIED_MODEL_FILES,
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
export const parakeetModel = createModelDownload({
  directory: PARAKEET_MODEL_DIRECTORY,
  files: PARAKEET_MODEL_FILES,
  unload,
});

/**
 * Parakeet Unified EN 0.6B, as on desktop: English only, with punctuation and fewer errors than v3.
 * It is a Parakeet transducer of the same size, so the phone loads it with the same recognizer.
 */
export const parakeetUnifiedModel = createModelDownload({
  directory: PARAKEET_UNIFIED_MODEL_DIRECTORY,
  files: PARAKEET_UNIFIED_MODEL_FILES,
  unload,
});

export const useParakeetModel = parakeetModel.useModel;
export const useParakeetUnifiedModel = parakeetUnifiedModel.useModel;

/** The two Parakeet recognizers that the phone can run. */
export type ParakeetEngine = "parakeet" | "parakeet-unified";

export function parakeetModelOf(engine: ParakeetEngine): ModelDownload {
  return engine === "parakeet" ? parakeetModel : parakeetUnifiedModel;
}

/** Reads once whether each Parakeet model is on the phone. */
export function checkParakeetModels(): void {
  for (const model of [parakeetModel, parakeetUnifiedModel])
    if (model.useModel.getState().phase === "unknown") model.check();
}

/**
 * A loaded model needs about 1 GB, next to Supertonic 3 and the app. A phone with 4 GB stops the
 * app when it runs out of memory, so Parakeet needs 6 GB; the system reports a little less than
 * the installed memory. An unknown size, as on some Android phones, is allowed. Desktop's Whisper
 * turbo (1 GB, a slow decoder) and Cohere Transcribe (2.9 GB, about 4.3 GB loaded) are too heavy
 * for a phone, so the phone does not offer them.
 */
const PARAKEET_MINIMUM_MEMORY_BYTES = 5 * 1024 ** 3;

export function parakeetSupported(): boolean {
  if (typeof speechNative?.loadRecognizer !== "function") return false;
  return Device.totalMemory === null || Device.totalMemory >= PARAKEET_MINIMUM_MEMORY_BYTES;
}
