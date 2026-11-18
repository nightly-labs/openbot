import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/crm";

export const messages = {
  "error.crm.serverTooOld": "Bu sunucu CRM'i desteklemiyor. OpenBot'u sunucuyu çalıştıran bilgisayarda güncelleyin.",
  "error.crm.tooLargeToSend": "Bu CRM sayfası bu istemciye gönderilemeyecek kadar büyük.",
  "error.crm.customerMissing": "Bu müşteri artık yok.",
  "error.crm.planMissing": "Bu plan artık yok.",
  "error.crm.paymentMissing": "Bu ödeme artık yok.",
  "error.crm.tagMissing": "Bu etiket artık yok.",
  "error.crm.statusMissing": "Bu durum artık yok.",
  "error.crm.proposalMissing": "Bu öneri artık yok veya zaten karara bağlandı.",
  "error.crm.tagExists": "Bu adla bir etiket zaten var.",
  "error.crm.statusExists": "Bu adla bir durum zaten var.",
  "error.crm.builtinStatus": "Yerleşik bir durumu yeniden adlandıramaz veya silemezsiniz.",
  "error.crm.tooManyStatuses": "CRM'deki durum sayısı sınıra ulaştı. Önce bir durumu silin.",
  "error.crm.tooManyTags": "CRM'deki etiket sayısı sınıra ulaştı. Önce bir etiketi silin.",
  "error.crm.tooManyPlans": "Bu müşterinin plan sayısı sınıra ulaştı. Önce bir planı silin.",
  "error.crm.paymentPaid": "Bu ödeme ödendi olarak işaretli. Önce ödenmedi olarak işaretleyin.",
  "error.crm.splitTotal": "Parçaların toplamı ödeme tutarına eşit olmalı.",
  "error.crm.planEndsBeforeStart": "Bir plan başlamadan önce bitemez.",
  "error.crm.currencyInUse": "Planı veya ödemesi olan bir müşterinin para birimini değiştiremezsiniz.",
  "error.crm.badCursor": "Bu sayfa artık geçerli değil. Listeyi yeniden yükleyin.",
  "error.crm.invalidChange": "Bu değişiklik geçerli değil.",
  "error.crm.agentNotAllowed":
    "Bu ajan CRM'i kullanamaz. Bir sahip veya yönetici ona izin verebilir: CRM sayfasını açın, Öneriler'e tıklayın, ajan sayısını gösteren düğmeye tıklayın ve bu ajanı açın.",
  "error.crm.tooManyProposals": "Karar bekleyen çok fazla öneri var. Bir kişi karar verene kadar bekleyin.",
  "error.crm.amountInvalid": "Tutarı 129.00 gibi bir sayı olarak yazın.",
  "error.crm.amountDecimals": "Tutar {currency} için çok fazla ondalık basamak içeriyor.",
  "error.crm.fieldPrivate": "Bu alan gizli. Ajanlar bu alanı okuyamaz ve bu alana göre filtreleyemez.",
  "error.crm.sourceOwned":
    "Stripe bu satırı yönetir. Satırı Stripe içinde değiştirin; CRM değişikliği sonraki senkronizasyonda alır.",
  "error.crm.sourceConnected": "Stripe bu CRM'ye zaten bağlı.",
  "error.crm.sourceMissing": "Bu Stripe bağlantısı artık yok.",
  "error.crm.sourceSecretKey":
    "Bu, Stripe hesabınızı değiştirebilen gizli bir anahtar. Yalnızca okuma erişimi olan kısıtlı bir anahtar oluşturun.",
  "error.crm.sourceInvalidKey": "Stripe bu anahtarı kabul etmiyor. Kısıtlı anahtarı yeniden kopyalayın.",
  "error.crm.sourcePermission":
    "Bu anahtar müşterileri, faturaları, abonelikleri, olayları ve ürünleri okuyamıyor. Ona bunlar için okuma erişimi verin.",
  "error.crm.sourceRateLimited": "Stripe çok fazla istek aldı. Bir dakika sonra yeniden deneyin.",
  "error.crm.sourceNetwork": "OpenBot Stripe ile bağlantı kuramıyor. İnternet bağlantısını kontrol edin.",
  "error.crm.sourceFailed": "Stripe OpenBot'un okuyamadığı bir yanıt gönderdi. Daha sonra yeniden deneyin.",
  "error.crm.sourceKeySaveFailed": "OpenBot Stripe anahtarını bu bilgisayara kaydedemiyor.",
  "error.crm.off": "CRM kapalı. Bir sahip veya yönetici bunu Sunucu Ayarları > Deneysel bölümünden açabilir.",
  "error.crm.settingsSaveFailed": "OpenBot bu sunucuda CRM ayarını kaydedemiyor.",
} as const satisfies PartialTranslation<typeof source>;
