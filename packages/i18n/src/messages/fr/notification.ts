import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/notification";

export const messages = {
  "notification.needsInput": "Nécessite votre réponse.",
  "notification.needsApproval": "Nécessite votre approbation.",
  "notification.needsBrowserStep": "Vous devez terminer une étape dans le navigateur.",
  "notification.waitsForSignIn": "Attend la connexion à {provider}.",
  "notification.needsApprovalFor": "Nécessite votre approbation : {action}",
  "notification.finished": "Travail terminé.",
  "notification.workflowApproval": "Une étape attend votre approbation.",
  "notification.workflowOutput": "Un workflow a un nouveau résultat.",
  "notification.failed": "Arrêté à cause d’une erreur.",
  "notification.subagentFailed": "Un sous-agent s’est arrêté à cause d’une erreur.",
  "notification.subagentFailedFor": "Un sous-agent s’est arrêté à cause d’une erreur : {task}",
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
  "notification.toast.region": "Notifications",
  "notification.toast.close": "Fermer la notification",
} as const satisfies PartialTranslation<typeof source>;
