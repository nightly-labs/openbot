import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/marketplace";

export const messages = {
  "marketplace.category.coding": "Програмування",
  "marketplace.category.design": "Дизайн",
  "marketplace.category.dataAnalytics": "Дані й аналітика",
  "marketplace.category.documents": "Документи",
  "marketplace.category.productivity": "Продуктивність",
  "marketplace.category.research": "Дослідження",
  "marketplace.category.automation": "Автоматизація",
  "marketplace.category.other": "Інше",
  "marketplace.loadFailed": "Не вдалося завантажити каталог.",
  "marketplace.loading.skills": "Завантаження навичок",
  "marketplace.loading.agents": "Завантаження агентів",
  "marketplace.noMatch.skills": "За цим запитом навичок не знайдено.",
  "marketplace.noMatch.agents": "За цим запитом агентів не знайдено.",
  "marketplace.loadMore": "Завантажити ще",
  "marketplace.version": "Версія {version}",

  "marketplace.title": "Каталог",
  "marketplace.kinds": "Типи вмісту каталогу",
  "marketplace.tab.agents": "Агенти",
  "marketplace.tab.skills": "Навички",
  "marketplace.description.apps": "Під’єднайте інструменти й сервіси, з якими працюють ваші агенти.",
  "marketplace.description.agents": "Готові агенти з власними інструкціями та навичками.",
  "marketplace.description.skills":
    "Інструкції, що навчають агента виконувати завдання або користуватися інструментом.",

  "marketplace.plugins.missing": "Цього плагіна немає в каталозі OpenBot.",

  "marketplace.agents.loadingDetail": "Завантаження відомостей про агента…",
  "marketplace.agents.skills": "Навички",
  "marketplace.agents.routines": "Регулярні завдання",
  "marketplace.agents.routineActive": "Активне",
  "marketplace.agents.routineInactive": "Неактивне",

  "marketplace.skill.loading": "Завантаження навички",
  "marketplace.skill.update": "Оновити навичку",
  "marketplace.try.readFailed": "OpenBot не вдалося прочитати навички цього агента. Спробуйте ще раз.",
  "marketplace.try.enable": "Щоб спробувати цю навичку, увімкніть її в налаштуваннях агента.",
  "marketplace.try.repair": "Щоб спробувати цю навичку, відновіть її в налаштуваннях агента.",
  "marketplace.try.update": "Щоб спробувати цю версію, оновіть навичку.",
  "marketplace.try.composerUnavailable": "Поле введення агента недоступне.",

  "marketplace.open": "Відкрити: {name}",
  "marketplace.tab.apps": "Застосунки",
  "marketplace.crumbs.label": "Розташування",
  "marketplace.search.label": "Пошук у каталозі",
  "marketplace.search.placeholder": "Пошук",
  "marketplace.installs": {
    one: "{installs} встановлення",
    few: "{installs} встановлення",
    many: "{installs} встановлень",
    other: "{installs} встановлення",
  },
  "marketplace.filter": "Фільтр",
  "marketplace.filter.on": "Фільтр: {filters}",
  "marketplace.filter.all": "Усі",
  "marketplace.filter.status": "Статус",
  "marketplace.filter.category": "Категорія",
  "marketplace.filter.added": "Додані",
  "marketplace.filter.notAdded": "Не додані",
  "marketplace.filter.installed": "Встановлені",
  "marketplace.filter.notInstalled": "Не встановлені",
  "marketplace.filter.clear": "Скинути фільтри",
  "marketplace.noMatch.apps": "За цим запитом застосунків не знайдено.",
  "marketplace.noMatch.filters": "Ніщо не відповідає фільтрам.",
  "marketplace.noMatch.showAgents": {
    one: "Показати {count} агента",
    few: "Показати {count} агенти",
    many: "Показати {count} агентів",
    other: "Показати {count} агента",
  },
  "marketplace.noMatch.showApps": {
    one: "Показати {count} застосунок",
    few: "Показати {count} застосунки",
    many: "Показати {count} застосунків",
    other: "Показати {count} застосунку",
  },
  "marketplace.noMatch.showSkills": {
    one: "Показати {count} навичку",
    few: "Показати {count} навички",
    many: "Показати {count} навичок",
    other: "Показати {count} навички",
  },
  "marketplace.empty.agents": "У каталозі ще немає агентів.",
  "marketplace.empty.apps": "У каталозі ще немає застосунків.",
  "marketplace.empty.skills": "У каталозі ще немає навичок.",
  "marketplace.properties.agent": "Про цього агента",
  "marketplace.properties.skill": "Про цю навичку",
  "marketplace.properties.creator": "Автор",
  "marketplace.properties.category": "Категорія",
  "marketplace.properties.version": "Версія",
  "marketplace.properties.updated": "Оновлено",
  "marketplace.properties.installs": "Встановлення",

  "marketplace.agent.add": "Додати",
  "marketplace.agent.addNamed": "Додати: {name}",
  "marketplace.agent.addAgent": "Додати агента",
  "marketplace.agent.added": "Додано",
  "marketplace.agent.updateAvailable": "Доступне оновлення",
  "marketplace.agent.update": "Оновити",
  "marketplace.agent.openChat": "Відкрити чат",

  "marketplace.app.connect": "Під’єднати",
  "marketplace.app.reconnect": "Під’єднати знову",
  "marketplace.app.connectNamed": "Під’єднати: {name}",
  "marketplace.app.reconnectNamed": "Під’єднати знову: {name}",
  "marketplace.app.connected": "Під’єднано",
  "marketplace.app.attention": "Потребує уваги",
  "marketplace.app.partialTitle": "{name}: встановлення не завершено",
  "marketplace.app.partialDescription":
    "Частину застосунків або навичок не встановлено. «Під’єднати знову» встановить їх.",
  "marketplace.app.notConnected": "Не під’єднано",
  "marketplace.app.custom": "Сервер MCP",
  "marketplace.app.githubTagline": "Репозиторії, задачі й пул-реквести",
  "marketplace.app.onePasswordTagline": "Вхід на сайти зі спільними обліковими даними",
  "marketplace.app.slackTagline": "Згадки й особисті повідомлення в Slack",
  "marketplace.app.discordTagline": "Згадки й особисті повідомлення в Discord",
  "marketplace.app.telegramTagline": "Групи й особисті чати в Telegram",
  "marketplace.app.bitwardenTagline": "Вхід на сайти з обліковими даними зі спільної папки",
  "marketplace.app.onePasswordCategory": "Керування логінами й обліковими даними",
  "marketplace.app.yourApps": "Ваші застосунки",
  "marketplace.app.addCustom": "Додати власний",
  "marketplace.app.server": "Сервер",
  "marketplace.app.command": "Команда",
  "marketplace.app.address": "Адреса",
  "marketplace.app.disconnect.title": "Від’єднати {name}",
  "marketplace.app.disconnect.description":
    "Видалити «{name}» і його навички з цього комп’ютера. Пізніше його можна під’єднати знову.",
  "marketplace.app.disconnect.action": "Від’єднати",
  "marketplace.app.remove.title": "Видалити сервер",
  "marketplace.app.remove.description":
    "Ваші агенти більше не зможуть використовувати цей сервер. Його налаштування буде видалено.",
  "marketplace.app.remove.action": "Видалити",
  "marketplace.app.remove.confirmTitle": "Видалити «{name}»?",
  "marketplace.app.remove.keep": "Залишити",
  "marketplace.app.connection": "З’єднання",
  "marketplace.app.setup.account": "Увійдіть в обліковий запис {name} у браузері.",
  "marketplace.app.setup.key": "Потрібен ключ API з облікового запису {name}.",
  "marketplace.app.setup.keySaved": "{field} зберігається на {host}.",
  "marketplace.app.setup.desktop": "Працює в настільному застосунку {name} за адресою {address}.",
  "marketplace.app.setup.desktopConnected": "Під’єднано до {address}.",
  "marketplace.app.setup.open": "Вхід і ключ не потрібні.",
  "marketplace.app.connectAgain": "Під’єднати знову",
  "marketplace.app.signInTitle": "Знову увійти в {name}",
  "marketplace.app.signInDescription":
    "«{name}» відхилив збережений вхід. Агенти не зможуть ним користуватися, доки ви знову не ввійдете.",

  "marketplace.plugin.aave.tagline": "Дані й транзакції Aave",
  "marketplace.plugin.aave.description":
    "Aave допомагає вивчати ринки Aave V3 і V4 у реальному часі, переглядати позиції гаманця й відомості про управління DAO, моделювати операції кредитування та готувати некастодіальні транзакції. Кожна транзакція повертається непідписаною: плагін читає ринки й складає виклик, а гаманець залишається у вас.",
  "marketplace.plugin.aave.app":
    "Ринки V3 і V4 у реальному часі, позиції гаманця, управління DAO та підготовлені транзакції через один сервер MCP.",
  "marketplace.plugin.aave.prompt.stablecoinYield": "Де в Aave зараз найвища дохідність за стейблкоїнами?",
  "marketplace.plugin.aave.prompt.usdcRates": "Де зараз вища ставка за USDC: в Aave V3 чи V4 в Ethereum?",
  "marketplace.plugin.aave.prompt.healthFactor":
    "Який коефіцієнт здоров’я у 0x0a42b2f3a0d54157dbd7cc346335a4f1909fc02c і наскільки близька ліквідація?",
  "marketplace.plugin.canva.tagline": "Дизайни, ресурси й експорт",
  "marketplace.plugin.canva.description":
    "Canva дає змогу створювати й редагувати дизайни за текстовим описом, шукати у власній бібліотеці дизайнів, завантажувати й упорядковувати ресурси, експортувати у форматі, потрібному для каналу, і залишати коментарі безпосередньо в дизайнах. Кожен користувач входить у свій обліковий запис Canva, і агентові доступне те саме, що й цьому обліковому запису.",
  "marketplace.plugin.canva.app":
    "Створення й редагування дизайнів, пошук у бібліотеці, керування ресурсами й брендом, експорт і коментарі через один сервер MCP.",
  "marketplace.plugin.canva.prompt.recentDesign": "Покажіть мій останній відредагований дизайн у Canva.",
  "marketplace.plugin.canva.prompt.socialResize":
    "Змініть розмір постера до запуску для Instagram і експортуйте обидва варіанти в PNG.",
  "marketplace.plugin.canva.prompt.deckFromNotes":
    "Зробіть із цих нотаток до релізу презентацію Canva на шість слайдів.",
  "marketplace.plugin.linear.tagline": "Задачі й розбір проєктів",
  "marketplace.plugin.linear.description":
    "Linear дає змогу агентам показувати призначені задачі, розбирати беклог, змінювати статуси й складати нові задачі в робочому просторі, до якого належить обліковий запис. Кожен користувач входить у свій обліковий запис Linear через браузер.",
  "marketplace.plugin.linear.app":
    "Пошук задач, розбір, зміна статусів і створення задач через сервер MCP Linear із входом через браузер.",
  "marketplace.plugin.linear.prompt.myWeek": "Що призначено мені цього тижня?",
  "marketplace.plugin.linear.prompt.backlog":
    "Розберіть беклог: що застаріло, заблоковано або залишилося без відповідального?",
  "marketplace.plugin.linear.prompt.newIssue": "Створіть задачу про збій у черзі синхронізації з кроками відтворення.",
  "marketplace.plugin.notion.tagline": "Документи й база знань",
  "marketplace.plugin.notion.description":
    "Notion дає змогу агентам читати й писати сторінки, шукати в робочому просторі та вести нотатки зустрічей і специфікації там, де команда вже працює. Кожен користувач входить у свій обліковий запис Notion через браузер.",
  "marketplace.plugin.notion.app":
    "Пошук, читання й запис сторінок і навігація робочим простором через сервер MCP Notion із входом через браузер.",
  "marketplace.plugin.notion.prompt.findSpec":
    "Знайдіть актуальну специфікацію запуску й коротко викладіть відкриті питання.",
  "marketplace.plugin.notion.prompt.meetingNotes":
    "Оформіть ці пункти як структуровану нотатку зустрічі в просторі моєї команди.",
  "marketplace.plugin.notion.prompt.updateDoc": "Додайте до документа з онбордингу новий чекліст релізу.",
  "marketplace.plugin.cobrain.tagline": "Спільна пам’ять для ваших ШІ-агентів",
  "marketplace.plugin.cobrain.description":
    "Cobrain — це пам’ять у форматі Markdown, яку може читати й доповнювати будь-який під’єднаний ШІ. Перед роботою агенти завантажують контекст клієнта чи проєкту, шукають минулі нотатки й рішення та зберігають те, що дізналися, щоб наступна гілка починалася там, де закінчилася попередня. Кожен користувач входить у свій обліковий запис Cobrain.",
  "marketplace.plugin.cobrain.app": "Читання, пошук і запис нотаток у вашому Cobrain через один сервер MCP.",
  "marketplace.plugin.cobrain.prompt.startSession":
    "Завантажте мій контекст Cobrain для цього проєкту, перш ніж ми почнемо.",
  "marketplace.plugin.cobrain.prompt.searchDecision": "Знайдіть у моїх нотатках Cobrain, що ми вирішили щодо цін.",
  "marketplace.plugin.cobrain.prompt.saveNote":
    "Збережіть у Cobrain нотатку про те, що ми зробили сьогодні й що залишилося.",
  "marketplace.plugin.figma.tagline": "Дизайни й прототипи",
  "marketplace.plugin.figma.description":
    "Figma дає змогу агентам читати файли дизайну, вивчати компоненти, стилі й змінні та передавати специфікації розробникам. Вона під’єднується до сервера MCP у настільному застосунку Figma на цьому комп’ютері. Сервер поки може лише читати дизайни; підтримка запису в розробці.",
  "marketplace.plugin.figma.app":
    "Контекст дизайну, метадані, змінні й скриншоти через сервер MCP у настільному застосунку Figma. Поки лише читання.",
  "marketplace.plugin.figma.prompt.handoff":
    "Підготуйте файл оформлення замовлення до передачі: перелічіть екрани, компоненти й стилі.",
  "marketplace.plugin.figma.prompt.audit": "Перевірте цей файл на непослідовні відступи й використання кольорів.",
  "marketplace.plugin.figma.prompt.assets": "Експортуйте маркетингові іконки у 2x для збірки застосунку.",
  "marketplace.plugin.paper.tagline": "Полотно для дизайну на HTML і CSS",
  "marketplace.plugin.paper.description":
    "Paper дає змогу агентам читати й змінювати файл дизайну, відкритий у Paper Desktop: вивчати артборди, виділення, обчислені стилі, JSX і токени, а також створювати й змінювати фрейми, текст і стилі. Установіть Paper Desktop, запустіть його хоча б раз і відкрийте файл перед початком роботи. OpenBot запускає Paper CLI, який установлює Paper Desktop. Ключ для Paper не потрібен. Інструменти запису змінюють відкритий файл, тому перевіряйте кожну зміну, перш ніж її схвалити.",
  "marketplace.plugin.paper.app":
    "Читає й змінює відкритий файл Paper Desktop через локальний сервер MCP, доступ до якого надає Paper CLI. Потрібен Paper Desktop із відкритим файлом.",
  "marketplace.plugin.paper.prompt.implement":
    "Реалізуйте вибраний фрейм Paper у цій кодовій базі за нашими домовленостями щодо коду.",
  "marketplace.plugin.paper.prompt.codeToDesign":
    "Використайте стилі з цього репозиторію й зробіть у Paper дизайн сторінки налаштувань.",
  "marketplace.plugin.paper.prompt.tokens":
    "Перелічіть токени дизайну у відкритому файлі Paper і порівняйте їх із нашою темою.",
  "marketplace.plugin.appleApps.tagline": "Mail, Calendar та інше на вашому Mac",
  "marketplace.plugin.appleApps.description":
    "Apple apps дає змогу агентам працювати із застосунками Mail, Calendar, Contacts, Reminders, Notes, Messages і Safari на цьому Mac. Працює лише в macOS. OpenBot запускає mcp-icloud — сервер спільноти, який не створено ні Apple, ні OpenBot. Сервер керує застосунками через AppleScript на цьому комп’ютері, і йому не потрібні ні обліковий запис, ні ключ. Коли агент уперше використовує застосунок, macOS запитує, чи може OpenBot ним керувати. Щоб змінити це пізніше, відкрийте System Settings › Privacy & Security › Automation. Агенти можуть надсилати листи й iMessage, а також змінювати чи видаляти події, контакти й нагадування, тому перевіряйте кожну зміну перед підтвердженням. Те, що читають інструменти, наприклад текст листів, передається провайдеру моделі агента.",
  "marketplace.plugin.appleApps.app":
    "Пошта, Календар, Контакти, Нагадування, Нотатки, Повідомлення і Safari через локальний сервер mcp-icloud. Потрібні macOS і доступ до автоматизації.",
  "marketplace.plugin.appleApps.prompt.unread": "Коротко перекажіть мої непрочитані листи за сьогодні в Apple Mail.",
  "marketplace.plugin.appleApps.prompt.today": "Що в мене в Apple Calendar сьогодні й завтра?",
  "marketplace.plugin.appleApps.prompt.schedule":
    "Знайдіть останній лист про зустріч щодо проєкту й додайте цю зустріч до мого календаря.",
  "marketplace.plugin.sentry.tagline": "Розбір помилок і збоїв",
  "marketplace.plugin.sentry.description":
    "Sentry дає змогу агентам шукати нещодавні помилки, вивчати стек викликів і зачеплені релізи та коротко описувати, що зламалося після деплою. Кожен користувач входить у свій обліковий запис Sentry через браузер.",
  "marketplace.plugin.sentry.app":
    "Пошук помилок, розбір інцидентів і стан релізів через сервер MCP Sentry із входом через браузер.",
  "marketplace.plugin.sentry.prompt.newErrors": "Які нові помилки з’явилися після вчорашнього деплою?",
  "marketplace.plugin.sentry.prompt.topCrash":
    "Поясніть найчастіший збій у мобільному проєкті та його ймовірну причину.",
  "marketplace.plugin.sentry.prompt.releaseHealth": "Наскільки стабільний поточний реліз порівняно з попереднім?",
  "marketplace.plugin.vercel.tagline": "Деплої, логи збірки й проєкти",
  "marketplace.plugin.vercel.description":
    "Vercel дає змогу агентам переглядати проєкти й останні деплої, читати логи збірки та виконання й з’ясовувати, чому збірка не вдалася. Кожен користувач входить у свій обліковий запис Vercel через браузер і вибирає команди, які можуть використовувати агенти. У цих командах агенти мають ті самі права, що й обліковий запис користувача. Вони також можуть змінювати змінні середовища, домени, DNS-записи й деплої, а також купувати домени.",
  "marketplace.plugin.vercel.app":
    "Проєкти, деплої, логи збірки й виконання через сервер MCP Vercel із входом через браузер.",
  "marketplace.plugin.vercel.prompt.failedBuild": "Чому не вдався останній продакшен-деплой?",
  "marketplace.plugin.vercel.prompt.recentDeployments": "Покажіть сьогоднішні деплої та їхній статус.",
  "marketplace.plugin.vercel.prompt.runtimeErrors": "На яких маршрутах були помилки виконання за останню годину?",
  "marketplace.plugin.cloudflare.tagline": "Workers, DNS, сховища й логи",
  "marketplace.plugin.cloudflare.description":
    "Cloudflare дає змогу агентам переглядати Workers, DNS-записи, R2, D1 і KV та керувати ними через API Cloudflare, запитувати логи Workers і шукати в документації Cloudflare. Кожен користувач входить у свій обліковий запис Cloudflare через браузер. На сторінці згоди Cloudflare виберіть Read only: з варіантом за замовчуванням, Minimal, агенти не бачать Workers, логів і DNS-записів. З дозволами на запис агенти можуть розгортати й видаляти Workers, змінювати DNS-записи та інші налаштування облікового запису.",
  "marketplace.plugin.cloudflare.app":
    "Workers, DNS, сховища й логи через MCP-сервер API Cloudflare із входом у браузері.",
  "marketplace.plugin.cloudflare.prompt.workers": "Які Workers розгорнуто в моєму обліковому записі Cloudflare?",
  "marketplace.plugin.cloudflare.prompt.errors": "Які Cloudflare Workers записали помилки за останню годину?",
  "marketplace.plugin.cloudflare.prompt.dns": "Покажіть DNS-записи кожної зони в моєму обліковому записі Cloudflare.",
  "marketplace.plugin.supabase.tagline": "Бази даних, логи й edge functions",
  "marketplace.plugin.supabase.description":
    "Supabase дає змогу агентам переглядати проєкти, виконувати SQL, читати схеми таблиць і логи, перевіряти рекомендації щодо безпеки й продуктивності, керувати edge functions і гілками та шукати в документації Supabase. Кожен користувач входить у свій обліковий запис Supabase через браузер і вибирає організацію. Агенти отримують повний доступ: вони можуть виконувати SQL, що змінює або видаляє дані, застосовувати міграції, розгортати edge functions, створювати й призупиняти проєкти.",
  "marketplace.plugin.supabase.app":
    "Бази даних, логи й edge functions через MCP-сервер Supabase із входом у браузері.",
  "marketplace.plugin.supabase.prompt.projects": "Які проєкти є в моїй організації Supabase?",
  "marketplace.plugin.supabase.prompt.tables": "Покажіть таблиці й стовпці моєї бази даних Supabase.",
  "marketplace.plugin.supabase.prompt.errors": "Які помилки записав мій проєкт Supabase за останню годину?",
  "marketplace.plugin.context7.tagline": "Актуальна документація бібліотек",
  "marketplace.plugin.context7.description":
    "Context7 отримує актуальну документацію й довідники API для бібліотек і фреймворків, щоб відповіді враховували версію, яка справді використовується в проєкті. Обліковий запис і ключ не потрібні.",
  "marketplace.plugin.context7.app": "Пошук в актуальній документації бібліотек через сервер MCP Context7 без входу.",
  "marketplace.plugin.context7.prompt.apiCheck": "Який зараз API для віртуалізованих списків у цьому фреймворку?",
  "marketplace.plugin.context7.prompt.migrate": "Що змінилося між v2 і v3 цього роутера?",
  "marketplace.plugin.context7.prompt.example": "Покажіть актуальний приклад завантаження файлів з автентифікацією.",
  "marketplace.plugin.stripe.tagline": "Огляд платежів і білінгу",
  "marketplace.plugin.stripe.description":
    "Stripe дає змогу агентам шукати платежі, клієнтів і рахунки та складати платіжні посилання в обліковому записі, до якого має доступ користувач, що ввійшов. Кожен користувач входить у свій обліковий запис Stripe через браузер.",
  "marketplace.plugin.stripe.app":
    "Пошук платежів, клієнтів і рахунків через сервер MCP Stripe із входом через браузер.",
  "marketplace.plugin.stripe.prompt.payment": "Знайдіть цей платіж і поясніть, чому він не пройшов.",
  "marketplace.plugin.stripe.prompt.customer": "Коротко опишіть рахунки цього клієнта та його заборгованість.",
  "marketplace.plugin.stripe.prompt.link": "Складіть платіжне посилання на тариф Pro за 49 на місяць.",
  "marketplace.plugin.posthog.tagline": "Продуктова аналітика й прапорці",
  "marketplace.plugin.posthog.description":
    "PostHog дає змогу агентам запитувати події та воронки, перевіряти прапорці функцій і коротко описувати, що змінилося після релізу. Персональний API-ключ із налаштувань проєкту передається в одному заголовку Authorization.",
  "marketplace.plugin.posthog.app":
    "Доступ до подій, воронок і прапорців функцій через сервер MCP PostHog із персональним API-ключем.",
  "marketplace.plugin.posthog.prompt.funnel": "Який вигляд має воронка реєстрації за останні 14 днів?",
  "marketplace.plugin.posthog.prompt.flag": "Які прапорці функцій увімкнено для цього користувача?",
  "marketplace.plugin.posthog.prompt.release": "Чи змінилася активація після релізу минулого тижня?",
  "marketplace.plugin.airtable.tagline": "Бази й записи",
  "marketplace.plugin.airtable.description":
    "Airtable дає змогу агентам переглядати бази, читати й оновлювати записи та коротко описувати вміст таблиць. Ключ API зі сторінки облікового запису передається локальному серверу в одній змінній середовища.",
  "marketplace.plugin.airtable.app": "Список баз і доступ до записів через локальний сервер MCP з API-ключем Airtable.",
  "marketplace.plugin.airtable.prompt.bases": "До яких баз я маю доступ?",
  "marketplace.plugin.airtable.prompt.records": "Коротко опишіть таблицю трекера запуску.",
  "marketplace.plugin.airtable.prompt.update": "Позначте випущені функції як готові в базі дорожньої карти.",
  "marketplace.plugin.firecrawl.tagline": "Видобування даних і пошук в інтернеті",
  "marketplace.plugin.firecrawl.description":
    "Firecrawl дає змогу агентам збирати вміст сторінок, видобувати структуровані дані й шукати в інтернеті через один API. Ключ API з панелі Firecrawl передається локальному серверу в одній змінній середовища.",
  "marketplace.plugin.firecrawl.app":
    "Збирання сторінок, видобування даних і пошук в інтернеті через локальний сервер MCP з API-ключем Firecrawl.",
  "marketplace.plugin.firecrawl.prompt.scrape":
    "Видобудьте таблицю цін із цієї сторінки у вигляді структурованих даних.",
  "marketplace.plugin.firecrawl.prompt.research": "Дослідіть ціни конкурентів і вкажіть сторінку-джерело для кожної.",
  "marketplace.plugin.firecrawl.prompt.monitor": "Що змінилося на сторінці нашого журналу змін цього місяця?",
  "marketplace.plugin.braveSearch.tagline": "Приватний пошук в інтернеті",
  "marketplace.plugin.braveSearch.description":
    "Brave Search дає змогу агентам шукати в інтернеті й місця поблизу без стеження. Ключ API з панелі Brave Search API передається локальному серверу в одній змінній середовища.",
  "marketplace.plugin.braveSearch.app":
    "Пошук в інтернеті й місць поблизу через локальний сервер MCP з API-ключем Brave.",
  "marketplace.plugin.braveSearch.prompt.search": "Що пишуть оглядачі про цю версію фреймворку?",
  "marketplace.plugin.braveSearch.prompt.news": "Знайдіть сьогоднішні анонси в цій продуктовій галузі.",
  "marketplace.plugin.braveSearch.prompt.compare": "Порівняйте цих двох постачальників із посиланнями на джерела.",
  "marketplace.plugin.obsidian.tagline": "Нотатки у вашому сховищі",
  "marketplace.plugin.obsidian.description":
    "Obsidian дає змогу агентам шукати, читати й записувати нотатки у вашому сховищі, і сховище стає їхньою пам’яттю. Локальний сервер під’єднується до плагіна Local REST API в застосунку Obsidian на цьому комп’ютері. API-ключ плагіна передається локальному серверу в одній змінній середовища. Не закривайте Obsidian, поки агенти з ним працюють.",
  "marketplace.plugin.obsidian.app":
    "Пошук, читання й редагування нотаток через локальний MCP-сервер із ключем плагіна Local REST API.",
  "marketplace.plugin.obsidian.prompt.recall": "Що сказано в моїх нотатках про рішення щодо цього проєкту?",
  "marketplace.plugin.obsidian.prompt.save": "Збережіть це рішення як нову нотатку в моєму сховищі.",
  "marketplace.plugin.obsidian.prompt.log": "Додайте підсумок сьогоднішньої роботи до моєї нотатки «Work log».",
  "marketplace.plugin.obsidian.hint.apiKey":
    "В Obsidian відкрийте Settings > Local REST API. Скопіюйте API-ключ і ввімкніть «Enable non-encrypted (HTTP) server».",
  "marketplace.plugin.resend.tagline": "Транзакційна пошта",
  "marketplace.plugin.resend.description":
    "Resend дає змогу агентам надсилати транзакційні листи й перевіряти доставку через один API. Ключ API з панелі Resend передається локальному серверу в одній змінній середовища.",
  "marketplace.plugin.resend.app":
    "Надсилання листів і перевірка доставки через локальний сервер MCP з API-ключем Resend.",
  "marketplace.plugin.resend.prompt.send": "Надішліть чернетку анонсу запуску списку бета-тестувальників.",
  "marketplace.plugin.resend.prompt.status": "Чи дійшов лист із рахунком до клієнта?",
  "marketplace.plugin.resend.prompt.template": "Складіть лист для скидання пароля для нового сценарію.",
  "marketplace.plugin.composio.tagline": "Багато застосунків за вашим посиланням Composio",
  "marketplace.plugin.composio.description":
    "Composio під’єднує агентів до Gmail, Slack, GitHub і сотень інших застосунків через один сервер MCP. Під’єднайте потрібні застосунки у своєму обліковому записі Composio й вставте сюди його URL MCP і ключ API.",
  "marketplace.plugin.composio.app":
    "Застосунки, які ви додали на свій сервер MCP Composio, за посиланням із вашого облікового запису Composio.",
  "marketplace.plugin.composio.prompt.inbox":
    "Коротко перекажіть мої непрочитані листи й підготуйте відповіді на термінові.",
  "marketplace.plugin.composio.prompt.handoff": "Опублікуйте короткий опис цього пул-реквесту в каналі нашої команди.",
  "marketplace.plugin.composio.prompt.apps": "Які застосунки й дії доступні вам через Composio?",
  "marketplace.plugin.composio.hint.url": "URL сервера MCP у вашому обліковому записі Composio",
  "marketplace.plugin.composio.hint.apiKey":
    "Його можна знайти в обліковому записі Composio, у розділі Settings > Sessions & API Key.",
  "marketplace.plugin.neon.tagline": "Проєкти, гілки й міграції Postgres",
  "marketplace.plugin.neon.description":
    "Neon дає змогу агентам переглядати проєкти й гілки, виконувати SQL, читати схеми таблиць, перевіряти зміни схеми в тимчасовій гілці, знаходити повільні запити й шукати в документації Neon. Кожен користувач входить у свій обліковий запис Neon через браузер і під час авторизації може вибрати доступ лише для читання. З повним доступом агенти можуть виконувати SQL, що змінює або видаляє дані, а також створювати, скидати й видаляти гілки, бази даних і проєкти. Neon рекомендує свій сервер MCP для розробки й тестування, а не для продакшен-баз даних.",
  "marketplace.plugin.neon.app":
    "Проєкти, гілки, SQL і міграції Postgres через сервер MCP Neon із входом через браузер.",
  "marketplace.plugin.neon.prompt.projects": "Які проєкти й гілки є в моєму обліковому записі Neon?",
  "marketplace.plugin.neon.prompt.slowQueries": "Які запити найповільніші в моїй базі даних Neon і чому?",
  "marketplace.plugin.neon.prompt.migration":
    "Додайте індекс до таблиці orders у тимчасовій гілці й покажіть мені результат, перш ніж застосовувати його.",
  "marketplace.plugin.prisma.tagline": "Бази даних Postgres, резервні копії й застосунки Compute",
  "marketplace.plugin.prisma.description":
    "Prisma дає змогу агентам переглядати й створювати бази даних Prisma Postgres, читати схеми, виконувати SQL, переглядати резервні копії та відновлювати їх у нову базу даних, керувати бакетами Object Storage, читати збірки й логи Compute та шукати в документації Prisma. Кожен користувач входить у свій обліковий запис Prisma через браузер і вибирає робочий простір. Агенти отримують повний доступ: вони можуть виконувати SQL, що змінює або видаляє дані, оновлювати схеми, видаляти бази даних і бакети, а також зупиняти, відкочувати й видаляти деплої Compute.",
  "marketplace.plugin.prisma.app":
    "Бази даних, SQL, резервні копії й застосунки Compute через сервер MCP Prisma із входом через браузер.",
  "marketplace.plugin.prisma.prompt.databases": "Які бази даних є в моєму робочому просторі Prisma?",
  "marketplace.plugin.prisma.prompt.backups": "Покажіть усі доступні резервні копії моєї бази даних.",
  "marketplace.plugin.prisma.prompt.logs": "Покажіть логи виконання мого останнього деплою Compute.",
  "marketplace.plugin.netlify.tagline": "Проєкти, деплої й логи запитів",
  "marketplace.plugin.netlify.description":
    "Netlify дає змогу агентам переглядати проєкти й деплої, читати логи запитів на edge, створювати проєкти й деплоїти код в наявний проєкт. Кожен користувач входить у свій обліковий запис Netlify через браузер. Агенти мають той самий доступ, що й обліковий запис користувача: вони можуть змінювати змінні середовища, форми й доступ відвідувачів, установлювати й видаляти розширення, а також видаляти надіслані форми й змінні середовища.",
  "marketplace.plugin.netlify.app":
    "Проєкти, деплої, логи запитів і налаштування сайту через сервер MCP Netlify із входом через браузер.",
  "marketplace.plugin.netlify.prompt.latestDeploy": "Який статус останнього деплою кожного з моїх проєктів Netlify?",
  "marketplace.plugin.netlify.prompt.errors": "Які URL мого сайту повернули помилки сервера за останню добу?",
  "marketplace.plugin.netlify.prompt.deploy": "Задеплойте цю папку в мій наявний проєкт Netlify.",
  "marketplace.plugin.railway.tagline": "Проєкти, сервіси й деплої",
  "marketplace.plugin.railway.description":
    "Railway дає змогу агентам переглядати проєкти й сервіси, створювати проєкти, повторно деплоїти сервіси й керувати прапорцями функцій. Агенти також можуть передати багатокрокову роботу Railway Agent: він читає логи, з’ясовує, чому деплой не вдався, створює сервіси й задає змінні. Кожен користувач входить у свій обліковий запис Railway через браузер і вибирає робочі простори й проєкти, які можуть використовувати агенти. У цих проєктах агенти мають повний доступ: вони можуть деплоїти підготовлені зміни, видаляти прапорці функцій, а через Railway Agent — змінювати сервіси, змінні, бази даних і мережу.",
  "marketplace.plugin.railway.app": "Проєкти, сервіси й деплої через сервер MCP Railway із входом через браузер.",
  "marketplace.plugin.railway.prompt.projects": "Які проєкти й сервіси є в моєму робочому просторі Railway?",
  "marketplace.plugin.railway.prompt.crash": "Чому мій бекенд-сервіс на Railway падає під час деплою?",
  "marketplace.plugin.railway.prompt.redeploy": "Повторно задеплойте сервіс API в моєму проєкті Railway.",
  "marketplace.plugin.render.tagline": "Сервіси, деплої й логи",
  "marketplace.plugin.render.description":
    "Render дає змогу агентам переглядати робочі простори й сервіси, читати логи, події та метрики, переглядати історію деплоїв, запускати деплої й виконувати SQL лише для читання в Render Postgres. API-ключ Render передається в одному заголовку Authorization. Ключ дає доступ до всіх робочих просторів облікового запису Render. Агенти можуть створювати вебсервіси, статичні сайти, cron-завдання, бази даних Postgres та екземпляри Key Value, що може коштувати грошей, а також замінювати змінні середовища сервісу. Сервер не може видалити жоден ресурс.",
  "marketplace.plugin.render.app": "Сервіси, деплої, логи й метрики через сервер MCP Render з API-ключем.",
  "marketplace.plugin.render.prompt.services": "Які сервіси є в моєму робочому просторі Render?",
  "marketplace.plugin.render.prompt.logs": "Які помилки записав мій вебсервіс на Render за останню годину?",
  "marketplace.plugin.render.prompt.deploy": "Чому останній деплой мого сервісу на Render не вдався?",
  "marketplace.plugin.atlassian.tagline": "Робочі елементи Jira й сторінки Confluence",
  "marketplace.plugin.atlassian.description":
    "Atlassian дає змогу агентам шукати й читати робочі елементи Jira, сторінки Confluence та пул-реквести Bitbucket, а також створювати й оновлювати робочі елементи, сторінки й коментарі. Кожен користувач входить у свій обліковий запис Atlassian через браузер і підтверджує доступ на екрані згоди. Агенти мають ті самі дозволи, що й користувач: вони можуть змінювати робочі елементи й сторінки, змінювати дозволи доступу до сторінок і зливати пул-реквести. Інструменти, що видаляють дані Jira, залишаються вимкненими, доки адміністратор організації їх не ввімкне. Кожен виклик інструмента витрачає кредити Rovo.",
  "marketplace.plugin.atlassian.app":
    "Jira, Confluence і Bitbucket через сервер MCP Atlassian із входом через браузер.",
  "marketplace.plugin.atlassian.prompt.assigned": "Які відкриті робочі елементи Jira призначено мені?",
  "marketplace.plugin.atlassian.prompt.releasePage":
    "Знайдіть сторінку Confluence про наш процес релізу й коротко викладіть її.",
  "marketplace.plugin.atlassian.prompt.newItem":
    "Створіть робочий елемент Jira для помилки входу з кроками для відтворення.",
  "marketplace.plugin.todoist.tagline": "Завдання, проєкти й нагадування",
  "marketplace.plugin.todoist.description":
    "Todoist дає змогу агентам знаходити завдання за датою, текстом, міткою чи фільтром, додавати завдання й переносити їхні терміни, а також керувати проєктами, розділами, мітками, коментарями й нагадуваннями. Кожен користувач входить у свій обліковий запис Todoist через браузер. Агенти отримують доступ на читання й запис: вони можуть змінювати, завершувати й видаляти завдання, проєкти та інші елементи.",
  "marketplace.plugin.todoist.app": "Завдання, проєкти й нагадування через сервер MCP Todoist із входом через браузер.",
  "marketplace.plugin.todoist.prompt.today": "Які завдання в Todoist треба виконати сьогодні?",
  "marketplace.plugin.todoist.prompt.capture": "Додайте ці завдання до мого Todoist Inbox.",
  "marketplace.plugin.todoist.prompt.overdue": "Перенесіть мої прострочені завдання в Todoist на завтра.",
  "marketplace.plugin.trello.tagline": "Дошки, списки й картки",
  "marketplace.plugin.trello.description":
    "З Trello агенти шукають і читають дошки, списки, картки, чеклісти й коментарі, створюють дошки й картки, переміщують списки й картки, позначають картки виконаними й додають чеклісти, коментарі та мітки. Агенти також можуть читати й додавати картки в Trello Inbox користувача й читати події Planner, які можуть надходити з під’єднаного календаря Google чи Outlook. Кожен користувач входить у свій обліковий запис Trello через браузер і вибирає робочі простори на екрані згоди. У цих робочих просторах агенти мають ті самі дозволи, що й користувач. Вони можуть архівувати картки й списки, але сервер не може нічого видалити назавжди.",
  "marketplace.plugin.trello.app": "Дошки, списки й картки через сервер MCP Trello із входом через браузер.",
  "marketplace.plugin.trello.prompt.myCards": "Які картки в Trello призначено мені?",
  "marketplace.plugin.trello.prompt.board": "Коротко опишіть, що зараз у роботі на моїй дошці Trello.",
  "marketplace.plugin.trello.prompt.newCards": "Додайте ці пункти як картки на мою дошку Trello.",
  "marketplace.plugin.huggingface.tagline": "Моделі, датасети й статті на Hub",
  "marketplace.plugin.huggingface.description":
    "Hugging Face дає змогу агентам шукати моделі, датасети, Spaces, колекції та статті на Hugging Face Hub, читати картки моделей і файли репозиторіїв, переглядати датасети й шукати в документації Hugging Face. Він використовує публічні дані Hub і не потребує ні облікового запису, ні ключа. Інструменти лише читають дані: агенти не можуть створювати репозиторії чи запускати завдання.",
  "marketplace.plugin.huggingface.app":
    "Пошук моделей, датасетів, Spaces, статей і документації через сервер MCP Hugging Face без входу.",
  "marketplace.plugin.huggingface.prompt.models":
    "Знайдіть на Hugging Face невеликі відкриті моделі для розпізнавання мовлення.",
  "marketplace.plugin.huggingface.prompt.papers": "Які статті сьогодні в тренді на Hugging Face?",
  "marketplace.plugin.huggingface.prompt.dataset":
    "Знайдіть датасет із часовими рядами погоди й покажіть його стовпці.",
  "marketplace.auth.apiKey": "API-ключ",
  "marketplace.auth.personalApiKey": "Особистий API-ключ",
  "marketplace.auth.mcpUrl": "URL MCP",
  "marketplace.auth.createKey": "Створити ключ",
  "marketplace.skill.installMenu.install": "Встановити",
  "marketplace.skill.installMenu.installNamed": "Встановити: {name}",
  "marketplace.skill.installMenu.allAgents": "Усі агенти",
  "marketplace.skill.installMenu.agents": {
    one: "{count} агент",
    few: "{count} агенти",
    many: "{count} агентів",
    other: "{count} агента",
  },
  "marketplace.skill.installMenu.here": "Ви тут",
  "marketplace.skill.installMenu.change": {
    one: "{label}: встановлено «{name}». Змінити",
    few: "{label}: встановлено «{name}». Змінити",
    many: "{label}: встановлено «{name}». Змінити",
    other: "{label}: встановлено «{name}». Змінити",
  },
  "marketplace.skill.doc": "SKILL.md",
  "marketplace.try.in": "Спробувати в {name}",

  "marketplace.notice.agentAdded": "Агента «{name}» додано.",
  "marketplace.notice.agentUpdated": "Агента «{name}» оновлено.",
  "marketplace.notice.appConnected": "«{name}» під’єднано.",
  "marketplace.notice.appDisconnected": "«{name}» від’єднано.",
  "marketplace.notice.serverRemoved": "Сервер «{name}» видалено.",
  "marketplace.notice.skillInstalled": {
    one: "Навичку «{name}» встановлено для {count} агента.",
    few: "Навичку «{name}» встановлено для {count} агентів.",
    many: "Навичку «{name}» встановлено для {count} агентів.",
    other: "Навичку «{name}» встановлено для {count} агента.",
  },
  "marketplace.notice.skillRemoved": {
    one: "Навичку «{name}» видалено в {count} агента.",
    few: "Навичку «{name}» видалено в {count} агентів.",
    many: "Навичку «{name}» видалено в {count} агентів.",
    other: "Навичку «{name}» видалено в {count} агента.",
  },
  "marketplace.error.skillPartial": "Навичку «{name}» не змінено в цих агентів: {agents}. {reason}",

  "marketplace.error.openLink": "Не вдалося відкрити посилання.",
  "marketplace.error.copyLink": "Не вдалося скопіювати посилання.",
  "marketplace.error.connectNoServer": "Виберіть локальний сервер, щоб під’єднати цей застосунок.",
  "marketplace.error.installNoServer": "Виберіть локальний сервер, щоб установити плагін.",
  "marketplace.error.installNoAgent": "Виберіть агента, щоб установити навички цього плагіна.",
  "marketplace.error.installLocalOnHost":
    "Установіть «{name}» на комп’ютері, де працюють ці агенти: застосунок запускає свій сервер на цьому комп’ютері.",
  "marketplace.error.installOnHost":
    "Установіть «{name}» на комп’ютері, де працюють ці агенти: застосунку потрібен вхід через браузер.",
  "marketplace.error.appInvalid": "Неможливо додати «{name}»: {reason}",
  "marketplace.error.uninstallNoServer": "Виберіть локальний сервер, щоб видалити плагін.",
  "marketplace.error.uninstallPartial": "Частину «{name}» не вдалося видалити. {failures}",
  "marketplace.error.actionFailed": "Не вдалося виконати дію в каталозі. Спробуйте ще раз.",
  "marketplace.thisAgent": "цей агент",
} as const satisfies PartialTranslation<typeof source>;
