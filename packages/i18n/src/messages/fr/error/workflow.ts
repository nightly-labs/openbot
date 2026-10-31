import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/workflow";

export const messages = {
  "error.workflow.missing": "Ce workflow n’existe plus.",
  "error.workflow.versionMissing": "Cette version du workflow n’existe plus.",
  "error.workflow.annotation": "Les textes, les notes et les formes ne peuvent pas avoir de connexions.",
  "error.workflow.port": "Une étape ne peut pas recevoir ce type d’entrée.",
  "error.workflow.branch": "Seule une condition peut avoir des connexions oui et non.",
  "error.workflow.conditionBranch": "Chaque connexion d’une condition doit être oui ou non.",
  "error.workflow.duplicateEdge": "Ces deux étapes ont déjà cette connexion.",
  "error.workflow.serverTooOld":
    "Ce serveur ne prend pas en charge les workflows. Mettez à jour OpenBot sur l’ordinateur qui l’exécute.",
  "error.workflow.nodeUnsupported":
    "Cette version d’OpenBot ne peut pas encore exécuter les étapes d’image, de fichier et de message.",
  "error.workflow.interrupted": "OpenBot s’est arrêté pendant cette étape. Relancez-la.",
  "error.workflow.agentMissing": "Choisissez un agent pour cette étape.",
  "error.workflow.handoffFailed": "OpenBot n’a pas pu envoyer cette étape à son agent.",
  "error.workflow.agentStepEnded": "Le message à l’agent a été supprimé avant sa réponse.",
  "error.workflow.conditionUnclear": "Le modèle n’a pas répondu oui ou non.",
  "error.workflow.modelFailed": "Le modèle n’a pas pu répondre. Relancez l’étape.",
  "error.workflow.modelBusy": "Une autre requête au modèle est en cours. Relancez l’étape bientôt.",
  "error.workflow.stepMissing": "Cette étape n’existe plus.",
  "error.workflow.nodeMissing": "Cette étape n’est pas dans le workflow.",
  "error.workflow.runMissing": "Cette exécution n’existe plus.",
  "error.workflow.notRetryable": "Seule une étape en échec ou arrêtée peut être relancée.",
  "error.workflow.noDecision": "Cette étape n’attend pas de décision.",
  "error.workflow.outputPlaceMissing": "Choisissez un lieu de messagerie pour cette sortie.",
  "error.workflow.outputConnectionOff":
    "La connexion de messagerie de cette sortie est désactivée ou supprimée. Choisissez à nouveau un lieu.",
  "error.workflow.outputNotRunning":
    "La connexion de messagerie ne fonctionne pas pour le moment. Réessayez quand elle fonctionne.",
  "error.workflow.outputRefused": "Le lieu a refusé la publication. Vérifiez qu’OpenBot peut y publier.",
  "error.workflow.outputUncertain":
    "La publication s’est arrêtée en chemin. Une partie peut déjà être dans le lieu. Vérifiez avant de réessayer.",
  "error.workflow.tooLarge":
    "Ce workflow est trop volumineux pour être enregistré. Supprimez des dessins ou des textes longs, puis réessayez.",
  "error.workflow.tooLargeToSend":
    "Ce workflow est trop volumineux pour être envoyé à un autre ordinateur. Ouvrez-le sur l’ordinateur qui exécute le serveur.",
  "error.workflow.webhookMissing":
    "Cette étape n’est pas un déclencheur webhook. Enregistrez le workflow, puis réessayez.",
  "error.workflow.githubActionMissing": "Choisissez ce que cette sortie fait sur GitHub.",
  "error.workflow.githubRepositoryMissing": "Choisissez un dépôt pour cette sortie.",
  "error.workflow.githubItemMissing":
    "Cette sortie n’a ni issue ni pull request. Lancez l’exécution depuis un événement GitHub, ou mettez le numéro dans son entrée.",
  "error.workflow.githubPullRequestOnly": "Cette action ne fonctionne que sur les pull requests.",
  "error.workflow.githubTextMissing": "Cette sortie n’a aucun texte à envoyer. Connectez une étape qui l’écrit.",
  "error.workflow.githubChoiceMissing": "Choisissez les étiquettes ou la personne pour cette sortie.",
  "error.workflow.githubChoseNothing": "Le modèle n’a choisi aucune étiquette ni personne de ce dépôt.",
  "error.workflow.githubNotConnected": "Connectez GitHub sur l’ordinateur qui exécute ce workflow.",
  "error.workflow.githubNoAccess":
    "L’application GitHub d’OpenBot ne peut pas voir ce dépôt ou cet élément. Ouvrez GitHub et donnez-lui l’accès.",
  "error.workflow.githubNoWrite":
    "L’application GitHub d’OpenBot ne peut pas modifier ce dépôt. Ouvrez GitHub et donnez-lui l’accès.",
  "error.workflow.githubLocked": "Cette conversation est verrouillée sur GitHub.",
  "error.workflow.githubRefused": "GitHub a refusé la modification : {detail}",
  "error.workflow.githubUnreachable": "OpenBot n’a pas pu joindre GitHub. Relancez l’étape.",
  "error.workflow.githubUncertain":
    "La modification s’est arrêtée en chemin. Elle peut déjà être sur GitHub. Vérifiez avant de relancer l’étape.",
  "error.workflow.githubNoEvent": "GitHub n’a aucune issue ni pull request sur laquelle ce déclencheur démarre.",
} as const satisfies PartialTranslation<typeof source>;
