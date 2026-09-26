import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/agentSettings";

export const messages = {
  "agentSettings.label": "Réglages de l’agent",
  "agentSettings.title": "Réglages",
  "agentSettings.backToDetails": "Retour aux détails",
  "agentSettings.closeDetails": "Fermer les détails",
  "agentSettings.saveFailed": "Impossible d’enregistrer les réglages de l’agent.",

  "agentSettings.name": "Nom",
  "agentSettings.nameLabel": "Nom de l’agent",
  "agentSettings.agentTitle": "Titre",
  "agentSettings.agentTitleLabel": "Titre de l’agent",
  "agentSettings.agentTitlePlaceholder": "Décrivez ce que fait votre agent",
  "agentSettings.instructions": "Instructions",
  "agentSettings.instructionsLabel": "Instructions de l’agent",
  "agentSettings.instructionsPlaceholder": "À quoi sert cet agent",

  "agentSettings.avatar.edit": "Modifier l’avatar de l’agent",
  "agentSettings.avatar.editor": "Éditeur d’avatar",
  "agentSettings.avatar.attachFiles": "Joindre des fichiers",
  "agentSettings.avatar.image": "Image",
  "agentSettings.avatar.replaceImage": "Remplacer l’image",
  "agentSettings.avatar.uploadImage": "Importer une image",
  "agentSettings.avatar.imageHint": "PNG, JPEG ou WebP · recadrage carré",
  "agentSettings.avatar.generatedFace": "Visage généré",
  "agentSettings.avatar.resetToId": "Réinitialiser selon l’ID",
  "agentSettings.avatar.newSet": "Nouvelle série",
  "agentSettings.avatar.faces": "Visages d’avatar générés",
  "agentSettings.avatar.selected": "Avatar sélectionné",
  "agentSettings.avatar.option": "Option d’avatar {number}",
  "agentSettings.avatar.color": "Couleur",
  "agentSettings.avatar.colorLabel": "Couleur de l’avatar",
  "agentSettings.avatar.autoColor": "Couleur d’avatar automatique",
  "agentSettings.avatar.autoInitial": "A",
  "agentSettings.avatar.hueColor": "Couleur d’avatar {hue}",
  "agentSettings.avatar.saveFailed": "Impossible d’enregistrer l’avatar de l’agent.",
  "agentSettings.avatar.processFailed": "Impossible de traiter l’avatar de l’agent.",

  "agentSettings.runtime.title": "Exécution",
  "agentSettings.runtime.model": "Modèle de l’agent",
  "agentSettings.runtime.modelBusy": "Attendez la fin du travail en cours avant de changer de modèle.",
  "agentSettings.runtime.modelUnavailable": "Les modèles sont disponibles après la connexion d’une CLI d’agent.",
  "agentSettings.runtime.reasoning": "Raisonnement",
  "agentSettings.runtime.reasoningLabel": "Niveau de raisonnement de l’agent",
  "agentSettings.runtime.selectReasoning": "Choisir le raisonnement",
  "agentSettings.runtime.access": "Accès",
  "agentSettings.runtime.accessLabel": "Accès de l’agent",
  "agentSettings.runtime.workingDirectory": "Répertoire de travail",
  "agentSettings.runtime.notAvailable": "Pas encore disponible",
  "agentSettings.runtime.fullAccessNote":
    "L’agent s’exécute avec un accès complet à l’ordinateur depuis son espace de travail et le dossier partagé.",
  "agentSettings.runtime.claudeApprovalNote":
    "Claude agit sans demander d’approbation, sauf pour les questions qu’il vous pose.",
  "agentSettings.runtime.providerApprovalNote":
    "Selon le fournisseur, les commandes sensibles peuvent d’abord demander une approbation.",

  "agentSettings.access.workspace": "Espace de travail uniquement",
  "agentSettings.access.full": "Accès complet",

  "agentSettings.notifications.title": "Notifications",
  "agentSettings.notifications.description":
    "Recevez une notification quand cet agent termine ou a besoin d’une réponse",

  "agentSettings.fullAccess.title": "Donner un accès complet à cet agent ?",
  "agentSettings.fullAccess.description":
    "L’agent pourra alors lire, modifier et supprimer tout fichier accessible à votre compte utilisateur, exécuter n’importe quelle commande et utiliser le réseau. Une seule instruction mal comprise ou une page web malveillante peut atteindre vos fichiers personnels.",
  "agentSettings.fullAccess.cancel": "Garder l’espace de travail uniquement",
  "agentSettings.fullAccess.confirm": "Autoriser l’accès complet",

  "agentSettings.links.usage": "Utilisation",
  "agentSettings.links.memories": "Souvenirs",
  "agentSettings.links.memoriesCount": { one: "{count} enregistré", other: "{count} enregistrés" },
  "agentSettings.links.skills": "Compétences",
  "agentSettings.links.skillsCount": { one: "{count} attribuée", other: "{count} attribuées" },
  "agentSettings.links.tables": "Tables",
  "agentSettings.links.tablesCount": { one: "{count} table", other: "{count} tables" },
  "agentSettings.links.files": "Fichiers",
  "agentSettings.links.routines": "Routines",
  "agentSettings.links.routinesCount": { one: "{count} configurée", other: "{count} configurées" },
  "agentSettings.runtime.workspaceNote":
    "« Espace de travail uniquement » limite les écritures à l’espace de travail de cet agent, au dossier partagé et aux dossiers temporaires. La lecture et le réseau restent disponibles.",
  "agentSettings.runtime.workspaceNotEnforced":
    "{provider} ne l’applique pas encore : cet agent a donc toujours un accès complet. Les agents Codex et Claude sont limités.",
  "agentSettings.runtime.workspaceEnforcedCommand":
    "Une commande qui doit écrire à l’extérieur vous demande d’abord, même quand l’approbation automatique est activée.",
  "agentSettings.runtime.workspaceEnforcedClaude":
    "Une modification de fichier à l’extérieur vous demande d’abord, même quand l’approbation automatique est activée. Une commande ne peut pas écrire à l’extérieur.",
  "agentSettings.runtime.workspaceUnlimited":
    "Computer Use et le navigateur OpenBot ne sont pas limités ; vous pouvez désactiver Computer Use ci-dessous.",
  "agentSettings.computerUse.title": "Computer Use",
  "agentSettings.computerUse.description": "Autoriser cet agent à contrôler les apps de cet ordinateur",
} as const satisfies PartialTranslation<typeof source>;
