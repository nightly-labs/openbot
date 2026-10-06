import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "İndirme durduruldu. Tekrar deneyin.",
  "status.provider.downloadFailed": "İndirme başarısız oldu. Tekrar deneyin.",
} as const satisfies PartialTranslation<typeof source>;
