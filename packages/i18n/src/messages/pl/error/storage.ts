import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/storage";

export const messages = {
  "error.storage.unsupported": "Ten serwer nie obsługuje magazynu.",
  "error.storage.agentMissing": "Agent nie istnieje.",
} as const satisfies PartialTranslation<typeof source>;
