import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/agent";

export const messages = {
  "error.agent.approvalWhileDeleting": "Impossible d’accorder l’approbation pendant la suppression de l’agent.",
  "error.agent.accessLocalOnly": "L’accès à l’agent ne peut être modifié que sur l’ordinateur qui exécute l’agent.",
  "error.agent.duplicateCleanupFailed":
    "La duplication de l’agent a échoué et la copie incomplète n’a pas pu être supprimée.",
  "error.agent.settingsLocalOnly":
    "Les réglages de l’agent ne peuvent être modifiés que sur l’ordinateur qui exécute l’agent.",
  "error.agent.skillsLocalOnly": "Les compétences ne peuvent être modifiées que sur l’ordinateur qui exécute l’agent.",
  "error.agent.addLocalOnly": "Les agents ne peuvent être ajoutés que sur l’ordinateur qui les exécute.",
  "error.agent.joinedServerUpdate": "Un agent d’un serveur rejoint ne peut pas être modifié d’ici.",
  "error.agent.searchQueryRequired": "Une requête de recherche est requise.",
  "error.agent.messageTooLong": "Le message est trop long.",
  "error.agent.messageOrAttachmentRequired": "Un message ou une pièce jointe est requis.",
  "error.agent.promptAnswersTooLong": "Les réponses sont trop longues.",
  "error.agent.gone": "Cet agent n’existe plus.",
  "error.agent.profileGenerationBusy": "La génération de profil est occupée. Réessayez dans un instant.",
  "error.agent.initialMessageRequired": "Le message initial est requis.",
  "error.agent.initialMessageTooLong": "Le message initial est trop long.",
  "error.agent.setupCleanupFailed":
    "La configuration de l’agent a échoué et l’agent incomplet n’a pas pu être supprimé.",
  "error.agent.modelUnavailable": "Le modèle d’agent sélectionné est indisponible.",
  "error.agent.modelProviderMismatch": "Le modèle sélectionné n’appartient pas à ce fournisseur.",
  "error.agent.waitBeforeProviderChange":
    "Attendez la fin du tour actif et de la file d’attente avant de changer de fournisseur.",
  "error.agent.unknown": "Agent inconnu : {id}",
  "error.agent.queuedMessageCreateFailed": "Impossible de créer le message en file d’attente.",
  "error.agent.messageUnavailable": "Le message n’est plus disponible.",
  "error.agent.hostLimit": "Un hôte peut avoir jusqu’à {limit} agents.",
  "error.agent.changedWhileDuplicating": "L’agent a changé pendant sa duplication. Réessayez.",
  "error.agent.duplicatedAgentGone": "L’agent dupliqué n’existe plus.",
  "error.agent.stateCorrupt":
    "L’état des agents est corrompu ou provient d’une version plus récente d’OpenBot ; il ne sera pas écrasé.",
  "error.agent.oldRoleField":
    "Les profils d’agent enregistrés utilisent l’ancien champ de rôle ; mettez à jour les données avant de démarrer OpenBot.",
  "error.agent.duplicateIds": "L’état des agents contient des ID d’agent en double ; il ne sera pas écrasé.",
  "error.agent.copyNameFailed": "OpenBot n’a pas pu créer un nom unique pour la copie de l’agent.",
  "error.agent.endpointRemoved":
    "Le point de terminaison utilisé par cet agent a été supprimé. Choisissez un autre modèle pour lui.",
  "error.agent.selectedGone": "L’agent sélectionné n’existe plus.",
  "error.agent.profileEndpointsChanged":
    "Les points de terminaison personnalisés ont changé pendant la génération. Réessayez.",
  "error.agent.profileInvalid": "Le fournisseur a renvoyé un profil non valide. Essayez de reformuler votre demande.",
  "error.agent.profileSectionUnavailable":
    "La section générée est indisponible. Réessayez ou choisissez une section manuellement.",
  "error.agent.profileTimedOut": "La génération du profil a expiré. Réessayez.",
  "error.agent.profileDisconnected": "Le fournisseur s’est déconnecté pendant la génération du profil.",
  "error.agent.profileToolUse": "Le fournisseur a tenté d’utiliser un outil. Essayez de reformuler votre demande.",
  "error.agent.profileFailed": "Le fournisseur n’a pas pu générer de profil. Réessayez.",
  "error.agent.profileTooLarge": "Le profil généré est trop volumineux. Essayez une demande plus courte.",
  "error.agent.profileNotStarted": "Le fournisseur n’a pas pu démarrer la génération du profil.",
  "error.agent.deletionBusy": "La suppression de l’agent est déjà en cours.",
  "error.agent.stopBeforeDelete": "Arrêtez l’agent et annulez ses messages en file d’attente avant de le supprimer.",
  "error.agent.deleteIncomplete":
    "Les données de l’agent n’ont pas pu être entièrement supprimées. Relancez la suppression de l’agent.",
  "error.agent.duplicationBusy": "Cet agent est déjà en cours de duplication.",
  "error.agent.waitBeforeDuplicate":
    "Attendez que l’agent ait terminé et videz sa file d’attente avant de le dupliquer.",
  "error.agent.saveOtherAgent": "Cet enregistrement appartient à un autre agent.",
  "error.agent.savedGone": "L’agent enregistré n’existe plus.",
  "error.agent.storedProfileUnreadable":
    "Un profil d’agent enregistré a une valeur « {field} » illisible ; mettez à jour les données avant de démarrer OpenBot.",
  "error.agent.storedProfileUnreadableId":
    "Le profil d’agent enregistré {id} a une valeur « {field} » illisible ; mettez à jour les données avant de démarrer OpenBot.",
  "error.agent.queueEditRejected": "Modification de la file d’attente refusée : {reason}",
  "error.agent.computerUseLocalOnly": "Computer Use ne peut être modifié que sur l’ordinateur qui exécute l’agent.",
} as const satisfies PartialTranslation<typeof source>;
