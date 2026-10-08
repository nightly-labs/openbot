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
  "marketplace.close": "Закрыть каталог",
  "marketplace.kinds": "Типы содержимого каталога",
  "marketplace.tab.agents": "Агенты",
  "marketplace.tab.skills": "Навыки",

  "marketplace.plugins.missing": "Этого плагина нет в каталоге OpenBot.",

  "marketplace.agents.loadingDetail": "Загрузка сведений об агенте…",
  "marketplace.agents.skills": "Навыки",
  "marketplace.agents.routines": "Регулярные задачи",
  "marketplace.agents.routineActive": "Активна",
  "marketplace.agents.routineInactive": "Неактивна",

  "marketplace.skill.loading": "Загрузка навыка",
  "marketplace.skill.update": "Обновить навык",
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
  "marketplace.filter.installed": "Установлены",
  "marketplace.filter.notInstalled": "Не установлены",
  "marketplace.filter.clear": "Сбросить фильтры",
  "marketplace.noMatch.apps": "Приложений по этому запросу не найдено.",
  "marketplace.noMatch.filters": "Ничего не подходит под фильтры.",
  "marketplace.noMatch.showAgents": {
    one: "Показать {count} агента",
    few: "Показать {count} агентов",
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
  "marketplace.properties.skill": "Об этом навыке",
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
  "marketplace.app.notConnected": "Не подключено",
  "marketplace.app.custom": "Сервер MCP",
  "marketplace.app.githubTagline": "Репозитории, задачи и пул-реквесты",
  "marketplace.app.onePasswordTagline": "Вход на сайты с общими учётными данными",
  "marketplace.app.onePasswordCategory": "Управление логинами и учётными данными",
  "marketplace.app.yourApps": "Ваши приложения",
  "marketplace.app.moreApps": "Другие приложения",
  "marketplace.app.server": "Сервер",
  "marketplace.app.command": "Команда",
  "marketplace.app.address": "Адрес",
  "marketplace.app.disconnect.title": "Отключить",
  "marketplace.app.disconnect.description":
    "Удалить «{name}» и его навыки с этого компьютера. Позже его можно подключить снова.",
  "marketplace.app.disconnect.action": "Отключить",
  "marketplace.app.remove.title": "Удалить сервер",
  "marketplace.app.remove.description":
    "Ваши агенты больше не смогут использовать этот сервер. Его настройки будут удалены.",
  "marketplace.app.remove.action": "Удалить",
  "marketplace.app.remove.confirmTitle": "Удалить «{name}»?",
  "marketplace.app.remove.keep": "Оставить",

  "marketplace.plugin.aave.tagline": "Данные и транзакции Aave",
  "marketplace.plugin.aave.description":
    "Aave помогает изучать рынки Aave V3 и V4 в реальном времени, смотреть позиции кошелька и голосования DAO, моделировать операции кредитования и готовить некастодиальные транзакции. Каждая транзакция возвращается неподписанной: плагин читает рынки и составляет вызов, а кошелёк остаётся у вас.",
  "marketplace.plugin.aave.app":
    "Рынки V3 и V4 в реальном времени, позиции кошелька, голосования DAO и подготовленные транзакции через один MCP-сервер.",
  "marketplace.plugin.aave.prompt.stablecoinYield": "Где в Aave сейчас самая высокая доходность по стейблкоинам?",
  "marketplace.plugin.aave.prompt.usdcRates": "Где сейчас выше ставка по USDC: в Aave V3 или V4 в Ethereum?",
  "marketplace.plugin.aave.prompt.healthFactor":
    "Какой health factor у 0x0a42b2f3a0d54157dbd7cc346335a4f1909fc02c и насколько он далёк от ликвидации?",
  "marketplace.plugin.canva.tagline": "Дизайны, ресурсы и экспорт",
  "marketplace.plugin.canva.description":
    "Canva позволяет создавать и редактировать дизайны по текстовому описанию, искать в своей библиотеке дизайнов, загружать и упорядочивать ресурсы, экспортировать в нужном для канала формате и оставлять комментарии прямо в работе. Каждый пользователь входит в свой аккаунт Canva, и агенту доступно то же, что и этому аккаунту.",
  "marketplace.plugin.canva.app":
    "Создание и редактирование дизайнов, поиск по библиотеке, управление ресурсами и брендом, экспорт и комментарии через один MCP-сервер.",
  "marketplace.plugin.canva.prompt.recentDesign": "Покажите мой последний отредактированный дизайн в Canva.",
  "marketplace.plugin.canva.prompt.socialResize":
    "Измените размер постера к запуску для Instagram и экспортируйте оба варианта в PNG.",
  "marketplace.plugin.canva.prompt.deckFromNotes":
    "Сделайте из этих заметок к релизу презентацию Canva на шесть слайдов.",
  "marketplace.plugin.linear.tagline": "Задачи и разбор проектов",
  "marketplace.plugin.linear.description":
    "Linear позволяет агентам показывать назначенные задачи, разбирать бэклог, менять статусы и составлять новые задачи в рабочем пространстве, к которому относится аккаунт. Каждый пользователь входит в свой аккаунт Linear через браузер.",
  "marketplace.plugin.linear.app":
    "Поиск задач, разбор, смена статусов и создание задач через MCP-сервер Linear со входом через браузер.",
  "marketplace.plugin.linear.prompt.myWeek": "Что назначено мне на этой неделе?",
  "marketplace.plugin.linear.prompt.backlog":
    "Разберите бэклог: что устарело, заблокировано или осталось без ответственного?",
  "marketplace.plugin.linear.prompt.newIssue":
    "Заведите задачу о сбое в очереди синхронизации с шагами воспроизведения.",
  "marketplace.plugin.notion.tagline": "Документы и база знаний",
  "marketplace.plugin.notion.description":
    "Notion позволяет агентам читать и писать страницы, искать по рабочему пространству и вести заметки со встреч и спецификации там, где команда уже работает. Каждый пользователь входит в свой аккаунт Notion через браузер.",
  "marketplace.plugin.notion.app":
    "Поиск, чтение и запись страниц и навигация по рабочему пространству через MCP-сервер Notion со входом через браузер.",
  "marketplace.plugin.notion.prompt.findSpec":
    "Найдите актуальную спецификацию запуска и кратко изложите открытые вопросы.",
  "marketplace.plugin.notion.prompt.meetingNotes":
    "Оформите эти пункты как структурированную заметку со встречи в пространстве моей команды.",
  "marketplace.plugin.notion.prompt.updateDoc": "Добавьте в документ по онбордингу новый чек-лист релиза.",
  "marketplace.plugin.figma.tagline": "Дизайны и прототипы",
  "marketplace.plugin.figma.description":
    "Figma позволяет агентам читать файлы дизайна, изучать компоненты, стили и переменные и передавать спецификации разработчикам. Она подключается к MCP-серверу в настольном приложении Figma на этом компьютере. Сервер пока может только читать дизайны; поддержка записи в разработке.",
  "marketplace.plugin.figma.app":
    "Контекст дизайна, метаданные, переменные и скриншоты через MCP-сервер в настольном приложении Figma. Пока только чтение.",
  "marketplace.plugin.figma.prompt.handoff":
    "Подготовьте файл оформления заказа к передаче: перечислите экраны, компоненты и стили.",
  "marketplace.plugin.figma.prompt.audit": "Проверьте этот файл на непоследовательные отступы и использование цветов.",
  "marketplace.plugin.figma.prompt.assets": "Экспортируйте маркетинговые иконки в 2x для сборки приложения.",
  "marketplace.plugin.paper.tagline": "Холст для дизайна на HTML и CSS",
  "marketplace.plugin.paper.description":
    "Paper позволяет агентам читать и изменять файл дизайна, открытый в Paper Desktop: изучать артборды, выделение, вычисленные стили, JSX и токены, а также создавать и менять фреймы, текст и стили. Установите Paper Desktop, запустите его хотя бы раз и откройте файл перед началом работы. OpenBot запускает Paper CLI, который устанавливает Paper Desktop. Ключ для Paper не нужен. Инструменты записи меняют открытый файл, поэтому проверяйте каждое изменение перед тем, как его одобрить.",
  "marketplace.plugin.paper.app":
    "Читает и изменяет открытый файл Paper Desktop через локальный MCP-сервер, к которому подключается Paper CLI. Нужен Paper Desktop с открытым файлом.",
  "marketplace.plugin.paper.prompt.implement":
    "Реализуйте выбранный фрейм Paper в этой кодовой базе по нашим соглашениям о коде.",
  "marketplace.plugin.paper.prompt.codeToDesign":
    "Используйте стили из этого репозитория и сделайте в Paper дизайн страницы настроек.",
  "marketplace.plugin.paper.prompt.tokens":
    "Перечислите токены дизайна в открытом файле Paper и сравните их с нашей темой.",
  "marketplace.plugin.sentry.tagline": "Разбор ошибок и сбоев",
  "marketplace.plugin.sentry.description":
    "Sentry позволяет агентам искать недавние ошибки, изучать стек вызовов и затронутые релизы и кратко описывать, что сломалось после деплоя. Каждый пользователь входит в свой аккаунт Sentry через браузер.",
  "marketplace.plugin.sentry.app":
    "Поиск ошибок, разбор инцидентов и состояние релизов через MCP-сервер Sentry со входом через браузер.",
  "marketplace.plugin.sentry.prompt.newErrors": "Какие новые ошибки появились после вчерашнего деплоя?",
  "marketplace.plugin.sentry.prompt.topCrash":
    "Объясните самый частый сбой в мобильном проекте и его вероятную причину.",
  "marketplace.plugin.sentry.prompt.releaseHealth": "Насколько стабилен текущий релиз по сравнению с предыдущим?",
  "marketplace.plugin.context7.tagline": "Актуальная документация библиотек",
  "marketplace.plugin.context7.description":
    "Context7 получает актуальную документацию и справочники API для библиотек и фреймворков, чтобы ответы учитывали версию, которая действительно используется в проекте. Аккаунт и ключ не нужны.",
  "marketplace.plugin.context7.app": "Поиск по актуальной документации библиотек через MCP-сервер Context7 без входа.",
  "marketplace.plugin.context7.prompt.apiCheck": "Какой сейчас API для виртуализированных списков в этом фреймворке?",
  "marketplace.plugin.context7.prompt.migrate": "Что изменилось между v2 и v3 этого роутера?",
  "marketplace.plugin.context7.prompt.example": "Покажите актуальный пример загрузки файлов с аутентификацией.",
  "marketplace.plugin.stripe.tagline": "Платежи и биллинг",
  "marketplace.plugin.stripe.description":
    "Stripe позволяет агентам искать платежи, клиентов и счета и составлять платёжные ссылки в аккаунте, к которому есть доступ у вошедшего пользователя. Каждый пользователь входит в свой аккаунт Stripe через браузер.",
  "marketplace.plugin.stripe.app": "Поиск платежей, клиентов и счетов через MCP-сервер Stripe со входом через браузер.",
  "marketplace.plugin.stripe.prompt.payment": "Найдите этот платёж и объясните, почему он не прошёл.",
  "marketplace.plugin.stripe.prompt.customer": "Кратко опишите счета этого клиента и его задолженность.",
  "marketplace.plugin.stripe.prompt.link": "Составьте платёжную ссылку на тариф Pro за 49 в месяц.",
  "marketplace.plugin.posthog.tagline": "Продуктовая аналитика и флаги",
  "marketplace.plugin.posthog.description":
    "PostHog позволяет агентам запрашивать события и воронки, проверять флаги функций и кратко описывать, что изменилось после релиза. Персональный ключ API из настроек проекта передаётся в одном заголовке Authorization.",
  "marketplace.plugin.posthog.app":
    "Доступ к событиям, воронкам и флагам функций через MCP-сервер PostHog с персональным ключом API.",
  "marketplace.plugin.posthog.prompt.funnel": "Как выглядит воронка регистрации за последние 14 дней?",
  "marketplace.plugin.posthog.prompt.flag": "Какие флаги функций включены для этого пользователя?",
  "marketplace.plugin.posthog.prompt.release": "Изменилась ли активация после релиза на прошлой неделе?",
  "marketplace.plugin.airtable.tagline": "Базы и записи",
  "marketplace.plugin.airtable.description":
    "Airtable позволяет агентам просматривать базы, читать и обновлять записи и кратко описывать содержимое таблиц. Ключ API со страницы аккаунта передаётся локальному серверу в одной переменной окружения.",
  "marketplace.plugin.airtable.app": "Список баз и доступ к записям через локальный MCP-сервер с ключом API Airtable.",
  "marketplace.plugin.airtable.prompt.bases": "К каким базам у меня есть доступ?",
  "marketplace.plugin.airtable.prompt.records": "Кратко опишите таблицу трекера запуска.",
  "marketplace.plugin.airtable.prompt.update": "Отметьте выпущенные функции как готовые в базе роадмапа.",
  "marketplace.plugin.firecrawl.tagline": "Извлечение данных и поиск в интернете",
  "marketplace.plugin.firecrawl.description":
    "Firecrawl позволяет агентам собирать содержимое страниц, извлекать структурированные данные и искать в интернете через один API. Ключ API из панели Firecrawl передаётся локальному серверу в одной переменной окружения.",
  "marketplace.plugin.firecrawl.app":
    "Сбор страниц, извлечение данных и поиск в интернете через локальный MCP-сервер с ключом API Firecrawl.",
  "marketplace.plugin.firecrawl.prompt.scrape":
    "Извлеките таблицу цен с этой страницы в виде структурированных данных.",
  "marketplace.plugin.firecrawl.prompt.research": "Изучите цены конкурентов и укажите страницу-источник для каждой.",
  "marketplace.plugin.firecrawl.prompt.monitor": "Что изменилось на странице нашего журнала изменений в этом месяце?",
  "marketplace.plugin.braveSearch.tagline": "Приватный поиск в интернете",
  "marketplace.plugin.braveSearch.description":
    "Brave Search позволяет агентам искать в интернете и по местам поблизости без отслеживания. Ключ API из панели Brave Search API передаётся локальному серверу в одной переменной окружения.",
  "marketplace.plugin.braveSearch.app":
    "Поиск в интернете и по местам поблизости через локальный MCP-сервер с ключом API Brave.",
  "marketplace.plugin.braveSearch.prompt.search": "Что пишут обозреватели об этой версии фреймворка?",
  "marketplace.plugin.braveSearch.prompt.news": "Найдите сегодняшние анонсы в этой продуктовой области.",
  "marketplace.plugin.braveSearch.prompt.compare": "Сравните этих двух поставщиков со ссылками на источники.",
  "marketplace.plugin.resend.tagline": "Транзакционная почта",
  "marketplace.plugin.resend.description":
    "Resend позволяет агентам отправлять транзакционные письма и проверять доставку через один API. Ключ API из панели Resend передаётся локальному серверу в одной переменной окружения.",
  "marketplace.plugin.resend.app": "Отправка писем и проверка доставки через локальный MCP-сервер с ключом API Resend.",
  "marketplace.plugin.resend.prompt.send": "Отправьте черновик анонса запуска списку бета-тестеров.",
  "marketplace.plugin.resend.prompt.status": "Дошло ли письмо со счётом до клиента?",
  "marketplace.plugin.resend.prompt.template": "Составьте письмо для сброса пароля для нового сценария.",
  "marketplace.plugin.composio.tagline": "Множество приложений по вашей ссылке Composio",
  "marketplace.plugin.composio.description":
    "Composio подключает агентов к Gmail, Slack, GitHub и сотням других приложений через один MCP-сервер. Создайте сервер в своём аккаунте Composio, добавьте в него нужные приложения и вставьте сюда его ссылку. Ключ API добавляйте, только если ваш сервер его требует.",
  "marketplace.plugin.composio.app":
    "Приложения, которые вы добавили на свой MCP-сервер Composio, по ссылке из вашего аккаунта Composio.",
  "marketplace.plugin.composio.prompt.inbox":
    "Кратко перескажите мои непрочитанные письма и подготовьте ответы на срочные.",
  "marketplace.plugin.composio.prompt.handoff":
    "Опубликуйте краткое описание этого пул-реквеста в канале нашей команды.",
  "marketplace.plugin.composio.prompt.apps": "Какие приложения и действия доступны вам через Composio?",
  "marketplace.skill.installMenu.install": "Установить",
  "marketplace.skill.installMenu.installNamed": "Установить: {name}",
  "marketplace.skill.installMenu.allAgents": "Все агенты",
  "marketplace.skill.installMenu.agents": {
    one: "{count} агент",
    few: "{count} агента",
    many: "{count} агентов",
    other: "{count} агента",
  },
  "marketplace.skill.installMenu.here": "Вы здесь",
  "marketplace.skill.installMenu.change": {
    one: "{label}: установлен «{name}». Изменить",
    few: "{label}: установлен «{name}». Изменить",
    many: "{label}: установлен «{name}». Изменить",
    other: "{label}: установлен «{name}». Изменить",
  },
  "marketplace.skill.doc": "SKILL.md",
  "marketplace.try.in": "Попробовать в {name}",

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
