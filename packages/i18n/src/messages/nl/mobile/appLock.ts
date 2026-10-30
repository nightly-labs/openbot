import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/appLock";

export const messages = {
  "mobile.appLock.title": "App-vergrendeling",
  "mobile.appLock.method.pin": "Pincode",
  "mobile.appLock.method.faceId": "Face ID",
  "mobile.appLock.method.touchId": "Touch ID",
  "mobile.appLock.method.phone": "Telefoonontgrendeling",
  "mobile.appLock.methods.title": "Ontgrendel met",
  "mobile.appLock.methods.footer":
    "Zet een pincode, {method} of allebei aan. OpenBot wordt dan vergrendeld als je de app verlaat en vraagt om een van beide als je terugkomt.",
  "mobile.appLock.methods.footerPinOnly":
    "Zet een pincode aan. OpenBot wordt dan vergrendeld als je de app verlaat en vraagt om de pincode als je terugkomt.",
  "mobile.appLock.changePin": "Wijzig pincode",
  "mobile.appLock.lockAfter.title": "Vergrendel OpenBot",
  "mobile.appLock.lockAfter.immediately": "Direct",
  "mobile.appLock.lockAfter.minutes": { one: "Na {count} minuut", other: "Na {count} minuten" },
  "mobile.appLock.lockAfter.hours": { one: "Na {count} uur", other: "Na {count} uur" },
  "mobile.appLock.lockWithPhone": "Als de telefoon vergrendelt",
  "mobile.appLock.lockAfter.footer":
    "De tijd start als je OpenBot verlaat. OpenBot wordt altijd vergrendeld als de app opnieuw start.",
  "mobile.appLock.device.turnOnPrompt": "Zet {method} aan voor OpenBot",
  "mobile.appLock.device.failed": "{method} is niet bevestigd. Probeer opnieuw.",
  "mobile.appLock.device.unavailable": "Stel eerst een toegangscode in op je telefoon.",
  "mobile.appLock.pinSetup.title": "Pincode",
  "mobile.appLock.pinSetup.enter": "Voer een nieuwe pincode van 4 cijfers in",
  "mobile.appLock.pinSetup.confirm": "Voer de pincode opnieuw in",
  "mobile.appLock.pinSetup.mismatch": "De pincodes zijn niet gelijk. Probeer opnieuw.",
  "mobile.appLock.pinSetup.saveFailed": "Kan de pincode niet opslaan. Probeer opnieuw.",
  "mobile.appLock.lock.title": "OpenBot is vergrendeld",
  "mobile.appLock.lock.confirmTitle": "Bevestig dat jij het bent",
  "mobile.appLock.lock.enterPin": "Voer je pincode in",
  "mobile.appLock.lock.unlockPrompt": "Ontgrendel OpenBot",
  "mobile.appLock.lock.useDevice": "Gebruik {method}",
  "mobile.appLock.lock.unlock": "Ontgrendel",
  "mobile.appLock.lock.wrongPin": "Onjuiste pincode.",
  "mobile.appLock.lock.attemptsLeft": {
    one: "Onjuiste pincode. Nog {count} poging voordat je wordt uitgelogd.",
    other: "Onjuiste pincode. Nog {count} pogingen voordat je wordt uitgelogd.",
  },
  "mobile.appLock.lock.waitSeconds": {
    one: "Te veel pogingen. Probeer het over {count} seconde opnieuw.",
    other: "Te veel pogingen. Probeer het over {count} seconden opnieuw.",
  },
  "mobile.appLock.lock.waitMinutes": {
    one: "Te veel pogingen. Probeer het over {count} minuut opnieuw.",
    other: "Te veel pogingen. Probeer het over {count} minuten opnieuw.",
  },
  "mobile.appLock.lock.checkFailed": "Kan de pincode niet controleren. Probeer opnieuw.",
  "mobile.appLock.lock.pinMissing":
    "Deze telefoon heeft geen pincode voor OpenBot. Log uit om de app-vergrendeling te resetten.",
  "mobile.appLock.lock.loadFailed": "Kan de instellingen voor app-vergrendeling niet lezen.",
  "mobile.appLock.lock.retry": "Probeer opnieuw",
  "mobile.appLock.lock.forgotPin": "Pincode vergeten?",
  "mobile.appLock.lock.signOut": "Uitloggen",
  "mobile.appLock.lock.signOutTitle": "Uitloggen bij OpenBot?",
  "mobile.appLock.lock.signOutBody":
    "Hiermee verwijder je de app-vergrendeling en log je uit op deze telefoon. Maak opnieuw verbinding door een nieuwe code te scannen in OpenBot op je computer.",
  "mobile.appLock.lock.signedOut": "Te veel onjuiste pincodes. OpenBot heeft je uitgelogd op deze telefoon.",
  "mobile.appLock.lock.delete": "Verwijder cijfer",
  "mobile.appLock.lock.progress": { one: "{count} van 4 cijfers ingevoerd", other: "{count} van 4 cijfers ingevoerd" },
} as const satisfies PartialTranslation<typeof source>;
