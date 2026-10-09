import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/storage";

export const messages = {
  "error.storage.unsupported": "Este servidor no admite almacenamiento.",
  "error.storage.agentMissing": "El agente no existe.",
} as const satisfies PartialTranslation<typeof source>;
