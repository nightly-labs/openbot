import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/appLock";

export const messages = {
  "mobile.appLock.title": "App-Sperre",
  "mobile.appLock.method.pin": "PIN-Code",
  "mobile.appLock.method.faceId": "Face ID",
  "mobile.appLock.method.touchId": "Touch ID",
  "mobile.appLock.method.phone": "Telefonentsperrung",
  "mobile.appLock.methods.title": "Entsperren mit",
  "mobile.appLock.methods.footer":
    "Aktiviere eine PIN, {method} oder beides. OpenBot wird dann gesperrt, wenn du die App verlässt, und fragt bei deiner Rückkehr nach einer der beiden Methoden.",
  "mobile.appLock.methods.footerPinOnly":
    "Aktiviere eine PIN. OpenBot wird dann gesperrt, wenn du die App verlässt, und fragt bei deiner Rückkehr nach der PIN.",
  "mobile.appLock.changePin": "PIN ändern",
  "mobile.appLock.lockAfter.title": "OpenBot sperren",
  "mobile.appLock.lockAfter.immediately": "Sofort",
  "mobile.appLock.lockAfter.minutes": { one: "Nach {count} Minute", other: "Nach {count} Minuten" },
  "mobile.appLock.lockAfter.hours": { one: "Nach {count} Stunde", other: "Nach {count} Stunden" },
  "mobile.appLock.lockWithPhone": "Wenn das Telefon gesperrt wird",
  "mobile.appLock.lockAfter.footer":
    "Die Zeit beginnt, wenn du OpenBot verlässt. OpenBot wird bei jedem Neustart gesperrt.",
  "mobile.appLock.device.turnOnPrompt": "{method} für OpenBot aktivieren",
  "mobile.appLock.device.failed": "{method} wurde nicht bestätigt. Versuche es erneut.",
  "mobile.appLock.device.unavailable": "Lege zuerst einen Code auf deinem Telefon fest.",
  "mobile.appLock.pinSetup.title": "PIN-Code",
  "mobile.appLock.pinSetup.enter": "Gib eine neue 4-stellige PIN ein",
  "mobile.appLock.pinSetup.confirm": "Gib die PIN erneut ein",
  "mobile.appLock.pinSetup.mismatch": "Die PINs stimmen nicht überein. Versuche es erneut.",
  "mobile.appLock.pinSetup.saveFailed": "Die PIN konnte nicht gespeichert werden. Versuche es erneut.",
  "mobile.appLock.lock.title": "OpenBot ist gesperrt",
  "mobile.appLock.lock.confirmTitle": "Bestätige, dass du es bist",
  "mobile.appLock.lock.enterPin": "Gib deine PIN ein",
  "mobile.appLock.lock.unlockPrompt": "OpenBot entsperren",
  "mobile.appLock.lock.useDevice": "{method} verwenden",
  "mobile.appLock.lock.unlock": "Entsperren",
  "mobile.appLock.lock.wrongPin": "Falsche PIN.",
  "mobile.appLock.lock.attemptsLeft": {
    one: "Falsche PIN. Noch {count} Versuch bis zur Abmeldung.",
    other: "Falsche PIN. Noch {count} Versuche bis zur Abmeldung.",
  },
  "mobile.appLock.lock.waitSeconds": {
    one: "Zu viele Versuche. Versuche es in {count} Sekunde erneut.",
    other: "Zu viele Versuche. Versuche es in {count} Sekunden erneut.",
  },
  "mobile.appLock.lock.waitMinutes": {
    one: "Zu viele Versuche. Versuche es in {count} Minute erneut.",
    other: "Zu viele Versuche. Versuche es in {count} Minuten erneut.",
  },
  "mobile.appLock.lock.checkFailed": "Die PIN konnte nicht geprüft werden. Versuche es erneut.",
  "mobile.appLock.lock.pinMissing":
    "Dieses Telefon hat keine PIN für OpenBot. Melde dich ab, um die App-Sperre zurückzusetzen.",
  "mobile.appLock.lock.loadFailed": "Die Einstellungen der App-Sperre konnten nicht gelesen werden.",
  "mobile.appLock.lock.retry": "Wiederholen",
  "mobile.appLock.lock.forgotPin": "PIN vergessen?",
  "mobile.appLock.lock.signOut": "Abmelden",
  "mobile.appLock.lock.signOutTitle": "Von OpenBot abmelden?",
  "mobile.appLock.lock.signOutBody":
    "Dadurch wird die App-Sperre entfernt und du wirst auf diesem Telefon abgemeldet. Verbinde dich erneut, indem du einen neuen Code aus OpenBot auf deinem Desktop scannst.",
  "mobile.appLock.lock.signedOut": "Zu viele falsche PINs. OpenBot hat dich auf diesem Telefon abgemeldet.",
  "mobile.appLock.lock.delete": "Ziffer löschen",
  "mobile.appLock.lock.progress": {
    one: "{count} von 4 Ziffern eingegeben",
    other: "{count} von 4 Ziffern eingegeben",
  },
} as const satisfies PartialTranslation<typeof source>;
