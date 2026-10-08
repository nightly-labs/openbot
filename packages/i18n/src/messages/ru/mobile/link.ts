import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/link";

export const messages = {
  "mobile.link.connectFailed": "OpenBot не удалось подключиться. Повторите попытку.",
  "mobile.link.invite.signInTitle": "Войдите, чтобы присоединиться к серверу",
  "mobile.link.invite.signInDescription":
    "Отсканируйте QR-код в OpenBot на компьютере. После этого вы сможете просмотреть приглашение.",
  "mobile.link.invite.cancel": "Отменить приглашение",
  "mobile.link.pairing.title": "Подключить этот телефон",
  "mobile.link.pairing.alreadySignedIn": "Вы уже вошли. Выйдите в настройках, прежде чем подключать другой аккаунт.",
  "mobile.link.pairing.description":
    "Продолжайте, только если вы сами запросили эту ссылку Mobile Connect на компьютере.",
  "mobile.link.pairing.connect": "Подключить",
  "mobile.link.plugin.title": "Открыть страницу плагина",
  "mobile.link.plugin.description": "Посмотреть этот плагин на сайте OpenBot.",
  "mobile.link.plugin.openFailed": "Не удалось открыть страницу плагина.",
  "mobile.link.plugin.view": "Смотреть плагин",
  "mobile.link.unavailable.title": "Ссылка недоступна",
  "mobile.link.unavailable.description":
    "Эта ссылка недействительна, больше недоступна или не поддерживается на мобильных устройствах.",
  "mobile.link.template.signInTitle": "Войдите, чтобы добавить этого агента",
  "mobile.link.template.signInDescription":
    "Отсканируйте QR-код в OpenBot на компьютере. После этого вы сможете просмотреть агента перед добавлением.",
  "mobile.link.template.loading": "Загрузка агента…",
  "mobile.link.template.creator": "Автор: {name}",
  "mobile.link.template.section.instructions": "Инструкции",
  "mobile.link.template.section.skills": "Навыки",
  "mobile.link.template.section.noSkills": "Навыков нет.",
  "mobile.link.template.section.routines": "Регулярные задачи",
  "mobile.link.template.section.noRoutines": "Регулярных задач нет.",
  "mobile.link.template.skill.local": "Локальный навык (только SKILL.md)",
  "mobile.link.template.skill.marketplace": "Навык из каталога, версия {version}",
  "mobile.link.template.server.title": "Добавить на сервер",
  "mobile.link.template.server.footer": "Показаны только серверы, где вы владелец или администратор.",
  "mobile.link.template.server.updateRequired": "Обновите OpenBot на этом сервере, чтобы добавлять общих агентов.",
  "mobile.link.template.server.none":
    "Чтобы добавить общего агента, нужно быть владельцем или администратором сервера.",
  "mobile.link.template.install.action": "Добавить агента",
  "mobile.link.template.install.pending": "Добавление…",
  "mobile.link.template.install.failed": "Не удалось добавить агента.",
  "mobile.link.template.notFound.title": "Агент не найден",
  "mobile.link.template.notFound.description": "Этого общего агента не существует, или автор снял его с публикации.",
  "mobile.link.template.error.title": "Не удалось загрузить агента",
  "mobile.link.template.error.loadFailed": "Не удалось прочитать общего агента. Повторите попытку.",
  "mobile.link.template.error.unsupported":
    "Этот сервер не может добавлять общих агентов. Обновите OpenBot на компьютере, где работает сервер.",
} as const satisfies PartialTranslation<typeof source>;
