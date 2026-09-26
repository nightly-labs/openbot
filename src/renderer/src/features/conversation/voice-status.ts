import type { AppInfo } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { currentText } from "@openbot/ui/text";
export type VoicePhase = "idle" | "preparing" | "requesting" | "recording" | "transcribing";

/** The catalog key of the voice button's accessible name. */
export function voiceButtonLabel(phase: VoicePhase): AppTextKey {
  if (phase === "recording") return "composer.voice.stop";
  if (phase === "preparing") return "composer.voice.preparing";
  if (phase === "requesting") return "composer.voice.requesting";
  if (phase === "transcribing") return "composer.voice.transcribing";
  return "composer.voice.start";
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
  const { t } = currentText();
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
    return t("composer.voice.blocked");
  }
  if (error instanceof DOMException && error.name === "NotFoundError") return t("composer.voice.noMicrophone");
  return t("composer.voice.startFailed");
}

export function voiceTranscriptionError(error: unknown): string {
  const { t, errorMessage } = currentText();
  return errorMessage(error, t("composer.voice.transcribeFailed"));
}
