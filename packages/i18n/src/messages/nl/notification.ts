import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/notification";

export const messages = {
  "notification.needsInput": "Heeft je input nodig.",
  "notification.needsApproval": "Heeft je goedkeuring nodig.",
  "notification.needsBrowserStep": "Je moet een stap in de browser afronden.",
  "notification.needsApprovalFor": "Heeft je goedkeuring nodig: {action}",
  "notification.finished": "Klaar met werken.",
  "notification.workflowApproval": "Een stap wacht op je goedkeuring.",
  "notification.workflowOutput": "Een workflow heeft een nieuw resultaat.",
  "notification.failed": "Gestopt met een fout.",
  "notification.channelTitle": "{agent} in {channel}",
  "notification.channelMessage": "Heeft een bericht gestuurd.",
  "notification.usageLimit.title": "Account van {provider} heeft de limiet bereikt",
  "notification.usageLimit.body": {
    one: "{count} agent wacht. OpenBot probeert het later opnieuw.",
    other: "{count} agents wachten. OpenBot probeert het later opnieuw.",
  },
  "notification.usageLimit.bodyResets": {
    one: "{count} agent wacht. Reset op {reset}.",
    other: "{count} agents wachten. Reset op {reset}.",
  },
  "notification.machineAlert.disk": "{server}: schijf {percent} vol",
  "notification.machineAlert.memory": "{server}: geheugen {percent} gebruikt",
  "notification.machineAlert.cpu": "{server}: CPU {percent} bezet",
  "notification.machineAlert.body": "Het alarmniveau van {level} is overschreden. Zie Serverinstellingen > Opslag.",
  "notification.test": "Meldingen werken.",
  "notification.welcome": "OpenBot laat je hier weten wanneer een agent je nodig heeft.",
  "notification.toast.region": "Meldingen",
  "notification.toast.close": "Melding sluiten",
} as const satisfies PartialTranslation<typeof source>;
