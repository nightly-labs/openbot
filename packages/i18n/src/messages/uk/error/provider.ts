import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/provider";

export const messages = {
  "error.provider.mcpConfig":
    "OpenBot не вдалося зареєструвати сервери MCP у конфігурації Codex. Переконайтеся, що файл config.toml Codex коректний і доступний для запису, потім перезапустіть OpenBot.",
  "error.provider.computerUseConfig":
    "OpenBot не вдалося зареєструвати керування комп’ютером у конфігурації Codex. Переконайтеся, що ваш config.toml для Codex коректний і доступний для запису, потім перезапустіть OpenBot. Щоб продовжити без нього, вимкніть керування комп’ютером у налаштуваннях агента.",
  "error.provider.codexUnresponsive": "Codex перестав відповідати, тому OpenBot завершив його процес.",
  "error.provider.endpointsReadOnly":
    "Збережені ендпоінти записано новішою версією OpenBot, або файл не вдається прочитати. Щоб змінити їх, оновіть OpenBot.",
  "error.provider.endpointNoSecureStorage":
    "На цьому комп’ютері немає захищеного сховища, тому API-ключ або заголовок зберегти не можна. Видаліть їх або використайте ендпоінт без облікових даних.",
  "error.provider.endpointDuplicate":
    "Ендпоінт із таким ID провайдера вже збережено. Спершу видаліть його або використайте інший ID.",
  "error.provider.endpointNotSaved": "Цей ендпоінт не збережено. Оновіть список і спробуйте ще раз.",
  "error.provider.endpointKeyForNewAddress":
    "Адреса має новий хост або порт. Введіть API-ключ і заголовки знову, щоб збережені не потрапили на нього.",
  "error.provider.endpointSecretUnreadable":
    "Цей комп’ютер не може прочитати збережені API-ключ і заголовки. Введіть їх знову, щоб нічого не втратити.",
  "error.provider.discoveryTimeout": "{host} не відповів вчасно.",
  "error.provider.discoveryUnreachable": "OpenBot не вдалося під’єднатися до {host}.",
  "error.provider.discoveryRedirect": "{host} надіслав переспрямування. Введіть кінцеву адресу сервера.",
  "error.provider.discoveryRefused": "{host} відхилив запит. Перевірте API-ключ і заголовки.",
  "error.provider.discoveryHttp": "{host} відповів з HTTP {status}.",
  "error.provider.discoveryTooLarge": "Список моделей від {host} завеликий.",
  "error.provider.discoveryInvalid": "{host} не надіслав список моделей, сумісний з OpenAI.",
  "error.provider.detectionSettingsReadOnly":
    "Налаштування виявлення записано новішою версією OpenBot, або файл не вдається прочитати. Щоб змінити їх, оновіть OpenBot.",
  "error.provider.detectionEntryInvalid":
    "Адреса має бути URL http:// або https:// без пароля, а папка — абсолютним шляхом.",
  "error.provider.detectionEntriesTooMany": "Забагато адрес або папок.",
  "error.provider.credentialFileUnreadable": "Файл облікових даних провайдера не вдається прочитати.",
  "error.provider.credentialFileTooLarge": "Файл облікових даних провайдера завеликий.",
  "error.provider.archiveSpecialFile": "Архів середовища виконання містить посилання або спеціальний файл.",
  "error.provider.archiveUnsafePath": "Архів середовища виконання містить небезпечний шлях.",
  "error.provider.runtimeSpecialFile": "Середовище виконання містить посилання або спеціальний файл.",
  "error.provider.codexArchivePath": "Архів Codex містить неочікуваний шлях.",
  "error.provider.codexVersionUnexpected": "Неочікувана версія середовища виконання Codex.",
  "error.provider.claudeArchivePath": "Архів Claude містить неочікуваний шлях.",
  "error.provider.claudePackageMismatch": "Пакет Claude не відповідає каталогу середовищ виконання.",
  "error.provider.claudeChecksum": "Контрольна сума середовища виконання Claude не збігається.",
  "error.provider.claudeLicenseChecksum": "Контрольна сума ліцензії Claude не збігається.",
  "error.provider.opencodeArchivePath": "Архів OpenCode містить неочікуваний шлях.",
  "error.provider.opencodePackageMismatch": "Пакет OpenCode не відповідає каталогу середовищ виконання.",
  "error.provider.opencodeChecksum": "Контрольна сума середовища виконання OpenCode не збігається.",
  "error.provider.opencodeLicenseChecksum": "Контрольна сума ліцензії OpenCode не збігається.",
  "error.provider.grokChecksum": "Контрольна сума середовища виконання Grok не збігається.",
  "error.provider.grokLicenseChecksum": "Контрольна сума ліцензії Grok не збігається.",
  "error.provider.grokNoticesChecksum": "Контрольна сума повідомлень Grok не збігається.",
  "error.provider.bunArchivePath": "Архів Bun містить неочікуваний шлях.",
  "error.provider.bunPackageMismatch": "Пакет Bun не відповідає каталогу середовищ виконання.",
  "error.provider.bunChecksum": "Контрольна сума середовища виконання Bun не збігається.",
  "error.provider.bunLicenseChecksum": "Контрольна сума ліцензії Bun не збігається.",
  "error.provider.bunxDamaged": "Засіб запуску менеджера пакетів Bun відсутній або пошкоджений.",
  "error.provider.releaseSourcesUnreachable":
    "OpenBot не вдалося зв’язатися з джерелами випусків провайдерів. Перевірте з’єднання і спробуйте ще раз.",
  "error.provider.runtimesUnsupported": "Середовища виконання провайдерів недоступні на цій платформі.",
  "error.provider.closing": "OpenBot закривається.",
  "error.provider.removeWhileOn": "Вимкніть провайдера, перш ніж видаляти його завантаження.",
  "error.provider.removeWhileDownloading": "Дочекайтеся завершення завантаження, потім видаліть його.",
  "error.provider.removeIncomplete": "Програма використовує файли цього CLI. Закрийте її і спробуйте ще раз.",
  "error.provider.cliOverride": "Видаліть явно заданий шлях до CLI, перш ніж оновлювати в OpenBot.",
  "error.provider.runtimeUpdateIncomplete": "Оновлення середовища виконання не завершено.",
  "error.provider.downloadHttp": "Завантаження середовища виконання не вдалося: HTTP {status}.",
  "error.provider.downloadNoData": "Завантаження середовища виконання не повернуло даних.",
  "error.provider.downloadSize": "Завантажене середовище виконання має неочікуваний розмір.",
  "error.provider.downloadIntegrity": "Завантажене середовище виконання не пройшло перевірку цілісності.",
  "error.provider.runtimeReplacing": "Не вдалося встановити середовище виконання, бо інший екземпляр замінює його.",
  "error.provider.runtimeFilesInUse":
    "Не вдалося встановити середовище виконання, бо інша програма тримає його файли відкритими. Закрийте її і спробуйте ще раз.",
  "error.provider.metadataHttp": "Завантаження метаданих середовища виконання не вдалося: HTTP {status}.",
  "error.provider.metadataIntegrity": "Метадані середовища виконання не пройшли перевірку цілісності.",
  "error.provider.diskSpace": "Для цього провайдера недостатньо вільного місця на диску.",
  "error.provider.unexpectedVersion": "Середовище виконання провайдера повернуло неочікувану версію.",
  "error.provider.metadataNoData": "Завантаження метаданих середовища виконання не повернуло даних.",
  "error.provider.metadataTooLarge": "Метадані середовища виконання завеликі.",
  "error.provider.requestFailed": "OpenBot не вдалося завантажити {url}. {reason}",
  "error.provider.installRecordMismatch": "Запис про встановлення середовища виконання не збігається.",
  "error.provider.runtimeChecksum": "Контрольна сума середовища виконання провайдера не збігається.",
  "error.provider.codexReleaseShape": "Випуск Codex має неочікувану структуру.",
  "error.provider.codexReleaseNoDownload": "Випуск Codex не має перевірюваного завантаження для цього комп’ютера.",
  "error.provider.claudeReleaseShape": "Випуск Claude має неочікувану структуру.",
  "error.provider.grokReleaseVersion": "Випуск Grok має неочікувану версію.",
  "error.provider.blockedListShape": "Список заблокованих версій має неочікувану структуру.",
  "error.provider.releaseNoDownload": "Випуск {name} не має перевірюваного завантаження.",
  "error.provider.releaseSizeUnknown": "Розмір завантаження випуску невідомий.",
  "error.provider.releaseMetadataNotObject": "Метадані випуску — не об’єкт JSON.",
  "error.provider.releaseCheckHttp": "Перевірка випуску не вдалася: HTTP {status}.",
  "error.provider.releaseMetadataTooLarge": "Метадані випуску завеликі.",
  "error.provider.idInvalid": "ID провайдера має складатися з малих літер, цифр, `-` або `_`.",
  "error.provider.baseUrlInvalid": "Базовий URL — не URL.",
  "error.provider.baseUrlProtocol": "Базовий URL має починатися з http:// або https://.",
  "error.provider.baseUrlCredentials":
    "Базовий URL не має містити імені користувача або пароля. Передайте облікові дані в заголовку.",
  "error.provider.modelsRequired": "Потрібна принаймні одна модель.",
  "error.provider.modelsTooMany": "Забагато моделей.",
  "error.provider.modelIdCharacter": "ID моделі містить неприпустимий символ.",
  "error.provider.modelIdDuplicate": "Дві моделі мають однаковий ID.",
  "error.provider.headersTooMany": "Забагато заголовків.",
  "error.provider.headerNameCharacter": "Назва заголовка містить символ, неприпустимий у HTTP.",
  "error.provider.headerNameTooLong": "Назва заголовка задовга.",
  "error.provider.headerNameDuplicate": "Два заголовки мають однакову назву.",
  "error.provider.headerValueInvalid": "Значення заголовка відсутнє або задовге.",
  "error.provider.headerValueMissing": "Введіть значення заголовка {name}.",
  "error.provider.apiKeyTooLong": "API-ключ задовгий.",
  "error.provider.localOnly": "Провайдерів можна змінити лише на комп’ютері, де працюють агенти.",
  "error.provider.keyRequired": "Потрібен ключ провайдера.",
  "error.provider.keyTooLong": "Ключ провайдера задовгий.",
  "error.provider.keyInvalidCharacters": "Ключ провайдера містить пробіл або символ, якого не може бути в ключі.",
  "error.provider.noModel": "Вибраний провайдер не має доступної моделі.",
  "error.provider.noModelNamed": "{provider} не має доступної моделі.",
  "error.provider.acpNoModels":
    "ACP CLI не повідомив жодної моделі ACP. OpenBot не добиратиме запасну модель навмання.",
  "error.provider.endpointRemoveBusy":
    "Дочекайтеся завершення поточного ходу та черги, перш ніж видаляти цей ендпоінт.",
  "error.provider.codexOutdated": "Codex CLI {version} застарий. OpenBot потребує версії 0.156.0 або новішої.",
  "error.provider.codexNotStarted": "Codex CLI знайдено, але запустити його не вдалося.",
  "error.provider.codexNotStartedHint":
    "Codex CLI знайдено, але запустити його не вдалося. Виконайте `codex --version` у новому терміналі.",
  "error.provider.codexManagedNotStarted":
    "ChatGPT завантажено, але запустити його не вдалося. Завантажте його знову в OpenBot.",
  "error.provider.codexMissing": "ChatGPT не завантажено. Завантажте його в OpenBot, щоб продовжити.",
  "error.provider.codexConfigIgnored": {
    one: "Codex проігнорував {count} налаштування у своїй конфігурації: {settings}. Виправте або видаліть його чи оновіть Codex.",
    few: "Codex проігнорував {count} налаштування у своїй конфігурації: {settings}. Виправте або видаліть їх чи оновіть Codex.",
    many: "Codex проігнорував {count} налаштувань у своїй конфігурації: {settings}. Виправте або видаліть їх чи оновіть Codex.",
    other:
      "Codex проігнорував {count} налаштування у своїй конфігурації: {settings}. Виправте або видаліть їх чи оновіть Codex.",
  },
  "error.provider.codexConfigIgnoredUnnamed": {
    one: "Codex проігнорував {count} налаштування у своїй конфігурації. Виправте або видаліть його чи оновіть Codex.",
    few: "Codex проігнорував {count} налаштування у своїй конфігурації. Виправте або видаліть їх чи оновіть Codex.",
    many: "Codex проігнорував {count} налаштувань у своїй конфігурації. Виправте або видаліть їх чи оновіть Codex.",
    other: "Codex проігнорував {count} налаштування у своїй конфігурації. Виправте або видаліть їх чи оновіть Codex.",
  },
  "error.provider.claudeOutdated": "Claude Code {version} застарий. OpenBot потребує версії 2.1.232 або новішої.",
  "error.provider.claudeNotStarted": "Claude CLI знайдено, але запустити його не вдалося.",
  "error.provider.claudeNotStartedHint":
    "Claude CLI знайдено, але запустити його не вдалося. Виконайте `claude --version` у новому терміналі.",
  "error.provider.claudeManagedNotStarted":
    "Claude завантажено, але запустити його не вдалося. Завантажте його знову в OpenBot.",
  "error.provider.claudeMissing": "Claude не завантажено. Завантажте його в OpenBot, щоб продовжити.",
  "error.provider.grokOutdated": "Grok CLI {version} застарий. OpenBot потребує версії 1.0.5 або новішої.",
  "error.provider.grokNotStarted": "Grok CLI знайдено, але запустити його не вдалося.",
  "error.provider.grokNotStartedHint":
    "Grok CLI знайдено, але запустити його не вдалося. Виконайте `grok --version` у новому терміналі.",
  "error.provider.grokMissing": "Grok не завантажено. Завантажте його в OpenBot, щоб продовжити.",
  "error.provider.opencodeNotStarted": "OpenCode не вдалося запустити. Виконайте `opencode --version` у терміналі.",
  "error.provider.opencodeMissing": "OpenCode не завантажено. Завантажте його в OpenBot, щоб продовжити.",
  "error.provider.codexVersionUnreadable": "Не вдалося прочитати версію Codex CLI.",
  "error.provider.claudeVersionUnreadable": "Не вдалося прочитати версію Claude CLI.",
  "error.provider.grokVersionUnreadable": "Не вдалося прочитати версію Grok CLI.",
  "error.provider.opencodeVersionUnreadable": "Не вдалося прочитати версію OpenCode CLI.",
  "error.provider.bunVersionUnreadable": "Не вдалося прочитати версію середовища виконання Bun.",
  "error.provider.connectBeforeProfile": "Під’єднайте вибраного провайдера, перш ніж створювати профіль.",
  "error.provider.cliNotReady": "{provider} CLI не готовий або в ньому не виконано вхід.",
  "error.provider.cliTimedOut": "{provider} не відповів вчасно. Можливо, комп’ютер зайнятий. OpenBot спробує ще раз.",
  "error.provider.cliTimedOutRefresh":
    "{provider} не відповів вчасно. Можливо, комп’ютер зайнятий. Оновіть провайдерів, щоб спробувати ще раз.",
  "error.provider.acpStartTimedOut": "{provider} не завершив запуск за {seconds} с. Можливо, комп’ютер зайнятий.",
  "error.provider.acpModelsTimedOut": "{provider} не вивів список моделей за {seconds} с. Можливо, комп’ютер зайнятий.",
  "error.provider.startStopped":
    "{provider} кілька разів поспіль не запустився, тому OpenBot припинив спроби. Оновіть провайдерів, щоб спробувати ще раз.",
  "error.provider.tempDiskSpace":
    "Для запуску {provider} потрібно щонайменше 1 ГБ вільного місця на диску. Звільніть місце, потім оновіть провайдерів.",
  "error.provider.noCodeSignIn": "У {provider} не можна увійти за допомогою коду.",
  "error.provider.codeLoginNoLink": "Провайдер не показав посилання для входу. Спробуйте ще раз.",
  "error.provider.hostSignInEnded": "Вхід у {provider} не завершено. Спробуйте ще раз.",
  "error.provider.codeLoginNotWaiting": "Жоден вхід не очікує коду. Почніть вхід знову.",
  "error.provider.codeLoginBadCode": "Вставте код, який показує сторінка входу.",
  "error.provider.codeLoginRefused": "Провайдер не прийняв код. Почніть вхід знову.",
  "error.provider.codeLoginUnsupported":
    "Цей сервер не підтримує вхід за вставленим кодом. Увійдіть на комп’ютері сервера в його браузері.",
  "error.provider.cliBusyRetry": "{provider} CLI обробляє хід. Дочекайтеся його завершення і спробуйте ще раз.",
  "error.provider.cliSigningIn": "{provider} CLI виконує вхід. Завершіть або скасуйте вхід, потім оновіть.",
  "error.provider.cliBusyUpdate": "{provider} CLI обробляє хід. Дочекайтеся його завершення, потім оновіть.",
  "error.provider.cliSelectFailed": "OpenBot не вдалося вибрати встановлений керований CLI.",
  "error.provider.noAuthenticatedAccount": "{provider} не повернув обліковий запис, у який виконано вхід.",
  "error.provider.signInExpired": "Термін дії входу в {provider} минув. Увійдіть знову, щоб продовжити.",
  "error.provider.cliActivateFailed": "OpenBot не вдалося активувати керований CLI.",
  "error.provider.cliBusyReconnect":
    "{provider} CLI обробляє хід. Дочекайтеся його завершення, потім під’єднайтеся знову.",
  "error.provider.opencodeCredentialsRejected":
    "Провайдер моделей відхилив API-ключ. Виправте ключ OpenCode у налаштуваннях або ключ провайдера командою `opencode auth login`. Потім спробуйте ще раз або виберіть іншу модель.\n{detail}",
  "error.provider.opencodeAuthRequired":
    "OpenCode не виконав вхід у провайдера моделі «{provider}». Виберіть модель із позначкою «Безкоштовно» або під’єднайте провайдера: вставте ключ OpenCode Go у налаштуваннях OpenCode або виконайте `opencode auth login` у терміналі. Потім спробуйте ще раз.",
  "error.provider.opencodeAuthRequiredUnknown":
    "OpenCode не виконав вхід у провайдера цієї моделі. Виберіть модель із позначкою «Безкоштовно» або під’єднайте провайдера: вставте ключ OpenCode Go у налаштуваннях OpenCode або виконайте `opencode auth login` у терміналі. Потім спробуйте ще раз.",
  "error.provider.opencodeKeyExpired":
    "Термін дії API-ключа OpenCode минув. Створіть новий ключ в OpenCode Console, вставте його в налаштуваннях OpenCode, потім спробуйте ще раз.",
  "error.provider.opencodeServiceFailure":
    "OpenCode не зміг завершити цей хід через збій локальної служби. Спробуйте ще раз. Якщо помилка повторюється, під’єднайте OpenCode знову в налаштуваннях.",
  "error.provider.opencodeRateLimited":
    "Провайдер моделей відхилив запит через обмеження частоти. Зачекайте кілька хвилин або виберіть іншу модель і спробуйте ще раз.\n{detail}",
  "error.provider.opencodeBilling":
    "Провайдер моделей відхилив запит через оплату облікового запису. Очікування не допоможе. Додайте спосіб оплати або кошти в обліковому записі провайдера чи виберіть іншу модель.\n{detail}",
  "error.provider.opencodeInvalidUpload":
    "Провайдер моделей OpenCode повідомив про некоректний запит на вивантаження. Виберіть іншу модель і продовжуйте. Перевірте збережені регулярні завдання, перш ніж створювати їх знову.\n{detail}",
  "error.provider.opencodeUnreadableContent":
    "Ця модель не може прочитати файл або зображення в цьому чаті. Виберіть модель, яка читає файли, потім надішліть повідомлення ще раз.",
  "error.provider.opencodeFreeLimit":
    "Безкоштовні моделі OpenCode вичерпали ліміт використання. Цей ліміт спільний для всіх безкоштовних моделей. Щоб продовжити, вставте ключ OpenCode Go у налаштуваннях OpenCode або виберіть модель іншого провайдера.",
  "error.provider.opencodeProviderFailed":
    "У провайдера моделей стався збій на його боці. Справа не у вашому з’єднанні. Спробуйте пізніше або виберіть іншу модель.\n{detail}",
  "error.provider.opencodeNetwork":
    "OpenCode не вдалося під’єднатися до провайдера моделей. Перевірте мережеве з’єднання комп’ютера, де працює OpenBot, і спробуйте ще раз.\n{detail}",
  "error.provider.opencodeDatabaseNewer":
    "OpenCode не вдалося відкрити свою базу даних, бо її змінила новіша версія OpenCode. Оновіть OpenCode до версії 2 або новішої і спробуйте ще раз.",
  "error.provider.opencodeNoAnswer":
    "Модель OpenCode завершила хід без відповіді. Спробуйте ще раз або виберіть іншу модель.",
  "error.provider.opencodeReasoningWithoutAnswer":
    "Модель OpenCode завершила хід після міркувань, без відповіді. Спробуйте ще раз або виберіть іншу модель.",
  "error.provider.chatgptPageFailed": "OpenBot не вдалося відкрити сторінку під’єднання ChatGPT.",
  "error.provider.noneReady": "Жоден провайдер агентів не готовий.",
  "error.provider.claudeTurnActive": "Дочекайтеся завершення поточного ходу Claude, перш ніж оновлювати його контекст.",
  "error.provider.codexLoginRequired": "Codex потребує входу з підпискою ChatGPT. Виконайте `codex login`.",
  "error.provider.cliUpdateFailed": "OpenBot не вдалося оновити {provider} CLI. {reason}",
  "error.provider.tryAgain": "Спробуйте ще раз.",
  "error.provider.noAgentProcess": "{provider} не має запущеного процесу для цього агента.",
  "error.provider.stoppedBeforeAgentProcess": "{provider} зупинився до запуску процесу агента.",
  "error.provider.archiveUnreadable":
    "Архів середовища виконання не вдається прочитати, або він має непідтримуваний формат.",
  "error.provider.antigravityArchivePath": "Архів Gemini містить неочікуваний файл.",
  "error.provider.antigravityChecksum": "Контрольна сума середовища виконання Gemini не збігається.",
  "error.provider.antigravityReleaseShape": "Випуск Gemini має неочікувану структуру.",
  "error.provider.antigravityMissing": "Gemini не завантажено. Завантажте його в OpenBot, щоб продовжити.",
  "error.provider.antigravityNotStarted": "Сервер Gemini знайдено, але його версію не вдається прочитати.",
  "error.provider.antigravityVersionUnreadable": "Не вдалося прочитати версію сервера Gemini.",
  "error.provider.antigravitySignIn": "Увійдіть через Google, щоб використовувати Gemini.",
  "error.provider.antigravityRateLimited":
    "Gemini відхилив запит: досягнуто ліміту частоти запитів або квоти тарифу. Зачекайте кілька хвилин або виберіть іншу модель і спробуйте ще раз.\n{detail}",
  "error.provider.antigravityQuotaReached":
    "Google повідомляє, що досягнуто ліміту використання Gemini. Ліміт може стосуватися однієї моделі, тому на сторінці використання вашого тарифу може бути показано залишок. Виберіть іншу модель Gemini або дочекайтеся скидання.\n{detail}",
  "error.provider.antigravityModelUnavailable":
    "Gemini зараз не може використовувати цю модель. Виберіть іншу модель і спробуйте ще раз.\n{detail}",
  "error.provider.antigravityServiceFailure":
    "Сервіс Gemini від Google не виконав запит. Спробуйте ще раз за кілька хвилин.\n{detail}",
  "error.provider.cursorArchivePath": "Архів Cursor містить неочікуваний файл.",
  "error.provider.cursorChecksum": "Контрольна сума середовища виконання Cursor не збігається.",
  "error.provider.cursorReleaseShape": "Випуск Cursor має неочікувану структуру.",
  "error.provider.cursorMissing": "Cursor не завантажено. Завантажте його в OpenBot, щоб продовжити.",
  "error.provider.cursorNotStarted": "Агента Cursor знайдено, але його версію не вдається прочитати.",
  "error.provider.cursorVersionUnreadable": "Не вдалося прочитати версію агента Cursor.",
  "error.provider.cursorSignIn": "Увійдіть через Cursor або задайте CURSOR_API_KEY, щоб використовувати Cursor.",
  "error.provider.clineArchivePath": "Архів Cline містить неочікуваний шлях.",
  "error.provider.clinePackageMismatch": "Пакет Cline не відповідає каталогу середовищ виконання.",
  "error.provider.clineChecksum": "Контрольна сума середовища виконання Cline не збігається.",
  "error.provider.clineLicenseChecksum": "Контрольна сума ліцензії Cline не збігається.",
  "error.provider.clineMissing": "Cline не завантажено. Завантажте його в OpenBot, щоб продовжити.",
  "error.provider.clineOutdated": "Cline CLI {version} застарий. OpenBot потребує версії 3.0.68 або новішої.",
  "error.provider.clineNotStarted": "Cline не вдалося запустити. Виконайте `cline --version` у терміналі.",
  "error.provider.clineVersionUnreadable": "Не вдалося прочитати версію Cline CLI.",
  "error.provider.clineSignIn": "Увійдіть через Cline або задайте CLINE_API_KEY, щоб використовувати Cline.",
  "error.provider.usageLimitReached": "Обліковий запис досяг ліміту використання.",
  "error.provider.foreignReasoning":
    "{provider} не прийняв попередні міркування в цьому чаті, бо їх отримав інший обліковий запис або API-ключ. OpenBot почав новий сеанс {provider} з історією чату. Спробуйте ще раз.",
  "error.provider.opencodeSessionRejected":
    "OpenCode відхилив запит і не вказав причину. Таке може статися в довгому чаті або після зміни моделі. OpenBot почав новий сеанс OpenCode з історією чату. Спробуйте ще раз. Якщо помилка не зникне, виберіть іншу модель або нижчий рівень зусиль.",
  "error.provider.museMcpStartupFault":
    "Muse не вдалося запустити сервер MCP, і він заблокував MCP у цьому сеансі. OpenBot почав новий сеанс Muse з історією чату. Спробуйте ще раз. Якщо помилка повторюється, вимкніть Керування комп’ютером або несправний сервер MCP для цього агента.",
  "error.provider.grokSignIn": "Виконайте `grok login` або задайте XAI_API_KEY, щоб використовувати Grok.",
  "error.provider.acpSignInTimedOut": "Час входу вичерпано.",
  "error.provider.acpSignInStopped": "Вхід перервався, не завершившись.",
  "error.provider.geminiBrowserUnavailable":
    "Gemini не вдалося відкрити сторінку входу. Установіть браузер і xdg-utils, потім під’єднайтеся із сеансу робочого стола на цьому хості. Сервер без робочого стола не може завершити цей вхід.",
  "error.provider.acpSignInFailed": "Вхід не завершено.",
  "error.provider.acpSignInFailedReason": "Вхід не завершено: {reason}",
  "error.provider.acpSignInMethodMissing":
    "Цей провайдер не пропонує такого входу на цьому комп’ютері. Оновіть провайдера і спробуйте ще раз.",
  "error.provider.httpsSignInLinkOnly": "У браузері можна відкривати лише посилання для входу через HTTPS.",
  "error.provider.geminiKeyRefused":
    "Gemini відхилив збережений ключ API. Замініть або видаліть ключ у налаштуваннях, потім під’єднайтеся знову.",
  "error.provider.keyProviderRefused":
    "{provider} відхилив збережений ключ API. Замініть або видаліть ключ у налаштуваннях, потім спробуйте ще раз.",
  "error.provider.keyProviderNoBalance":
    "Обліковий запис {provider} для збереженого ключа API не має коштів. Поповніть баланс облікового запису, потім спробуйте ще раз.",
  "error.provider.messageTooLarge": "OpenBot зупинив {provider}, бо він надіслав повідомлення більше за {limit} МБ.",
  "error.provider.customAgentIdInvalid":
    "ID агента має складатися з малих літер, цифр або `-` і не може збігатися з ID вбудованого провайдера.",
  "error.provider.customAgentEnvInvalid":
    "Назва змінної має складатися з літер, цифр або `_` і не починатися з цифри. Використовуйте кожну назву один раз, загалом не більше 16 назв.",
  "error.provider.customAgentUsagePromptInvalid":
    "Команда використання має бути одним рядком не довшим за 256 символів.",
  "error.provider.customAgentCommandInvalid":
    "Команда має бути повним шляхом, шляхом, що починається з ~/, або назвою команди без пробілів.",
  "error.provider.customAgentArgsInvalid":
    "Аргумент не може містити розрив рядка. Використовуйте не більше 32 аргументів.",
  "error.provider.customAgentWindowsScript":
    "В аргументах команди .cmd або .bat дозволено лише літери, цифри та символи - _ . , : = @ + / \\.",
  "error.provider.customAgentNotFound": "OpenBot не може знайти {command}. Введіть повний шлях до команди.",
  "error.provider.customAgentCheckTimedOut": "Агент не відповів за 20 секунд.",
  "error.provider.customAgentCheckStopped": "Агент зупинився, не відповівши.",
  "error.provider.customAgentProtocolVersion":
    "Агент використовує ACP версії {version}. OpenBot використовує версію 1.",
  "error.provider.customAgentCheckFailed": "Агент не відповів як агент ACP.",
  "error.provider.customAgentRemoveBusy":
    "Дочекайтеся завершення поточного ходу та черги, перш ніж видаляти цього власного агента.",
  "error.provider.customAgentNone": "Немає збережених власних агентів.",
  "error.provider.customAgentMissing": "Цей власний агент зараз не збережений. Виберіть іншу модель.",
  "error.provider.customAgentSignIn": "Увійдіть за допомогою команди самого агента і спробуйте ще раз.",
  "error.provider.customAgentsReadOnly":
    "Збережених власних агентів записано новішою версією OpenBot, або файл не вдається прочитати. Щоб змінити їх, оновіть OpenBot.",
  "error.provider.customAgentNoSecureStorage":
    "На цьому комп’ютері немає захищеного сховища, тому значення середовища зберегти не можна. Видаліть їх і спробуйте ще раз.",
  "error.provider.customAgentNotSaved": "Цей власний агент не збережений. Оновіть список і спробуйте ще раз.",
  "error.provider.customAgentTooMany": "Можна зберегти не більше {count} власних агентів.",
  "error.provider.customAgentEnvValueMissing": "Введіть значення для {name}.",
  "error.provider.off": "{provider} вимкнено в OpenBot. Спершу ввімкніть його в налаштуваннях провайдерів.",
  "error.provider.inUse": "{provider} використовує агент. Змініть його модель, перш ніж вимикати цього провайдера.",
  "error.provider.useBusy": "Дочекайтеся завершення перевірки провайдера або входу і спробуйте ще раз.",
  "error.provider.useSettingsReadOnly":
    "Не вдається прочитати збережені налаштування провайдерів. Оновіть OpenBot, перш ніж їх змінювати.",
  "error.provider.useChangeFailed": "OpenBot не вдалося змінити налаштування провайдера.",
  "error.provider.accountsUnsupported": "{provider} підтримує лише один обліковий запис.",
  "error.provider.accountNeedsConnection": "Під’єднайте {provider}, перш ніж додавати ще один обліковий запис.",
  "error.provider.usageResetUnsupported": "{provider} не може скидати ліміти використання.",
  "error.provider.usageResetNotConnected":
    "Знову увійдіть у цей обліковий запис {provider}, перш ніж скидати його використання.",
  "error.provider.accountLimit": "Максимум облікових записів {provider}: {limit}.",
  "error.provider.accountNotFound":
    "Цього облікового запису {provider} немає на цьому комп’ютері. Оновіть список і спробуйте ще раз.",
  "error.provider.accountAlreadyAdded": "Цей обліковий запис {provider} уже під’єднано.",
  "error.provider.accountDefault": "Перший обліковий запис {provider} не можна видалити.",
  "error.provider.accountUsesKey":
    "Цей обліковий запис {provider} використовує збережений API-ключ і не має входу. Змініть ключ у розділі «Налаштування сервера» → «Провайдери».",
  "error.provider.accountInUse":
    "Агент із цим обліковим записом зараз працює. Спробуйте ще раз, коли агент зупиниться.",
  "error.provider.accountsReadOnly":
    "Не вдається прочитати збережені облікові записи провайдерів. Оновіть OpenBot, перш ніж їх змінювати.",
  "error.provider.accountSignedOut": "Виконано вихід з облікового запису {provider}. Увійдіть знову.",
  "error.provider.sessionSettingUnavailable": "Цей параметр недоступний у поточному сеансі провайдера.",
  "error.provider.sessionSettingInvalid": "Це значення недоступне для параметра.",
  "error.provider.sessionSettingsBusy": "Дочекайтеся завершення поточного ходу, перш ніж змінювати параметр сеансу.",
  "error.provider.piOutdated":
    "Pi {version} застарий. Установіть Pi 1.1.0 або новішу версію для підтримки нативного RPC і MCP.",
  "error.provider.nativeMissing": "CLI {provider} не встановлено. Завантажте його в налаштуваннях.",
  "error.provider.nativeNotStarted": "Не вдалося запустити CLI {provider}.",
  "error.provider.nativeVersionUnreadable": "Не вдалося прочитати версію CLI {provider}.",
  "error.provider.piSessionBusy": "Дочекайтеся завершення поточного ходу Pi.",
  "error.provider.piStopped": "Pi не запущено. Під’єднайте Pi і спробуйте ще раз.",
  "error.provider.piSessionMissing": "Файл сеансу Pi недоступний на цьому комп’ютері.",
  "error.provider.piResumeCancelled": "Pi скасував відновлення сеансу. Спробуйте ще раз.",
  "error.provider.piSessionIdentity": "Pi повернув інший сеанс. Збережений сеанс не замінено.",
  "error.provider.piModelInvalid": "Виберіть модель Pi із зазначенням її провайдера.",
  "error.provider.piToolInvalid": "Інструмент повернув некоректний результат.",
  "error.provider.piSignIn": "Виконайте /login у Pi на комп’ютері-хості. Закрийте Pi, коли вхід завершиться.",
  "error.provider.museBusy": "Сеанс Muse зайнятий.",
  "error.provider.museStopped": "Клієнт Muse не запущено.",
  "error.provider.museUnexpectedProvider": "Muse повернув неочікуваного провайдера моделі.",
  "error.provider.museNoActiveTurn": "Muse не має активного ходу, який можна скерувати.",
  "error.provider.museInvalidProtocol": "Muse повернув некоректну відповідь протоколу.",
  "error.provider.museNotStarted": "Muse не запустився.",
  "error.provider.museNativeWindows": "У Windows для Muse потрібен нативний виконуваний файл.",
  "error.provider.museStartTimeout": "Час ініціалізації Muse вичерпано.",
  "error.provider.museStartStopped": "Muse зупинився під час ініціалізації.",
  "error.provider.museProtocolVersion": "Непідтримувана версія протоколу Muse.",
  "error.provider.museHistoryRequired": "Muse має зберігати історію сеансу.",
  "error.provider.museRequestUnsupported": "Непідтримуваний запит сервера Muse.",
  "error.provider.museConnectionFailed":
    "Не вдалося під’єднатися до Muse. Відновіть розмову, щоб повернути її збережену історію.",
  "error.provider.museUnknownSession": "Невідомий сеанс Muse.",
  "error.provider.museInvalidToolResult": "Некоректний результат інструмента OpenBot.",
  "error.provider.museMcpRequired": "Muse має підтримувати сервери MCP для сеансу.",
  "error.provider.museSessionMismatch": "Muse повернув інший сеанс.",
  "error.provider.museCompactRejected": "Muse не прийняв стиснення контексту.",
  "error.provider.museTurnMismatch": "Muse повернув інший хід.",
  "error.provider.museHistoryMismatch": "В історії Muse змішалися дані різних сеансів.",
  "error.provider.museRecoveryFailed": "Muse не вдалося відновити пропущені події.",
  "error.provider.museHistoryStalled": "Курсор історії Muse не просунувся.",
  "error.provider.museApprovalUnavailable": "Muse не запропонував такої відповіді на підтвердження.",
  "error.provider.museHistoryOwner": "Історія Muse належить іншому сеансу.",
  "error.provider.museHistoryMissing": "Muse не повернув історію сеансу.",
  "error.provider.museEmptyInput": "Muse потрібен текст або зображення.",
  "error.provider.museMethodUnsupported": "Muse не підтримує {method}.",
  "error.provider.museTurnFailed": "Хід Muse не вдався.",
  "error.provider.museProfileUnsupported":
    "Muse не може створити профіль без доступу до зовнішніх інструментів. Створіть профіль з іншим провайдером, потім виберіть Muse для агента.",
  "error.provider.museAuthUnverified":
    "Автентифікацію Muse не підтверджено. Під’єднайтеся на комп’ютері-хості або задайте ключ API Meta.",
  "error.provider.museSignIn": "Щоб продовжити, увійдіть у Muse на комп’ютері-хості.",
  "error.provider.inceptionSignIn": "Щоб продовжити, додайте ключ API Inception.",
  "error.provider.deepseekSignIn": "Додайте ключ API DeepSeek, щоб продовжити.",
  "error.provider.openrouterSignIn": "Додайте ключ API OpenRouter, щоб продовжити.",
  "error.provider.terminalLoginFailed":
    "Не вдалося відкрити термінал для входу. Відкрийте CLI провайдера на цьому хості, увійдіть там, потім оновіть список провайдерів.",
  "error.provider.nativeArchiveInvalid": "Завантажений файл провайдера не містить коректного встановлення.",
  "error.provider.nativeChecksum": "Встановлення провайдера не пройшло перевірку цілісності.",
  "error.provider.registryUnavailable": "Реєстр ACP недоступний. Спробуйте ще раз.",
  "error.provider.registryInvalid": "Реєстр ACP повернув некоректні дані.",
  "error.provider.registryMissing": "Цього агента немає в реєстрі ACP.",
  "error.provider.registryBusy": "Для цього агента вже триває встановлення.",
  "error.provider.registryCancelled": "Встановлення агента скасовано.",
  "error.provider.registryPrerequisite": "Установіть {tool} на хост, перш ніж встановлювати цього агента.",
  "error.provider.registryBindingChanged": "Користувацький агент змінився під час встановлення. Спробуйте ще раз.",
  "error.provider.registryInstallFailed": "Не вдалося встановити агента. Попереднє встановлення не змінено.",
  "error.provider.registryRemoveBusy":
    "Дочекайтеся завершення встановлення агента та активної роботи ACP, перш ніж видаляти його.",
} as const satisfies PartialTranslation<typeof source>;
