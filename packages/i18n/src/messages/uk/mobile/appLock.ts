import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/appLock";

export const messages = {
  "mobile.appLock.title": "Блокування застосунку",
  "mobile.appLock.method.pin": "PIN-код",
  "mobile.appLock.method.faceId": "Face ID",
  "mobile.appLock.method.touchId": "Touch ID",
  "mobile.appLock.method.phone": "Розблокування телефона",
  "mobile.appLock.methods.title": "Спосіб розблокування",
  "mobile.appLock.methods.footer":
    "Увімкніть PIN-код, {method} або обидва способи. Тоді OpenBot блокуватиметься, коли ви з нього виходите, і після повернення запитає один із них.",
  "mobile.appLock.methods.footerPinOnly":
    "Увімкніть PIN-код. Тоді OpenBot блокуватиметься, коли ви з нього виходите, і після повернення запитає PIN-код.",
  "mobile.appLock.changePin": "Змінити PIN-код",
  "mobile.appLock.lockAfter.title": "Блокувати OpenBot",
  "mobile.appLock.lockAfter.immediately": "Одразу",
  "mobile.appLock.lockAfter.minutes": {
    one: "Через {count} хвилину",
    few: "Через {count} хвилини",
    many: "Через {count} хвилин",
    other: "Через {count} хвилини",
  },
  "mobile.appLock.lockAfter.hours": {
    one: "Через {count} годину",
    few: "Через {count} години",
    many: "Через {count} годин",
    other: "Через {count} години",
  },
  "mobile.appLock.lockWithPhone": "Під час блокування телефона",
  "mobile.appLock.lockAfter.footer":
    "Відлік починається, коли ви виходите з OpenBot. Під час кожного запуску OpenBot блокується.",
  "mobile.appLock.device.turnOnPrompt": "Увімкнути для OpenBot: {method}",
  "mobile.appLock.device.failed": "{method}: не вдалося підтвердити. Спробуйте ще раз.",
  "mobile.appLock.device.unavailable": "Спочатку встановіть код-пароль на телефоні.",
  "mobile.appLock.pinSetup.title": "PIN-код",
  "mobile.appLock.pinSetup.enter": "Введіть новий 4-значний PIN-код",
  "mobile.appLock.pinSetup.confirm": "Введіть PIN-код ще раз",
  "mobile.appLock.pinSetup.mismatch": "PIN-коди не збігаються. Спробуйте ще раз.",
  "mobile.appLock.pinSetup.saveFailed": "Не вдалося зберегти PIN-код. Спробуйте ще раз.",
  "mobile.appLock.lock.title": "OpenBot заблоковано",
  "mobile.appLock.lock.confirmTitle": "Підтвердьте, що це ви",
  "mobile.appLock.lock.enterPin": "Введіть PIN-код",
  "mobile.appLock.lock.unlockPrompt": "Розблокувати OpenBot",
  "mobile.appLock.lock.useDevice": "Використати: {method}",
  "mobile.appLock.lock.unlock": "Розблокувати",
  "mobile.appLock.lock.wrongPin": "Неправильний PIN-код.",
  "mobile.appLock.lock.attemptsLeft": {
    one: "Неправильний PIN-код. До виходу залишилася {count} спроба.",
    few: "Неправильний PIN-код. До виходу залишилося {count} спроби.",
    many: "Неправильний PIN-код. До виходу залишилося {count} спроб.",
    other: "Неправильний PIN-код. До виходу залишилося {count} спроби.",
  },
  "mobile.appLock.lock.waitSeconds": {
    one: "Забагато спроб. Спробуйте через {count} секунду.",
    few: "Забагато спроб. Спробуйте через {count} секунди.",
    many: "Забагато спроб. Спробуйте через {count} секунд.",
    other: "Забагато спроб. Спробуйте через {count} секунди.",
  },
  "mobile.appLock.lock.waitMinutes": {
    one: "Забагато спроб. Спробуйте через {count} хвилину.",
    few: "Забагато спроб. Спробуйте через {count} хвилини.",
    many: "Забагато спроб. Спробуйте через {count} хвилин.",
    other: "Забагато спроб. Спробуйте через {count} хвилини.",
  },
  "mobile.appLock.lock.checkFailed": "Не вдалося перевірити PIN-код. Спробуйте ще раз.",
  "mobile.appLock.lock.pinMissing":
    "На цьому телефоні немає PIN-коду для OpenBot. Вийдіть, щоб скинути блокування застосунку.",
  "mobile.appLock.lock.loadFailed": "Не вдалося прочитати налаштування блокування застосунку.",
  "mobile.appLock.lock.retry": "Повторити",
  "mobile.appLock.lock.forgotPin": "Забули PIN-код?",
  "mobile.appLock.lock.signOut": "Вийти",
  "mobile.appLock.lock.signOutTitle": "Вийти з OpenBot?",
  "mobile.appLock.lock.signOutBody":
    "Блокування застосунку буде знято, і ви вийдете з облікового запису на цьому телефоні. Щоб під’єднатися знову, відскануйте новий код в OpenBot на комп’ютері.",
  "mobile.appLock.lock.signedOut": "Забагато неправильних PIN-кодів. OpenBot завершив ваш сеанс на цьому телефоні.",
  "mobile.appLock.lock.delete": "Видалити цифру",
  "mobile.appLock.lock.progress": {
    one: "Введено {count} цифру з 4",
    few: "Введено {count} цифри з 4",
    many: "Введено {count} цифр з 4",
    other: "Введено {count} цифри з 4",
  },
} as const satisfies PartialTranslation<typeof source>;
