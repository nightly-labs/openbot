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
  "error.workflow.githubActionMissing": "Bu çıktının GitHub'da ne yapacağını seçin.",
  "error.workflow.githubRepositoryMissing": "Bu çıktı için bir depo seçin.",
  "error.workflow.githubItemMissing":
    "Bu çıktının bir sorunu veya çekme isteği yok. Çalıştırmayı bir GitHub olayından başlatın ya da numarayı girdisine yazın.",
  "error.workflow.githubPullRequestOnly": "Bu eylem yalnızca çekme isteklerinde çalışır.",
  "error.workflow.githubTextMissing": "Bu çıktının gönderecek metni yok. Metni yazan bir adım bağlayın.",
  "error.workflow.githubChoiceMissing": "Bu çıktı için etiketleri veya kişiyi seçin.",
  "error.workflow.githubChoseNothing": "Model bu depodan hiçbir etiket veya kişi seçmedi.",
  "error.workflow.githubNotConnected": "Bu iş akışını çalıştıran bilgisayarda GitHub'ı bağlayın.",
  "error.workflow.githubNoAccess":
    "OpenBot GitHub Uygulaması bu depoyu veya öğeyi göremiyor. GitHub'ı açın ve uygulamaya erişim verin.",
  "error.workflow.githubNoWrite":
    "OpenBot GitHub Uygulaması bu depoyu değiştiremiyor. GitHub'ı açın ve uygulamaya erişim verin.",
  "error.workflow.githubLocked": "Bu konuşma GitHub'da kilitli.",
  "error.workflow.githubRefused": "GitHub değişikliği reddetti: {detail}",
  "error.workflow.githubUnreachable": "OpenBot GitHub'a ulaşamadı. Adımı yeniden çalıştırın.",
  "error.workflow.githubUncertain":
    "Değişiklik yolda durdu. GitHub'da olabilir. Adımı yeniden çalıştırmadan önce orayı kontrol edin.",
  "error.workflow.githubNoEvent": "GitHub'da bu tetikleyicinin başladığı bir sorun veya çekme isteği yok.",
} as const satisfies PartialTranslation<typeof source>;
