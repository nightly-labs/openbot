import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/billing";

export const messages = {
  "error.billing.lifecycleFailed": "Sunucu planı değiştirilemedi. Faturalandırma'yı yenileyin ve tekrar deneyin.",
  "error.billing.confirmMismatch": "Silmek için sunucu adını yazın.",
  "error.billing.restartBusy": "Sunucu şu anda yeniden başlatılamıyor. Bir dakika sonra tekrar deneyin.",
  "error.billing.planRequired": "Bu sunucunun planı sona erdi. Sunucuyu başlatmak için planı yenileyin.",
  "error.billing.planSoldOut": "Bu plan tükendi. Başka bir plan seçin.",
  // Masaüstü ve web istemcilerinin oluşturduğu faturalandırma hataları.
  "error.billing.licenseExists": "Bu hesabın zaten bir lisansı var. Bunun yerine kullanıcı sayısını değiştirin.",
  "error.billing.licenseCurrency": "Lisans, diğer planlarınızın para birimini kullanmalıdır.",
  "error.billing.planCurrency": "Yeni bir plan, diğer planlarınızın para birimini kullanmalıdır.",
  "error.billing.licenseUsersInUse": "Lisans, şu anda onu kullanan kişilerden daha az kullanıcıya sahip olamaz.",
  "error.billing.licensePaymentFailed":
    "Eklenen kullanıcıların ödemesi başarısız oldu. Ödeme yöntemini güncelleyip tekrar deneyin.",
  "error.billing.licenseUnavailable": "Lisanslar şu anda kullanılamıyor.",
  "error.billing.licenseOneUser": "Bu lisans 1 kullanıcı içindir. Kullanıcı eklemek için Team'e geçin.",
  "error.billing.licensePlanChange": "Bu lisans o plana geçemez. Lisansı iptal edip yeni planı satın alın.",
  "error.billing.noLicense": "Bu hesabın lisansı yok.",
  "error.billing.invalidRequest": "Faturalandırma isteği geçersiz.",
  "error.billing.invalidResponse": "Faturalandırma yanıtı geçersiz.",
  "error.billing.notStripePage": "Faturalandırma sayfası bir Stripe sayfası değil.",
} as const satisfies PartialTranslation<typeof source>;
