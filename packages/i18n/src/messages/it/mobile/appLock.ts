import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/appLock";

export const messages = {
  "mobile.appLock.title": "Blocco app",
  "mobile.appLock.method.pin": "Codice PIN",
  "mobile.appLock.method.faceId": "Face ID",
  "mobile.appLock.method.touchId": "Touch ID",
  "mobile.appLock.method.phone": "Sblocco del telefono",
  "mobile.appLock.methods.title": "Sblocca con",
  "mobile.appLock.methods.footer":
    "Attiva un PIN, {method} o entrambi. OpenBot si blocca quando lo lasci e ne chiede uno quando torni.",
  "mobile.appLock.methods.footerPinOnly":
    "Attiva un PIN. OpenBot si blocca quando lo lasci e chiede il PIN quando torni.",
  "mobile.appLock.changePin": "Cambia PIN",
  "mobile.appLock.lockAfter.title": "Blocca OpenBot",
  "mobile.appLock.lockAfter.immediately": "Subito",
  "mobile.appLock.lockAfter.minutes": { one: "Dopo {count} minuto", other: "Dopo {count} minuti" },
  "mobile.appLock.lockAfter.hours": { one: "Dopo {count} ora", other: "Dopo {count} ore" },
  "mobile.appLock.lockWithPhone": "Quando il telefono si blocca",
  "mobile.appLock.lockAfter.footer": "Il tempo parte quando lasci OpenBot. OpenBot si blocca sempre quando si riavvia.",
  "mobile.appLock.device.turnOnPrompt": "Attiva {method} per OpenBot",
  "mobile.appLock.device.failed": "{method} non ha confermato. Riprova.",
  "mobile.appLock.device.unavailable": "Imposta prima un codice sul telefono.",
  "mobile.appLock.pinSetup.title": "Codice PIN",
  "mobile.appLock.pinSetup.enter": "Inserisci un nuovo PIN di 4 cifre",
  "mobile.appLock.pinSetup.confirm": "Inserisci di nuovo il PIN",
  "mobile.appLock.pinSetup.mismatch": "I PIN non corrispondono. Riprova.",
  "mobile.appLock.pinSetup.saveFailed": "Impossibile salvare il PIN. Riprova.",
  "mobile.appLock.lock.title": "OpenBot è bloccato",
  "mobile.appLock.lock.confirmTitle": "Conferma che sei tu",
  "mobile.appLock.lock.enterPin": "Inserisci il PIN",
  "mobile.appLock.lock.unlockPrompt": "Sblocca OpenBot",
  "mobile.appLock.lock.useDevice": "Usa {method}",
  "mobile.appLock.lock.unlock": "Sblocca",
  "mobile.appLock.lock.wrongPin": "PIN errato.",
  "mobile.appLock.lock.attemptsLeft": {
    one: "PIN errato. Ti resta {count} tentativo prima dell'uscita.",
    other: "PIN errato. Ti restano {count} tentativi prima dell'uscita.",
  },
  "mobile.appLock.lock.waitSeconds": {
    one: "Troppi tentativi. Riprova tra {count} secondo.",
    other: "Troppi tentativi. Riprova tra {count} secondi.",
  },
  "mobile.appLock.lock.waitMinutes": {
    one: "Troppi tentativi. Riprova tra {count} minuto.",
    other: "Troppi tentativi. Riprova tra {count} minuti.",
  },
  "mobile.appLock.lock.checkFailed": "Impossibile verificare il PIN. Riprova.",
  "mobile.appLock.lock.pinMissing": "Questo telefono non ha un PIN per OpenBot. Esci per reimpostare il blocco app.",
  "mobile.appLock.lock.loadFailed": "Impossibile leggere le impostazioni del blocco app.",
  "mobile.appLock.lock.retry": "Riprova",
  "mobile.appLock.lock.forgotPin": "PIN dimenticato?",
  "mobile.appLock.lock.signOut": "Esci",
  "mobile.appLock.lock.signOutTitle": "Uscire da OpenBot?",
  "mobile.appLock.lock.signOutBody":
    "Questo rimuove il blocco app e ti disconnette su questo telefono. Per riconnetterti, scansiona un nuovo codice da OpenBot sul desktop.",
  "mobile.appLock.lock.signedOut": "Troppi PIN errati. OpenBot ti ha disconnesso su questo telefono.",
  "mobile.appLock.lock.delete": "Elimina cifra",
  "mobile.appLock.lock.progress": {
    one: "{count} cifra su 4 inserita",
    other: "{count} cifre su 4 inserite",
  },
} as const satisfies PartialTranslation<typeof source>;
