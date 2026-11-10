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
  "status.provider.claudeFastModeNeedsUsageCredits":
    "Claude ответил на стандартной скорости. С подпиской Claude быстрый режим расходует кредиты использования. Включите их в аккаунте Claude.",
  "status.provider.claudeFastModeNotOnPlan":
    "Claude ответил на стандартной скорости. Ваш тариф Claude не включает быстрый режим.",
  "status.provider.claudeFastModeNotFirstParty":
    "Claude ответил на стандартной скорости. Быстрый режим работает только с ключом API Anthropic или подпиской Claude, но не с Bedrock, Vertex, Foundry или шлюзом.",
  "status.provider.claudeFastModeModelNotAllowed":
    "Claude ответил на стандартной скорости. Эта модель не может использовать быстрый режим в вашем аккаунте.",
  "status.provider.claudeFastModeTurnedOff":
    "Claude ответил на стандартной скорости. Быстрый режим выключен в настройках Claude Code или вашей организацией.",
  "status.provider.claudeFastModeUnavailable":
    "Claude ответил на стандартной скорости. Claude Code не смог использовать быстрый режим в этом ходе.",
} as const satisfies PartialTranslation<typeof source>;
