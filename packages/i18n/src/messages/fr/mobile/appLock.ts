import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/appLock";

export const messages = {
  "mobile.appLock.title": "Verrouillage de l’app",
  "mobile.appLock.method.pin": "Code PIN",
  "mobile.appLock.method.faceId": "Face ID",
  "mobile.appLock.method.touchId": "Touch ID",
  "mobile.appLock.method.phone": "Déverrouillage du téléphone",
  "mobile.appLock.methods.title": "Déverrouiller avec",
  "mobile.appLock.methods.footer":
    "Activez un PIN, {method} ou les deux. OpenBot se verrouille alors quand vous le quittez et demande l’un d’eux à votre retour.",
  "mobile.appLock.methods.footerPinOnly":
    "Activez un PIN. OpenBot se verrouille alors quand vous le quittez et demande le PIN à votre retour.",
  "mobile.appLock.changePin": "Modifier le PIN",
  "mobile.appLock.lockAfter.title": "Verrouiller OpenBot",
  "mobile.appLock.lockAfter.immediately": "Immédiatement",
  "mobile.appLock.lockAfter.minutes": { one: "Après {count} minute", other: "Après {count} minutes" },
  "mobile.appLock.lockAfter.hours": { one: "Après {count} heure", other: "Après {count} heures" },
  "mobile.appLock.lockWithPhone": "Au verrouillage du téléphone",
  "mobile.appLock.lockAfter.footer":
    "Le délai commence quand vous quittez OpenBot. OpenBot se verrouille toujours quand il redémarre.",
  "mobile.appLock.device.turnOnPrompt": "Activer {method} pour OpenBot",
  "mobile.appLock.device.failed": "{method} n’a pas confirmé. Réessayez.",
  "mobile.appLock.device.unavailable": "Définissez d’abord un code sur votre téléphone.",
  "mobile.appLock.pinSetup.title": "Code PIN",
  "mobile.appLock.pinSetup.enter": "Saisissez un nouveau PIN à 4 chiffres",
  "mobile.appLock.pinSetup.confirm": "Saisissez de nouveau le PIN",
  "mobile.appLock.pinSetup.mismatch": "Les PIN ne correspondent pas. Réessayez.",
  "mobile.appLock.pinSetup.saveFailed": "Impossible d’enregistrer le PIN. Réessayez.",
  "mobile.appLock.lock.title": "OpenBot est verrouillé",
  "mobile.appLock.lock.confirmTitle": "Confirmez votre identité",
  "mobile.appLock.lock.enterPin": "Saisissez votre PIN",
  "mobile.appLock.lock.unlockPrompt": "Déverrouiller OpenBot",
  "mobile.appLock.lock.useDevice": "Utiliser {method}",
  "mobile.appLock.lock.unlock": "Déverrouiller",
  "mobile.appLock.lock.wrongPin": "PIN incorrect.",
  "mobile.appLock.lock.attemptsLeft": {
    one: "PIN incorrect. Encore {count} essai avant la déconnexion.",
    other: "PIN incorrect. Encore {count} essais avant la déconnexion.",
  },
  "mobile.appLock.lock.waitSeconds": {
    one: "Trop de tentatives. Réessayez dans {count} seconde.",
    other: "Trop de tentatives. Réessayez dans {count} secondes.",
  },
  "mobile.appLock.lock.waitMinutes": {
    one: "Trop de tentatives. Réessayez dans {count} minute.",
    other: "Trop de tentatives. Réessayez dans {count} minutes.",
  },
  "mobile.appLock.lock.checkFailed": "Impossible de vérifier le PIN. Réessayez.",
  "mobile.appLock.lock.pinMissing":
    "Ce téléphone n’a pas de PIN pour OpenBot. Déconnectez-vous pour réinitialiser le verrouillage de l’app.",
  "mobile.appLock.lock.loadFailed": "Impossible de lire les réglages du verrouillage de l’app.",
  "mobile.appLock.lock.retry": "Réessayer",
  "mobile.appLock.lock.forgotPin": "PIN oublié ?",
  "mobile.appLock.lock.signOut": "Se déconnecter",
  "mobile.appLock.lock.signOutTitle": "Se déconnecter d’OpenBot ?",
  "mobile.appLock.lock.signOutBody":
    "Cela supprime le verrouillage de l’app et vous déconnecte sur ce téléphone. Reconnectez-vous en scannant un nouveau code depuis OpenBot sur votre ordinateur.",
  "mobile.appLock.lock.signedOut": "Trop de PIN incorrects. OpenBot vous a déconnecté sur ce téléphone.",
  "mobile.appLock.lock.delete": "Effacer le chiffre",
  "mobile.appLock.lock.progress": {
    one: "{count} chiffre sur 4 saisi",
    other: "{count} chiffres sur 4 saisis",
  },
} as const satisfies PartialTranslation<typeof source>;
