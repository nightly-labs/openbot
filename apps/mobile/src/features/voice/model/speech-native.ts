import { type NativeModule, requireOptionalNativeModule } from "expo";

type SpeechEvents = {
  onSpeechStart: (event: { id: string }) => void;
  onSpeechDone: (event: { id: string }) => void;
  onSpeechError: (event: { id: string; code: string }) => void;
  /** The microphone level from 0 to 1, about ten times a second, and whether the user speaks now. */
  onCaptureLevel: (event: { level: number; speaking: boolean }) => void;
  /** 100 ms of 16 kHz little-endian 16-bit mono PCM, as base64, in `stream` mode. */
  onCaptureAudio: (event: { pcm: string }) => void;
  /**
   * The text of the current segment in `transcribe` mode. A final text is fixed, and the next text
   * belongs to a new segment.
   */
  onCaptureText: (event: { text: string; final: boolean }) => void;
  /** The capture ended: after a finish, when its last text is out, or with an error code. */
  onCaptureEnd: (event: { error?: string }) => void;
};

/** `transcribe` recognizes speech with the loaded recognizer; `stream` sends the audio to JavaScript. */
type CaptureMode = "transcribe" | "stream";

declare class SpeechModule extends NativeModule<SpeechEvents> {
  /** A `file://` URI of the directory for downloaded voice models, which the device does not back up. */
  modelRoot(): string;
  /** Loads Supertonic 3 from its model directory. The same directory keeps the loaded model. */
  load(directory: string, threads: number): Promise<void>;
  unload(): Promise<void>;
  /** Reads one part of a reply with Supertonic 3, after the parts before it. */
  speak(id: string, text: string, language: string, speaker: number, steps: number): void;
  /** Plays little-endian 16-bit mono PCM after the parts before it. */
  playPcm(id: string, pcm: Uint8Array, sampleRate: number): void;
  /** Stops the part that plays and drops the parts that wait. */
  stop(): void;
  /**
   * Loads Parakeet from its model directory. The same directory keeps the loaded model. Optional: an
   * app binary from before speech recognition does not have it.
   */
  loadRecognizer?(directory: string, threads: number): Promise<void>;
  unloadRecognizer?(): Promise<void>;
  /** Opens the microphone. The microphone permission must be granted first. */
  startCapture?(mode: CaptureMode): Promise<void>;
  /** Closes the microphone and sends the text of the speech so far, then `onCaptureEnd`. */
  finishCapture?(): void;
  /** Closes the microphone and drops the speech that was not sent. No event follows. */
  cancelCapture?(): void;
}

/**
 * `modules/speech`: Supertonic 3 and Parakeet through sherpa-onnx, the microphone for them and for
 * ElevenLabs, and the playback of every reply voice. Null in
 * a build without it, such as Expo Go or an app binary from before it, which an update can still
 * reach. The chat then keeps dictation and has no voice conversation.
 */
export const speechNative = requireOptionalNativeModule<SpeechModule>("OpenBotSpeech");
