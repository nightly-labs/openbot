import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/link";

export const messages = {
  "mobile.link.connectFailed": "OpenBot не вдалося під’єднатися. Спробуйте ще раз.",
  "mobile.link.invite.signInTitle": "Увійдіть, щоб приєднатися до сервера",
  "mobile.link.invite.signInDescription":
    "Відскануйте QR-код в OpenBot на комп’ютері. Після цього ви зможете переглянути запрошення.",
  "mobile.link.invite.cancel": "Скасувати запрошення",
  "mobile.link.pairing.title": "Під’єднати цей телефон",
  "mobile.link.pairing.alreadySignedIn":
    "Ви вже ввійшли. Вийдіть у Налаштуваннях, перш ніж під’єднувати інший обліковий запис.",
  "mobile.link.pairing.description":
    "Продовжуйте, лише якщо ви самі запросили це посилання Mobile Connect на комп’ютері.",
  "mobile.link.pairing.accountService":
    "Це посилання під’єднує до сервісу облікових записів за адресою {origin}, а не до сервісу облікових записів OpenBot.",
  "mobile.link.pairing.connect": "Під’єднати",
  "mobile.link.plugin.title": "Відкрити сторінку плагіна",
  "mobile.link.plugin.description": "Переглянути цей плагін на сайті OpenBot.",
  "mobile.link.plugin.openFailed": "Не вдалося відкрити сторінку плагіна.",
  "mobile.link.plugin.view": "Переглянути плагін",
  "mobile.link.unavailable.title": "Посилання недоступне",
  "mobile.link.unavailable.description":
    "Це посилання недійсне, більше недоступне або не підтримується на мобільних пристроях.",
  "mobile.link.template.signInTitle": "Увійдіть, щоб додати цього агента",
  "mobile.link.template.signInDescription":
    "Відскануйте QR-код в OpenBot на комп’ютері. Після цього ви зможете переглянути агента перед додаванням.",
  "mobile.link.template.loading": "Завантаження агента…",
  "mobile.link.template.creator": "Автор: {name}",
  "mobile.link.template.section.instructions": "Інструкції",
  "mobile.link.template.section.skills": "Навички",
  "mobile.link.template.section.noSkills": "Навичок немає.",
  "mobile.link.template.section.routines": "Автозавдання",
  "mobile.link.template.section.noRoutines": "Регулярних завдань немає.",
  "mobile.link.template.skill.local": "Локальна навичка (лише SKILL.md)",
  "mobile.link.template.skill.marketplace": "Навичка з каталогу, версія {version}",
  "mobile.link.template.server.title": "Додати на сервер",
  "mobile.link.template.server.footer": "Показано лише сервери, де ви власник або адміністратор.",
  "mobile.link.template.server.updateRequired": "Оновіть OpenBot на цьому сервері, щоб додавати спільних агентів.",
  "mobile.link.template.server.none":
    "Щоб додати спільного агента, потрібно бути власником або адміністратором сервера.",
  "mobile.link.template.install.action": "Додати агента",
  "mobile.link.template.install.pending": "Додавання…",
  "mobile.link.template.install.failed": "Не вдалося додати агента.",
  "mobile.link.template.notFound.title": "Агента не знайдено",
  "mobile.link.template.notFound.description":
    "Цього спільного агента не існує, або автором скасовано його публікацію.",
  "mobile.link.template.error.title": "Не вдалося завантажити агента",
  "mobile.link.template.error.loadFailed": "Не вдалося прочитати спільного агента. Спробуйте ще раз.",
  "mobile.link.template.error.unsupported":
    "Цей сервер не може додавати спільних агентів. Оновіть OpenBot на комп’ютері, де працює сервер.",
} as const satisfies PartialTranslation<typeof source>;
