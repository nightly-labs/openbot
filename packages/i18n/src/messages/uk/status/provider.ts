import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "Завантаження зупинено. Спробуйте ще раз.",
  "status.provider.downloadFailed": "Не вдалося завантажити. Спробуйте ще раз.",
  "status.provider.updateWaiting": "Оновлення почнеться, коли завершиться поточний хід.",
  "status.provider.confirmContinue": "Продовжити",
  "status.provider.confirmCancel": "Скасувати",
} as const satisfies PartialTranslation<typeof source>;
