import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/agent";

export const messages = {
  "status.agent.claudeWriteOutside":
    "Zapis {path} poza obszarem roboczym agenta, folderem współdzielonym i folderami tymczasowymi.",
  "status.agent.contextCleared": "Kontekst wyczyszczony. Tutaj zaczyna się nowy czat.",
  "status.agent.marketplaceSuggested": "Zaproponowano aplikację z Marketplace: {app}.",
} as const satisfies PartialTranslation<typeof source>;
