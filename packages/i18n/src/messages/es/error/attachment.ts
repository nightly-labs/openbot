import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/attachment";

export const messages = {
  "error.attachment.notFound": "No se encontró el archivo adjunto.",
  "error.attachment.fileTooLarge": "Un archivo supera el límite de 100 MB.",
  "error.attachment.totalTooLarge": "Los archivos adjuntos superan el límite total de 250 MB.",
  "error.attachment.unavailable": "Este archivo ya no está disponible.",
  "error.attachment.tooMany": "Elige un máximo de {limit} archivos.",
  "error.attachment.mediaUnsupported":
    "Este servidor no admite archivos adjuntos MP3 o MOV. Actualiza OpenBot en el host e inténtalo de nuevo.",
  "error.attachment.emlUnsupported":
    "Este servidor no admite archivos adjuntos EML. Actualiza OpenBot en el host e inténtalo de nuevo.",
  "error.attachment.previewTooLarge": "El archivo supera el límite de 100 MB.",
} as const satisfies PartialTranslation<typeof source>;
