import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/mobile/app";

export const messages = {
  "mobile.app.route.scanQrCode": "Scanner le code QR",
  "mobile.app.route.actionsNeeded": "Actions requises",
  "mobile.app.route.newChannel": "Nouveau canal",
  "mobile.app.route.createAgent": "Créer un agent",
  "mobile.app.route.newSection": "Nouvelle section",
  "mobile.app.route.settings": "Réglages",
  "mobile.app.route.profile": "Profil",
  "mobile.app.route.general": "Général",
  "mobile.app.route.accountSessions": "Sessions du compte",
  "mobile.app.route.about": "À propos",
  "mobile.app.route.hiddenChats": "Discussions masquées",
  "mobile.app.route.deletedChannels": "Canaux supprimés",
  "mobile.app.route.cropPhoto": "Déplacer et redimensionner",
  "mobile.app.route.queuedMessages": "Messages en attente",
  "mobile.app.route.messageOptions": "Options du message",
  "mobile.app.route.editMessage": "Modifier le message",
  "mobile.app.route.serverOptions": "Options du serveur",
  "mobile.app.route.members": "Membres",
  "mobile.app.route.message": "Message",
  "mobile.app.messageActions.reply": "Répondre",
  "mobile.app.messageActions.selectText": "Sélectionner le texte",
  "mobile.app.messageActions.copied": "Message copié",
  "mobile.app.messageActions.copy": "Copier le message",
  "mobile.app.messageActions.text": "Texte du message",
} as const satisfies PartialTranslation<typeof source>;
