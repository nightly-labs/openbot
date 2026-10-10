import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "İndirme durduruldu. Tekrar deneyin.",
  "status.provider.downloadFailed": "İndirme başarısız oldu. Tekrar deneyin.",
  "status.provider.confirmContinue": "Devam et",
  "status.provider.confirmCancel": "İptal",
} as const satisfies PartialTranslation<typeof source>;
