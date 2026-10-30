// The messages between the main process and the speech host, which reads replies aloud.
//
// Type-only: the host imports nothing from here at runtime, so it stays free of application code.

export interface VoiceSpeechRequest {
  id: number;
  /** Absolute path of `sherpa-onnx.node`. */
  addonPath: string;
  /** The directory with the files of Supertonic 3. */
  modelDirectory: string;
  text: string;
  /** A Supertonic 3 language code. */
  language: string;
  /** The voice style: 0-4 are F1-F5, 5-9 are M1-M5. */
  speakerId: number;
  /** Only load the model, and answer with no audio. */
  loadOnly: boolean;
}

/**
 * Why a request failed. Only the category crosses the process boundary: the addon's own message
 * can contain paths, and the main process maps the category to a localized error.
 */
export type VoiceSpeechFailure = "runtime-unavailable" | "model-load-failed" | "inference-failed";

export type VoiceSpeechResponse =
  | {
      id: number;
      /** Little-endian 16-bit mono PCM. */
      pcm: Uint8Array;
      sampleRate: number;
    }
  | { id: number; error: VoiceSpeechFailure };

export interface VoiceSpeechHostProcess {
  send(request: VoiceSpeechRequest): void;
  onResponse(listener: (response: VoiceSpeechResponse) => void): void;
  /** The host ended, asked or not. */
  onExit(listener: () => void): void;
  /** End it now, whatever it is in the middle of. */
  kill(): void;
}
