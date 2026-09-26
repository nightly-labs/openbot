import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/voice";

export const messages = {
  "error.voice.assetsUnavailable":
    "Les ressources de transcription vocale locale sont indisponibles. Exécutez `bun run voice:prepare` et redémarrez OpenBot.",
  "error.voice.downloadFailed": "Impossible de télécharger le modèle vocal. Réessayez.",
  "error.voice.downloadStopped": "Le téléchargement du modèle vocal a été arrêté.",
  "error.voice.runtimeUnavailable": "La transcription vocale locale n’est pas disponible sur cette plateforme.",
  "error.voice.busy": "Une transcription vocale est déjà en cours.",
  "error.voice.modelUnavailable": "Le modèle vocal est indisponible.",
  "error.voice.transcriptionTimedOut": "La transcription vocale a expiré.",
  "error.voice.prepareRequired":
    "La transcription vocale locale est indisponible. Exécutez `bun run voice:prepare` et redémarrez OpenBot.",
  "error.voice.transcriptionFailed": "OpenBot n’a pas pu transcrire cet enregistrement.",
} as const satisfies PartialTranslation<typeof source>;
