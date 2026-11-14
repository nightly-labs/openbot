import { defineMessages } from "../../../message";

export const messages = defineMessages("error.connector", {
  // The built-in GitHub connection: the device flow, the token refresh and the stored file.
  "error.connector.githubUnavailable": "This build of OpenBot has no GitHub App.",
  "error.connector.githubDenied": "The GitHub sign-in was refused.",
  "error.connector.githubCodeExpired": "The GitHub code expired. Connect GitHub again.",
  "error.connector.githubDeviceFlowDisabled": "The GitHub App does not allow device sign-in.",
  "error.connector.githubClientUnknown": "GitHub does not know the Client ID of this GitHub App.",
  "error.connector.githubUnexpected": "GitHub sent an unexpected answer: {detail}",
  "error.connector.githubUnreachable": "OpenBot cannot reach GitHub: {detail}",
  "error.connector.githubExpired": "The GitHub connection expired. Connect GitHub again.",
  "error.connector.githubFileUnreadable": "The GitHub connection file is unreadable.",
  "error.connector.githubFileTooLarge": "The GitHub connection file is too large.",
  "error.connector.linkDenied": "The Link sign-in was refused.",
  "error.connector.linkCodeExpired": "The Link sign-in expired. Connect Link again.",
  "error.connector.linkUnexpected": "Link sent an unexpected answer: {detail}",
  "error.connector.linkUnreachable": "OpenBot cannot reach Link: {detail}",
  "error.connector.linkExpired": "The Link connection expired. Connect Link again.",
  "error.connector.linkNotConnected": "Link is not connected. Connect it in Server settings > Vault > Cards.",
  "error.connector.linkNoCard": "The Link account has no card. Add a card in Link.",
  "error.connector.linkFileUnreadable": "The Link connection file is unreadable.",
  "error.connector.linkFileTooLarge": "The Link connection file is too large.",
  // The 1Password connection: the CLI that creates the service account, the token and the stored file.
  "error.connector.onePasswordCliMissing":
    "OpenBot cannot find the 1Password CLI. Install it and turn on its integration in the 1Password app, or use a service account token.",
  "error.connector.onePasswordCliInstallFailed":
    "OpenBot could not install the 1Password CLI. Check the connection to the internet, then try again.",
  "error.connector.onePasswordCliSignedOut":
    "The 1Password CLI is not signed in. Turn on its integration in the 1Password app, then connect again.",
  "error.connector.onePasswordCliFailed": "The 1Password CLI failed: {detail}",
  "error.connector.onePasswordUnexpected": "1Password sent an unexpected answer: {detail}",
  "error.connector.onePasswordTokenRejected": "1Password did not accept the service account token.",
  "error.connector.onePasswordNoVault":
    "The service account cannot read a vault. Give it access to a vault, then try again.",
  "error.connector.onePasswordFileUnreadable": "The 1Password connection file is unreadable.",
  "error.connector.onePasswordFileTooLarge": "The 1Password connection file is too large.",
  "error.connector.bitwardenFailed":
    "Could not read Bitwarden. Install the bw CLI, sign in, unlock it, and create one folder named Shared with OpenBot. Connect with a new session key.",
  "error.connector.bitwardenCliMissing":
    "OpenBot cannot find the Bitwarden CLI. Install bw, make sure that it works in a new terminal, then connect again.",
  "error.connector.bitwardenFolderMissing":
    "Bitwarden must have exactly one folder named Shared with OpenBot. Create it or remove the extra one, then connect again.",
  "error.connector.bitwardenHostInput":
    "Enter an HTTPS server address, the API key client_id and client_secret, and the master password.",
  "error.connector.bitwardenHostFailed":
    "Could not open Bitwarden on this server. Check the server address, the API key and the master password, and make sure that one folder is named Shared with OpenBot. Then connect again.",
  "error.connector.bitwardenCliInstallFailed":
    "Could not install the Bitwarden CLI on this server. Check its network connection, then connect again.",
  "error.connector.bitwardenFileUnreadable": "The Bitwarden connection file is unreadable.",
  "error.connector.passwordManagerUnknown": "OpenBot does not know this password manager.",
  "error.connector.passwordManagerMethod": "This password manager cannot connect this way.",
  "error.connector.passwordManagerNoSignIn": "No sign-in page is open. Connect again.",
  "error.connector.protonPassFailed": "Could not connect Proton Pass. Connect again.",
  "error.connector.protonPassCliInstallFailed":
    "Could not install the Proton Pass CLI. Check the network connection, then connect again.",
  "error.connector.protonPassPlan":
    "Your Proton plan does not allow the Proton Pass CLI. Change the plan, then connect again.",
  "error.connector.protonPassExpired": "The Proton Pass access ended. Connect again.",
  "error.connector.protonPassKeyInvalid": "Enter a Proton Pass access key that starts with pst_.",
  "error.connector.protonPassExtraPassword": "The extra password is not correct. Enter it again.",
  "error.connector.protonPassExtraPasswordNotAsked": "Proton Pass did not ask for an extra password.",
  "error.connector.protonPassFileUnreadable": "The Proton Pass connection file is unreadable.",
  "error.connector.protonPassSignInTimeout": "The Proton sign-in took too long. Connect again.",
  "error.connector.protonPassSetupFailed":
    "Could not make the vault Shared with OpenBot or its access key in Proton Pass. Connect again.",
});
