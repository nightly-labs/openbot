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

const parakeetModel = createModelDownload({
  directory: PARAKEET_MODEL_DIRECTORY,
  files: PARAKEET_MODEL_FILES,
  unload,
});

const parakeetUnifiedModel = createModelDownload({
  directory: PARAKEET_UNIFIED_MODEL_DIRECTORY,
  files: PARAKEET_UNIFIED_MODEL_FILES,
  unload,
});

const qwenModel = createModelDownload({
  directory: QWEN3_ASR_MODEL_DIRECTORY,
  files: QWEN3_ASR_MODEL_FILES,
  unload,
});

export const useParakeetModel = parakeetModel.useModel;
export const useParakeetUnifiedModel = parakeetUnifiedModel.useModel;
export const useQwenModel = qwenModel.useModel;

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

export function checkRecognitionModels(): void {
  for (const model of Object.values(MODELS)) if (model.useModel.getState().phase === "unknown") model.check();
}

const LOCAL_MODEL_MINIMUM_MEMORY_BYTES = 5 * 1024 ** 3;

const loaderOf = (engine: LocalRecognition) =>
  engine === "qwen3-asr" ? speechNative?.loadQwenRecognizer : speechNative?.loadRecognizer;

export const localRecognitionInBinary = (engine: LocalRecognition): boolean => typeof loaderOf(engine) === "function";

export function localRecognitionSupported(engine: LocalRecognition): boolean {
  if (!localRecognitionInBinary(engine)) return false;
  return Device.totalMemory === null || Device.totalMemory >= LOCAL_MODEL_MINIMUM_MEMORY_BYTES;
}

export async function loadLocalRecognizer(engine: LocalRecognition, threads: number): Promise<void> {
  const directory = localModelOf(engine).uri();
  const load = loaderOf(engine);
  if (!directory || !load) throw new Error("The model is not downloaded.");
  await load.call(speechNative, directory, threads);
}
