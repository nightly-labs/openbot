import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/share";

export const messages = {
  "mobile.share.signInTitle": "Connectez-vous pour partager",
  "mobile.share.signInDescription":
    "Scannez le code QR dans OpenBot sur votre ordinateur. Vous pourrez ensuite choisir l’agent qui reçoit ce que vous avez partagé.",
  "mobile.share.reading": "Lecture du contenu partagé…",
  "mobile.share.readFailed": "OpenBot n’a pas pu lire ce que vous avez partagé. Partagez-le à nouveau.",
  "mobile.share.content": "À partager",
  "mobile.share.footer":
    "La discussion s’ouvre avec ce contenu dans le champ de message. Rien n’est envoyé tant que vous ne l’envoyez pas.",
  "mobile.share.lastUsed": "Utilisé en dernier",
  "mobile.share.noAgents": "Aucun agent",
  "mobile.share.chooseAgent": "Choisissez un agent",
  "mobile.share.action": "Partager avec {name}",
  "mobile.share.extension.send": "Envoyer",
  "mobile.share.extension.footer": "OpenBot envoie ceci à l’agent maintenant. L’app ne s’ouvre pas.",
  "mobile.share.extension.sending": "Envoi à {name}…",
  "mobile.share.extension.sent": "Envoyé à {name}",
  "mobile.share.extension.failed": "OpenBot n’a pas pu envoyer ceci. Ouvre l’app pour l’envoyer depuis là.",
  "mobile.share.extension.unconfirmed":
    "Le serveur n’a pas confirmé le message. Vérifie le chat avant de l’envoyer à nouveau.",
  "mobile.share.extension.openApp": "Ouvrir OpenBot",
} as const satisfies PartialTranslation<typeof source>;
