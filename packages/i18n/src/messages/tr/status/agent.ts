import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/agent";

export const messages = {
  "status.agent.claudeWriteOutside":
    "{path} konumuna yaz (ajanın çalışma alanının, paylaşılan klasörün ve geçici klasörlerin dışı).",
  "status.agent.contextCleared": "Bağlam temizlendi. Yeni bir sohbet burada başlıyor.",
  "status.agent.marketplaceSuggested": "Bir Marketplace uygulaması önerildi: {app}.",
} as const satisfies PartialTranslation<typeof source>;
