import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "Загрузка остановлена. Повторите попытку.",
  "status.provider.downloadFailed": "Загрузка не удалась. Повторите попытку.",
  "status.provider.confirmContinue": "Продолжить",
  "status.provider.confirmCancel": "Отмена",
} as const satisfies PartialTranslation<typeof source>;
