import { currentText } from "@openbot/ui/text";

export function voiceCaptureError(error: unknown) {
  const { t } = currentText();
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
    return t("composer.voice.blocked");
  }
  if (error instanceof DOMException && error.name === "NotFoundError") return t("composer.voice.noMicrophone");
  // The OS could not open the device: another app holds it, or a driver or setting stops it.
  if (error instanceof DOMException && (error.name === "NotReadableError" || error.name === "AbortError")) {
    return t("composer.voice.microphoneUnavailable");
  }
  return t("composer.voice.startFailed");
}

export function voiceTranscriptionError(error: unknown): string {
  const { t, errorMessage } = currentText();
  return errorMessage(error, t("composer.voice.transcribeFailed"));
}
