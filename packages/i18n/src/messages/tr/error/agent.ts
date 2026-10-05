import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/agent";

export const messages = {
  // Agent errors that the main process and the backend send.
  "error.agent.approvalWhileDeleting": "Ajan silinirken onay verilemez.",
  "error.agent.accessLocalOnly": "Ajan erişimi yalnızca ajanı çalıştıran bilgisayarda değiştirilebilir.",
  "error.agent.duplicateCleanupFailed": "Ajan kopyalama başarısız oldu ve tamamlanmamış kopya kaldırılamadı.",
  "error.agent.settingsLocalOnly": "Ajan ayarları yalnızca ajanı çalıştıran bilgisayarda değiştirilebilir.",
  "error.agent.skillsLocalOnly": "Beceriler yalnızca ajanı çalıştıran bilgisayarda değiştirilebilir.",
  "error.agent.addLocalOnly": "Ajanlar yalnızca onları çalıştıran bilgisayarda eklenebilir.",
  "error.agent.joinedServerUpdate": "Katılınan bir sunucudaki ajan buradan güncellenemez.",
  "error.agent.searchQueryRequired": "Bir arama sorgusu gereklidir.",
  "error.agent.messageTooLong": "Mesaj çok uzun.",
  "error.agent.messageOrAttachmentRequired": "Bir mesaj veya ek gereklidir.",
  "error.agent.promptAnswersTooLong": "İstem yanıtları çok uzun.",
  "error.agent.gone": "Bu ajan artık mevcut değil.",
  "error.agent.profileGenerationBusy": "Profil oluşturma meşgul. Kısa bir süre sonra tekrar deneyin.",
  "error.agent.initialMessageRequired": "İlk mesaj gereklidir.",
  "error.agent.initialMessageTooLong": "İlk mesaj çok uzun.",
  "error.agent.setupCleanupFailed": "Ajan kurulumu başarısız oldu ve tamamlanmamış ajan kaldırılamadı.",
  "error.agent.modelUnavailable": "Seçilen ajan modeli kullanılamıyor.",
  "error.agent.modelProviderMismatch": "Seçilen model o sağlayıcıya ait değil.",
  "error.agent.modelNotListed": '"{model}" modeli mevcut değil. Kullanılabilir modeller: {models}.',
  "error.agent.providerNotListed":
    "Şu anda hiçbir {provider} modeli mevcut değil. Kullanılabilir modelleri görmek için list_models çağrısı yapın.",
  "error.agent.reasoningEffortUnsupported":
    '"{model}" modeli "{effort}" akıl yürütme eforunu desteklemiyor. Desteklenen eforlar: {efforts}.',
  "error.agent.noStartingModel":
    "{provider} sağlayıcısının kullanılabilir modeli yok ve oturum açmış başka hiçbir sağlayıcının da modeli bulunmuyor. Bir sağlayıcıda oturum açın veya Sağlayıcılar ve izinler bölümünden varsayılan sağlayıcıyı değiştirin.",
  "error.agent.waitBeforeProviderChange": "Sağlayıcıyı değiştirmeden önce etkin turun ve kuyruğun bitmesini bekleyin.",
  "error.agent.waitBeforeClearContext": "Yeni bir sohbet başlatmadan önce etkin turun ve kuyruğun bitmesini bekleyin.",
  "error.agent.unknown": "Bilinmeyen ajan: {id}",
  "error.agent.onlyUserWidensSettings":
    "Yalnızca kullanıcı bir ajana Tam erişim verebilir veya Bilgisayar Kullanımını açabilir. Kullanıcıdan bunu ajanın ayarlarından değiştirmesini isteyin.",
  "error.agent.queuedMessageCreateFailed": "Kuyruğa alınan mesaj oluşturulamadı.",
  "error.agent.messageUnavailable": "Mesaj artık mevcut değil.",
  "error.agent.hostLimit": "Bir ana makinede en fazla {limit} ajan bulunabilir.",
  "error.agent.changedWhileDuplicating": "Ajan kopyalanırken değişti. Tekrar deneyin.",
  "error.agent.duplicatedAgentGone": "Kopyalanan ajan artık mevcut değil.",
  "error.agent.stateCorrupt": "Ajan durumu bozuk veya daha yeni bir OpenBot sürümünden; üzerine yazılması reddedildi.",
  "error.agent.oldRoleField":
    "Kayıtlı ajan profilleri eski rol alanını kullanıyor; OpenBot'u başlatmadan önce verileri güncelleyin.",
  "error.agent.duplicateIds": "Ajan durumu yinelenen ajan kimlikleri içeriyor; üzerine yazılması reddedildi.",
  "error.agent.copyNameFailed": "OpenBot benzersiz bir ajan kopya adı oluşturamadı.",
  "error.agent.endpointRemoved": "Bu ajanın kullandığı uç nokta kaldırıldı. Ajan için başka bir model seçin.",
  "error.agent.selectedGone": "Seçilen ajan artık mevcut değil.",
  "error.agent.profileEndpointsChanged": "Bu işlem oluşturulurken özel uç noktalar değişti. Tekrar deneyin.",
  "error.agent.profileInvalid": "Sağlayıcı geçersiz bir profil döndürdü. İsteminizi revize etmeyi deneyin.",
  "error.agent.profileSectionUnavailable":
    "Oluşturulan bölüm kullanılamıyor. Tekrar deneyin veya bir bölümü manuel olarak seçin.",
  "error.agent.profileTimedOut": "Profil oluşturma zaman aşımına uğradı. Tekrar deneyin.",
  "error.agent.profileDisconnected": "Sağlayıcı profil oluştururken bağlantıyı kesti.",
  "error.agent.profileToolUse": "Sağlayıcı bir araç kullanmaya çalıştı. İsteminizi revize etmeyi deneyin.",
  "error.agent.profileFailed": "Sağlayıcı bir profil oluşturamadı. Tekrar deneyin.",
  "error.agent.profileTooLarge": "Oluşturulan profil çok büyük. Daha kısa bir istem deneyin.",
  "error.agent.profileNotStarted": "Sağlayıcı profil oluşturmayı başlatamadı.",
  "error.agent.deletionBusy": "Ajan silme işlemi zaten devam ediyor.",
  "error.agent.stopBeforeDelete": "Ajanı silmeden önce durdurun ve kuyruğa alınmış mesajlarını iptal edin.",
  "error.agent.deleteIncomplete": "Ajan verileri tamamen kaldırılamadı. Ajanı silmeyi tekrar deneyin.",
  "error.agent.duplicationBusy": "Bu ajan zaten kopyalanıyor.",
  "error.agent.waitBeforeDuplicate": "Ajanı kopyalamadan önce bitmesini ve kuyruğunu temizlemesini bekleyin.",
  "error.agent.saveOtherAgent": "Bu kayıt başka bir ajana ait.",
  "error.agent.savedGone": "Kaydedilen ajan artık mevcut değil.",
  "error.agent.storedProfileUnreadable":
    'Kayıtlı bir ajan profili okunamayan bir "{field}" değerine sahip; OpenBot\'u başlatmadan önce verileri güncelleyin.',
  "error.agent.storedProfileUnreadableId":
    '{id} kayıtlı ajan profili okunamayan bir "{field}" değerine sahip; OpenBot\'u başlatmadan önce verileri güncelleyin.',
  // Written by `QueueEditRejectedError` in @openbot/contracts, which cannot import this package.
  "error.agent.queueEditRejected": "Kuyruk düzenlemesi reddedildi: {reason}",
  "error.agent.computerUseLocalOnly": "Bilgisayar Kullanımı yalnızca ajanı çalıştıran bilgisayarda değiştirilebilir.",
  "error.agent.automationLocalOnly": "Yerel betiklere yalnızca ajanı çalıştıran bilgisayarda izin verilebilir.",
  "error.agent.automationOff": "Bu ajan, yerel betiklerin rutinlerini çalıştırmasına izin vermiyor.",
  "error.agent.automationPayloadTooLong": "Veri yükü {limit} karakterden daha uzun.",
  "error.agent.automationRateLimited":
    "Yerel betikler bu ajanın rutinlerini son bir saat içinde {limit} kez çalıştırdı. Daha sonra tekrar deneyin.",
  "error.agent.workspaceOnlyMacOnly":
    "Yalnızca çalışma alanı bu sağlayıcı için yalnızca macOS'ta kullanılabilir. Ajan ayarlarından Tam erişim'i seçin.",
  "error.agent.lowMemory":
    "Bu sunucunun belleği azaldı. Mesajınız kuyrukta bekler ve bellek boşaldığında başlar. Daha büyük bir plan sunucuya daha fazla bellek sağlar.",
  "error.agent.workspaceOnlyToolMissing":
    "Yalnızca çalışma alanı OpenBot'un bulamadığı {tool} aracına ihtiyaç duyar. Aracı yükleyin veya ajan ayarlarından Tam erişim'i seçin.",
} as const satisfies PartialTranslation<typeof source>;
