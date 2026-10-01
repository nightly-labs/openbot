import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/marketplace";

export const messages = {
  "marketplace.category.coding": "Code",
  "marketplace.category.design": "Design",
  "marketplace.category.dataAnalytics": "Données et analyse",
  "marketplace.category.documents": "Documents",
  "marketplace.category.productivity": "Productivité",
  "marketplace.category.research": "Recherche",
  "marketplace.category.automation": "Automatisation",
  "marketplace.category.other": "Autre",
  "marketplace.loadFailed": "Impossible de charger la Marketplace.",
  "marketplace.loading.skills": "Chargement des compétences",
  "marketplace.loading.agents": "Chargement des agents",
  "marketplace.noMatch.skills": "Aucune compétence ne correspond à cette recherche.",
  "marketplace.noMatch.agents": "Aucun agent ne correspond à cette recherche.",
  "marketplace.loadMore": "Charger plus",
  "marketplace.version": "Version {version}",

  "marketplace.title": "Marketplace",
  "marketplace.close": "Fermer la Marketplace",
  "marketplace.kinds": "Types de contenu de la Marketplace",
  "marketplace.tab.agents": "Agents",
  "marketplace.tab.skills": "Compétences",

  "marketplace.plugins.missing": "Ce plugin n’est pas dans le catalogue OpenBot.",

  "marketplace.agents.loadingDetail": "Chargement des détails de l’agent…",
  "marketplace.agents.skills": "Compétences",
  "marketplace.agents.routines": "Routines",
  "marketplace.agents.routineActive": "Active",
  "marketplace.agents.routineInactive": "Inactive",

  "marketplace.skill.loading": "Chargement de la compétence",
  "marketplace.skill.update": "Mettre à jour la compétence",
  "marketplace.try.readFailed": "OpenBot n’a pas pu lire les compétences de cet agent. Réessayez.",
  "marketplace.try.enable": "Activez cette compétence dans les réglages de l’agent pour l’essayer.",
  "marketplace.try.repair": "Réparez cette compétence dans les réglages de l’agent pour l’essayer.",
  "marketplace.try.update": "Mettez à jour cette compétence pour essayer cette version.",
  "marketplace.try.composerUnavailable": "L’éditeur de l’agent n’est pas disponible.",

  "marketplace.error.openLink": "Impossible d’ouvrir le lien.",
  "marketplace.error.copyLink": "Impossible de copier le lien.",
  "marketplace.error.connectNoServer": "Sélectionnez un serveur local pour connecter cette app.",
  "marketplace.error.installNoServer": "Sélectionnez un serveur local pour installer un plugin.",
  "marketplace.error.installNoAgent": "Choisissez un agent pour installer les compétences de ce plugin.",
  "marketplace.error.installLocalOnHost":
    "Installez {name} sur l’ordinateur qui exécute ces agents : son app exécute son serveur sur cet ordinateur.",
  "marketplace.error.installOnHost":
    "Installez {name} sur l’ordinateur qui exécute ces agents : son app demande une connexion dans le navigateur.",
  "marketplace.error.appInvalid": "Impossible d’ajouter {name} : {reason}",
  "marketplace.error.uninstallNoServer": "Sélectionnez un serveur local pour désinstaller un plugin.",
  "marketplace.error.uninstallPartial": "Une partie de {name} n’a pas pu être supprimée. {failures}",
  "marketplace.error.actionFailed": "Impossible de terminer l’action dans la Marketplace. Réessayez.",
  "marketplace.thisAgent": "cet agent",
} as const satisfies PartialTranslation<typeof source>;
