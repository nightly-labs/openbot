import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/link";

export const messages = {
  "mobile.link.connectFailed": "OpenBot n’a pas pu se connecter. Réessayez.",
  "mobile.link.invite.signInTitle": "Connectez-vous pour rejoindre ce serveur",
  "mobile.link.invite.signInDescription":
    "Scannez le code QR dans OpenBot sur votre ordinateur. Vous pourrez ensuite examiner l’invitation.",
  "mobile.link.invite.cancel": "Annuler l’invitation",
  "mobile.link.pairing.title": "Connecter ce téléphone",
  "mobile.link.pairing.alreadySignedIn":
    "Vous êtes déjà connecté. Déconnectez-vous dans Réglages avant de connecter un autre compte.",
  "mobile.link.pairing.description":
    "Continuez uniquement si vous avez demandé ce lien Mobile Connect depuis votre ordinateur.",
  "mobile.link.pairing.connect": "Connecter",
  "mobile.link.plugin.title": "Ouvrir la page du plugin",
  "mobile.link.plugin.description": "Consultez ce plugin sur le site web d’OpenBot.",
  "mobile.link.plugin.openFailed": "Impossible d’ouvrir la page du plugin.",
  "mobile.link.plugin.view": "Voir le plugin",
  "mobile.link.unavailable.title": "Lien indisponible",
  "mobile.link.unavailable.description":
    "Ce lien n’est pas valide, n’est plus disponible ou n’est pas pris en charge sur mobile.",
  "mobile.link.template.signInTitle": "Connectez-vous pour ajouter cet agent",
  "mobile.link.template.signInDescription":
    "Scannez le code QR dans OpenBot sur votre ordinateur. Vous pourrez ensuite examiner l’agent avant de l’ajouter.",
  "mobile.link.template.loading": "Chargement de l’agent…",
  "mobile.link.template.creator": "Par {name}",
  "mobile.link.template.section.instructions": "Instructions",
  "mobile.link.template.section.skills": "Compétences",
  "mobile.link.template.section.noSkills": "Aucune compétence.",
  "mobile.link.template.section.routines": "Routines",
  "mobile.link.template.section.noRoutines": "Aucune routine.",
  "mobile.link.template.skill.local": "Compétence locale (SKILL.md uniquement)",
  "mobile.link.template.skill.marketplace": "Compétence de la Marketplace, version {version}",
  "mobile.link.template.server.title": "Ajouter au serveur",
  "mobile.link.template.server.footer": "Seuls les serveurs dont vous êtes propriétaire ou administrateur sont listés.",
  "mobile.link.template.server.updateRequired":
    "Mettez à jour OpenBot sur ce serveur pour ajouter des agents partagés.",
  "mobile.link.template.server.none":
    "Vous devez être propriétaire ou administrateur d’un serveur pour ajouter un agent partagé.",
  "mobile.link.template.install.action": "Ajouter l’agent",
  "mobile.link.template.install.pending": "Ajout…",
  "mobile.link.template.install.failed": "Impossible d’ajouter l’agent.",
  "mobile.link.template.notFound.title": "Agent introuvable",
  "mobile.link.template.notFound.description":
    "Cet agent partagé n’existe pas, ou son créateur a annulé sa publication.",
  "mobile.link.template.error.title": "Impossible de charger l’agent",
  "mobile.link.template.error.loadFailed": "Impossible de lire l’agent partagé. Réessayez.",
  "mobile.link.template.error.unsupported":
    "Ce serveur ne peut pas ajouter d’agents partagés. Mettez à jour OpenBot sur l’ordinateur qui exécute le serveur.",
} as const satisfies PartialTranslation<typeof source>;
