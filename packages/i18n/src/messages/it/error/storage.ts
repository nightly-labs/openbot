import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/storage";

export const messages = {
  "error.storage.unsupported": "Questo server non supporta l'archiviazione.",
  "error.storage.agentMissing": "L'agente non esiste.",
} as const satisfies PartialTranslation<typeof source>;
