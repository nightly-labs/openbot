import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/attachment";

export const messages = {
  "attachment.openFile": "Ouvrir le fichier",
  "attachment.preview": "Aperçu de {name}",
  "attachment.notFound": "Fichier introuvable",
  "attachment.download": "Télécharger {name}",
  "attachment.open": "Ouvrir {name}",
  "attachment.previewUnavailable": "L’aperçu n’est pas disponible.",
  "attachment.error.preview": "Impossible d’afficher l’aperçu de {name}. Réessayez.",
  "attachment.error.download": "Impossible de télécharger les pièces jointes. Réessayez.",
  "attachment.error.open": "Impossible d’ouvrir ou d’enregistrer cette pièce jointe. Réessayez.",
  "attachment.error.openFile": "Impossible d’ouvrir ce fichier. Réessayez.",
  "attachment.error.fileFallback": "Fichier",
  "attachment.error.fileNotFound":
    "« {name} » est introuvable à cet emplacement. Il a peut-être été déplacé ou supprimé.",
  "attachment.error.previewFile": "Impossible d’afficher l’aperçu de « {name} ». Réessayez.",
} as const satisfies PartialTranslation<typeof source>;
