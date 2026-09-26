import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/storage";

export const messages = {
  // Storage errors.
  "error.storage.unsupported": "Ce serveur ne prend pas en charge le stockage.",
  "error.storage.agentMissing": "L’agent n’existe pas.",
} as const satisfies PartialTranslation<typeof source>;
