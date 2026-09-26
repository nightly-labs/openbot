import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/skill";

export const messages = {
  "skill.title": "Compétences",
  "skill.close": "Fermer les compétences",
  "skill.detailsDescription": "Détails de {name}",
  "skill.assignedDescription": "Compétences attribuées à {name}",
  "skill.addFromMarketplace": "Ajouter depuis la marketplace",
  "skill.limitReached":
    "Cet agent a atteint la limite de {limit} compétences. Retirez une compétence avant d’en ajouter une autre.",
  "skill.managedOnHost": "Les compétences de cet agent sont gérées sur l’hôte.",
  "skill.loading": "Chargement des compétences…",
  "skill.loadingDetails": "Chargement des détails…",
  "skill.emptyEnabled": "Cet agent n’a aucune compétence activée.",
  "skill.emptyAssigned": "Cet agent n’a encore aucune compétence attribuée.",
  "skill.folderSkill": "OpenBot n’a pas installé cette compétence. Modifiez-la ou retirez-la dans {location}.",
  "skill.localOnHost": "Cette compétence locale est stockée sur l’hôte. Ouvrez ses détails sur cet ordinateur.",
  "skill.moreFor": "Plus d’options pour {name}",
  "skill.update": "Mettre à jour",
  "skill.updateName": "Mettre à jour {name}",
  "skill.enableName": "Activer {name}",
  "skill.repair": "Réparer",
  "skill.uninstall": "Désinstaller",
  "skill.version": "v{version}",
  "skill.versionUpdate": "v{installed} · v{available} disponible",

  "skill.loadFailed": "Impossible de charger les compétences.",
  "skill.loadDetailsFailed": "Impossible de charger les détails de la compétence.",
  "skill.enableFailed": "Impossible d’activer la compétence.",
  "skill.disableFailed": "Impossible de désactiver la compétence.",
  "skill.removeFailed": "Impossible de retirer la compétence.",
  "skill.updateFailed": "Impossible de mettre à jour la compétence.",

  "skill.confirm.replaceTitle": "Remplacer les modifications locales ?",
  "skill.confirm.removeTitle": "Retirer cette compétence ?",
  "skill.confirm.replaceBody":
    "La mise à jour de cette compétence remplace les fichiers locaux par le dernier paquet de la compétence. Vos modifications dans ce dossier seront perdues.",
  "skill.confirm.removeModifiedBody":
    "Cette compétence a des modifications locales dans l’espace de travail de l’agent. Le retrait supprime ces fichiers. Les messages d’origine de la discussion restent.",
  "skill.confirm.removeBody": "OpenBot va retirer cette compétence de l’agent. L’historique de discussion reste.",
  "skill.confirm.replace": "Remplacer la compétence",
  "skill.confirm.remove": "Retirer la compétence",

  "skill.unavailable.readOnly": "Les compétences distantes sont en lecture seule.",
  "skill.unavailable.add": "Ajoutez cette compétence pour l’essayer.",
  "skill.unavailable.repair": "Réparez cette compétence pour l’essayer.",
  "skill.unavailable.updateVersion": "Mettez à jour cette compétence pour essayer cette version.",
  "skill.unavailable.updateRevision": "Mettez à jour cette compétence pour essayer cette révision.",
  "skill.unavailable.saving": "Attendez la fin de l’enregistrement de cette compétence, puis essayez-la.",
  "skill.unavailable.composer": "Le champ de message de l’agent n’est pas disponible.",

  "skill.toolbar.source": "Source des compétences",
  "skill.toolbar.all": "Toutes",
  "skill.toolbar.local": "Locales",
  "skill.toolbar.enabled": "Activées",
  "skill.toolbar.create": "Créer une compétence",

  "skill.local.loadFailed": "Impossible de charger les compétences locales.",
  "skill.local.toggleFailed": "Impossible de changer l’état de la compétence.",
  "skill.local.addFailed": "Impossible d’ajouter la compétence locale.",
  "skill.local.back": "Retour aux compétences locales",
  "skill.local.added": "Ajoutée",
  "skill.local.add": "Ajouter la compétence",
  "skill.local.loading": "Chargement des compétences locales…",
  "skill.local.empty": "Aucune compétence locale pour le moment.",

  "skill.preview.label": "Aperçu de {name}",
  "skill.preview.creator": "Par {name}",
  "skill.preview.examplePrompt": "Aidez-moi à utiliser cette compétence.",
  "skill.preview.try": "Essayer la compétence",
  "skill.preview.linkFailed": "Impossible d’ouvrir le lien.",
} as const satisfies PartialTranslation<typeof source>;
