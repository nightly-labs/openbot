import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/notification";

export const messages = {
  "notification.needsInput": "Braucht deine Eingabe.",
  "notification.needsApproval": "Braucht deine Genehmigung.",
  "notification.finished": "Arbeit abgeschlossen.",
  "notification.failed": "Mit einem Fehler gestoppt.",
  "notification.usageLimit.title": "Das {provider}-Konto hat sein Limit erreicht",
  "notification.usageLimit.body": {
    one: "{count} Agent wartet. OpenBot versucht es später erneut.",
    other: "{count} Agenten warten. OpenBot versucht es später erneut.",
  },
  "notification.usageLimit.bodyResets": {
    one: "{count} Agent wartet. Wird {reset} zurückgesetzt.",
    other: "{count} Agenten warten. Wird {reset} zurückgesetzt.",
  },
  "notification.test": "Benachrichtigungen funktionieren.",
  "notification.welcome": "OpenBot informiert dich hier, wenn ein Agent dich braucht.",
  "notification.toast.region": "Benachrichtigungen",
  "notification.toast.close": "Benachrichtigung schließen",
} as const satisfies PartialTranslation<typeof source>;
