import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/billing";

export const messages = {
  "error.billing.lifecycleFailed": "Sunucu planı değiştirilemedi. Faturalandırma'yı yenileyin ve tekrar deneyin.",
  "error.billing.confirmMismatch": "Silmek için sunucu adını yazın.",
  // Masaüstü ve web istemcilerinin oluşturduğu faturalandırma hataları.
  "error.billing.invalidRequest": "Faturalandırma isteği geçersiz.",
  "error.billing.invalidResponse": "Faturalandırma yanıtı geçersiz.",
  "error.billing.notStripePage": "Faturalandırma sayfası bir Stripe sayfası değil.",
} as const satisfies PartialTranslation<typeof source>;
