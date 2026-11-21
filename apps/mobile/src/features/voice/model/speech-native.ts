import { type NativeModule, requireOptionalNativeModule } from "expo";

type SpeechEvents = {
  onSpeechStart: (event: { id: string }) => void;
  onSpeechDone: (event: { id: string }) => void;
  onSpeechError: (event: { id: string; code: string }) => void;
  onCaptureLevel: (event: { level: number; speaking: boolean }) => void;
  onCaptureAudio: (event: { pcm: string }) => void;
  onCaptureText: (event: { text: string; final: boolean }) => void;
  onCaptureEnd: (event: { error?: string }) => void;
};

type CaptureMode = "transcribe" | "stream";

declare class SpeechModule extends NativeModule<SpeechEvents> {
  modelRoot(): string;
  load(directory: string, threads: number): Promise<void>;
  unload(): Promise<void>;
  speak(id: string, text: string, language: string, speaker: number, steps: number): void;
  playPcm(id: string, pcm: Uint8Array, sampleRate: number): void;
  stop(): void;
  setSpeed?(speed: number): void;
  loadRecognizer?(directory: string, threads: number): Promise<void>;
  loadQwenRecognizer?(directory: string, threads: number): Promise<void>;
  unloadRecognizer?(): Promise<void>;
  startCapture?(mode: CaptureMode): Promise<void>;
  finishCapture?(): void;
  cancelCapture?(): void;
  allowHapticsWhileRecording?(): void;
  keyboardLanguage?(): string | null;
  setCallAudio?(active: boolean): void;
}

export const speechNative = requireOptionalNativeModule<SpeechModule>("OpenBotSpeech");
