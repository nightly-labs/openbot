import { PARAKEET_MODEL_DIRECTORY, PARAKEET_MODEL_FILES } from "@openbot/contracts/speech-models";
import * as Device from "expo-device";
import { createModelDownload } from "./model-download";
import { speechNative } from "./speech-native";

/**
 * Parakeet TDT 0.6B v3, the speech recognition model of desktop. It finds the spoken language itself,
 * in 25 European languages, and runs on the phone.
 */
export const parakeetModel = createModelDownload({
  directory: PARAKEET_MODEL_DIRECTORY,
  files: PARAKEET_MODEL_FILES,
  unload: async () => {
    await speechNative?.unloadRecognizer?.();
  },
});

export const useParakeetModel = parakeetModel.useModel;

/**
 * The loaded model needs about 1 GB, next to Supertonic 3 and the app. A phone with 4 GB stops the
 * app when it runs out of memory, so Parakeet needs 6 GB; the system reports a little less than
 * the installed memory. An unknown size, as on some Android phones, is allowed.
 */
const PARAKEET_MINIMUM_MEMORY_BYTES = 5 * 1024 ** 3;

export function parakeetSupported(): boolean {
  if (typeof speechNative?.loadRecognizer !== "function") return false;
  return Device.totalMemory === null || Device.totalMemory >= PARAKEET_MINIMUM_MEMORY_BYTES;
}
