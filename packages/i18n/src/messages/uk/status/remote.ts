import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/remote";

export const messages = {
  "status.remote.setupMacOnly": "Налаштування дозволів доступне в macOS.",
  "status.remote.setupInstallHost": "Встановіть компонент хоста віддаленого робочого столу й перевірте знову.",
  "status.remote.setupUpdateRuntime": "Оновіть середовище віддаленого робочого столу, щоб перевірити дозволи macOS.",
  "status.remote.setupCheckFailed":
    "Sunshine не зміг завершити перевірку дозволів. Перевірте сеанс хоста й спробуйте ще раз.",
  "status.remote.setupServiceFailed":
    "Не вдалося запустити службу віддаленого робочого столу. Переконайтеся, що цей користувач macOS має активний графічний сеанс.",
  "status.remote.connectingSunshine": "Під’єднання через Sunshine…",
  "status.remote.switchingMonitor": "Перемикання спільного монітора…",
  "status.remote.controlConnected": "Віддалене керування під’єднано.",
  "status.remote.controlFailed": "Збій віддаленого керування.",
  "status.remote.stagePreferences": "Завантаження локальних налаштувань чату: {reason}",
  "status.remote.stageConnection": "Під’єднання до комп’ютера: {reason}",
  "status.remote.stageCompatibility": "Перевірка сумісності комп’ютера: {reason}",
  "status.remote.stageAgents": "Завантаження агентів: {reason}",
  "status.remote.stageReads": "Завантаження статусу прочитання: {reason}",
  "status.remote.suspendedDetail":
    "Оновіть OpenBot Mobile або застосунок для комп’ютера, перш ніж під’єднуватися.\n{detail}",
  "status.remote.cooldownDetail":
    "Не вдалося під’єднатися після {limit} спроб. Повтор через {minutes}:{seconds}.\n{detail}",
  "status.remote.cooldown": "Не вдалося під’єднатися після {limit} спроб. Повтор через {minutes}:{seconds}.",
  "status.remote.connectionLostDetail": {
    one: "З’єднання втрачено. Повтор через {count} с.\n{detail}",
    few: "З’єднання втрачено. Повтор через {count} с.\n{detail}",
    many: "З’єднання втрачено. Повтор через {count} с.\n{detail}",
    other: "З’єднання втрачено. Повтор через {count} с.\n{detail}",
  },
  "status.remote.connectionLost": {
    one: "З’єднання втрачено. Повтор через {count} с.",
    few: "З’єднання втрачено. Повтор через {count} с.",
    many: "З’єднання втрачено. Повтор через {count} с.",
    other: "З’єднання втрачено. Повтор через {count} с.",
  },
  "status.remote.attemptFailedDetail": {
    one: "Спроба під’єднання не вдалася. Повтор через {count} с.\n{detail}",
    few: "Спроба під’єднання не вдалася. Повтор через {count} с.\n{detail}",
    many: "Спроба під’єднання не вдалася. Повтор через {count} с.\n{detail}",
    other: "Спроба під’єднання не вдалася. Повтор через {count} с.\n{detail}",
  },
  "status.remote.attemptFailed": {
    one: "Спроба під’єднання не вдалася. Повтор через {count} с.",
    few: "Спроба під’єднання не вдалася. Повтор через {count} с.",
    many: "Спроба під’єднання не вдалася. Повтор через {count} с.",
    other: "Спроба під’єднання не вдалася. Повтор через {count} с.",
  },
  "status.remote.reconnectingDetail": {
    one: "Повторне під’єднання {attempt}/{count}\n{detail}",
    few: "Повторне під’єднання {attempt}/{count}\n{detail}",
    many: "Повторне під’єднання {attempt}/{count}\n{detail}",
    other: "Повторне під’єднання {attempt}/{count}\n{detail}",
  },
  "status.remote.reconnecting": {
    one: "Повторне під’єднання {attempt}/{count}",
    few: "Повторне під’єднання {attempt}/{count}",
    many: "Повторне під’єднання {attempt}/{count}",
    other: "Повторне під’єднання {attempt}/{count}",
  },
} as const satisfies PartialTranslation<typeof source>;
