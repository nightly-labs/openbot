import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/notification";

export const messages = {
  // Desktop notifications, raised by the main process while the window may be closed, and browser
  // notifications, raised by the web client while its tab is open.
  "notification.needsInput": "Nécessite votre réponse.",
  "notification.needsApproval": "Nécessite votre approbation.",
  "notification.needsBrowserStep": "Vous devez terminer une étape dans le navigateur.",
  "notification.needsApprovalFor": "Nécessite votre approbation : {action}",
  "notification.finished": "Travail terminé.",
  // A workflow step that waits for a person to approve or reject it.
  "notification.workflowApproval": "Une étape attend votre approbation.",
  // A workflow output step that tells the user its result.
  "notification.workflowOutput": "Un workflow a un nouveau résultat.",
  "notification.failed": "Arrêté à cause d’une erreur.",
  "notification.channelTitle": "{agent} dans {channel}",
  "notification.channelMessage": "A envoyé un message.",
  "notification.usageLimit.title": "Le compte {provider} a atteint sa limite",
  "notification.usageLimit.body": {
    one: "{count} agent attend. OpenBot réessaiera plus tard.",
    other: "{count} agents attendent. OpenBot réessaiera plus tard.",
  },
  "notification.usageLimit.bodyResets": {
    one: "{count} agent attend. La limite se réinitialise {reset}.",
    other: "{count} agents attendent. La limite se réinitialise {reset}.",
  },
  "notification.machineAlert.disk": "{server} : disque plein à {percent}",
  "notification.machineAlert.memory": "{server} : mémoire utilisée à {percent}",
  "notification.machineAlert.cpu": "{server} : CPU occupé à {percent}",
  "notification.machineAlert.body": "Le seuil d’alerte de {level} est dépassé. Voir Réglages du serveur > Stockage.",
  "notification.test": "Les notifications fonctionnent.",
  "notification.welcome": "OpenBot vous préviendra ici quand un agent aura besoin de vous.",
  // The toast region in each window.
  "notification.toast.region": "Notifications",
  "notification.toast.close": "Fermer la notification",
} as const satisfies PartialTranslation<typeof source>;
