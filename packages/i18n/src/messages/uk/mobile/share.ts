import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/share";

export const messages = {
  "mobile.share.signInTitle": "Увійдіть, щоб поділитися",
  "mobile.share.signInDescription":
    "Відскануйте QR-код в OpenBot на комп’ютері. Після цього ви зможете вибрати агента, який отримає те, чим ви поділилися.",
  "mobile.share.reading": "Читання того, чим ви поділилися…",
  "mobile.share.readFailed": "OpenBot не вдалося прочитати те, чим ви поділилися. Поділіться ще раз.",
  "mobile.share.content": "Що надіслати",
  "mobile.share.footer":
    "Чат відкриється з цим вмістом у полі повідомлення. Нічого не буде надіслано, доки ви не надішлете це самі.",
  "mobile.share.lastUsed": "Останній використаний",
  "mobile.share.noAgents": "Немає агентів",
  "mobile.share.chooseAgent": "Виберіть агента",
  "mobile.share.action": "Поділитися з {name}",
} as const satisfies PartialTranslation<typeof source>;
