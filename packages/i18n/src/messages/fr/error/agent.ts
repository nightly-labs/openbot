import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/agent";

export const messages = {
  "error.agent.historyUnavailable":
    "L’historique n’est pas disponible pour cette demande. Relisez l’historique récent, ou utilisez channel_history pour le travail dans un canal.",
  "error.agent.toolRequestInvalid":
    "Arguments de découverte d’outils non valides. Utilisez le schéma déclaré et un nom d’outil qualifié d’origine.",
  "error.agent.approvalWhileDeleting": "Impossible d’accorder l’approbation pendant la suppression de l’agent.",
  "error.agent.accessLocalOnly": "L’accès à l’agent ne peut être modifié que sur l’ordinateur qui exécute l’agent.",
  "error.agent.duplicateCleanupFailed":
    "La duplication de l’agent a échoué et la copie incomplète n’a pas pu être supprimée.",
  "error.agent.commitEffectsFailed": "La transaction a été validée, mais ses effets enregistrés ont échoué.",
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
  "error.agent.modelProviderNotConnected":
    "Le modèle d’agent sélectionné « {model} » est indisponible : {provider} n’est pas connecté.",
  "error.agent.modelListEmpty":
    "Le modèle d’agent sélectionné « {model} » est indisponible : {provider} n’a listé aucun modèle. Dernière erreur : {detail}",
  "error.agent.modelListEmptyNoError":
    "Le modèle d’agent sélectionné « {model} » est indisponible : {provider} n’a listé aucun modèle.",
  "error.agent.modelNotInProviderList":
    "Le modèle d’agent sélectionné « {model} » est indisponible : {provider} ne le liste pas.",
  "error.agent.modelProviderMismatch": "Le modèle sélectionné n’appartient pas à ce fournisseur.",
  "error.agent.modelNotListed": "Le modèle « {model} » n’est pas disponible. Modèles disponibles : {models}.",
  "error.agent.providerNotListed":
    "Aucun modèle {provider} n’est disponible pour le moment. Appelez list_models pour voir les modèles disponibles.",
  "error.agent.reasoningEffortUnsupported":
    "Le modèle « {model} » ne prend pas en charge l’effort de raisonnement « {effort} ». Efforts pris en charge : {efforts}.",
  "error.agent.noStartingModelInSettings":
    "{provider} ne propose aucun modèle disponible, et aucun autre fournisseur connecté non plus. Connectez-vous à un fournisseur ou changez le fournisseur par défaut dans Réglages du serveur → Fournisseurs.",
  "error.agent.noStartingModel":
    "{provider} n’a aucun modèle disponible, et aucun autre fournisseur connecté n’en a. Connectez-vous à un fournisseur, ou changez le fournisseur par défaut dans Fournisseurs et autorisations.",
  "error.agent.waitBeforeProviderChange":
    "Attendez la fin du tour actif et de la file d’attente avant de changer de fournisseur.",
  "error.agent.waitBeforeClearContext":
    "Attendez la fin du tour actif et de la file d’attente avant de commencer une nouvelle discussion.",
  "error.agent.unknown": "Agent inconnu : {id}",
  "error.agent.onlyUserWidensSettings":
    "Seul l’utilisateur peut donner à un agent l’accès complet ou activer Computer Use. Demandez à l’utilisateur de le modifier dans les réglages de l’agent.",
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
  "error.agent.automationLocalOnly":
    "Les scripts locaux ne peuvent être autorisés que sur l’ordinateur qui exécute l’agent.",
  "error.agent.busyMessageModeLocalOnly":
    "Le comportement des messages pendant le travail de l’agent ne peut être réglé que sur l’ordinateur qui exécute l’agent.",
  "error.agent.localScriptsOff": "Cet agent n’autorise pas les scripts locaux.",
  "error.agent.localScriptsRateLimited":
    "Des scripts locaux ont envoyé à cet agent {limit} demandes de message ou de routine au cours de la dernière heure. Réessayez plus tard.",
  "error.agent.automationOff": "Cet agent n’autorise pas les scripts locaux à exécuter ses routines.",
  "error.agent.automationPayloadTooLong": "Les données envoyées dépassent {limit} caractères.",
  "error.agent.automationRateLimited":
    "Des scripts locaux ont exécuté les routines de cet agent {limit} fois au cours de la dernière heure. Réessayez plus tard.",
  "error.agent.workspaceOnlyMacOnly":
    "« Espace de travail uniquement » n’est disponible pour ce fournisseur que sur macOS. Choisissez « Accès complet » dans les réglages de l’agent.",
  "error.agent.lowMemory":
    "Ce serveur manque de mémoire. Votre message attend dans la file et démarre quand la mémoire est libre. Une offre plus grande donne plus de mémoire au serveur.",
  "error.agent.workspaceOnlyToolMissing":
    "« Espace de travail uniquement » nécessite {tool}, qu’OpenBot n’a pas trouvé. Installez-le, ou choisissez « Accès complet » dans les réglages de l’agent.",
} as const satisfies PartialTranslation<typeof source>;
