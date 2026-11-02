import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/voice";

export const messages = {
  // Ses dökümü hataları.
  "error.voice.downloadFailed": "Ses modeli indirilemedi. Tekrar deneyin.",
  "error.voice.downloadStopped": "Ses modeli indirmesi durduruldu.",
  "error.voice.removeBusy": "Ses dökümü bitene kadar bekleyin, sonra modeli kaldırın.",
  "error.voice.removeFailed": "Ses modeli kaldırılamadı. Tekrar deneyin.",
  "error.voice.runtimeUnavailable": "Yerel ses dökümü bu platformda kullanılamıyor.",
  "error.voice.busy": "Zaten bir ses dökümü işlemi devam ediyor.",
  "error.voice.modelUnavailable": "Ses modeli kullanılamıyor.",
  "error.voice.transcriptionTimedOut": "Ses dökümü zaman aşımına uğradı.",
  "error.voice.prepareRequired":
    "Yerel ses dökümü kullanılamıyor. `bun run voice:prepare` komutunu çalıştırın ve OpenBot'u yeniden başlatın.",
  "error.voice.transcriptionFailed": "OpenBot bu kaydın dökümünü çıkaramadı.",
  "error.voice.cloud.keyRequired": "ElevenLabs API anahtarınızı Ayarlar → Ses bölümünde ekleyin.",
  "error.voice.cloud.keyRejected":
    "ElevenLabs API anahtarını kabul etmedi. Anahtarı Ayarlar → Ses bölümünde kontrol edin.",
  "error.voice.cloud.quotaExceeded": "ElevenLabs kotanız doldu.",
  "error.voice.cloud.rateLimited": "ElevenLabs meşgul. Biraz sonra yeniden deneyin.",
  "error.voice.cloud.termsRequired": "ElevenLabs hesabınızda ElevenLabs koşullarını kabul edin, sonra yeniden deneyin.",
  "error.voice.cloud.streamEnded": "Dikte aktarımı sona erdi. Yeniden kaydedin.",
  "error.voice.cloud.tooLong": "Kayıt çok uzun.",
  "error.voice.cloud.keySaveFailed": "ElevenLabs API anahtarı kaydedilemedi.",
  "error.voice.speech.runtimeUnavailable": "Yerel konuşma sentezi bu platformda kullanılamıyor.",
  "error.voice.speech.modelRequired": "Konuşma modelini Ayarlar → Ses bölümünden indirin.",
  "error.voice.speech.timedOut": "Yanıtı sesli okuma zaman aşımına uğradı.",
  "error.voice.speech.failed": "OpenBot yanıtı sesli okuyamadı.",
  "error.voice.recordingNotKept": "OpenBot ses kaydını saklayamadı.",
} as const satisfies PartialTranslation<typeof source>;
