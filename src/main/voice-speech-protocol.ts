export interface VoiceSpeechRequest {
  id: number;
  addonPath: string;
  modelDirectory: string;
  text: string;
  language: string;
  speakerId: number;
  loadOnly: boolean;
  numThreads: number;
  sessionConfig: string;
}

export type VoiceSpeechFailure = "runtime-unavailable" | "model-load-failed" | "inference-failed";

export type VoiceSpeechResponse =
  | {
      id: number;
      pcm: Uint8Array;
      sampleRate: number;
    }
  | { id: number; error: VoiceSpeechFailure };

export interface VoiceSpeechHostProcess {
  send(request: VoiceSpeechRequest): void;
  onResponse(listener: (response: VoiceSpeechResponse) => void): void;
  onExit(listener: () => void): void;
  kill(): void;
}
