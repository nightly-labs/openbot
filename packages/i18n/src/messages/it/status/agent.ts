import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/agent";

export const messages = {
  "status.agent.claudeWriteOutside":
    "Scrivi {path}, fuori dal workspace dell'agente, dalla cartella condivisa e dalle cartelle temporanee.",
  "status.agent.contextCleared": "Contesto cancellato. Da qui inizia una nuova chat.",
  "status.agent.marketplaceSuggested": "Ha suggerito un'app del Marketplace: {app}.",
} as const satisfies PartialTranslation<typeof source>;
