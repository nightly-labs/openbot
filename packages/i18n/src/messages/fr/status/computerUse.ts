import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/computerUse";

export const messages = {
  "status.computerUse.driverNotStarted": "Le pilote Computer Use n’a pas démarré. {reason}",
  "status.computerUse.driverStoppedBeforeAnswer": "Le pilote Computer Use s’est arrêté avant de pouvoir répondre.",
  "status.computerUse.driverNoAnswer": "Le pilote Computer Use n’a pas répondu. {reason}",
  "status.computerUse.driverStopped": "Le pilote Computer Use s’est arrêté.",
  "status.computerUse.unsupported": "Computer Use est disponible sur macOS, Windows et Linux.",
  "status.computerUse.driverMissing": "Cette version d’OpenBot ne contient pas de pilote Computer Use.",
} as const satisfies PartialTranslation<typeof source>;
