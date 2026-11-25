export type VoiceTranscriptionEngine = "nemo-transducer" | "whisper" | "cohere-transcribe";

export interface VoiceTranscriptionRequest {
  id: number;
  addonPath: string;
  modelDirectory: string;
  engine: VoiceTranscriptionEngine;
  language: string;
  leadingSilenceSamples: number;
  numThreads: number;
  sessionConfig: string;
  speechDetector: string;
  pcm: Uint8Array;
}

export interface VoiceSpeechCheckRequest {
  id: number;
  addonPath: string;
  speechDetector: string;
  pcm: Uint8Array;
}

export type VoiceHostRequest = VoiceTranscriptionRequest | VoiceSpeechCheckRequest;

export type VoiceTranscriptionFailure = "runtime-unavailable" | "model-load-failed" | "inference-failed";

export type VoiceTranscriptionResponse =
  | { id: number; text: string }
  | { id: number; speech: boolean }
  | { id: number; error: VoiceTranscriptionFailure };

export interface VoiceTranscriptionHostProcess {
  send(request: VoiceHostRequest): void;
  onResponse(listener: (response: VoiceTranscriptionResponse) => void): void;
  onExit(listener: () => void): void;
  kill(): void;
}
