import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/workflow";

export const messages = {
  "error.workflow.missing": "Bu iş akışı artık yok.",
  "error.workflow.versionMissing": "İş akışının bu sürümü artık yok.",
  "error.workflow.annotation": "Metinler, notlar ve şekiller bağlantı içeremez.",
  "error.workflow.port": "Bir adım bu tür girdiyi alamaz.",
  "error.workflow.branch": "Yalnızca bir koşul evet ve hayır bağlantılarına sahip olabilir.",
  "error.workflow.conditionBranch": "Bir koşuldan çıkan her bağlantı evet veya hayır olmalıdır.",
  "error.workflow.duplicateEdge": "Bu iki adımda bu bağlantı zaten var.",
  "error.workflow.serverTooOld":
    "Bu sunucu iş akışlarını desteklemiyor. OpenBot'u sunucuyu çalıştıran bilgisayarda güncelleyin.",
  "error.workflow.nodeUnsupported": "OpenBot'un bu sürümü görsel, dosya ve mesaj adımlarını henüz çalıştıramaz.",
  "error.workflow.interrupted": "Bu adım çalışırken OpenBot durdu. Adımı yeniden çalıştırın.",
  "error.workflow.agentMissing": "Bu adım için bir ajan seçin.",
  "error.workflow.handoffFailed": "OpenBot bu adımı ajanına gönderemedi.",
  "error.workflow.agentStepEnded": "Ajana giden mesaj, ajan yanıt vermeden kaldırıldı.",
  "error.workflow.conditionUnclear": "Model evet ya da hayır yanıtı vermedi.",
  "error.workflow.modelFailed": "Model yanıt veremedi. Adımı yeniden çalıştırın.",
  "error.workflow.modelBusy": "Başka bir model isteği çalışıyor. Adımı birazdan yeniden çalıştırın.",
  "error.workflow.stepMissing": "Bu adım artık yok.",
  "error.workflow.nodeMissing": "Bu adım iş akışında yok.",
  "error.workflow.runMissing": "Bu çalıştırma artık yok.",
  "error.workflow.notRetryable": "Yalnızca başarısız olan veya durdurulan bir adım yeniden çalışabilir.",
  "error.workflow.noDecision": "Bu adım bir karar beklemiyor.",
  "error.workflow.outputPlaceMissing": "Bu çıktı için bir mesajlaşma yeri seçin.",
  "error.workflow.outputConnectionOff":
    "Bu çıktının mesajlaşma bağlantısı kapalı ya da kaldırılmış. Yeniden bir yer seçin.",
  "error.workflow.outputNotRunning": "Mesajlaşma bağlantısı şu anda çalışmıyor. Çalıştığında yeniden deneyin.",
  "error.workflow.outputRefused": "Yer gönderiyi reddetti. OpenBot'un orada gönderi yapabildiğinden emin olun.",
  "error.workflow.outputUncertain":
    "Gönderi yolda durdu. Bir kısmı yerde olabilir. Yeniden denemeden önce kontrol edin.",
  "error.workflow.tooLarge":
    "Bu iş akışı kaydedilemeyecek kadar büyük. Bazı çizimleri veya uzun metinleri kaldırıp yeniden deneyin.",
  "error.workflow.tooLargeToSend":
    "Bu iş akışı başka bir bilgisayara gönderilemeyecek kadar büyük. Sunucuyu çalıştıran bilgisayarda açın.",
  "error.workflow.webhookMissing":
    "Bu adım bir webhook tetikleyicisi değil. İş akışını kaydedin, sonra yeniden deneyin.",
} as const satisfies PartialTranslation<typeof source>;
