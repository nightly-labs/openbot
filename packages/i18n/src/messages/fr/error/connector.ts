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
  "error.connector.passwordManagerUnknown": "OpenBot ne connaît pas ce gestionnaire de mots de passe.",
  "error.connector.passwordManagerMethod": "Ce gestionnaire de mots de passe ne peut pas se connecter de cette façon.",
  "error.connector.passwordManagerNoSignIn": "Aucune page de connexion n’est ouverte. Connectez-vous à nouveau.",
  "error.connector.protonPassFailed": "Impossible de connecter Proton Pass. Connectez-vous à nouveau.",
  "error.connector.protonPassCliInstallFailed":
    "Impossible d’installer la CLI Proton Pass. Vérifiez la connexion réseau, puis connectez-vous à nouveau.",
  "error.connector.protonPassPlan":
    "Votre forfait Proton n’autorise pas la CLI Proton Pass. Changez de forfait, puis connectez-vous à nouveau.",
  "error.connector.protonPassExpired": "L’accès à Proton Pass a pris fin. Connectez-vous à nouveau.",
  "error.connector.protonPassKeyInvalid": "Saisissez une clé d’accès Proton Pass qui commence par pst_.",
  "error.connector.protonPassExtraPassword": "Le mot de passe supplémentaire est incorrect. Saisissez-le à nouveau.",
  "error.connector.protonPassExtraPasswordNotAsked": "Proton Pass n’a pas demandé de mot de passe supplémentaire.",
  "error.connector.protonPassFileUnreadable": "Le fichier de connexion Proton Pass est illisible.",
  "error.connector.protonPassSignInTimeout": "La connexion à Proton a pris trop de temps. Connectez-vous à nouveau.",
  "error.connector.protonPassSetupFailed":
    "Impossible de créer le coffre Shared with OpenBot ou sa clé d’accès dans Proton Pass. Connectez-vous à nouveau.",
} as const satisfies PartialTranslation<typeof source>;
