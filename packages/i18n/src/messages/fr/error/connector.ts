import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/connector";

export const messages = {
  "error.connector.githubUnavailable": "Cette version d’OpenBot n’a pas d’application GitHub.",
  "error.connector.githubDenied": "La connexion à GitHub a été refusée.",
  "error.connector.githubCodeExpired": "Le code GitHub a expiré. Connectez GitHub à nouveau.",
  "error.connector.githubDeviceFlowDisabled": "L’application GitHub n’autorise pas la connexion par appareil.",
  "error.connector.githubClientUnknown": "GitHub ne connaît pas le Client ID de cette application GitHub.",
  "error.connector.githubUnexpected": "GitHub a envoyé une réponse inattendue : {detail}",
  "error.connector.githubUnreachable": "OpenBot ne peut pas joindre GitHub : {detail}",
  "error.connector.githubExpired": "La connexion GitHub a expiré. Connectez GitHub à nouveau.",
  "error.connector.githubFileUnreadable": "Le fichier de connexion GitHub est illisible.",
  "error.connector.githubFileTooLarge": "Le fichier de connexion GitHub est trop volumineux.",
  "error.connector.onePasswordCliMissing":
    "OpenBot ne trouve pas la CLI 1Password. Installez-la et activez son intégration dans l’application 1Password, ou utilisez un jeton de compte de service.",
  "error.connector.onePasswordCliInstallFailed":
    "OpenBot n’a pas pu installer la CLI 1Password. Vérifiez la connexion à Internet, puis réessayez.",
  "error.connector.onePasswordCliSignedOut":
    "La CLI 1Password n’est pas connectée. Activez son intégration dans l’application 1Password, puis connectez-vous à nouveau.",
  "error.connector.onePasswordCliFailed": "La CLI 1Password a échoué : {detail}",
  "error.connector.onePasswordUnexpected": "1Password a envoyé une réponse inattendue : {detail}",
  "error.connector.onePasswordTokenRejected": "1Password n’a pas accepté le jeton du compte de service.",
  "error.connector.onePasswordNoVault":
    "Le compte de service ne peut lire aucun coffre. Donnez-lui accès à un coffre, puis réessayez.",
  "error.connector.onePasswordFileUnreadable": "Le fichier de connexion 1Password est illisible.",
  "error.connector.onePasswordFileTooLarge": "Le fichier de connexion 1Password est trop volumineux.",
  "error.connector.bitwardenFailed":
    "Impossible de lire Bitwarden. Installez la CLI bw, connectez-vous, déverrouillez-la et créez un dossier nommé « Shared with OpenBot ». Connectez-vous avec une nouvelle clé de session.",
  "error.connector.bitwardenHostInput":
    "Saisissez une adresse de serveur HTTPS, le client_id et le client_secret de la clé d’API et le mot de passe principal.",
  "error.connector.bitwardenHostFailed":
    "Impossible d’ouvrir Bitwarden sur ce serveur. Vérifiez l’adresse du serveur, la clé d’API et le mot de passe principal, et assurez-vous qu’un dossier se nomme « Shared with OpenBot ». Puis connectez-vous à nouveau.",
  "error.connector.bitwardenCliInstallFailed":
    "Impossible d’installer la CLI Bitwarden sur ce serveur. Vérifiez sa connexion réseau, puis connectez-vous à nouveau.",
  "error.connector.bitwardenFileUnreadable": "Le fichier de connexion Bitwarden est illisible.",
  "error.connector.telegramAccountCredentialsMissing":
    "Saisissez l’api_id et l’api_hash de votre application Telegram. Vous les obtenez sur my.telegram.org.",
  "error.connector.telegramAccountCredentialsInvalid":
    "L’api_id est un nombre et l’api_hash compte 32 caractères parmi 0-9 et a-f. Copiez-les à nouveau depuis my.telegram.org.",
  "error.connector.telegramAccountApiRejected":
    "Telegram n’accepte pas cet api_id et cet api_hash. Copiez-les à nouveau depuis my.telegram.org.",
  "error.connector.telegramAccountPhoneFormat":
    "Saisissez le numéro de téléphone avec son indicatif de pays, par exemple +48 600 100 200.",
  "error.connector.telegramAccountPhoneInvalid":
    "Telegram ne connaît pas ce numéro. Ajoutez l’indicatif de pays, par exemple +48.",
  "error.connector.telegramAccountCodeInvalid": "Ce code n’est pas correct. Vérifiez-le et réessayez.",
  "error.connector.telegramAccountCodeEmpty": "Saisissez le code que Telegram vous a envoyé.",
  "error.connector.telegramAccountCodeExpired": "Le code a expiré. Recommencez pour recevoir un nouveau code.",
  "error.connector.telegramAccountPasswordInvalid": "Ce mot de passe n’est pas correct. Réessayez.",
  "error.connector.telegramAccountPasswordEmpty": "Saisissez votre mot de passe de validation en deux étapes.",
  "error.connector.telegramAccountPasswordNeeded":
    "Telegram a besoin de votre mot de passe de validation en deux étapes.",
  "error.connector.telegramAccountNoAccount":
    "Ce numéro n’a pas de compte Telegram. Connectez-vous avec un numéro qui utilise déjà Telegram.",
  "error.connector.telegramAccountPhoneBanned": "Telegram a banni ce numéro.",
  "error.connector.telegramAccountQrExpired": "Le code QR a expiré avant que vous le scanniez. Recommencez.",
  "error.connector.telegramAccountFloodWait": "Telegram vous demande de patienter. Réessayez dans {count} min.",
  "error.connector.telegramAccountCancelled": "La connexion à Telegram a été annulée.",
  "error.connector.telegramAccountTimedOut": "La connexion s’est arrêtée après 10 minutes sans activité. Recommencez.",
  "error.connector.telegramAccountMovedOn": "La connexion est passée à une autre étape. Recommencez.",
  "error.connector.telegramAccountRefused": "Telegram a refusé la connexion : {detail}",
  "error.connector.telegramAccountSaveFailed": "OpenBot n’a pas pu enregistrer la connexion Telegram : {detail}",
  "error.connector.telegramAccountSessionEnded":
    "Telegram a fermé cette session, par exemple dans Paramètres > Appareils. Connectez à nouveau votre compte Telegram.",
  "error.connector.telegramAccountFileUnreadable": "Le fichier de connexion du compte Telegram est illisible.",
  "error.connector.telegramAccountFileTooLarge": "Le fichier de connexion du compte Telegram est trop volumineux.",
  "error.connector.whatsappAccountPhoneFormat":
    "Saisissez le numéro de téléphone avec son indicatif de pays, par exemple +48 600 100 200.",
  "error.connector.whatsappAccountPairingFailed": "WhatsApp n’a pas donné de code : {detail}",
  "error.connector.whatsappAccountQrExpired": "Le code a expiré avant que vous l’utilisiez. Recommencez.",
  "error.connector.whatsappAccountTimedOut":
    "La connexion de l’appareil s’est arrêtée après 10 minutes sans activité. Recommencez.",
  "error.connector.whatsappAccountMovedOn": "La connexion de l’appareil est passée à une autre étape. Recommencez.",
  "error.connector.whatsappAccountLinkFailed": "WhatsApp n’a pas connecté cet appareil : {detail}",
  "error.connector.whatsappAccountSaveFailed": "OpenBot n’a pas pu enregistrer la connexion WhatsApp : {detail}",
  "error.connector.whatsappAccountLoggedOut":
    "WhatsApp a retiré cet appareil, par exemple dans Réglages > Appareils connectés. Connectez à nouveau votre compte WhatsApp.",
  "error.connector.whatsappAccountReplaced":
    "Un autre programme a ouvert cet appareil connecté, donc WhatsApp a fermé la connexion ici. Déconnectez-le, puis connectez-le à nouveau.",
  "error.connector.whatsappAccountForbidden":
    "WhatsApp a refusé cet appareil. Votre numéro est peut-être limité. Vérifiez WhatsApp sur votre téléphone.",
  "error.connector.whatsappAccountOutdated":
    "WhatsApp n’accepte plus cette version de la connexion. Mettez à jour OpenBot, puis connectez à nouveau l’appareil.",
  "error.connector.whatsappAccountOffline":
    "WhatsApp n’est pas joignable pour l’instant. OpenBot réessaie. Les agents peuvent toujours lire les discussions sur cet ordinateur.",
  "error.connector.whatsappAccountFileUnreadable": "Le fichier de connexion du compte WhatsApp est illisible.",
} as const satisfies PartialTranslation<typeof source>;
