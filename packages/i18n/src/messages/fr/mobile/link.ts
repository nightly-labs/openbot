import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/link";

export const messages = {
  "mobile.link.connectFailed": "OpenBot n’a pas pu se connecter. Réessayez.",
  "mobile.link.invite.signIn": "Connectez-vous avec votre ordinateur pour examiner cette invitation.",
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
} as const satisfies PartialTranslation<typeof source>;
