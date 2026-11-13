import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "OpenBot: локальный хост",
  "window.localClientTitle": "OpenBot: локальный клиент",
  "window.computerUsePermissionTitle": "Включите управление компьютером",
  "window.controls.label": "Окно",
  "window.controls.minimize": "Свернуть",
  "window.controls.maximize": "Развернуть",
  "window.controls.restore": "Восстановить",
  "window.controls.close": "Закрыть",
} as const satisfies PartialTranslation<typeof source>;
