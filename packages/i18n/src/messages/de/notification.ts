import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/notification";

export const messages = {
  "notification.needsInput": "Braucht deine Eingabe.",
  "notification.needsApproval": "Braucht deine Genehmigung.",
  "notification.needsBrowserStep": "Braucht dich für einen Schritt im Browser.",
  "notification.needsApprovalFor": "Braucht deine Genehmigung: {action}",
  "notification.finished": "Arbeit abgeschlossen.",
  // A workflow step that waits for a person to approve or reject it.
  "notification.workflowApproval": "Ein Schritt wartet auf deine Freigabe.",
  // A workflow output step that tells the user its result.
  "notification.workflowOutput": "Ein Workflow hat ein neues Ergebnis.",
  "notification.failed": "Mit einem Fehler gestoppt.",
  "notification.channelTitle": "{agent} in {channel}",
  "notification.channelMessage": "Hat eine Nachricht gesendet.",
  "notification.usageLimit.title": "Das {provider}-Konto hat sein Limit erreicht",
  "notification.usageLimit.body": {
    one: "{count} Agent wartet. OpenBot versucht es später erneut.",
    other: "{count} Agenten warten. OpenBot versucht es später erneut.",
  },
  "notification.usageLimit.bodyResets": {
    one: "{count} Agent wartet. Das Limit wird {reset} zurückgesetzt.",
    other: "{count} Agenten warten. Das Limit wird {reset} zurückgesetzt.",
  },
  "notification.machineAlert.disk": "{server}: Datenträger zu {percent} voll",
  "notification.machineAlert.memory": "{server}: Arbeitsspeicher zu {percent} belegt",
  "notification.machineAlert.cpu": "{server}: CPU zu {percent} ausgelastet",
  "notification.machineAlert.body":
    "Der Warnwert von {level} wurde überschritten. Siehe Servereinstellungen → Speicher.",
  "notification.test": "Benachrichtigungen funktionieren.",
  "notification.welcome": "OpenBot informiert dich hier, wenn ein Agent dich braucht.",
  "notification.toast.region": "Benachrichtigungen",
  "notification.toast.close": "Benachrichtigung schließen",
} as const satisfies PartialTranslation<typeof source>;
