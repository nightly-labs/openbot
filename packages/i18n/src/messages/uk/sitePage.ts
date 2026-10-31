import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/sitePage";

export const messages = {
  "sitePage.error.title": "Не вдалося завантажити сторінку",
  "sitePage.error.body":
    "Перевірте з’єднання й перезавантажте сторінку. Якщо вона все ще не завантажується, поверніться на головну сторінку.",
  "sitePage.error.reload": "Перезавантажити",
  "sitePage.error.home": "На головну",
  "sitePage.join.title": "Приєднатися до сервера OpenBot",
  "sitePage.join.description": "Відкрийте приватне запрошення на сервер в OpenBot.",
  "sitePage.join.eyebrow": "Приватне запрошення",
  "sitePage.join.intro":
    "Відкрийте це запрошення в OpenBot. Застосунок перевірить сервер і попросить підтвердження перед під’єднанням.",
  "sitePage.join.invalid":
    "Це посилання-запрошення недійсне або неповне. Попросіть власника сервера про нове запрошення.",
  "sitePage.join.open": "Відкрити OpenBot",
  "sitePage.join.browser": "Відкрити в браузері",
  "sitePage.join.download": "Завантажити OpenBot",
  "sitePage.join.notOpened":
    "Якщо OpenBot не відкрився, встановіть його кнопкою «{download}» або запустіть OpenBot один раз, щоб він міг відкривати посилання-запрошення. Також можна скористатися кнопкою «{browser}».",
  "sitePage.join.mobile":
    "Якщо OpenBot встановлено, натисніть «{open}». Також можна вставити це посилання в «Додати сервер» у застосунку.",
  "sitePage.join.singleUse":
    "Одноразове посилання працює один раз, після чого стає недійсним. Постійне посилання працює, доки власник його не відкличе. OpenBot показує термін дії, перш ніж ви приєднаєтеся.",
  "sitePage.join.email": "Якщо запрошення надійшло електронною поштою, увійдіть в OpenBot із цією адресою.",
  "sitePage.join.share": "Це посилання дає доступ до сервера. Діліться ним лише з тими, кого хочете запросити.",
  "sitePage.connect.title": "Повернутися до OpenBot",
  "sitePage.connect.failedTitle": "Під’єднання не завершено",
  "sitePage.connect.openApp": "Відкрити OpenBot",
  "sitePage.connect.tryAgainApp": "Повторити в OpenBot",
  "sitePage.connect.tryAgainBrowser": "Повторити в браузері",
  "sitePage.connect.doneInWebClient": "Ваша вкладка OpenBot завершує під’єднання до {name}. Цю вкладку можна закрити.",
  "sitePage.connect.doneInApp": "OpenBot завершує під’єднання до {name} на вашому комп’ютері.",
  "sitePage.connect.failure.cancelled": "Під’єднання до {name} скасовано. Нічого не змінилося.",
  "sitePage.connect.failure.expired": "Час на вхід до {name} минув. Почніть під’єднання знову.",
  "sitePage.connect.failure.exchange": "{name} не підтвердив під’єднання. Спробуйте ще раз.",
  "sitePage.connect.failure.enterprise": "Під’єднайте один робочий простір Slack, а не всю організацію.",
  "sitePage.connect.failure.takenSlack":
    "Інший сервер OpenBot уже відповідає в цьому робочому просторі Slack. Від’єднайте його на тому сервері й спробуйте ще раз.",
  "sitePage.connect.failure.takenDiscord":
    "Інший сервер OpenBot уже відповідає на цьому сервері Discord. Від’єднайте його на тому сервері й спробуйте ще раз.",
  "sitePage.connect.failure.unavailable": "OpenBot зараз не може під’єднатися до {name}. Спробуйте пізніше.",
  "sitePage.connect.failure.tabClosed":
    "Вкладка OpenBot, яка почала під’єднання до {name}, не відповіла. Відкрийте OpenBot у браузері й під’єднайте {name} знову.",
  "sitePage.connect.failure.failed": "{name} не завершив під’єднання. Спробуйте ще раз.",
  "sitePage.connect.restartHint":
    "В OpenBot відкрийте «{marketplace}», потім «{apps}», потім {name} і виберіть «{connect}».",
  "sitePage.connect.notOpened":
    "Запустіть OpenBot і спробуйте ще раз. Якщо OpenBot немає на цьому комп’ютері, завантажте його й під’єднайте {name} у застосунку.",
  "sitePage.openApp.title": "Нічого не відкрилося?",
  "sitePage.openApp.dismiss": "Не зараз",
  "sitePage.billing.pageTitle": "Оплата OpenBot",
  "sitePage.billing.updatedTitle": "Оплату оновлено",
  "sitePage.billing.updatedBody": "Поверніться до OpenBot. Цю сторінку можна закрити.",
  "sitePage.billing.cancelledTitle": "Оплату скасовано",
  "sitePage.billing.cancelledBody": "Кошти не списано. Поверніться до OpenBot.",
  "sitePage.report.pageTitle": "Поскаржитися на розміщений сайт — OpenBot",
  "sitePage.report.title": "Поскаржитися на розміщений сайт",
  "sitePage.report.intro": "Надішліть скаргу на шкідливий або незаконний вміст за адресою openbot.site.",
  "sitePage.report.hostnameLabel": "Адреса сайту",
  "sitePage.report.hostnameMissing": "Введіть адресу сайту",
  "sitePage.report.reasonLabel": "Причина",
  "sitePage.report.reason.phishing": "Фішинг",
  "sitePage.report.reason.malware": "Шкідливе ПЗ",
  "sitePage.report.reason.abuse": "Зловживання",
  "sitePage.report.reason.copyright": "Авторське право",
  "sitePage.report.reason.other": "Інше",
  "sitePage.report.detailsLabel": "Подробиці",
  "sitePage.report.optional": "Необов’язково",
  "sitePage.report.detailsPlaceholder": "Що не так із цим сайтом?",
  "sitePage.report.send": "Надіслати",
  "sitePage.report.sending": "Надсилання…",
  "sitePage.report.tooMany": "Забагато скарг. Спробуйте пізніше.",
  "sitePage.report.sendFailed": "Не вдалося надіслати скаргу. Спробуйте ще раз.",
  "sitePage.report.writeTo": "Також можна написати на {email}.",
  "sitePage.report.sentTitle": "Скаргу надіслано",
  "sitePage.report.sentBody": "Дякуємо. Ми отримали вашу скаргу.",
  "sitePage.report.home": "На головну сторінку",
} as const satisfies PartialTranslation<typeof source>;
