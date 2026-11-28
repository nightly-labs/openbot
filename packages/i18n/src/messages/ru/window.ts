import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "OpenBot: локальный хост",
  "window.localClientTitle": "OpenBot: локальный клиент",
  "window.computerUsePermissionTitle": "Включите управление компьютером",
  "window.rendererStoppedTitle": "OpenBot перестал работать",
  "window.rendererStoppedBody":
    "Окно несколько раз останавливалось. Ваши чаты сохранены, а агенты продолжают работать.",
  "window.rendererStoppedReload": "Перезагрузить",
  "window.minimize": "Свернуть",
  "window.maximize": "Развернуть",
  "window.restore": "Восстановить",
} as const satisfies PartialTranslation<typeof source>;
