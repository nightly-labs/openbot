import { currentText } from "@openbot/ui/text";

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
