import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "Téléchargement arrêté. Réessayez.",
  "status.provider.downloadFailed": "Échec du téléchargement. Réessayez.",
} as const satisfies PartialTranslation<typeof source>;
