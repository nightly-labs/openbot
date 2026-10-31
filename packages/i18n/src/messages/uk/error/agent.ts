import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/agent";

export const messages = {
  "error.agent.historyUnavailable":
    "Історія недоступна для цього запиту. Прочитайте нещодавню історію ще раз або використайте channel_history для роботи з каналом.",
  "error.agent.toolRequestInvalid":
    "Некоректні аргументи пошуку інструментів. Використайте оголошену схему й початкову повну назву інструмента.",
  "error.agent.approvalWhileDeleting": "Не можна надати схвалення, поки агент видаляється.",
  "error.agent.accessLocalOnly": "Доступ агента можна змінити лише на комп’ютері, де він працює.",
  "error.agent.duplicateCleanupFailed": "Не вдалося дублювати агента, а неповну копію не вдалося видалити.",
  "error.agent.commitEffectsFailed": "Транзакцію зафіксовано, але її збережені дії не вдалося виконати.",
  "error.agent.settingsLocalOnly": "Налаштування агента можна змінити лише на комп’ютері, де він працює.",
  "error.agent.skillsLocalOnly": "Навички можна змінити лише на комп’ютері, де працює агент.",
  "error.agent.addLocalOnly": "Агентів можна додавати лише на комп’ютері, де вони працюють.",
  "error.agent.joinedServerUpdate": "Агента на під’єднаному сервері не можна оновити звідси.",
  "error.agent.searchQueryRequired": "Потрібен пошуковий запит.",
  "error.agent.messageTooLong": "Повідомлення задовге.",
  "error.agent.messageOrAttachmentRequired": "Потрібне повідомлення або вкладення.",
  "error.agent.promptAnswersTooLong": "Відповіді на запитання задовгі.",
  "error.agent.gone": "Цього агента більше немає.",
  "error.agent.profileGenerationBusy": "Створення профілю вже триває. Повторіть спробу трохи пізніше.",
  "error.agent.initialMessageRequired": "Потрібне перше повідомлення.",
  "error.agent.initialMessageTooLong": "Перше повідомлення задовге.",
  "error.agent.setupCleanupFailed": "Не вдалося налаштувати агента, а неповного агента не вдалося видалити.",
  "error.agent.modelUnavailable": "Вибрана модель агента недоступна.",
  "error.agent.modelProviderNotConnected": "Вибрана модель агента «{model}» недоступна: {provider} не під’єднано.",
  "error.agent.modelListEmpty":
    "Вибрана модель агента «{model}» недоступна: {provider} не повернув жодної моделі. Остання помилка: {detail}",
  "error.agent.modelListEmptyNoError":
    "Вибрана модель агента «{model}» недоступна: {provider} не повернув жодної моделі.",
  "error.agent.modelNotInProviderList": "Вибрана модель агента «{model}» недоступна: {provider} її не пропонує.",
  "error.agent.modelProviderMismatch": "Вибрана модель не належить цьому провайдерові.",
  "error.agent.modelNotListed": "Модель «{model}» недоступна. Доступні моделі: {models}.",
  "error.agent.providerNotListed":
    "Зараз немає доступних моделей {provider}. Викличте list_models, щоб побачити доступні моделі.",
  "error.agent.reasoningEffortUnsupported":
    "Модель «{model}» не підтримує рівень зусиль на міркування «{effort}». Підтримувані рівні: {efforts}.",
  "error.agent.noStartingModelInSettings":
    "У {provider} немає доступних моделей, і в інших провайдерів, у які ви ввійшли, їх теж немає. Увійдіть в обліковий запис провайдера або змініть провайдера за замовчуванням у розділі «Налаштування сервера» → «Провайдери».",
  "error.agent.noStartingModel":
    "У {provider} немає доступної моделі, і в інших провайдерів, у які ви ввійшли, її теж немає. Увійдіть в обліковий запис провайдера або змініть провайдера за замовчуванням у розділі «Провайдери й дозволи».",
  "error.agent.waitBeforeProviderChange":
    "Дочекайтеся завершення поточного ходу й черги, перш ніж змінювати провайдера.",
  "error.agent.waitForTasksBeforeProviderChange":
    "Завдання цього агента виконуються. Дочекайтеся їх завершення або зупиніть їх, перш ніж змінювати провайдера.",
  "error.agent.waitBeforeClearContext": "Дочекайтеся завершення поточного ходу й черги, перш ніж починати новий чат.",
  "error.agent.waitBeforeCompactContext": "Дочекайтеся завершення активного ходу й черги, перш ніж стискати контекст.",
  "error.agent.compactContextUnavailable": "Цей агент зараз не може стиснути свій контекст.",
  "error.agent.unknown": "Невідомий агент: {id}",
  "error.agent.onlyUserWidensSettings":
    "Лише користувач може надати агентові повний доступ або ввімкнути керування комп’ютером. Попросіть користувача змінити це в налаштуваннях агента.",
  "error.agent.queuedMessageCreateFailed": "Не вдалося створити повідомлення в черзі.",
  "error.agent.messageUnavailable": "Повідомлення більше недоступне.",
  "error.agent.hostLimit": "На одному хості може бути не більше ніж {limit} агентів.",
  "error.agent.changedWhileDuplicating": "Агент змінився під час дублювання. Повторіть спробу.",
  "error.agent.duplicatedAgentGone": "Дубліката агента більше немає.",
  "error.agent.stateCorrupt": "Стан агентів пошкоджено або створено новішою версією OpenBot; перезапис відхилено.",
  "error.agent.oldRoleField":
    "Збережені профілі агентів використовують старе поле role; оновіть дані перед запуском OpenBot.",
  "error.agent.duplicateIds": "Стан агентів містить повторювані ідентифікатори; перезапис відхилено.",
  "error.agent.copyNameFailed": "OpenBot не зміг дібрати унікальне ім’я для копії агента.",
  "error.agent.endpointRemoved": "Ендпоінт, який використовував цей агент, видалено. Виберіть для нього іншу модель.",
  "error.agent.turnStalled":
    "{provider} перестав відповідати, тому OpenBot завершив цей хід. Надішліть повідомлення ще раз або виберіть іншу модель.",
  "error.agent.selectedGone": "Вибраного агента більше немає.",
  "error.agent.profileEndpointsChanged": "Користувацькі ендпоінти змінилися під час створення. Повторіть спробу.",
  "error.agent.profileInvalid": "Провайдер повернув некоректний профіль. Спробуйте змінити запит.",
  "error.agent.profileSectionUnavailable": "Створений розділ недоступний. Повторіть спробу або виберіть розділ вручну.",
  "error.agent.profileTimedOut": "Час створення профілю вичерпано. Повторіть спробу.",
  "error.agent.profileDisconnected": "Провайдер від’єднався під час створення профілю.",
  "error.agent.profileToolUse": "Провайдер спробував використати інструмент. Спробуйте змінити запит.",
  "error.agent.profileFailed": "Провайдер не зміг створити профіль. Повторіть спробу.",
  "error.agent.profileTooLarge": "Створений профіль завеликий. Спробуйте коротший запит.",
  "error.agent.profileNotStarted": "Провайдер не зміг почати створення профілю.",
  "error.agent.deletionBusy": "Агент уже видаляється.",
  "error.agent.stopBeforeDelete": "Зупиніть агента й скасуйте його повідомлення в черзі, перш ніж видаляти.",
  "error.agent.deleteIncomplete": "Дані агента видалено не повністю. Повторіть видалення.",
  "error.agent.duplicationBusy": "Цей агент уже дублюється.",
  "error.agent.waitBeforeDuplicate":
    "Дочекайтеся, поки агент завершить роботу й спорожнить чергу, перш ніж дублювати його.",
  "error.agent.saveOtherAgent": "Це збереження належить іншому агентові.",
  "error.agent.savedGone": "Збереженого агента більше немає.",
  "error.agent.storedProfileUnreadable":
    "У збереженому профілі агента не читається значення «{field}»; оновіть дані перед запуском OpenBot.",
  "error.agent.storedProfileUnreadableId":
    "У збереженому профілі агента {id} не читається значення «{field}»; оновіть дані перед запуском OpenBot.",
  "error.agent.queueEditRejected": "Зміну черги відхилено: {reason}",
  "error.agent.computerUseLocalOnly": "Керування комп’ютером можна змінити лише на комп’ютері, де працює агент.",
  "error.agent.automationLocalOnly": "Локальні скрипти можна дозволити лише на комп’ютері, де працює агент.",
  "error.agent.newChatLocalOnly": "Дозволити агентові починати нові чати можна лише на комп’ютері, де він працює.",
  "error.agent.quickAcknowledgementLocalOnly": "Змінити цей параметр можна лише на комп’ютері, де працює агент.",
  "error.agent.sideQuestionBusy": "Виконується забагато побічних питань. Повторіть спробу трохи пізніше.",
  "error.agent.sideQuestionFailed": "Агентові не вдалося відповісти на побічне питання. Повторіть спробу.",
  "error.agent.busyMessageModeLocalOnly":
    "Поведінку повідомлень, поки агент працює, можна задати лише на комп’ютері, де він працює.",
  "error.agent.backupModelsLocalOnly": "Резервні моделі можна задати лише на комп’ютері, де працює агент.",
  "error.agent.taskLimitLocalOnly": "Ліміт завдань можна задати лише на комп’ютері, де працює агент.",
  "error.agent.localScriptsOff": "Цей агент не дозволяє локальні скрипти.",
  "error.agent.localScriptsRateLimited":
    "За останню годину локальні скрипти надіслали цьому агентові {limit} запитів на повідомлення або регулярні завдання. Повторіть спробу пізніше.",
  "error.agent.automationOff": "Цей агент не дозволяє локальним скриптам запускати його регулярні завдання.",
  "error.agent.automationPayloadTooLong": "Дані довші за {limit} символів.",
  "error.agent.automationRateLimited":
    "Локальні скрипти запускали регулярні завдання цього агента {limit} разів за останню годину. Повторіть спробу пізніше.",
  "error.agent.workspaceOnlyMacOnly":
    "Режим «Лише робочий простір» для цього провайдера доступний лише в macOS. Виберіть «Повний доступ» у налаштуваннях агента.",
  "error.agent.lowMemory":
    "На цьому сервері мало пам’яті. Ваше повідомлення чекає в черзі й почне виконуватися, коли пам’ять звільниться. Більший тариф дає серверу більше пам’яті.",
  "error.agent.lowMemoryServer":
    "На цьому сервері мало пам’яті. Ваше повідомлення чекає в черзі й почне виконуватися, коли пам’ять звільниться.",
  "error.agent.workspaceOnlyToolMissing":
    "Для режиму «Лише робочий простір» потрібен {tool}, але OpenBot його не знайшов. Установіть його або виберіть «Повний доступ» у налаштуваннях агента.",
  "error.agent.screenCaptureOff":
    "Знімки екрана для цього агента вимкнено. Користувач може ввімкнути керування комп’ютером у налаштуваннях агента.",
  "error.agent.screenCaptureUnavailable": "Знімки екрана недоступні на цьому комп’ютері.",
  "error.agent.screenCaptureShared":
    "Знімки екрана не працюють у розмовах Slack, Discord або Telegram, бо їхні файли отримують інші люди.",
  "error.agent.screenCaptureDeclined": "Користувачем не надано дозволу на цей знімок екрана. Нічого не знято.",
  "error.agent.screenCaptureWindowMissing":
    "Це вікно зараз не відкрито. Викличте list_capture_sources, щоб отримати поточні ID вікон.",
  "error.agent.screenCaptureDisplayMissing":
    "Цей дисплей зараз не під’єднано. Викличте list_capture_sources, щоб отримати поточні ID дисплеїв.",
  "error.agent.screenCaptureRegionOutside":
    "Область не вміщується в один дисплей. Використайте точки робочого столу в межах одного дисплея з list_capture_sources.",
  "error.agent.screenCapturePermissionMissing":
    "OpenBot не має дозволу «Запис екрана». Попросіть користувача відкрити «Системні параметри» → «Конфіденційність і безпека» → «Запис екрана й системного аудіо», увімкнути OpenBot, а потім завершити роботу OpenBot і відкрити його знову.",
  "error.agent.screenCaptureEmptyWindows":
    "Windows повернула порожнє зображення. Попросіть користувача розблокувати комп’ютер і закрити захищений вміст. Знімки екрана також може забороняти політика організації.",
  "error.agent.screenCaptureFailed": "Не вдалося зробити знімок екрана. Повторіть спробу.",
} as const satisfies PartialTranslation<typeof source>;
