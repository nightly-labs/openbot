import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/agent";

export const messages = {
  "error.agent.historyUnavailable":
    "Bu istek için geçmiş kullanılamıyor. Son geçmişi tekrar okuyun veya kanal çalışması için channel_history kullanın.",
  "error.agent.toolRequestInvalid":
    "Geçersiz araç keşfi bağımsız değişkenleri. Bildirilen şemayı ve özgün nitelikli araç adını kullanın.",
  // Agent errors that the main process and the backend send.
  "error.agent.approvalWhileDeleting": "Ajan silinirken onay verilemez.",
  "error.agent.accessLocalOnly": "Ajan erişimi yalnızca ajanı çalıştıran bilgisayarda değiştirilebilir.",
  "error.agent.duplicateCleanupFailed": "Ajan çoğaltma başarısız oldu ve tamamlanmamış kopya kaldırılamadı.",
  "error.agent.commitEffectsFailed": "İşlem kaydedildi, ancak kaydedilen etkileri başarısız oldu.",
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
  "error.agent.modelProviderNotConnected": 'Seçilen ajan modeli "{model}" kullanılamıyor: {provider} bağlı değil.',
  "error.agent.modelListEmpty":
    'Seçilen ajan modeli "{model}" kullanılamıyor: {provider} hiç model listelemedi. Son hata: {detail}',
  "error.agent.modelListEmptyNoError":
    'Seçilen ajan modeli "{model}" kullanılamıyor: {provider} hiç model listelemedi.',
  "error.agent.modelNotInProviderList":
    'Seçilen ajan modeli "{model}" kullanılamıyor: {provider} bu modeli listelemiyor.',
  "error.agent.modelProviderMismatch": "Seçilen model o sağlayıcıya ait değil.",
  "error.agent.modelNotListed": '"{model}" modeli mevcut değil. Kullanılabilir modeller: {models}.',
  "error.agent.providerNotListed":
    "Şu anda hiçbir {provider} modeli mevcut değil. Kullanılabilir modelleri görmek için list_models çağrısı yapın.",
  "error.agent.reasoningEffortUnsupported":
    '"{model}" modeli "{effort}" akıl yürütme eforunu desteklemiyor. Desteklenen eforlar: {efforts}.',
  "error.agent.noStartingModelInSettings":
    "{provider} için kullanılabilir model yok ve oturum açılmış diğer sağlayıcılarda da yok. Bir sağlayıcıda oturum açın veya Sunucu ayarları → Sağlayıcılar bölümünden varsayılan sağlayıcıyı değiştirin.",
  "error.agent.noStartingModel":
    "{provider} sağlayıcısının kullanılabilir modeli yok ve oturum açmış başka hiçbir sağlayıcının da modeli bulunmuyor. Bir sağlayıcıda oturum açın veya Sağlayıcılar ve izinler bölümünden varsayılan sağlayıcıyı değiştirin.",
  "error.agent.waitBeforeProviderChange": "Sağlayıcıyı değiştirmeden önce etkin turun ve kuyruğun bitmesini bekleyin.",
  "error.agent.waitForTasksBeforeProviderChange":
    "Bu ajanın görevleri çalışıyor. Sağlayıcıyı değiştirmeden önce bitmelerini bekleyin veya onları durdurun.",
  "error.agent.waitBeforeClearContext": "Yeni bir sohbet başlatmadan önce etkin turun ve kuyruğun bitmesini bekleyin.",
  "error.agent.waitBeforeCompactContext": "Bağlamı sıkıştırmadan önce etkin turun ve kuyruğun bitmesini bekleyin.",
  "error.agent.compactContextUnavailable": "Bu ajan bağlamını şu anda sıkıştıramaz.",
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
  "error.agent.turnStalled":
    "{provider} yanıt vermeyi bıraktı, bu yüzden OpenBot bu turu bitirdi. Mesajı yeniden gönderin veya başka bir model seçin.",
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
  "error.agent.newChatLocalOnly": "Yalnızca ajanı çalıştıran bilgisayar ona yeni sohbet başlatma izni verebilir.",
  "error.agent.quickAcknowledgementLocalOnly": "Bu ayarı yalnızca ajanı çalıştıran bilgisayar değiştirebilir.",
  "error.agent.sideQuestionBusy": "Çok fazla yan soru çalışıyor. Kısa bir süre sonra tekrar deneyin.",
  "error.agent.sideQuestionFailed": "Ajan yan soruyu yanıtlayamadı. Tekrar deneyin.",
  "error.agent.busyMessageModeLocalOnly":
    "Ajan çalışırken mesajların ne yapacağı yalnızca ajanı çalıştıran bilgisayarda ayarlanabilir.",
  "error.agent.backupModelsLocalOnly": "Yedek modeller yalnızca ajanı çalıştıran bilgisayarda ayarlanabilir.",
  "error.agent.taskLimitLocalOnly": "Görev limiti yalnızca ajanı çalıştıran bilgisayarda ayarlanabilir.",
  "error.agent.localScriptsOff": "Bu ajan yerel betiklere izin vermiyor.",
  "error.agent.localScriptsRateLimited":
    "Yerel betikler son bir saatte bu ajana {limit} mesaj veya rutin isteği gönderdi. Daha sonra tekrar deneyin.",
  "error.agent.automationOff": "Bu ajan, yerel betiklerin rutinlerini çalıştırmasına izin vermiyor.",
  "error.agent.automationPayloadTooLong": "Veri yükü {limit} karakterden daha uzun.",
  "error.agent.automationRateLimited":
    "Yerel betikler bu ajanın rutinlerini son bir saat içinde {limit} kez çalıştırdı. Daha sonra tekrar deneyin.",
  "error.agent.workspaceOnlyMacOnly":
    "Bu sağlayıcıda “Yalnızca çalışma alanı” seçeneği yalnızca macOS'ta kullanılabilir. Ajan ayarlarından Tam erişim'i seçin.",
  "error.agent.lowMemory":
    "Bu sunucunun belleği azaldı. Mesajınız kuyrukta bekler ve bellek boşaldığında başlar. Daha büyük bir plan sunucuya daha fazla bellek sağlar.",
  "error.agent.lowMemoryServer":
    "Bu sunucunun belleği azaldı. Mesajınız kuyrukta bekler ve bellek boşaldığında başlar.",
  "error.agent.workspaceOnlyToolMissing":
    "“Yalnızca çalışma alanı” seçeneği, OpenBot'un bulamadığı {tool} aracına ihtiyaç duyar. Aracı yükleyin veya ajan ayarlarından Tam erişim'i seçin.",
  "error.agent.claudeSandboxUnavailable":
    "“Yalnızca çalışma alanı” Claude korumalı alanına ihtiyaç duyar, ancak Claude bu bilgisayarda onu başlatamıyor: {reason}. Ajan ayarlarından Tam erişim'i veya başka bir sağlayıcıyı seçin.",
  "error.agent.screenCaptureOff":
    "Bu ajan için ekran yakalama kapalı. Kullanıcı, ajan ayarlarında Bilgisayar Kullanımı'nı açabilir.",
  "error.agent.screenCaptureUnavailable": "Ekran yakalama bu bilgisayarda kullanılamıyor.",
  "error.agent.screenCaptureShared":
    "Ekran yakalama bir Slack, Discord ya da Telegram konuşmasında çalışmaz, çünkü dosyalarını başka kişiler de alır.",
  "error.agent.screenCaptureDeclined": "Kullanıcı bu ekran yakalamaya izin vermedi. Hiçbir şey yakalanmadı.",
  "error.agent.screenCaptureWindowMissing":
    "Bu pencere şu anda açık değil. Geçerli pencere kimliklerini almak için list_capture_sources çağırın.",
  "error.agent.screenCaptureDisplayMissing":
    "Bu ekran şu anda bağlı değil. Geçerli ekran kimliklerini almak için list_capture_sources çağırın.",
  "error.agent.screenCaptureRegionOutside":
    "Bölge tek bir ekranın içinde değil. list_capture_sources sonucundaki tek bir ekranın sınırları içinde kalan masaüstü noktaları kullanın.",
  "error.agent.screenCapturePermissionMissing":
    "OpenBot'un Ekran Kaydı izni yok. Kullanıcıdan Sistem Ayarları > Gizlilik ve Güvenlik > Ekran ve Sistem Sesi Kaydı bölümünü açmasını, OpenBot'u etkinleştirmesini, sonra OpenBot'tan çıkıp yeniden açmasını isteyin.",
  "error.agent.screenCaptureEmptyWindows":
    "Windows boş bir görüntü verdi. Kullanıcıdan bilgisayarın kilidini açmasını ve korumalı içeriği kapatmasını isteyin. Bir kuruluş ilkesi de ekran yakalamayı engelleyebilir.",
  "error.agent.screenCaptureFailed": "Ekran yakalama başarısız oldu. Tekrar deneyin.",
} as const satisfies PartialTranslation<typeof source>;
