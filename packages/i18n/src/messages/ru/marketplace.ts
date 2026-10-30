import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/marketplace";

export const messages = {
  "marketplace.category.coding": "Программирование",
  "marketplace.category.design": "Дизайн",
  "marketplace.category.dataAnalytics": "Данные и аналитика",
  "marketplace.category.documents": "Документы",
  "marketplace.category.productivity": "Продуктивность",
  "marketplace.category.research": "Исследования",
  "marketplace.category.automation": "Автоматизация",
  "marketplace.category.other": "Другое",
  "marketplace.loadFailed": "Не удалось загрузить каталог.",
  "marketplace.loading.skills": "Загрузка навыков",
  "marketplace.loading.agents": "Загрузка агентов",
  "marketplace.noMatch.skills": "Навыков по этому запросу не найдено.",
  "marketplace.noMatch.agents": "Агентов по этому запросу не найдено.",
  "marketplace.loadMore": "Загрузить ещё",
  "marketplace.version": "Версия {version}",

  "marketplace.title": "Каталог",
  "marketplace.kinds": "Типы содержимого каталога",
  "marketplace.tab.agents": "Агенты",
  "marketplace.tab.skills": "Навыки",
  "marketplace.description.apps": "Подключите инструменты и сервисы, с которыми работают ваши агенты.",
  "marketplace.description.agents": "Готовые агенты со своими инструкциями и навыками.",
  "marketplace.description.skills": "Инструкции, которые учат агента задаче или инструменту.",

  "marketplace.plugins.missing": "Этого плагина нет в каталоге OpenBot.",

  "marketplace.agents.loadingDetail": "Загрузка сведений об агенте…",
  "marketplace.agents.skills": "Навыки",
  "marketplace.agents.routines": "Регулярные задачи",
  "marketplace.agents.routineActive": "Активна",
  "marketplace.agents.routineInactive": "Неактивна",

  "marketplace.skill.loading": "Загрузка навыка",
  "marketplace.try.readFailed": "OpenBot не удалось прочитать навыки этого агента. Повторите попытку.",
  "marketplace.try.enable": "Чтобы попробовать этот навык, включите его в настройках агента.",
  "marketplace.try.repair": "Чтобы попробовать этот навык, восстановите его в настройках агента.",
  "marketplace.try.update": "Чтобы попробовать эту версию, обновите навык.",
  "marketplace.try.composerUnavailable": "Поле ввода агента недоступно.",

  "marketplace.open": "Открыть: {name}",
  "marketplace.tab.apps": "Приложения",
  "marketplace.crumbs.label": "Расположение",
  "marketplace.search.label": "Поиск по каталогу",
  "marketplace.search.placeholder": "Поиск",
  "marketplace.installs": {
    one: "{installs} установка",
    few: "{installs} установки",
    many: "{installs} установок",
    other: "{installs} установки",
  },
  "marketplace.filter": "Фильтр",
  "marketplace.filter.on": "Фильтр: {filters}",
  "marketplace.filter.all": "Все",
  "marketplace.filter.status": "Статус",
  "marketplace.filter.category": "Категория",
  "marketplace.filter.added": "Добавлены",
  "marketplace.filter.notAdded": "Не добавлены",
  "marketplace.filter.clear": "Сбросить фильтры",
  "marketplace.noMatch.apps": "Приложений по этому запросу не найдено.",
  "marketplace.noMatch.filters": "Ничего не подходит под фильтры.",
  "marketplace.noMatch.showAgents": {
    one: "Показать {count} агента",
    few: "Показать {count} агента",
    many: "Показать {count} агентов",
    other: "Показать {count} агента",
  },
  "marketplace.noMatch.showApps": {
    one: "Показать {count} приложение",
    few: "Показать {count} приложения",
    many: "Показать {count} приложений",
    other: "Показать {count} приложения",
  },
  "marketplace.noMatch.showSkills": {
    one: "Показать {count} навык",
    few: "Показать {count} навыка",
    many: "Показать {count} навыков",
    other: "Показать {count} навыка",
  },
  "marketplace.empty.agents": "В каталоге пока нет агентов.",
  "marketplace.empty.apps": "В каталоге пока нет приложений.",
  "marketplace.empty.skills": "В каталоге пока нет навыков.",
  "marketplace.properties.agent": "Об этом агенте",
  "marketplace.properties.creator": "Автор",
  "marketplace.properties.category": "Категория",
  "marketplace.properties.version": "Версия",
  "marketplace.properties.updated": "Обновлено",
  "marketplace.properties.installs": "Установки",

  "marketplace.agent.add": "Добавить",
  "marketplace.agent.addNamed": "Добавить: {name}",
  "marketplace.agent.addAgent": "Добавить агента",
  "marketplace.agent.added": "Добавлен",
  "marketplace.agent.updateAvailable": "Доступно обновление",
  "marketplace.agent.update": "Обновить",
  "marketplace.agent.openChat": "Открыть чат",

  "marketplace.app.connect": "Подключить",
  "marketplace.app.reconnect": "Переподключить",
  "marketplace.app.connectNamed": "Подключить: {name}",
  "marketplace.app.reconnectNamed": "Переподключить: {name}",
  "marketplace.app.connected": "Подключено",
  "marketplace.app.attention": "Требует внимания",
  "marketplace.app.partialTitle": "{name}: установка не завершена",
  "marketplace.app.partialDescription": "Часть приложений или навыков не установлена. «Переподключить» установит их.",
  "marketplace.app.notConnected": "Не подключено",
  "marketplace.app.custom": "Сервер MCP",
  "marketplace.app.githubTagline": "Репозитории, задачи и пул-реквесты",
  "marketplace.app.onePasswordTagline": "Вход на сайты с общими учётными данными",
  "marketplace.app.slackTagline": "Упоминания и личные сообщения в Slack",
  "marketplace.app.discordTagline": "Упоминания и личные сообщения в Discord",
  "marketplace.app.telegramTagline": "Группы и личные чаты в Telegram",
  "marketplace.app.bitwardenTagline": "Вход на сайты с учётными данными из общей папки",
  "marketplace.app.onePasswordCategory": "Управление логинами и учётными данными",
  "marketplace.app.yourApps": "Ваши приложения",
  "marketplace.app.addCustom": "Добавить своё",
  "marketplace.app.server": "Сервер",
  "marketplace.app.command": "Команда",
  "marketplace.app.address": "Адрес",
  "marketplace.app.disconnect.title": "Отключить {name}",
  "marketplace.app.disconnect.description":
    "Удалить «{name}» и его навыки с этого компьютера. Позже его можно подключить снова.",
  "marketplace.app.disconnect.action": "Отключить",
  "marketplace.app.remove.title": "Удалить сервер",
  "marketplace.app.remove.description":
    "Ваши агенты больше не смогут использовать этот сервер. Его настройки будут удалены.",
  "marketplace.app.remove.action": "Удалить",
  "marketplace.app.remove.confirmTitle": "Удалить «{name}»?",
  "marketplace.app.remove.keep": "Оставить",
  "marketplace.app.connection": "Подключение",
  "marketplace.app.setup.account": "Войдите в аккаунт {name} в браузере.",
  "marketplace.app.setup.key": "Нужен ключ API из аккаунта {name}.",
  "marketplace.app.setup.keySaved": "{field} хранится на {host}.",
  "marketplace.app.setup.desktop": "Работает в настольном приложении {name} по адресу {address}.",
  "marketplace.app.setup.desktopConnected": "Подключено к {address}.",
  "marketplace.app.setup.open": "Вход и ключ не нужны.",
  "marketplace.app.connectAgain": "Подключить снова",
  "marketplace.app.automation.askOnInstall": "Запросить доступ у macOS при установке",
  "marketplace.app.automation.title": "Доступ к приложениям Apple",
  "marketplace.app.automation.description":
    "macOS показывает один запрос для каждого приложения. Закрытое приложение ненадолго откроется, а затем закроется.",
  "marketplace.app.automation.request": "Запросить доступ",
  "marketplace.app.automation.allowed": "Теперь OpenBot может управлять всеми приложениями Apple.",
  "marketplace.app.automation.refused":
    "macOS не дала доступ к приложениям: {apps}. Разрешите OpenBot в Системных настройках › Конфиденциальность и безопасность › Автоматизация.",
  "marketplace.app.automation.failed": "OpenBot не смог запросить macOS о приложениях: {apps}. Попробуйте ещё раз.",
  "marketplace.app.automation.app.calendar": "Календарь",
  "marketplace.app.automation.app.contacts": "Контакты",
  "marketplace.app.automation.app.mail": "Почта",
  "marketplace.app.automation.app.notes": "Заметки",
  "marketplace.app.automation.app.reminders": "Напоминания",
  "marketplace.app.automation.app.messages": "Сообщения",
  "marketplace.app.automation.app.safari": "Safari",
  "marketplace.app.signInTitle": "Снова войдите в {name}",
  "marketplace.app.signInDescription":
    "«{name}» отклонил сохранённый вход. Агенты не смогут им пользоваться, пока вы снова не войдёте.",

  "marketplace.plugin.aave.tagline": "Данные и транзакции Aave",
  "marketplace.plugin.aave.description":
    "Aave помогает изучать рынки Aave V3 и V4 в реальном времени, смотреть позиции кошелька и голосования DAO, моделировать операции кредитования и готовить некастодиальные транзакции. Каждая транзакция возвращается неподписанной: плагин читает рынки и составляет вызов, а кошелёк остаётся у вас.",
  "marketplace.plugin.aave.app":
    "Рынки V3 и V4 в реальном времени, позиции кошелька, голосования DAO и подготовленные транзакции через один сервер MCP.",
  "marketplace.plugin.aave.prompt.stablecoinYield": "Где в Aave сейчас самая высокая доходность по стейблкоинам?",
  "marketplace.plugin.aave.prompt.usdcRates": "Где сейчас выше ставка по USDC: в Aave V3 или V4 в Ethereum?",
  "marketplace.plugin.aave.prompt.healthFactor":
    "Какой health factor у 0x0a42b2f3a0d54157dbd7cc346335a4f1909fc02c и насколько он далёк от ликвидации?",
  "marketplace.plugin.canva.tagline": "Дизайны, ресурсы и экспорт",
  "marketplace.plugin.canva.description":
    "Canva позволяет создавать и редактировать дизайны по текстовому описанию, искать в своей библиотеке дизайнов, загружать и упорядочивать ресурсы, экспортировать в нужном для канала формате и оставлять комментарии прямо в работе. Каждый пользователь входит в свой аккаунт Canva, и агенту доступно то же, что и этому аккаунту.",
  "marketplace.plugin.canva.app":
    "Создание и редактирование дизайнов, поиск по библиотеке, управление ресурсами и брендом, экспорт и комментарии через один сервер MCP.",
  "marketplace.plugin.canva.prompt.recentDesign": "Покажите мой последний отредактированный дизайн в Canva.",
  "marketplace.plugin.canva.prompt.socialResize":
    "Измените размер постера к запуску для Instagram и экспортируйте оба варианта в PNG.",
  "marketplace.plugin.canva.prompt.deckFromNotes":
    "Сделайте из этих заметок к релизу презентацию Canva на шесть слайдов.",
  "marketplace.plugin.linear.tagline": "Задачи и разбор проектов",
  "marketplace.plugin.linear.description":
    "Linear позволяет агентам показывать назначенные задачи, разбирать бэклог, менять статусы и составлять новые задачи в рабочем пространстве, к которому относится аккаунт. Каждый пользователь входит в свой аккаунт Linear через браузер.",
  "marketplace.plugin.linear.app":
    "Поиск задач, разбор, смена статусов и создание задач через сервер MCP Linear со входом через браузер.",
  "marketplace.plugin.linear.prompt.myWeek": "Что назначено мне на этой неделе?",
  "marketplace.plugin.linear.prompt.backlog":
    "Разберите бэклог: что устарело, заблокировано или осталось без ответственного?",
  "marketplace.plugin.linear.prompt.newIssue":
    "Заведите задачу о сбое в очереди синхронизации с шагами воспроизведения.",
  "marketplace.plugin.notion.tagline": "Документы и база знаний",
  "marketplace.plugin.notion.description":
    "Notion позволяет агентам читать и писать страницы, искать по рабочему пространству и вести заметки со встреч и спецификации там, где команда уже работает. Каждый пользователь входит в свой аккаунт Notion через браузер.",
  "marketplace.plugin.notion.app":
    "Поиск, чтение и запись страниц и навигация по рабочему пространству через сервер MCP Notion со входом через браузер.",
  "marketplace.plugin.notion.prompt.findSpec":
    "Найдите актуальную спецификацию запуска и кратко изложите открытые вопросы.",
  "marketplace.plugin.notion.prompt.meetingNotes":
    "Оформите эти пункты как структурированную заметку со встречи в пространстве моей команды.",
  "marketplace.plugin.notion.prompt.updateDoc": "Добавьте в документ по онбордингу новый чек-лист релиза.",
  "marketplace.plugin.cobrain.tagline": "Общая память для ваших ИИ-агентов",
  "marketplace.plugin.cobrain.description":
    "Cobrain — это память в формате Markdown, которую может читать и дополнять любой подключённый ИИ. Перед работой агенты загружают контекст клиента или проекта, ищут прошлые заметки и решения и сохраняют то, что узнали, чтобы следующий диалог начинался там, где закончился предыдущий. Каждый пользователь входит в свой аккаунт Cobrain.",
  "marketplace.plugin.cobrain.app": "Чтение, поиск и запись заметок в вашем Cobrain через один сервер MCP.",
  "marketplace.plugin.cobrain.prompt.startSession":
    "Загрузите мой контекст Cobrain для этого проекта, прежде чем мы начнём.",
  "marketplace.plugin.cobrain.prompt.searchDecision": "Найдите в моих заметках Cobrain, что мы решили насчёт цен.",
  "marketplace.plugin.cobrain.prompt.saveNote":
    "Сохраните в Cobrain заметку о том, что мы сделали сегодня и что осталось.",
  "marketplace.plugin.figma.tagline": "Дизайны и прототипы",
  "marketplace.plugin.figma.description":
    "Figma позволяет агентам читать файлы дизайна, изучать компоненты, стили и переменные и передавать спецификации разработчикам. Она подключается к серверу MCP в настольном приложении Figma на этом компьютере. Сервер пока может только читать дизайны; поддержка записи в разработке.",
  "marketplace.plugin.figma.app":
    "Контекст дизайна, метаданные, переменные и скриншоты через сервер MCP в настольном приложении Figma. Пока только чтение.",
  "marketplace.plugin.figma.prompt.handoff":
    "Подготовьте файл оформления заказа к передаче: перечислите экраны, компоненты и стили.",
  "marketplace.plugin.figma.prompt.audit": "Проверьте этот файл на непоследовательные отступы и использование цветов.",
  "marketplace.plugin.figma.prompt.assets": "Экспортируйте маркетинговые иконки в 2x для сборки приложения.",
  "marketplace.plugin.paper.tagline": "Холст для дизайна на HTML и CSS",
  "marketplace.plugin.paper.description":
    "Paper позволяет агентам читать и изменять файл дизайна, открытый в Paper Desktop: изучать артборды, выделение, вычисленные стили, JSX и токены, а также создавать и менять фреймы, текст и стили. Установите Paper Desktop, запустите его хотя бы раз и откройте файл перед началом работы. OpenBot запускает Paper CLI, который устанавливает Paper Desktop. Ключ для Paper не нужен. Инструменты записи меняют открытый файл, поэтому проверяйте каждое изменение перед тем, как его одобрить.",
  "marketplace.plugin.paper.app":
    "Читает и изменяет открытый файл Paper Desktop через локальный сервер MCP, к которому подключается Paper CLI. Нужен Paper Desktop с открытым файлом.",
  "marketplace.plugin.paper.prompt.implement":
    "Реализуйте выбранный фрейм Paper в этой кодовой базе по нашим соглашениям о коде.",
  "marketplace.plugin.paper.prompt.codeToDesign":
    "Используйте стили из этого репозитория и сделайте в Paper дизайн страницы настроек.",
  "marketplace.plugin.paper.prompt.tokens":
    "Перечислите токены дизайна в открытом файле Paper и сравните их с нашей темой.",
  "marketplace.plugin.appleApps.tagline": "Почта, Календарь и другое на вашем Mac",
  "marketplace.plugin.appleApps.description":
    "Apple apps позволяет агентам работать с приложениями Почта, Календарь, Контакты, Напоминания, Заметки, Сообщения и Safari на этом Mac. Работает только в macOS. OpenBot запускает mcp-icloud — сервер сообщества, который не создан Apple или OpenBot. Сервер управляет приложениями через AppleScript на этом компьютере, и ему не нужны аккаунт или ключ. При установке OpenBot может сразу запросить у macOS доступ ко всем этим приложениям, по одному запросу на приложение. Иначе macOS спросит, когда агент впервые использует приложение. Чтобы изменить это позже, откройте Системные настройки › Конфиденциальность и безопасность › Автоматизация. Агенты могут отправлять письма и iMessage, а также изменять или удалять события, контакты и напоминания, поэтому проверяйте каждую запись перед подтверждением. То, что читают инструменты, например текст писем, передаётся провайдеру модели агента.",
  "marketplace.plugin.appleApps.app":
    "Почта, Календарь, Контакты, Напоминания, Заметки, Сообщения и Safari через локальный сервер mcp-icloud. Нужны macOS и доступ в разделе «Автоматизация».",
  "marketplace.plugin.appleApps.prompt.unread": "Кратко перескажите мои непрочитанные письма за сегодня в Apple Почте.",
  "marketplace.plugin.appleApps.prompt.today": "Что у меня в Календаре Apple сегодня и завтра?",
  "marketplace.plugin.appleApps.prompt.schedule":
    "Найдите последнее письмо о встрече по проекту и добавьте эту встречу в мой календарь.",
  "marketplace.plugin.sentry.tagline": "Разбор ошибок и сбоев",
  "marketplace.plugin.sentry.description":
    "Sentry позволяет агентам искать недавние ошибки, изучать стек вызовов и затронутые релизы и кратко описывать, что сломалось после деплоя. Каждый пользователь входит в свой аккаунт Sentry через браузер.",
  "marketplace.plugin.sentry.app":
    "Поиск ошибок, разбор инцидентов и состояние релизов через сервер MCP Sentry со входом через браузер.",
  "marketplace.plugin.sentry.prompt.newErrors": "Какие новые ошибки появились после вчерашнего деплоя?",
  "marketplace.plugin.sentry.prompt.topCrash":
    "Объясните самый частый сбой в мобильном проекте и его вероятную причину.",
  "marketplace.plugin.sentry.prompt.releaseHealth": "Насколько стабилен текущий релиз по сравнению с предыдущим?",
  "marketplace.plugin.vercel.tagline": "Деплои, логи сборки и проекты",
  "marketplace.plugin.vercel.description":
    "Vercel позволяет агентам просматривать проекты и последние деплои, читать логи сборки и выполнения и выяснять, почему сборка не удалась. Каждый пользователь входит в свой аккаунт Vercel через браузер и выбирает команды, которые могут использовать агенты. В этих командах у агентов те же права, что и у аккаунта пользователя. Они также могут изменять переменные окружения, домены, DNS-записи и деплои, а также покупать домены.",
  "marketplace.plugin.vercel.app":
    "Проекты, деплои, логи сборки и выполнения через сервер MCP Vercel со входом через браузер.",
  "marketplace.plugin.vercel.prompt.failedBuild": "Почему не удался последний продакшен-деплой?",
  "marketplace.plugin.vercel.prompt.recentDeployments": "Покажите сегодняшние деплои и их статус.",
  "marketplace.plugin.vercel.prompt.runtimeErrors": "На каких маршрутах были ошибки выполнения за последний час?",
  "marketplace.plugin.cloudflare.tagline": "Workers, DNS, хранилища и логи",
  "marketplace.plugin.cloudflare.description":
    "Cloudflare позволяет агентам просматривать Workers, DNS-записи, R2, D1 и KV и управлять ими через API Cloudflare, запрашивать логи Workers и искать в документации Cloudflare. Каждый пользователь входит в свой аккаунт Cloudflare через браузер. На странице согласия Cloudflare выберите Read only: с вариантом по умолчанию, Minimal, агенты не видят Workers, логи и DNS-записи. С правами на запись агенты могут развёртывать и удалять Workers, менять DNS-записи и другие настройки аккаунта.",
  "marketplace.plugin.cloudflare.app":
    "Workers, DNS, хранилища и логи через MCP-сервер API Cloudflare со входом в браузере.",
  "marketplace.plugin.cloudflare.prompt.workers": "Какие Workers развёрнуты в моём аккаунте Cloudflare?",
  "marketplace.plugin.cloudflare.prompt.errors": "Какие Cloudflare Workers записали ошибки за последний час?",
  "marketplace.plugin.cloudflare.prompt.dns": "Покажите DNS-записи каждой зоны в моём аккаунте Cloudflare.",
  "marketplace.plugin.supabase.tagline": "Базы данных, логи и edge functions",
  "marketplace.plugin.supabase.description":
    "Supabase позволяет агентам просматривать проекты, выполнять SQL, читать схемы таблиц и логи, проверять рекомендации advisors по безопасности и производительности, управлять edge functions и ветками и искать в документации Supabase. Каждый пользователь входит в свой аккаунт Supabase через браузер и выбирает организацию. Агенты получают полный доступ: они могут выполнять SQL, который меняет или удаляет данные, применять миграции, развёртывать edge functions, создавать и приостанавливать проекты.",
  "marketplace.plugin.supabase.app":
    "Базы данных, логи и edge functions через MCP-сервер Supabase со входом в браузере.",
  "marketplace.plugin.supabase.prompt.projects": "Какие проекты есть в моей организации Supabase?",
  "marketplace.plugin.supabase.prompt.tables": "Покажите таблицы и столбцы моей базы данных Supabase.",
  "marketplace.plugin.supabase.prompt.errors": "Какие ошибки записал мой проект Supabase за последний час?",
  "marketplace.plugin.context7.tagline": "Актуальная документация библиотек",
  "marketplace.plugin.context7.description":
    "Context7 получает актуальную документацию и справочники API для библиотек и фреймворков, чтобы ответы учитывали версию, которая действительно используется в проекте. Аккаунт и ключ не нужны.",
  "marketplace.plugin.context7.app": "Поиск по актуальной документации библиотек через сервер MCP Context7 без входа.",
  "marketplace.plugin.context7.prompt.apiCheck": "Какой сейчас API для виртуализированных списков в этом фреймворке?",
  "marketplace.plugin.context7.prompt.migrate": "Что изменилось между v2 и v3 этого роутера?",
  "marketplace.plugin.context7.prompt.example": "Покажите актуальный пример загрузки файлов с аутентификацией.",
  "marketplace.plugin.stripe.tagline": "Платежи и биллинг",
  "marketplace.plugin.stripe.description":
    "Stripe позволяет агентам искать платежи, клиентов и счета и составлять платёжные ссылки в аккаунте, к которому есть доступ у вошедшего пользователя. Каждый пользователь входит в свой аккаунт Stripe через браузер.",
  "marketplace.plugin.stripe.app": "Поиск платежей, клиентов и счетов через сервер MCP Stripe со входом через браузер.",
  "marketplace.plugin.stripe.prompt.payment": "Найдите этот платёж и объясните, почему он не прошёл.",
  "marketplace.plugin.stripe.prompt.customer": "Кратко опишите счета этого клиента и его задолженность.",
  "marketplace.plugin.stripe.prompt.link": "Составьте платёжную ссылку на тариф Pro за 49 в месяц.",
  "marketplace.plugin.posthog.tagline": "Продуктовая аналитика и флаги",
  "marketplace.plugin.posthog.description":
    "PostHog позволяет агентам запрашивать события и воронки, проверять флаги функций и кратко описывать, что изменилось после релиза. Персональный API-ключ из настроек проекта передаётся в одном заголовке Authorization.",
  "marketplace.plugin.posthog.app":
    "Доступ к событиям, воронкам и флагам функций через сервер MCP PostHog с персональным API-ключом.",
  "marketplace.plugin.posthog.prompt.funnel": "Как выглядит воронка регистрации за последние 14 дней?",
  "marketplace.plugin.posthog.prompt.flag": "Какие флаги функций включены для этого пользователя?",
  "marketplace.plugin.posthog.prompt.release": "Изменилась ли активация после релиза на прошлой неделе?",
  "marketplace.plugin.airtable.tagline": "Базы и записи",
  "marketplace.plugin.airtable.description":
    "Airtable позволяет агентам просматривать базы, читать и обновлять записи и кратко описывать содержимое таблиц. Ключ API со страницы аккаунта передаётся локальному серверу в одной переменной окружения.",
  "marketplace.plugin.airtable.app": "Список баз и доступ к записям через локальный сервер MCP с API-ключом Airtable.",
  "marketplace.plugin.airtable.prompt.bases": "К каким базам у меня есть доступ?",
  "marketplace.plugin.airtable.prompt.records": "Кратко опишите таблицу трекера запуска.",
  "marketplace.plugin.airtable.prompt.update": "Отметьте выпущенные функции как готовые в базе роадмапа.",
  "marketplace.plugin.firecrawl.tagline": "Извлечение данных и поиск в интернете",
  "marketplace.plugin.firecrawl.description":
    "Firecrawl позволяет агентам собирать содержимое страниц, извлекать структурированные данные и искать в интернете через один API. Ключ API из панели Firecrawl передаётся локальному серверу в одной переменной окружения.",
  "marketplace.plugin.firecrawl.app":
    "Сбор страниц, извлечение данных и поиск в интернете через локальный сервер MCP с API-ключом Firecrawl.",
  "marketplace.plugin.firecrawl.prompt.scrape":
    "Извлеките таблицу цен с этой страницы в виде структурированных данных.",
  "marketplace.plugin.firecrawl.prompt.research": "Изучите цены конкурентов и укажите страницу-источник для каждой.",
  "marketplace.plugin.firecrawl.prompt.monitor": "Что изменилось на странице нашего журнала изменений в этом месяце?",
  "marketplace.plugin.braveSearch.tagline": "Приватный поиск в интернете",
  "marketplace.plugin.braveSearch.description":
    "Brave Search позволяет агентам искать в интернете и по местам поблизости без отслеживания. Ключ API из панели Brave Search API передаётся локальному серверу в одной переменной окружения.",
  "marketplace.plugin.braveSearch.app":
    "Поиск в интернете и по местам поблизости через локальный сервер MCP с API-ключом Brave.",
  "marketplace.plugin.braveSearch.prompt.search": "Что пишут обозреватели об этой версии фреймворка?",
  "marketplace.plugin.braveSearch.prompt.news": "Найдите сегодняшние анонсы в этой продуктовой области.",
  "marketplace.plugin.braveSearch.prompt.compare": "Сравните этих двух поставщиков со ссылками на источники.",
  "marketplace.plugin.obsidian.tagline": "Заметки в вашем хранилище",
  "marketplace.plugin.obsidian.description":
    "Obsidian позволяет агентам искать, читать и записывать заметки в вашем хранилище, и хранилище становится их памятью. Локальный сервер подключается к плагину Local REST API в приложении Obsidian на этом компьютере. API-ключ плагина передаётся локальному серверу в одной переменной окружения. Не закрывайте Obsidian, пока агенты с ним работают.",
  "marketplace.plugin.obsidian.app":
    "Поиск, чтение и правка заметок через локальный MCP-сервер с ключом плагина Local REST API.",
  "marketplace.plugin.obsidian.prompt.recall": "Что сказано в моих заметках о решениях по этому проекту?",
  "marketplace.plugin.obsidian.prompt.save": "Сохраните это решение как новую заметку в моём хранилище.",
  "marketplace.plugin.obsidian.prompt.log": "Добавьте сводку сегодняшней работы в мою заметку «Журнал работы».",
  "marketplace.plugin.obsidian.hint.apiKey":
    'В Obsidian откройте Settings > Local REST API. Скопируйте API-ключ и включите "Enable non-encrypted (HTTP) server".',
  "marketplace.plugin.resend.tagline": "Транзакционная почта",
  "marketplace.plugin.resend.description":
    "Resend позволяет агентам отправлять транзакционные письма и проверять доставку через один API. Ключ API из панели Resend передаётся локальному серверу в одной переменной окружения.",
  "marketplace.plugin.resend.app": "Отправка писем и проверка доставки через локальный сервер MCP с API-ключом Resend.",
  "marketplace.plugin.resend.prompt.send": "Отправьте черновик анонса запуска списку бета-тестеров.",
  "marketplace.plugin.resend.prompt.status": "Дошло ли письмо со счётом до клиента?",
  "marketplace.plugin.resend.prompt.template": "Составьте письмо для сброса пароля для нового сценария.",
  "marketplace.plugin.composio.tagline": "Множество приложений по вашей ссылке Composio",
  "marketplace.plugin.composio.description":
    "Composio подключает агентов к Gmail, Slack, GitHub и сотням других приложений через один сервер MCP. Подключите нужные приложения в своём аккаунте Composio и вставьте сюда его URL MCP и ключ API.",
  "marketplace.plugin.composio.app":
    "Приложения, которые вы добавили на свой сервер MCP Composio, по ссылке из вашего аккаунта Composio.",
  "marketplace.plugin.composio.prompt.inbox":
    "Кратко перескажите мои непрочитанные письма и подготовьте ответы на срочные.",
  "marketplace.plugin.composio.prompt.handoff":
    "Опубликуйте краткое описание этого пул-реквеста в канале нашей команды.",
  "marketplace.plugin.composio.prompt.apps": "Какие приложения и действия доступны вам через Composio?",
  "marketplace.plugin.composio.hint.url": "URL сервера MCP в вашем аккаунте Composio",
  "marketplace.plugin.composio.hint.apiKey":
    "Он находится в аккаунте Composio, в разделе Settings > Sessions & API Key.",
  "marketplace.plugin.neon.tagline": "Проекты, ветки и миграции Postgres",
  "marketplace.plugin.neon.description":
    "Neon позволяет агентам просматривать проекты и ветки, выполнять SQL, читать схемы таблиц, проверять изменения схемы во временной ветке, находить медленные запросы и искать в документации Neon. Каждый пользователь входит в свой аккаунт Neon через браузер и при авторизации может выбрать доступ только для чтения. С полным доступом агенты могут выполнять SQL, который изменяет или удаляет данные, а также создавать, сбрасывать и удалять ветки, базы данных и проекты. Neon рекомендует свой сервер MCP для разработки и тестирования, а не для продакшен-баз данных.",
  "marketplace.plugin.neon.app":
    "Проекты, ветки, SQL и миграции Postgres через сервер MCP Neon со входом через браузер.",
  "marketplace.plugin.neon.prompt.projects": "Какие проекты и ветки есть в моём аккаунте Neon?",
  "marketplace.plugin.neon.prompt.slowQueries": "Какие запросы самые медленные в моей базе данных Neon и почему?",
  "marketplace.plugin.neon.prompt.migration":
    "Добавьте индекс в таблицу orders во временной ветке и покажите мне результат, прежде чем применять его.",
  "marketplace.plugin.prisma.tagline": "Базы данных Postgres, резервные копии и приложения Compute",
  "marketplace.plugin.prisma.description":
    "Prisma позволяет агентам просматривать и создавать базы данных Prisma Postgres, читать схемы, выполнять SQL, просматривать резервные копии и восстанавливать их в новую базу данных, управлять бакетами Object Storage, читать сборки и логи Compute и искать в документации Prisma. Каждый пользователь входит в свой аккаунт Prisma через браузер и выбирает рабочее пространство. Агенты получают полный доступ: они могут выполнять SQL, который изменяет или удаляет данные, обновлять схемы, удалять базы данных и бакеты, а также останавливать, откатывать и удалять деплои Compute.",
  "marketplace.plugin.prisma.app":
    "Базы данных, SQL, резервные копии и приложения Compute через сервер MCP Prisma со входом через браузер.",
  "marketplace.plugin.prisma.prompt.databases": "Какие базы данных есть в моём рабочем пространстве Prisma?",
  "marketplace.plugin.prisma.prompt.backups": "Покажите все доступные резервные копии моей базы данных.",
  "marketplace.plugin.prisma.prompt.logs": "Покажите логи выполнения моего последнего деплоя Compute.",
  "marketplace.plugin.netlify.tagline": "Проекты, деплои и логи запросов",
  "marketplace.plugin.netlify.description":
    "Netlify позволяет агентам просматривать проекты и деплои, читать логи запросов на edge, создавать проекты и деплоить код в существующий проект. Каждый пользователь входит в свой аккаунт Netlify через браузер. У агентов тот же доступ, что и у аккаунта пользователя: они могут изменять переменные окружения, формы и доступ посетителей, устанавливать и удалять расширения, а также удалять отправки форм и переменные окружения.",
  "marketplace.plugin.netlify.app":
    "Проекты, деплои, логи запросов и настройки сайта через сервер MCP Netlify со входом через браузер.",
  "marketplace.plugin.netlify.prompt.latestDeploy": "Каков статус последнего деплоя каждого из моих проектов Netlify?",
  "marketplace.plugin.netlify.prompt.errors": "Какие URL моего сайта вернули ошибки сервера за последние сутки?",
  "marketplace.plugin.netlify.prompt.deploy": "Задеплойте эту папку в мой существующий проект Netlify.",
  "marketplace.plugin.railway.tagline": "Проекты, сервисы и деплои",
  "marketplace.plugin.railway.description":
    "Railway позволяет агентам просматривать проекты и сервисы, создавать проекты, заново деплоить сервисы и управлять флагами функций. Агенты также могут передать многошаговую работу Railway Agent: он читает логи, выясняет, почему деплой не удался, создаёт сервисы и задаёт переменные. Каждый пользователь входит в свой аккаунт Railway через браузер и выбирает рабочие пространства и проекты, которые могут использовать агенты. В этих проектах у агентов полный доступ: они могут деплоить подготовленные изменения, удалять флаги функций, а через Railway Agent — изменять сервисы, переменные, базы данных и сеть.",
  "marketplace.plugin.railway.app": "Проекты, сервисы и деплои через сервер MCP Railway со входом через браузер.",
  "marketplace.plugin.railway.prompt.projects": "Какие проекты и сервисы есть в моём рабочем пространстве Railway?",
  "marketplace.plugin.railway.prompt.crash": "Почему мой бэкенд-сервис на Railway падает при деплое?",
  "marketplace.plugin.railway.prompt.redeploy": "Заново задеплой сервис API в моём проекте Railway.",
  "marketplace.plugin.render.tagline": "Сервисы, деплои и логи",
  "marketplace.plugin.render.description":
    "Render позволяет агентам просматривать рабочие пространства и сервисы, читать логи, события и метрики, смотреть историю деплоев, запускать деплои и выполнять SQL только для чтения в Render Postgres. API-ключ Render передаётся в одном заголовке Authorization. Ключ даёт доступ ко всем рабочим пространствам аккаунта Render. Агенты могут создавать веб-сервисы, статические сайты, cron-задачи, базы данных Postgres и экземпляры Key Value, что может стоить денег, а также заменять переменные окружения сервиса. Сервер не может удалить ни один ресурс.",
  "marketplace.plugin.render.app": "Сервисы, деплои, логи и метрики через сервер MCP Render с API-ключом.",
  "marketplace.plugin.render.prompt.services": "Какие сервисы есть в моём рабочем пространстве Render?",
  "marketplace.plugin.render.prompt.logs": "Какие ошибки записал мой веб-сервис на Render за последний час?",
  "marketplace.plugin.render.prompt.deploy": "Почему последний деплой моего сервиса на Render не удался?",
  "marketplace.plugin.atlassian.tagline": "Рабочие элементы Jira и страницы Confluence",
  "marketplace.plugin.atlassian.description":
    "Atlassian позволяет агентам искать и читать рабочие элементы Jira, страницы Confluence и пул-реквесты Bitbucket, а также создавать и обновлять рабочие элементы, страницы и комментарии. Каждый пользователь входит в свой аккаунт Atlassian через браузер и подтверждает доступ на экране согласия. У агентов те же права, что и у пользователя: они могут изменять рабочие элементы и страницы, менять права доступа к страницам и сливать пул-реквесты. Инструменты, которые удаляют данные Jira, остаются выключенными, пока администратор организации их не включит. Каждый вызов инструмента расходует кредиты Rovo.",
  "marketplace.plugin.atlassian.app":
    "Jira, Confluence и Bitbucket через сервер MCP Atlassian со входом через браузер.",
  "marketplace.plugin.atlassian.prompt.assigned": "Какие открытые рабочие элементы Jira назначены мне?",
  "marketplace.plugin.atlassian.prompt.releasePage":
    "Найди страницу Confluence о нашем процессе релиза и кратко изложи её.",
  "marketplace.plugin.atlassian.prompt.newItem":
    "Создай рабочий элемент Jira для ошибки входа с шагами для воспроизведения.",
  "marketplace.plugin.todoist.tagline": "Задачи, проекты и напоминания",
  "marketplace.plugin.todoist.description":
    "Todoist позволяет агентам находить задачи по дате, тексту, метке или фильтру, добавлять задачи и переносить их сроки, а также управлять проектами, разделами, метками, комментариями и напоминаниями. Каждый пользователь входит в свой аккаунт Todoist через браузер. Агенты получают доступ на чтение и запись: они могут изменять, завершать и удалять задачи, проекты и другие элементы.",
  "marketplace.plugin.todoist.app": "Задачи, проекты и напоминания через сервер MCP Todoist со входом через браузер.",
  "marketplace.plugin.todoist.prompt.today": "Какие задачи в Todoist нужно сделать сегодня?",
  "marketplace.plugin.todoist.prompt.capture": "Добавь эти пункты в мои «Входящие» в Todoist.",
  "marketplace.plugin.todoist.prompt.overdue": "Перенеси мои просроченные задачи в Todoist на завтра.",
  "marketplace.plugin.trello.tagline": "Доски, списки и карточки",
  "marketplace.plugin.trello.description":
    "С Trello агенты ищут и читают доски, списки, карточки, чек-листы и комментарии, создают доски и карточки, перемещают списки и карточки, отмечают карточки выполненными и добавляют чек-листы, комментарии и метки. Агенты также могут читать и добавлять карточки во «Входящих» Trello пользователя и читать события Planner, которые могут приходить из подключённого календаря Google или Outlook. Каждый пользователь входит в свой аккаунт Trello через браузер и выбирает рабочие пространства на экране согласия. В этих рабочих пространствах у агентов те же права, что и у пользователя. Они могут архивировать карточки и списки, но сервер не может ничего удалить навсегда.",
  "marketplace.plugin.trello.app": "Доски, списки и карточки через сервер MCP Trello со входом через браузер.",
  "marketplace.plugin.trello.prompt.myCards": "Какие карточки в Trello назначены мне?",
  "marketplace.plugin.trello.prompt.board": "Кратко опиши, что сейчас в работе на моей доске Trello.",
  "marketplace.plugin.trello.prompt.newCards": "Добавь эти пункты как карточки на мою доску Trello.",
  "marketplace.plugin.huggingface.tagline": "Модели, датасеты и статьи на Hub",
  "marketplace.plugin.huggingface.description":
    "Hugging Face позволяет агентам искать модели, датасеты, Spaces, коллекции и статьи на Hugging Face Hub, читать карточки моделей и файлы репозиториев, просматривать датасеты и искать по документации Hugging Face. Он использует публичные данные Hub и не требует аккаунта и ключа. Инструменты только читают данные: агенты не могут создавать репозитории или запускать задачи.",
  "marketplace.plugin.huggingface.app":
    "Поиск моделей, датасетов, Spaces, статей и документации через сервер MCP Hugging Face без входа.",
  "marketplace.plugin.huggingface.prompt.models":
    "Найди на Hugging Face небольшие открытые модели для распознавания речи.",
  "marketplace.plugin.huggingface.prompt.papers": "Какие статьи сегодня в тренде на Hugging Face?",
  "marketplace.plugin.huggingface.prompt.dataset": "Найди датасет с временными рядами погоды и покажи его столбцы.",
  "marketplace.auth.apiKey": "API-ключ",
  "marketplace.auth.personalApiKey": "Личный API-ключ",
  "marketplace.auth.mcpUrl": "URL MCP",
  "marketplace.auth.createKey": "Создать ключ",
  "marketplace.skill.doc": "SKILL.md",
  "marketplace.try.in": "Попробовать в {name}",
  "marketplace.skills.yours": "Ваши навыки",
  "marketplace.skills.seeAll": "Показать все",
  "marketplace.skills.seeAllName": "Показать все: {name}",
  "marketplace.skills.none": "Пока ни у одного агента нет навыков.",
  "marketplace.skills.noneHint": "Навык учит агента одной задаче. Добавьте навык ниже или создайте свой.",
  "marketplace.skills.sourceLabel": "Источник",
  "marketplace.skills.source.all": "Все",
  "marketplace.skills.source.verified": "Проверенные",
  "marketplace.skills.source.public": "Публичные",
  "marketplace.skills.source.verifiedLong": "Проверен OpenBot",
  "marketplace.skills.source.publicLong": "Публичный: OpenBot его не проверял",
  "marketplace.skills.sortLabel": "Сортировка",
  "marketplace.skills.sortName": "Сортировка: {name}",
  "marketplace.skills.sort.installs": "Популярные",
  "marketplace.skills.sort.updated": "Недавно обновлённые",
  "marketplace.skills.sort.name": "Название",
  "marketplace.skills.featured": "Рекомендуемые",
  "marketplace.skills.all": "Все навыки",
  "marketplace.skills.count": {
    one: "{count} навык",
    few: "{count} навыка",
    many: "{count} навыков",
    other: "{count} навыка",
  },
  "marketplace.skills.searchIn": "Поиск: {name}",
  "marketplace.skills.state.off": "Выключен",
  "marketplace.skills.state.repair": "Требует восстановления",
  "marketplace.skills.state.update": "Есть обновление",
  "marketplace.skills.state.modified": "Изменён вами",
  "marketplace.skills.stateOn": "{state}: {agents}",
  "marketplace.skills.version": "Версия {version}",
  "marketplace.skills.origin.local": "Создан на этом компьютере",
  "marketplace.skills.origin.workspace": "В папке этого агента",
  "marketplace.skills.origin.marketplace": "Из каталога · версия {version}",
  "marketplace.skills.status.notAdded": "Не добавлен",
  "marketplace.skills.status.on": "Включён: {agents}",
  "marketplace.skills.agentCount": {
    one: "{count} агент",
    few: "{count} агента",
    many: "{count} агентов",
    other: "{count} агента",
  },
  "marketplace.skills.allAgents": "все агенты",
  "marketplace.skills.agentsTitle": "Агенты · {total}",
  "marketplace.skills.agents.search": "Поиск агентов",
  "marketplace.skills.agents.searchName": "Поиск агентов с навыком «{name}»",
  "marketplace.skills.agents.noMatch": "Нет агентов по запросу «{query}».",
  "marketplace.skills.agents.removeAll": "Удалить у всех",
  "marketplace.skills.agents.removeAllName": {
    one: "Удалить «{name}» у {count} агента",
    few: "Удалить «{name}» у всех {count} агентов",
    many: "Удалить «{name}» у всех {count} агентов",
    other: "Удалить «{name}» у всех {count} агента",
  },
  "marketplace.skills.agent.toggle": "«{name}»: {agent}",
  "marketplace.skills.agent.remove": "Удалить",
  "marketplace.skills.agent.removeName": "Удалить «{name}»: {agent}",
  "marketplace.skills.add": "Добавить",
  "marketplace.skills.addName": "Добавить «{name}» агентам",
  "marketplace.skills.addToAgents": "Добавить агентам",
  "marketplace.skills.onOf": "Включён у {have} из {total}",
  "marketplace.skills.chooseAgents": "«{name}» есть у: {agents}. Выбрать агентов",
  "marketplace.skills.dialog.list": "Агенты с навыком «{name}»",
  "marketplace.skills.dialog.search": {
    one: "Поиск среди {count} агента",
    few: "Поиск среди {count} агентов",
    many: "Поиск среди {count} агентов",
    other: "Поиск среди {count} агента",
  },
  "marketplace.skills.dialog.all": {
    one: "{count} агент",
    few: "Все {count} агента",
    many: "Все {count} агентов",
    other: "Все {count} агента",
  },
  "marketplace.skills.dialog.allMatches": {
    one: "{count} совпадение",
    few: "Все {count} совпадения",
    many: "Все {count} совпадений",
    other: "Все {count} совпадения",
  },
  "marketplace.skills.dialog.checked": "{checked} из {total}",
  "marketplace.skills.dialog.save": "Сохранить",
  "marketplace.skills.dialog.saveBoth": "Сохранить: добавить {added}, удалить {removed}",
  "marketplace.skills.dialog.addTo": "Добавить: {agents}",
  "marketplace.skills.dialog.removeFrom": "Удалить у: {agents}",
  "marketplace.skills.dialog.full": "Достигнут лимит навыков",
  "marketplace.skills.dialog.unread": "Навыки не прочитаны",
  "marketplace.skills.local.gone": "Сейчас ни у одного агента нет этого навыка.",

  "marketplace.notice.agentAdded": "Агент «{name}» добавлен.",
  "marketplace.notice.agentUpdated": "Агент «{name}» обновлён.",
  "marketplace.notice.appConnected": "«{name}» подключено.",
  "marketplace.notice.appDisconnected": "«{name}» отключено.",
  "marketplace.notice.serverRemoved": "Сервер «{name}» удалён.",
  "marketplace.notice.skillInstalled": {
    one: "Навык «{name}» установлен для {count} агента.",
    few: "Навык «{name}» установлен для {count} агентов.",
    many: "Навык «{name}» установлен для {count} агентов.",
    other: "Навык «{name}» установлен для {count} агента.",
  },
  "marketplace.notice.skillRemoved": {
    one: "Навык «{name}» удалён у {count} агента.",
    few: "Навык «{name}» удалён у {count} агентов.",
    many: "Навык «{name}» удалён у {count} агентов.",
    other: "Навык «{name}» удалён у {count} агента.",
  },
  "marketplace.error.skillPartial": "«{name}» не изменился у этих агентов: {agents}. {reason}",

  "marketplace.error.openLink": "Не удалось открыть ссылку.",
  "marketplace.error.copyLink": "Не удалось скопировать ссылку.",
  "marketplace.error.connectNoServer": "Выберите локальный сервер, чтобы подключить это приложение.",
  "marketplace.error.installNoServer": "Выберите локальный сервер, чтобы установить плагин.",
  "marketplace.error.installNoAgent": "Выберите агента, чтобы установить навыки этого плагина.",
  "marketplace.error.installLocalOnHost":
    "Установите «{name}» на компьютере, где работают эти агенты: приложение запускает свой сервер на этом компьютере.",
  "marketplace.error.installOnHost":
    "Установите «{name}» на компьютере, где работают эти агенты: приложению нужен вход через браузер.",
  "marketplace.error.appInvalid": "Не удалось добавить «{name}»: {reason}",
  "marketplace.error.uninstallNoServer": "Выберите локальный сервер, чтобы удалить плагин.",
  "marketplace.error.uninstallPartial": "Часть «{name}» удалить не удалось. {failures}",
  "marketplace.error.actionFailed": "Не удалось выполнить действие в каталоге. Повторите попытку.",
  "marketplace.thisAgent": "этот агент",
} as const satisfies PartialTranslation<typeof source>;
