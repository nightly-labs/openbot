import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/agentSettings";

export const messages = {
  "agentSettings.label": "Настройки агента",
  "agentSettings.title": "Настройки",
  "agentSettings.backToDetails": "Назад к описанию",
  "agentSettings.closeDetails": "Закрыть описание",
  "agentSettings.backToSettings": "Назад к настройкам",
  "agentSettings.profile.title": "Профиль",
  "agentSettings.profile.open": "Изменить профиль {name}",
  "agentSettings.instructionsEdit": "Изменить инструкции",
  "agentSettings.permissions.title": "Разрешения",
  "agentSettings.advanced.title": "Дополнительно",
  "agentSettings.groups.brain": "Мозг",
  "agentSettings.groups.knows": "Знает",
  "agentSettings.groups.does": "Делает",
  "agentSettings.groups.rules": "Правила",
  "agentSettings.saveFailed": "Не удалось сохранить настройки агента.",

  "agentSettings.name": "Имя",
  "agentSettings.nameLabel": "Имя агента",
  "agentSettings.agentTitle": "Описание",
  "agentSettings.agentTitleLabel": "Описание агента",
  "agentSettings.agentTitlePlaceholder": "Опишите, чем занимается агент",
  "agentSettings.instructions": "Инструкции",
  "agentSettings.instructionsLabel": "Инструкции агента",
  "agentSettings.instructionsPlaceholder": "Для чего нужен этот агент",

  "agentSettings.avatar.edit": "Изменить аватар агента",
  "agentSettings.avatar.editor": "Редактор аватара",
  "agentSettings.avatar.attachFiles": "Прикрепить файлы",
  "agentSettings.avatar.image": "Изображение",
  "agentSettings.avatar.replaceImage": "Заменить изображение",
  "agentSettings.avatar.uploadImage": "Загрузить изображение",
  "agentSettings.avatar.imageHint": "PNG, JPEG или WebP · квадратная обрезка",
  "agentSettings.avatar.generatedFace": "Сгенерированное лицо",
  "agentSettings.avatar.resetToId": "Сбросить до ID",
  "agentSettings.avatar.newSet": "Новый набор",
  "agentSettings.avatar.faces": "Сгенерированные лица аватара",
  "agentSettings.avatar.selected": "Выбранный аватар",
  "agentSettings.avatar.option": "Вариант аватара {number}",
  "agentSettings.avatar.color": "Цвет",
  "agentSettings.avatar.colorLabel": "Цвет аватара",
  "agentSettings.avatar.autoColor": "Автоматический цвет аватара",
  "agentSettings.avatar.autoInitial": "А",
  "agentSettings.avatar.hueColor": "Цвет аватара: {hue}",
  "agentSettings.avatar.saveFailed": "Не удалось сохранить аватар агента.",
  "agentSettings.avatar.processFailed": "Не удалось обработать аватар агента.",

  "agentSettings.runtime.model": "Модель агента",
  "agentSettings.runtime.modelBusy": "Дождитесь завершения текущей работы, прежде чем менять модель.",
  "agentSettings.runtime.modelUnavailable": "Модели станут доступны после подключения CLI агента.",
  "agentSettings.runtime.reasoning": "Рассуждение",
  "agentSettings.runtime.reasoningLabel": "Уровень рассуждения агента",
  "agentSettings.runtime.selectReasoning": "Выберите рассуждение",
  "agentSettings.runtime.reasoningSetByProvider": "Задаёт {provider}",
  "agentSettings.runtime.access": "Доступ",
  "agentSettings.runtime.accessLabel": "Доступ агента",
  "agentSettings.runtime.busyMessage": "Во время работы",
  "agentSettings.runtime.busyMessageLabel": "Сообщения, пока агент работает",
  "agentSettings.runtime.workingDirectory": "Рабочая папка",
  "agentSettings.runtime.notAvailable": "Пока недоступно",
  "agentSettings.runtime.fullAccessNote":
    "Агент работает с полным доступом к компьютеру из своего рабочего пространства и общей папки.",
  "agentSettings.runtime.claudeApprovalNote":
    "Claude действует без запроса подтверждения, кроме вопросов, которые он задаёт вам.",
  "agentSettings.runtime.providerApprovalNote":
    "В зависимости от провайдера для опасных команд сначала может понадобиться подтверждение.",

  "agentSettings.access.workspace": "Только рабочее пространство",
  "agentSettings.access.full": "Полный доступ",
  "agentSettings.busyMessage.appDefaultQueue": "Очередь (общая)",
  "agentSettings.busyMessage.appDefaultSteer": "Направлять (общая)",
  "agentSettings.busyMessage.queue": "Очередь",
  "agentSettings.busyMessage.steer": "Направлять",
  "agentSettings.busyMessage.steerUnsupported":
    "{provider} не умеет направлять выполняемый ход. Сообщения, отправленные во время работы, ждут в очереди.",

  "agentSettings.notifications.title": "Уведомления",

  "agentSettings.newChat.title": "Новый чат",
  "agentSettings.newChat.description": "Агент забудет этот чат. Настройки сохранятся.",
  "agentSettings.newChat.button": "Начать",
  "agentSettings.newChat.confirmTitle": "Начать новый чат с {name}?",
  "agentSettings.newChat.confirmDescription":
    "Агент забудет этот чат. Сообщения останутся видны над разделителем. Инструкции, модель, инструменты, память, рабочее пространство и браузер не изменятся.",
  "agentSettings.newChat.confirm": "Начать новый чат",
  "agentSettings.newChat.failed": "Не удалось начать новый чат.",

  "agentSettings.fullAccess.title": "Дать этому агенту полный доступ?",
  "agentSettings.fullAccess.description":
    "Тогда агент сможет читать, изменять и удалять любые файлы, доступные вашему пользователю, выполнять любые команды и пользоваться сетью. Одна неверно понятая инструкция или вредоносная веб-страница могут добраться до ваших личных файлов.",
  "agentSettings.fullAccess.cancel": "Оставить только рабочее пространство",
  "agentSettings.fullAccess.confirm": "Разрешить полный доступ",

  "agentSettings.links.usage": "Использование",
  "agentSettings.links.memories": "Память",
  "agentSettings.links.memoriesCount": {
    one: "Сохранено: {count}",
    few: "Сохранено: {count}",
    many: "Сохранено: {count}",
    other: "Сохранено: {count}",
  },
  "agentSettings.links.skills": "Навыки",
  "agentSettings.links.skillsCount": {
    one: "Назначено: {count}",
    few: "Назначено: {count}",
    many: "Назначено: {count}",
    other: "Назначено: {count}",
  },
  "agentSettings.links.tables": "Таблицы",
  "agentSettings.links.tablesCount": {
    one: "{count} таблица",
    few: "{count} таблицы",
    many: "{count} таблиц",
    other: "{count} таблицы",
  },
  "agentSettings.links.files": "Файлы",
  "agentSettings.links.routines": "Регулярные задачи",
  "agentSettings.links.routinesCount": {
    one: "Настроено: {count}",
    few: "Настроено: {count}",
    many: "Настроено: {count}",
    other: "Настроено: {count}",
  },
  "agentSettings.runtime.workspaceNote":
    "Режим «Только рабочее пространство» ограничивает запись рабочим пространством агента, общей папкой и временными папками. Чтение и сеть остаются доступными.",
  "agentSettings.runtime.workspaceEnforcedCommand":
    "Если команде нужно записать данные за пределами, сначала будет запрос к вам, в том числе при включённом автоодобрении.",
  "agentSettings.runtime.workspaceEnforcedClaude":
    "Изменение файла за пределами сначала запрашивает ваше подтверждение, в том числе при включённом автоодобрении. Команда не может записывать за пределами.",
  "agentSettings.runtime.workspaceUnlimited":
    "Управление компьютером и браузер OpenBot не ограничены; управление компьютером можно отключить ниже.",
  "agentSettings.computerUse.title": "Управление компьютером",
  "agentSettings.computerUse.description": "Разрешить этому агенту управлять приложениями на этом компьютере",
  "agentSettings.automation.title": "Локальные скрипты",
  "agentSettings.automation.description":
    "Разрешить скриптам на этом компьютере запускать регулярные задачи этого агента",
  "agentSettings.runtime.workspaceEnforcedProcess":
    "Весь процесс {provider} работает в песочнице, поэтому запись за пределами не удастся. Доступно только в macOS.",
} as const satisfies PartialTranslation<typeof source>;
