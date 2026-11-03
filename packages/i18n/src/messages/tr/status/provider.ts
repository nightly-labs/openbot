import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "İndirme durduruldu. Tekrar deneyin.",
  "status.provider.downloadFailed": "İndirme başarısız oldu. Tekrar deneyin.",
  "status.provider.updateWaiting": "Güncelleme, geçerli tur bitince başlar.",
  "status.provider.confirmContinue": "Devam et",
  "status.provider.confirmCancel": "İptal",
  "status.provider.retryUnreachable": "{provider} sunucusuna bağlanamıyor. Yeniden deneme {attempt}/{maxAttempts}.",
  "status.provider.retryServerError":
    "{provider} sunucusu meşgul veya bir hata verdi. Yeniden deneme {attempt}/{maxAttempts}.",
  "status.provider.retryRecovered": "{provider} sunucusundan yeniden yanıt alıyor.",
} as const satisfies PartialTranslation<typeof source>;
