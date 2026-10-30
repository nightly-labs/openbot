import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/storage";

export const messages = {
  // Depolama hataları.
  "error.storage.unsupported": "Depolama bu sunucu tarafından desteklenmiyor.",
  "error.storage.agentMissing": "Ajan mevcut değil.",
  "error.storage.unreadableFile": "OpenBot {path} dosyasını okuyamıyor. Dosya bozuk.",
} as const satisfies PartialTranslation<typeof source>;
