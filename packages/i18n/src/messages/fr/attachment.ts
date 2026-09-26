import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/attachment";

export const messages = {
  "attachment.downloadAll.pending": "Téléchargement du ZIP…",
  "attachment.downloadAll.label": "Tout télécharger en ZIP",
  "attachment.downloadAll.count": { one: "{count} pièce jointe", other: "{count} pièces jointes" },
  "attachment.downloadAll.zipping": "Compression",
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
    "« {name} » est introuvable. Demandez à l’agent de créer ou de restaurer le fichier, puis cliquez à nouveau sur le lien.",
  "attachment.error.previewFile": "Impossible d’afficher l’aperçu de « {name} ». Réessayez.",
} as const satisfies PartialTranslation<typeof source>;
