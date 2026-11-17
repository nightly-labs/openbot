import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/computerUse";

export const messages = {
  "status.computerUse.driverNotStarted": "Le pilote Computer Use n’a pas démarré. {reason}",
  "status.computerUse.driverStoppedBeforeAnswer": "Le pilote Computer Use s’est arrêté avant de pouvoir répondre.",
  "status.computerUse.driverNoAnswer": "Le pilote Computer Use n’a pas répondu. {reason}",
  "status.computerUse.driverStopped": "Le pilote Computer Use s’est arrêté.",
  "status.computerUse.unsupported": "Computer Use est disponible sur macOS, Windows et Linux.",
  "status.computerUse.driverMissing": "Cette version d’OpenBot ne contient pas de pilote Computer Use.",
  "status.computerUse.restartRequired":
    "macOS empêche toujours OpenBot de cliquer et de saisir, bien que les deux autorisations soient activées. Redémarrez OpenBot. Si cela se reproduit, cliquez sur Gérer à côté d’Accessibilité, retirez OpenBot de la liste, ajoutez-le de nouveau, puis redémarrez OpenBot.",
  "status.computerUse.progressActing": "Utilisation d’une application sur cet ordinateur…",
  "status.computerUse.progressDeciding": "Choix de la prochaine étape dans l’application…",
} as const satisfies PartialTranslation<typeof source>;
