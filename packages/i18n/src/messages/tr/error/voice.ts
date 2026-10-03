import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/voice";

export const messages = {
  // Ses dökümü hataları.
  "error.voice.assetsUnavailable":
    "Yerel ses dökümü varlıkları kullanılamıyor. `bun run voice:prepare` komutunu çalıştırın ve OpenBot'u yeniden başlatın.",
  "error.voice.downloadFailed": "Ses modeli indirilemedi. Tekrar deneyin.",
  "error.voice.downloadStopped": "Ses modeli indirmesi durduruldu.",
  "error.voice.runtimeUnavailable": "Yerel ses dökümü bu platformda kullanılamıyor.",
  "error.voice.busy": "Zaten bir ses dökümü işlemi devam ediyor.",
  "error.voice.modelUnavailable": "Ses modeli kullanılamıyor.",
  "error.voice.transcriptionTimedOut": "Ses dökümü zaman aşımına uğradı.",
  "error.voice.prepareRequired":
    "Yerel ses dökümü kullanılamıyor. `bun run voice:prepare` komutunu çalıştırın ve OpenBot'u yeniden başlatın.",
  "error.voice.transcriptionFailed": "OpenBot bu kaydın dökümünü çıkaramadı.",
} as const satisfies PartialTranslation<typeof source>;
