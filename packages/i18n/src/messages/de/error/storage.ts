import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/storage";

export const messages = {
  "error.storage.unsupported": "Dieser Server unterstützt keinen Speicher.",
  "error.storage.agentMissing": "Der Agent existiert nicht.",
} as const satisfies PartialTranslation<typeof source>;
