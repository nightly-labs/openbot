import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/attachment";

export const messages = {
  "error.attachment.notFound": "Allegato non trovato.",
  "error.attachment.fileTooLarge": "Un file supera il limite di 100 MB.",
  "error.attachment.totalTooLarge": "Gli allegati superano il limite totale di 250 MB.",
  "error.attachment.unavailable": "Questo file non è più disponibile.",
  "error.attachment.tooMany": "Scegli al massimo {limit} file.",
  "error.attachment.mediaUnsupported":
    "Questo server non supporta gli allegati MP3 o MOV. Aggiorna OpenBot sull'host e riprova.",
  "error.attachment.emlUnsupported":
    "Questo server non supporta gli allegati EML. Aggiorna OpenBot sull'host e riprova.",
  "error.attachment.previewTooLarge": "Il file supera il limite di 100 MB.",
} as const satisfies PartialTranslation<typeof source>;
