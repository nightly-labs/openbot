import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/appLock";

export const messages = {
  "mobile.appLock.title": "Блокировка приложения",
  "mobile.appLock.method.pin": "PIN-код",
  "mobile.appLock.method.faceId": "Face ID",
  "mobile.appLock.method.touchId": "Touch ID",
  "mobile.appLock.method.phone": "Разблокировка телефона",
  "mobile.appLock.methods.title": "Способ разблокировки",
  "mobile.appLock.methods.footer":
    "Включите PIN-код, {method} или оба способа. Тогда OpenBot будет блокироваться, когда вы выходите из него, и при возвращении запросит один из них.",
  "mobile.appLock.methods.footerPinOnly":
    "Включите PIN-код. Тогда OpenBot будет блокироваться, когда вы выходите из него, и при возвращении запросит PIN-код.",
  "mobile.appLock.changePin": "Изменить PIN-код",
  "mobile.appLock.lockAfter.title": "Блокировать OpenBot",
  "mobile.appLock.lockAfter.immediately": "Сразу",
  "mobile.appLock.lockAfter.minutes": {
    one: "Через {count} минуту",
    few: "Через {count} минуты",
    many: "Через {count} минут",
    other: "Через {count} минуты",
  },
  "mobile.appLock.lockAfter.hours": {
    one: "Через {count} час",
    few: "Через {count} часа",
    many: "Через {count} часов",
    other: "Через {count} часа",
  },
  "mobile.appLock.lockWithPhone": "При блокировке телефона",
  "mobile.appLock.lockAfter.footer":
    "Отсчёт начинается, когда вы выходите из OpenBot. При каждом запуске OpenBot блокируется.",
  "mobile.appLock.device.turnOnPrompt": "Включить для OpenBot: {method}",
  "mobile.appLock.device.failed": "{method}: не удалось подтвердить. Повторите попытку.",
  "mobile.appLock.device.unavailable": "Сначала установите код-пароль на телефоне.",
  "mobile.appLock.pinSetup.title": "PIN-код",
  "mobile.appLock.pinSetup.enter": "Введите новый 4-значный PIN-код",
  "mobile.appLock.pinSetup.confirm": "Введите PIN-код ещё раз",
  "mobile.appLock.pinSetup.mismatch": "PIN-коды не совпадают. Повторите попытку.",
  "mobile.appLock.pinSetup.saveFailed": "Не удалось сохранить PIN-код. Повторите попытку.",
  "mobile.appLock.lock.title": "OpenBot заблокирован",
  "mobile.appLock.lock.confirmTitle": "Подтвердите, что это вы",
  "mobile.appLock.lock.enterPin": "Введите PIN-код",
  "mobile.appLock.lock.unlockPrompt": "Разблокировать OpenBot",
  "mobile.appLock.lock.useDevice": "Использовать: {method}",
  "mobile.appLock.lock.unlock": "Разблокировать",
  "mobile.appLock.lock.wrongPin": "Неверный PIN-код.",
  "mobile.appLock.lock.attemptsLeft": {
    one: "Неверный PIN-код. До выхода осталась {count} попытка.",
    few: "Неверный PIN-код. До выхода осталось {count} попытки.",
    many: "Неверный PIN-код. До выхода осталось {count} попыток.",
    other: "Неверный PIN-код. До выхода осталось {count} попытки.",
  },
  "mobile.appLock.lock.waitSeconds": {
    one: "Слишком много попыток. Повторите через {count} секунду.",
    few: "Слишком много попыток. Повторите через {count} секунды.",
    many: "Слишком много попыток. Повторите через {count} секунд.",
    other: "Слишком много попыток. Повторите через {count} секунды.",
  },
  "mobile.appLock.lock.waitMinutes": {
    one: "Слишком много попыток. Повторите через {count} минуту.",
    few: "Слишком много попыток. Повторите через {count} минуты.",
    many: "Слишком много попыток. Повторите через {count} минут.",
    other: "Слишком много попыток. Повторите через {count} минуты.",
  },
  "mobile.appLock.lock.checkFailed": "Не удалось проверить PIN-код. Повторите попытку.",
  "mobile.appLock.lock.pinMissing":
    "На этом телефоне нет PIN-кода для OpenBot. Выйдите, чтобы сбросить блокировку приложения.",
  "mobile.appLock.lock.loadFailed": "Не удалось прочитать настройки блокировки приложения.",
  "mobile.appLock.lock.retry": "Повторить",
  "mobile.appLock.lock.forgotPin": "Забыли PIN-код?",
  "mobile.appLock.lock.signOut": "Выйти",
  "mobile.appLock.lock.signOutTitle": "Выйти из OpenBot?",
  "mobile.appLock.lock.signOutBody":
    "Блокировка приложения будет снята, и вы выйдете из аккаунта на этом телефоне. Чтобы подключиться снова, отсканируйте новый код в OpenBot на компьютере.",
  "mobile.appLock.lock.signedOut": "Слишком много неверных PIN-кодов. OpenBot выполнил выход на этом телефоне.",
  "mobile.appLock.lock.delete": "Удалить цифру",
  "mobile.appLock.lock.progress": {
    one: "Введена {count} цифра из 4",
    few: "Введено {count} цифры из 4",
    many: "Введено {count} цифр из 4",
    other: "Введено {count} цифры из 4",
  },
} as const satisfies PartialTranslation<typeof source>;
