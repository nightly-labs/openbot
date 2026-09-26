import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/notification";

export const messages = {
  // Desktop notifications, raised by the main process while the window may be closed.
  "notification.needsInput": "Nécessite votre réponse.",
  "notification.needsApproval": "Nécessite votre approbation.",
  "notification.finished": "Travail terminé.",
  "notification.failed": "Arrêté à cause d’une erreur.",
  "notification.test": "Les notifications fonctionnent.",
  "notification.welcome": "OpenBot vous préviendra ici quand un agent aura besoin de vous.",
} as const satisfies PartialTranslation<typeof source>;
