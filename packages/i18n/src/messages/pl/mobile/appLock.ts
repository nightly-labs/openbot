import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/appLock";

export const messages = {
  "mobile.appLock.title": "Blokada aplikacji",
  "mobile.appLock.method.pin": "Kod PIN",
  "mobile.appLock.method.faceId": "Face ID",
  "mobile.appLock.method.touchId": "Touch ID",
  "mobile.appLock.method.phone": "Odblokowanie telefonu",
  "mobile.appLock.methods.title": "Odblokuj za pomocą",
  "mobile.appLock.methods.footer":
    "Włącz PIN, {method} lub oba. OpenBot zablokuje się wtedy, gdy go opuścisz, i po powrocie poprosi o jedno z nich.",
  "mobile.appLock.methods.footerPinOnly":
    "Włącz PIN. OpenBot zablokuje się wtedy, gdy go opuścisz, i po powrocie poprosi o PIN.",
  "mobile.appLock.changePin": "Zmień PIN",
  "mobile.appLock.lockAfter.title": "Blokuj OpenBot",
  "mobile.appLock.lockAfter.immediately": "Natychmiast",
  "mobile.appLock.lockAfter.minutes": {
    one: "Po {count} minucie",
    few: "Po {count} minutach",
    many: "Po {count} minutach",
    other: "Po {count} minuty",
  },
  "mobile.appLock.lockAfter.hours": {
    one: "Po {count} godzinie",
    few: "Po {count} godzinach",
    many: "Po {count} godzinach",
    other: "Po {count} godziny",
  },
  "mobile.appLock.lockWithPhone": "Gdy telefon się zablokuje",
  "mobile.appLock.lockAfter.footer":
    "Czas liczy się od opuszczenia OpenBot. OpenBot zawsze blokuje się po ponownym uruchomieniu.",
  "mobile.appLock.device.turnOnPrompt": "Włącz {method} dla OpenBot",
  "mobile.appLock.device.failed": "Nie udało się potwierdzić przez {method}. Spróbuj ponownie.",
  "mobile.appLock.device.unavailable": "Najpierw ustaw kod blokady w telefonie.",
  "mobile.appLock.pinSetup.title": "Kod PIN",
  "mobile.appLock.pinSetup.enter": "Wpisz nowy 4-cyfrowy PIN",
  "mobile.appLock.pinSetup.confirm": "Wpisz PIN ponownie",
  "mobile.appLock.pinSetup.mismatch": "Kody PIN się różnią. Spróbuj ponownie.",
  "mobile.appLock.pinSetup.saveFailed": "Nie udało się zapisać PIN-u. Spróbuj ponownie.",
  "mobile.appLock.lock.title": "OpenBot jest zablokowany",
  "mobile.appLock.lock.confirmTitle": "Potwierdź, że to ty",
  "mobile.appLock.lock.enterPin": "Wpisz swój PIN",
  "mobile.appLock.lock.unlockPrompt": "Odblokuj OpenBot",
  "mobile.appLock.lock.useDevice": "Użyj: {method}",
  "mobile.appLock.lock.unlock": "Odblokuj",
  "mobile.appLock.lock.wrongPin": "Nieprawidłowy PIN.",
  "mobile.appLock.lock.attemptsLeft": {
    one: "Nieprawidłowy PIN. Do wylogowania została {count} próba.",
    few: "Nieprawidłowy PIN. Do wylogowania zostały {count} próby.",
    many: "Nieprawidłowy PIN. Do wylogowania zostało {count} prób.",
    other: "Nieprawidłowy PIN. Do wylogowania zostało {count} próby.",
  },
  "mobile.appLock.lock.waitSeconds": {
    one: "Zbyt wiele prób. Spróbuj ponownie za {count} sekundę.",
    few: "Zbyt wiele prób. Spróbuj ponownie za {count} sekundy.",
    many: "Zbyt wiele prób. Spróbuj ponownie za {count} sekund.",
    other: "Zbyt wiele prób. Spróbuj ponownie za {count} sekundy.",
  },
  "mobile.appLock.lock.waitMinutes": {
    one: "Zbyt wiele prób. Spróbuj ponownie za {count} minutę.",
    few: "Zbyt wiele prób. Spróbuj ponownie za {count} minuty.",
    many: "Zbyt wiele prób. Spróbuj ponownie za {count} minut.",
    other: "Zbyt wiele prób. Spróbuj ponownie za {count} minuty.",
  },
  "mobile.appLock.lock.checkFailed": "Nie udało się sprawdzić PIN-u. Spróbuj ponownie.",
  "mobile.appLock.lock.pinMissing":
    "Ten telefon nie ma PIN-u dla OpenBot. Wyloguj się, aby zresetować blokadę aplikacji.",
  "mobile.appLock.lock.loadFailed": "Nie udało się odczytać ustawień blokady aplikacji.",
  "mobile.appLock.lock.retry": "Ponów",
  "mobile.appLock.lock.forgotPin": "Nie pamiętasz PIN-u?",
  "mobile.appLock.lock.signOut": "Wyloguj się",
  "mobile.appLock.lock.signOutTitle": "Wylogować się z OpenBot?",
  "mobile.appLock.lock.signOutBody":
    "Spowoduje to usunięcie blokady aplikacji i wylogowanie na tym telefonie. Połącz się ponownie, skanując nowy kod z OpenBot na komputerze.",
  "mobile.appLock.lock.signedOut": "Zbyt wiele nieprawidłowych PIN-ów. OpenBot wylogował cię na tym telefonie.",
  "mobile.appLock.lock.delete": "Usuń cyfrę",
  "mobile.appLock.lock.progress": {
    one: "Wpisano {count} z 4 cyfr",
    few: "Wpisano {count} z 4 cyfr",
    many: "Wpisano {count} z 4 cyfr",
    other: "Wpisano {count} z 4 cyfr",
  },
} as const satisfies PartialTranslation<typeof source>;
