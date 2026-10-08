import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/agent";

export const messages = {
  "status.agent.claudeWriteOutside":
    "In {path} schreiben, außerhalb des Agentenarbeitsbereichs, des geteilten Ordners und der temporären Ordner.",
  "status.agent.contextCleared": "Kontext geleert. Hier beginnt ein neuer Chat.",
  "status.agent.marketplaceSuggested": "Eine Marketplace-App wurde vorgeschlagen: {app}.",
} as const satisfies PartialTranslation<typeof source>;
