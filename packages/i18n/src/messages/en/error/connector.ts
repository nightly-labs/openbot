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
});
