import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/voice";

export const messages = {
  // Ses dökümü hataları.
  "error.voice.downloadFailed": "Ses modeli indirilemedi. Tekrar deneyin.",
  "error.voice.downloadStopped": "Ses modeli indirmesi durduruldu.",
  "error.voice.removeBusy": "Ses dökümü bitene kadar bekleyin, sonra modeli kaldırın.",
  "error.voice.removeFailed": "Ses modeli kaldırılamadı. Tekrar deneyin.",
  "error.voice.runtimeUnavailable": "Yerel ses dökümü bu platformda kullanılamıyor.",
  "error.voice.modelUnavailable": "Ses modeli kullanılamıyor.",
  "error.voice.transcriptionTimedOut": "Ses dökümü zaman aşımına uğradı.",
  "error.voice.prepareRequired":
    "Yerel ses dökümü kullanılamıyor. `bun run voice:prepare` komutunu çalıştırın ve OpenBot'u yeniden başlatın.",
  "error.voice.transcriptionFailed": "OpenBot bu kaydın dökümünü çıkaramadı.",
  "error.voice.cloud.keyRequired": "{provider} API anahtarınızı Ayarlar → Ses bölümünde ekleyin.",
  "error.voice.cloud.keyRejected":
    "{provider} API anahtarını kabul etmedi. Anahtarı Ayarlar → Ses bölümünde kontrol edin.",
  "error.voice.cloud.quotaExceeded": "{provider} kotanız doldu.",
  "error.voice.cloud.rateLimited": "{provider} meşgul. Biraz sonra yeniden deneyin.",
  "error.voice.cloud.termsRequired": "ElevenLabs hesabınızda ElevenLabs koşullarını kabul edin, sonra yeniden deneyin.",
  "error.voice.cloud.streamEnded": "Dikte aktarımı sona erdi. Yeniden kaydedin.",
  "error.voice.cloud.tooLong": "Kayıt çok uzun.",
  "error.voice.cloud.keySaveFailed": "{provider} API anahtarı kaydedilemedi.",
  "error.voice.speech.runtimeUnavailable": "Yerel konuşma sentezi bu platformda kullanılamıyor.",
  "error.voice.speech.modelRequired": "Konuşma modelini Ayarlar → Ses bölümünden indirin.",
  "error.voice.speech.timedOut": "Yanıtı sesli okuma zaman aşımına uğradı.",
  "error.voice.speech.failed": "OpenBot yanıtı sesli okuyamadı.",
  "error.voice.recordingNotKept": "OpenBot ses kaydını saklayamadı.",
  "error.voice.live.timedOut": "Codex canlı ses zamanında başlamadı. Tekrar dene.",
  "error.voice.live.failed": "Canlı ses durdu: {reason}",
  "error.voice.live.disconnected": "Canlı ses bağlantısı kesildi.",
  "error.voice.live.hostFailed":
    "Sunucudaki Codex canlı sesi başlatamadı. Sahibinden o bilgisayardaki Codex'i güncellemesini ve ChatGPT ile oturum açmasını isteyin, sonra yeniden deneyin.",
  "error.voice.live.signIn": "Canlı sesi kullanmak için ChatGPT hesabınızla Codex'e giriş yapın.",
  "error.voice.live.unavailable": "OpenAI canlı sesi başlatamadı. Sorun OpenAI tarafında. Daha sonra yeniden deneyin.",
  "error.voice.live.refused":
    "OpenAI canlı sesi başlatmayı reddetti. Daha sonra yeniden deneyin veya sesle konuşmak için Ayarlar'dan canlı sesi kapatın.",
  "error.voice.live.off": "Codex canlı ses kapalı. Ayarlar → Ses bölümünden açın.",
} as const satisfies PartialTranslation<typeof source>;
