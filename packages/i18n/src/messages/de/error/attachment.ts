import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/attachment";

export const messages = {
  "error.attachment.notFound": "Der Anhang wurde nicht gefunden.",
  "error.attachment.fileTooLarge": "Eine Datei überschreitet die Grenze von 100 MB.",
  "error.attachment.totalTooLarge": "Die Anhänge überschreiten die Gesamtgrenze von 250 MB.",
  "error.attachment.unavailable": "Diese Datei ist nicht mehr verfügbar.",
  "error.attachment.tooMany": "Wähle höchstens {limit} Dateien.",
  "error.attachment.mediaUnsupported":
    "Dieser Server unterstützt keine MP3- oder MOV-Anhänge. Aktualisiere OpenBot auf dem Host und versuche es erneut.",
  "error.attachment.emlUnsupported":
    "Dieser Server unterstützt keine EML-Anhänge. Aktualisiere OpenBot auf dem Host und versuche es erneut.",
  "error.attachment.previewTooLarge": "Die Datei überschreitet die Grenze von 100 MB.",
} as const satisfies PartialTranslation<typeof source>;
