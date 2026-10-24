import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/deviceApps";

export const messages = {
  "mobile.deviceApps.title": "Подключённые приложения",
  "mobile.deviceApps.apps": "Приложения",
  "mobile.deviceApps.appsFooter":
    "Разрешите агентам использовать эти приложения на этом iPhone. Когда вы включаете приложение, iPhone запрашивает на него разрешение. Пока приложение выключено, OpenBot спрашивает при первом обращении агента.",
  "mobile.deviceApps.writes": "Добавление записей",
  "mobile.deviceApps.writesFooter":
    "Пока вы не выберете «Всегда», OpenBot спрашивает, прежде чем агент добавит событие или напоминание.",
  "mobile.deviceApps.app.calendar": "Календарь",
  "mobile.deviceApps.app.reminders": "Напоминания",
  "mobile.deviceApps.app.contacts": "Контакты",
  "mobile.deviceApps.app.location": "Геопозиция",
  "mobile.deviceApps.app.denied": "{app} (запрещено)",
  "mobile.deviceApps.write.calendar": "Добавлять события без запроса",
  "mobile.deviceApps.write.reminders": "Добавлять напоминания без запроса",
  "mobile.deviceApps.osDenied": "Разрешите {app} в настройках iPhone",
  "mobile.deviceApps.consent.heading": "Разрешить {app}?",
  "mobile.deviceApps.consent.calendarListEvents": "Агент хочет прочитать события в вашем календаре.",
  "mobile.deviceApps.consent.calendarAddEvent": "Агент хочет добавить в ваш календарь это событие: {title}",
  "mobile.deviceApps.consent.remindersList": "Агент хочет прочитать ваши напоминания.",
  "mobile.deviceApps.consent.remindersAdd": "Агент хочет добавить это напоминание: {title}",
  "mobile.deviceApps.consent.contactsFind": "Агент хочет найти людей в ваших контактах.",
  "mobile.deviceApps.consent.locationCurrent": "Агент хочет узнать, где вы находитесь, с точностью около 100 метров.",
  "mobile.deviceApps.consent.privacy":
    "Прочитанное агентом уходит на его компьютер и может попасть к провайдеру модели.",
  "mobile.deviceApps.consent.once": "Разрешить один раз",
  "mobile.deviceApps.consent.always": "Всегда разрешать",
  "mobile.deviceApps.consent.deny": "Запретить",
} as const satisfies PartialTranslation<typeof source>;
