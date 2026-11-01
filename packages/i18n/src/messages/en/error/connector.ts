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
  "error.connector.bitwardenHostInput":
    "Enter an HTTPS server address, the API key client_id and client_secret, and the master password.",
  "error.connector.bitwardenHostFailed":
    "Could not open Bitwarden on this server. Check the server address, the API key and the master password, and make sure that one folder is named Shared with OpenBot. Then connect again.",
  "error.connector.bitwardenCliInstallFailed":
    "Could not install the Bitwarden CLI on this server. Check its network connection, then connect again.",
  "error.connector.bitwardenFileUnreadable": "The Bitwarden connection file is unreadable.",
  // The Telegram account connection: the API credentials, each step of the sign-in, the stored session and file.
  "error.connector.telegramAccountCredentialsMissing":
    "Enter the api_id and api_hash of your Telegram app. You get them at my.telegram.org.",
  "error.connector.telegramAccountCredentialsInvalid":
    "The api_id is a number and the api_hash has 32 characters from 0-9 and a-f. Copy them again from my.telegram.org.",
  "error.connector.telegramAccountApiRejected":
    "Telegram does not accept this api_id and api_hash. Copy them again from my.telegram.org.",
  "error.connector.telegramAccountPhoneFormat":
    "Enter the phone number with its country code, for example +48 600 100 200.",
  "error.connector.telegramAccountPhoneInvalid":
    "Telegram does not know this number. Include the country code, for example +48.",
  "error.connector.telegramAccountCodeInvalid": "This code is not correct. Check it and try again.",
  "error.connector.telegramAccountCodeEmpty": "Enter the code that Telegram sent you.",
  "error.connector.telegramAccountCodeExpired": "The code expired. Start again to get a new code.",
  "error.connector.telegramAccountPasswordInvalid": "This password is not correct. Try again.",
  "error.connector.telegramAccountPasswordEmpty": "Enter your two-step verification password.",
  "error.connector.telegramAccountPasswordNeeded": "Telegram needs your two-step verification password.",
  "error.connector.telegramAccountNoAccount":
    "This number has no Telegram account. Sign in with a number that already uses Telegram.",
  "error.connector.telegramAccountPhoneBanned": "Telegram has banned this number.",
  "error.connector.telegramAccountQrExpired": "The QR code expired before you scanned it. Start again.",
  "error.connector.telegramAccountFloodWait": "Telegram asks you to wait. Try again in {count} min.",
  "error.connector.telegramAccountCancelled": "The Telegram sign-in was cancelled.",
  "error.connector.telegramAccountTimedOut": "The sign-in stopped after 10 minutes with no activity. Start again.",
  "error.connector.telegramAccountMovedOn": "The sign-in has moved to a different step. Start again.",
  "error.connector.telegramAccountRefused": "Telegram refused the sign-in: {detail}",
  "error.connector.telegramAccountSaveFailed": "OpenBot could not save the Telegram connection: {detail}",
  "error.connector.telegramAccountSessionEnded":
    "Telegram ended this session, for example in Settings > Devices. Connect your Telegram account again.",
  "error.connector.telegramAccountFileUnreadable": "The Telegram account connection file is unreadable.",
  "error.connector.telegramAccountFileTooLarge": "The Telegram account connection file is too large.",
});
