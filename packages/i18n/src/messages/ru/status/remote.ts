import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/remote";

export const messages = {
  "status.remote.setupMacOnly": "Настройка разрешений доступна в macOS.",
  "status.remote.setupInstallHost": "Установите компонент хоста удалённого рабочего стола и проверьте снова.",
  "status.remote.setupUpdateRuntime": "Обновите среду удалённого рабочего стола, чтобы проверить разрешения macOS.",
  "status.remote.setupCheckFailed":
    "Sunshine не смог завершить проверку разрешений. Проверьте сессию хоста и повторите попытку.",
  "status.remote.setupServiceFailed":
    "Не удалось запустить службу удалённого рабочего стола. Убедитесь, что у этого пользователя macOS есть активная графическая сессия.",
  "status.remote.connectingSunshine": "Подключение через Sunshine…",
  "status.remote.switchingMonitor": "Переключение общего монитора…",
  "status.remote.controlConnected": "Удалённое управление подключено.",
  "status.remote.controlFailed": "Удалённое управление не удалось.",
  "status.remote.stagePreferences": "Загрузка локальных настроек чата: {reason}",
  "status.remote.stageConnection": "Подключение к компьютеру: {reason}",
  "status.remote.stageCompatibility": "Проверка совместимости компьютера: {reason}",
  "status.remote.stageAgents": "Загрузка агентов: {reason}",
  "status.remote.stageReads": "Загрузка статуса прочтения: {reason}",
  "status.remote.stageConversations": "Загрузка диалогов: {reason}",
  "status.remote.suspendedDetail":
    "Обновите OpenBot Mobile или приложение для компьютера, прежде чем подключаться.\n{detail}",
  "status.remote.cooldownDetail":
    "Подключение не удалось после {limit} попыток. Повтор через {minutes}:{seconds}.\n{detail}",
  "status.remote.cooldown": "Подключение не удалось после {limit} попыток. Повтор через {minutes}:{seconds}.",
  "status.remote.connectionLostDetail": {
    one: "Соединение потеряно. Повтор через {count} с.\n{detail}",
    few: "Соединение потеряно. Повтор через {count} с.\n{detail}",
    many: "Соединение потеряно. Повтор через {count} с.\n{detail}",
    other: "Соединение потеряно. Повтор через {count} с.\n{detail}",
  },
  "status.remote.connectionLost": {
    one: "Соединение потеряно. Повтор через {count} с.",
    few: "Соединение потеряно. Повтор через {count} с.",
    many: "Соединение потеряно. Повтор через {count} с.",
    other: "Соединение потеряно. Повтор через {count} с.",
  },
  "status.remote.attemptFailedDetail": {
    one: "Попытка подключения не удалась. Повтор через {count} с.\n{detail}",
    few: "Попытка подключения не удалась. Повтор через {count} с.\n{detail}",
    many: "Попытка подключения не удалась. Повтор через {count} с.\n{detail}",
    other: "Попытка подключения не удалась. Повтор через {count} с.\n{detail}",
  },
  "status.remote.attemptFailed": {
    one: "Попытка подключения не удалась. Повтор через {count} с.",
    few: "Попытка подключения не удалась. Повтор через {count} с.",
    many: "Попытка подключения не удалась. Повтор через {count} с.",
    other: "Попытка подключения не удалась. Повтор через {count} с.",
  },
  "status.remote.reconnectingDetail": {
    one: "Повторное подключение {attempt}/{count}\n{detail}",
    few: "Повторное подключение {attempt}/{count}\n{detail}",
    many: "Повторное подключение {attempt}/{count}\n{detail}",
    other: "Повторное подключение {attempt}/{count}\n{detail}",
  },
  "status.remote.reconnecting": {
    one: "Повторное подключение {attempt}/{count}",
    few: "Повторное подключение {attempt}/{count}",
    many: "Повторное подключение {attempt}/{count}",
    other: "Повторное подключение {attempt}/{count}",
  },
} as const satisfies PartialTranslation<typeof source>;
