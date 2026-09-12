import type { AppInfo } from "@openbot/contracts/ipc";
import { errorMessage } from "../../error-message";
export type VoicePhase = "idle" | "preparing" | "requesting" | "recording" | "transcribing";

export function voiceButtonLabel(phase: VoicePhase) {
  if (phase === "recording") return "Stop voice recording";
  if (phase === "preparing") return "Downloading voice model";
  if (phase === "requesting") return "Requesting microphone access";
  if (phase === "transcribing") return "Transcribing voice prompt";
  return "Create prompt with voice";
}

/**
 * Whether this build can transcribe at all. The whisper binary is prepared for macOS and Windows
 * only, so the Linux package ships without one and the composer offers no microphone rather than a
 * control that always fails.
 */
export function voiceSupported(platform: AppInfo["platform"] | undefined): boolean {
  return platform !== "linux";
}

export function formatVoiceDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function voiceCaptureError(error: unknown) {
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
    return "Microphone access is blocked. Allow OpenBot to use the microphone in system settings.";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") return "No microphone is available.";
  return "OpenBot could not start voice recording.";
}

export function voiceTranscriptionError(error: unknown): string {
  return errorMessage(error, "OpenBot could not transcribe this recording.");
}
