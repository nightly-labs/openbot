import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/provider";

export const messages = {
  "status.provider.downloadStopped": "Загрузка остановлена. Повторите попытку.",
  "status.provider.downloadFailed": "Загрузка не удалась. Повторите попытку.",
  "status.provider.updateWaiting": "Обновление начнётся, когда завершится текущий ход.",
  "status.provider.confirmContinue": "Продолжить",
  "status.provider.confirmCancel": "Отмена",
  "status.provider.retryUnreachable":
    "{provider} не может подключиться к своему серверу. Повтор {attempt} из {maxAttempts}.",
  "status.provider.retryServerError":
    "Сервер {provider} перегружен или вернул ошибку. Повтор {attempt} из {maxAttempts}.",
  "status.provider.retryRecovered": "{provider} снова получает ответы от своего сервера.",
} as const satisfies PartialTranslation<typeof source>;
