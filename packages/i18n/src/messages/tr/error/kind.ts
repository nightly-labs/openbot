import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/kind";

/** classifyUserError'ın belirlediği her tür için cümle. Eşleme @openbot/user-errors paketine aittir. */
export const messages = {
  "error.kind.network": "Bağlanılamadı. Bağlantınızı kontrol edin ve tekrar deneyin.",
  "error.kind.timeout": "İstek çok uzun sürdü. Tekrar denemeden önce eylemin tamamlanıp tamamlanmadığını kontrol edin.",
  "error.kind.storage":
    "Yeterli depolama alanı yok. OpenBot çalıştıran bilgisayarda biraz yer açın, ardından tekrar deneyin.",
  "error.kind.filePermission":
    "OpenBot'un bu eylemi tamamlamak için izni yok. Dosya veya klasör izinlerini kontrol edin, ardından tekrar deneyin.",
  "error.kind.notFound":
    "Gerekli bir dosya veya klasör bulunamadı. Geri yükleyin veya başka bir tane seçin, ardından tekrar deneyin.",
  "error.kind.readOnly": "Bu klasör salt okunur. Yazabileceğiniz bir klasör seçin, ardından tekrar deneyin.",
  "error.kind.conflict": "Bu ada sahip bir öge zaten var. Farklı bir ad seçin, ardından tekrar deneyin.",
  "error.kind.auth":
    "Kimlik doğrulama başarısız oldu. Hesabınızı veya sunucu bağlantınızı kontrol edin, ardından tekrar deneyin.",
  "error.kind.permission": "Bu eylemi tamamlamak için izniniz yok. Sahibinden erişim isteyin.",
  "error.kind.rateLimit": "Çok fazla istek. Bir süre bekleyin, ardından tekrar deneyin.",
  "error.kind.service": "Hizmet kullanılamıyor. Bir süre bekleyin, ardından tekrar deneyin.",
} as const satisfies PartialTranslation<typeof source>;
