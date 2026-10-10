import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/agent";

export const messages = {
  "error.agent.historyUnavailable":
    "История недоступна для этого запроса. Прочитайте недавнюю историю ещё раз или используйте channel_history для работы с каналом.",
  "error.agent.toolRequestInvalid":
    "Некорректные аргументы поиска инструментов. Используйте объявленную схему и исходное полное имя инструмента.",
  "error.agent.approvalWhileDeleting": "Нельзя дать подтверждение, пока агент удаляется.",
  "error.agent.accessLocalOnly": "Доступ агента можно изменить только на компьютере, где он работает.",
  "error.agent.duplicateCleanupFailed": "Не удалось дублировать агента, а неполную копию удалить не получилось.",
  "error.agent.commitEffectsFailed": "Транзакция зафиксирована, но сохранённые последствия не выполнены.",
  "error.agent.settingsLocalOnly": "Настройки агента можно изменить только на компьютере, где он работает.",
  "error.agent.skillsLocalOnly": "Навыки можно изменить только на компьютере, где работает агент.",
  "error.agent.addLocalOnly": "Агентов можно добавлять только на компьютере, где они работают.",
  "error.agent.joinedServerUpdate": "Агента на подключённом сервере нельзя обновить отсюда.",
  "error.agent.searchQueryRequired": "Нужен поисковый запрос.",
  "error.agent.messageTooLong": "Сообщение слишком длинное.",
  "error.agent.messageOrAttachmentRequired": "Нужно сообщение или вложение.",
  "error.agent.promptAnswersTooLong": "Ответы на вопросы слишком длинные.",
  "error.agent.gone": "Этого агента больше нет.",
  "error.agent.profileGenerationBusy": "Создание профиля занято. Повторите чуть позже.",
  "error.agent.initialMessageRequired": "Нужно первое сообщение.",
  "error.agent.initialMessageTooLong": "Первое сообщение слишком длинное.",
  "error.agent.setupCleanupFailed": "Не удалось настроить агента, а неполного агента удалить не получилось.",
  "error.agent.modelUnavailable": "Выбранная модель агента недоступна.",
  "error.agent.modelProviderNotConnected": "Выбранная модель агента «{model}» недоступна: {provider} не подключён.",
  "error.agent.modelListEmpty":
    "Выбранная модель агента «{model}» недоступна: {provider} не вернул ни одной модели. Последняя ошибка: {detail}",
  "error.agent.modelListEmptyNoError":
    "Выбранная модель агента «{model}» недоступна: {provider} не вернул ни одной модели.",
  "error.agent.modelNotInProviderList": "Выбранная модель агента «{model}» недоступна: {provider} её не перечисляет.",
  "error.agent.modelProviderMismatch": "Выбранная модель не принадлежит этому провайдеру.",
  "error.agent.modelNotListed": "Модель «{model}» недоступна. Доступные модели: {models}.",
  "error.agent.providerNotListed":
    "Сейчас нет доступных моделей {provider}. Вызовите list_models, чтобы увидеть доступные модели.",
  "error.agent.reasoningEffortUnsupported":
    "Модель «{model}» не поддерживает уровень рассуждения «{effort}». Поддерживаются: {efforts}.",
  "error.agent.noStartingModelInSettings":
    "У {provider} нет доступных моделей, и у других подключённых провайдеров их тоже нет. Войдите в аккаунт провайдера или измените провайдера по умолчанию в разделе Настройки сервера → Провайдеры.",
  "error.agent.noStartingModel":
    "У {provider} нет доступной модели, и ни у одного другого провайдера, в который вы вошли, её тоже нет. Войдите в провайдера или смените провайдера по умолчанию в разделе «Провайдеры и разрешения».",
  "error.agent.waitBeforeProviderChange":
    "Дождитесь, пока завершатся текущий ход и очередь, прежде чем менять провайдера.",
  "error.agent.waitBeforeClearContext":
    "Дождитесь, пока завершатся текущий ход и очередь, прежде чем начинать новый чат.",
  "error.agent.unknown": "Неизвестный агент: {id}",
  "error.agent.onlyUserWidensSettings":
    "Только пользователь может дать агенту полный доступ или включить управление компьютером. Попросите пользователя изменить это в настройках агента.",
  "error.agent.queuedMessageCreateFailed": "Не удалось создать сообщение в очереди.",
  "error.agent.messageUnavailable": "Сообщение больше недоступно.",
  "error.agent.hostLimit": "На одном хосте может быть не более {limit} агентов.",
  "error.agent.changedWhileDuplicating": "Агент изменился во время дублирования. Повторите попытку.",
  "error.agent.duplicatedAgentGone": "Дубликата агента больше нет.",
  "error.agent.stateCorrupt":
    "Состояние агентов повреждено или создано более новой версией OpenBot; перезапись отклонена.",
  "error.agent.oldRoleField":
    "Сохранённые профили агентов используют старое поле role; обновите данные перед запуском OpenBot.",
  "error.agent.duplicateIds": "Состояние агентов содержит повторяющиеся идентификаторы; перезапись отклонена.",
  "error.agent.copyNameFailed": "OpenBot не смог подобрать уникальное имя для копии агента.",
  "error.agent.endpointRemoved": "Эндпоинт, который использовал этот агент, удалён. Выберите для него другую модель.",
  "error.agent.selectedGone": "Выбранного агента больше нет.",
  "error.agent.profileEndpointsChanged": "Пользовательские эндпоинты изменились во время создания. Повторите попытку.",
  "error.agent.profileInvalid": "Провайдер вернул некорректный профиль. Попробуйте изменить запрос.",
  "error.agent.profileSectionUnavailable":
    "Созданный раздел недоступен. Повторите попытку или выберите раздел вручную.",
  "error.agent.profileTimedOut": "Время создания профиля истекло. Повторите попытку.",
  "error.agent.profileDisconnected": "Провайдер отключился во время создания профиля.",
  "error.agent.profileToolUse": "Провайдер попытался использовать инструмент. Попробуйте изменить запрос.",
  "error.agent.profileFailed": "Провайдер не смог создать профиль. Повторите попытку.",
  "error.agent.profileTooLarge": "Созданный профиль слишком большой. Попробуйте более короткий запрос.",
  "error.agent.profileNotStarted": "Провайдер не смог начать создание профиля.",
  "error.agent.deletionBusy": "Агент уже удаляется.",
  "error.agent.stopBeforeDelete": "Остановите агента и отмените его сообщения в очереди, прежде чем удалять.",
  "error.agent.deleteIncomplete": "Данные агента удалены не полностью. Повторите удаление.",
  "error.agent.duplicationBusy": "Этот агент уже дублируется.",
  "error.agent.waitBeforeDuplicate":
    "Дождитесь, пока агент закончит работу, и очистите его очередь, прежде чем дублировать.",
  "error.agent.saveOtherAgent": "Это сохранение относится к другому агенту.",
  "error.agent.savedGone": "Сохранённого агента больше нет.",
  "error.agent.storedProfileUnreadable":
    "В сохранённом профиле агента не читается значение «{field}»; обновите данные перед запуском OpenBot.",
  "error.agent.storedProfileUnreadableId":
    "В сохранённом профиле агента {id} не читается значение «{field}»; обновите данные перед запуском OpenBot.",
  "error.agent.queueEditRejected": "Изменение очереди отклонено: {reason}",
  "error.agent.computerUseLocalOnly": "Управление компьютером можно изменить только на компьютере, где работает агент.",
  "error.agent.automationLocalOnly": "Локальные скрипты можно разрешить только на компьютере, где работает агент.",
  "error.agent.busyMessageModeLocalOnly":
    "Поведение сообщений, пока агент работает, можно задать только на компьютере, где он работает.",
  "error.agent.localScriptsOff": "Этот агент не разрешает локальные скрипты.",
  "error.agent.localScriptsRateLimited":
    "За последний час локальные скрипты отправили этому агенту {limit} запросов сообщений или процедур. Повторите попытку позже.",
  "error.agent.automationOff": "Этот агент не разрешает локальным скриптам запускать свои регулярные задачи.",
  "error.agent.automationPayloadTooLong": "Данные длиннее {limit} символов.",
  "error.agent.automationRateLimited":
    "Локальные скрипты запускали регулярные задачи этого агента {limit} раз за последний час. Повторите позже.",
  "error.agent.workspaceOnlyMacOnly":
    "Режим «Только рабочее пространство» для этого провайдера доступен только в macOS. Выберите «Полный доступ» в настройках агента.",
  "error.agent.lowMemory":
    "На этом сервере мало памяти. Ваше сообщение ждёт в очереди и начнётся, когда память освободится. Более крупный тариф даёт серверу больше памяти.",
  "error.agent.workspaceOnlyToolMissing":
    "Для режима «Только рабочее пространство» нужен {tool}, но OpenBot его не нашёл. Установите его или выберите «Полный доступ» в настройках агента.",
} as const satisfies PartialTranslation<typeof source>;
