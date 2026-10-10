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
    "Impossible de lire Bitwarden. Installez la CLI bw, connectez-vous, déverrouillez-la et créez un dossier nommé Shared with OpenBot. Connectez-vous avec une nouvelle clé de session.",
} as const satisfies PartialTranslation<typeof source>;
