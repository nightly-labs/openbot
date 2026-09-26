import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/attachment";

export const messages = {
  // Attachment and file preview errors.
  "error.attachment.notFound": "La pièce jointe est introuvable.",
  "error.attachment.fileTooLarge": "Un fichier dépasse la limite de 100 Mo.",
  "error.attachment.totalTooLarge": "Les pièces jointes dépassent la limite totale de 250 Mo.",
  "error.attachment.unavailable": "Ce fichier n’est plus disponible.",
  "error.attachment.tooMany": "Choisissez au maximum {limit} fichiers.",
  "error.attachment.mediaUnsupported":
    "Ce serveur ne prend pas en charge les pièces jointes MP3 ou MOV. Mettez à jour OpenBot sur l’hôte, puis réessayez.",
  "error.attachment.emlUnsupported":
    "Ce serveur ne prend pas en charge les pièces jointes EML. Mettez à jour OpenBot sur l’hôte, puis réessayez.",
  "error.attachment.previewTooLarge": "Le fichier dépasse la limite de 100 Mo.",
} as const satisfies PartialTranslation<typeof source>;
