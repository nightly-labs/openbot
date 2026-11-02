/** One file of a downloaded voice model: where it comes from, and what it must hash to. */
export interface SpeechModelFile {
  name: string;
  url: string;
  bytes: number;
  sha256: string;
}

const PARAKEET_MODEL_REVISION = "2bda32ec70b097a55adaa07d9a7173915b43cc78";
const PARAKEET_MODEL_BASE_URL = `https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/${PARAKEET_MODEL_REVISION}`;

/**
 * The directory name of Parakeet on desktop (`<userData>/runtimes`) and on the phone. A new pin needs
 * a new name.
 */
export const PARAKEET_MODEL_DIRECTORY = "parakeet-tdt-0.6b-v3-int8";

/**
 * NVIDIA Parakeet TDT 0.6B v3 (CC-BY-4.0), int8 ONNX export for sherpa-onnx. It finds the spoken
 * language itself, in 25 European languages. Desktop and the phone download the same pinned files.
 */
export const PARAKEET_MODEL_FILES: readonly SpeechModelFile[] = [
  {
    name: "encoder.int8.onnx",
    url: `${PARAKEET_MODEL_BASE_URL}/encoder.int8.onnx`,
    bytes: 652_184_281,
    sha256: "acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247",
  },
  {
    name: "decoder.int8.onnx",
    url: `${PARAKEET_MODEL_BASE_URL}/decoder.int8.onnx`,
    bytes: 11_845_275,
    sha256: "179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e",
  },
  {
    name: "joiner.int8.onnx",
    url: `${PARAKEET_MODEL_BASE_URL}/joiner.int8.onnx`,
    bytes: 6_355_277,
    sha256: "3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3",
  },
  {
    name: "tokens.txt",
    url: `${PARAKEET_MODEL_BASE_URL}/tokens.txt`,
    bytes: 93_939,
    sha256: "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d",
  },
];

const SUPERTONIC_MODEL_REVISION = "cca5a0e6c96e1d2c720986bf7e75fcc81dee3ae4";
const SUPERTONIC_MODEL_BASE_URL = `https://huggingface.co/csukuangfj2/sherpa-onnx-supertonic-3-tts-int8-2026-05-11/resolve/${SUPERTONIC_MODEL_REVISION}`;

/**
 * The directory name of Supertonic 3 on desktop (`<userData>/runtimes`) and on the phone (the app's
 * storage outside the device backup). A new pin needs a new name.
 */
export const SUPERTONIC_MODEL_DIRECTORY = "supertonic-3-int8";

/**
 * Supertone Supertonic 3 (OpenRAIL-M weights, MIT code), int8 ONNX export for sherpa-onnx. The
 * export's MIT notice is a file of the model, so it stays next to the weights. Desktop and the
 * phone download the same pinned files, so a reply sounds the same on both.
 */
export const SUPERTONIC_MODEL_FILES: readonly SpeechModelFile[] = [
  {
    name: "duration_predictor.int8.onnx",
    url: `${SUPERTONIC_MODEL_BASE_URL}/duration_predictor.int8.onnx`,
    bytes: 3_700_147,
    sha256: "c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db",
  },
  {
    name: "text_encoder.int8.onnx",
    url: `${SUPERTONIC_MODEL_BASE_URL}/text_encoder.int8.onnx`,
    bytes: 36_416_150,
    sha256: "c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff",
  },
  {
    name: "vector_estimator.int8.onnx",
    url: `${SUPERTONIC_MODEL_BASE_URL}/vector_estimator.int8.onnx`,
    bytes: 78_400_833,
    sha256: "20cd86fa5c6effedfda0e7cffe5b0569ca401c440a0c3a1d72bf39286c0db3fd",
  },
  {
    name: "vocoder.int8.onnx",
    url: `${SUPERTONIC_MODEL_BASE_URL}/vocoder.int8.onnx`,
    bytes: 25_991_073,
    sha256: "e923d60f53f95eb1ce235f1dc33ec56d9c057823c96fa6f8acf98f32b0da6152",
  },
  {
    name: "unicode_indexer.bin",
    url: `${SUPERTONIC_MODEL_BASE_URL}/unicode_indexer.bin`,
    bytes: 262_144,
    sha256: "8402ca48e5189a8950138580b0fff64db6f072f24ac07cd54ba8b2fbb9883b30",
  },
  {
    name: "voice.bin",
    url: `${SUPERTONIC_MODEL_BASE_URL}/voice.bin`,
    bytes: 517_168,
    sha256: "67d5209b0ee8ce6c74105ffbe12fe6a7628aea3b4ba2fcb308a4a67938a93ce8",
  },
  {
    name: "tts.json",
    url: `${SUPERTONIC_MODEL_BASE_URL}/tts.json`,
    bytes: 8_253,
    sha256: "42078d3aef1cd43ab43021f3c54f47d2d75ceb4e75f627f118890128b06a0d09",
  },
  {
    name: "LICENSE",
    url: `${SUPERTONIC_MODEL_BASE_URL}/LICENSE`,
    bytes: 1_070,
    sha256: "0dfe0d0ba84416fe3879d9a34f4909d8d0137c78d1e95834177b0414ac096fa2",
  },
];

/** More denoising steps sound cleaner and take longer. Desktop and the phone use the same value. */
export const SUPERTONIC_DENOISING_STEPS = 8;
