import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/computerUse";

export const messages = {
  "status.computerUse.driverNotStarted": "Драйвер управления компьютером не запустился. {reason}",
  "status.computerUse.driverStoppedBeforeAnswer": "Драйвер управления компьютером остановился, не успев ответить.",
  "status.computerUse.driverNoAnswer": "Драйвер управления компьютером не ответил. {reason}",
  "status.computerUse.driverStopped": "Драйвер управления компьютером остановлен.",
  "status.computerUse.unsupported": "Управление компьютером доступно в macOS, Windows и Linux.",
  "status.computerUse.driverMissing": "В этой сборке OpenBot нет драйвера управления компьютером.",
  "status.computerUse.progressActing": "Работаю с приложением на этом компьютере…",
  "status.computerUse.progressDeciding": "Выбираю следующий шаг в приложении…",
} as const satisfies PartialTranslation<typeof source>;
