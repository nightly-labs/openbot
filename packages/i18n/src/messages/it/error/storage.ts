import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/storage";

export const messages = {
  "error.storage.unsupported": "Questo server non supporta l'archiviazione.",
  "error.storage.agentMissing": "L'agente non esiste.",
  "error.storage.unreadableFile": "OpenBot non riesce a leggere {path}. Il file è danneggiato.",
} as const satisfies PartialTranslation<typeof source>;
