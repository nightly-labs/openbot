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
  // The NEAR Intents wallet: the partner key, the owner's signatures in the browser, and agent payments.
  "error.connector.nearNoKey": "Add a NEAR Intents partner key in Server settings > Vault > Crypto.",
  "error.connector.nearKeyRejected": "The NEAR Intents Agent API did not accept the partner key.",
  "error.connector.nearNoWallet": "No NEAR Intents wallet is set up. Set it up in Server settings > Vault > Crypto.",
  "error.connector.nearWalletExists": "A NEAR Intents wallet is already set up.",
  "error.connector.nearFrozen": "The NEAR Intents wallet is frozen. Unfreeze it in Server settings > Vault > Crypto.",
  "error.connector.nearAgentNotAllowed":
    "This agent cannot pay from the NEAR Intents wallet. Turn it on in Server settings > Vault > Crypto.",
  "error.connector.nearGrantExpired":
    "OpenBot has no payment grant for the NEAR Intents wallet. Renew it in Server settings > Vault > Crypto.",
  "error.connector.nearUnknownAsset": "The NEAR Intents wallet has no asset {asset}.",
  "error.connector.nearAmountInvalid": "{amount} is not a valid amount of {asset}.",
  "error.connector.nearRecipientInvalid": "{recipient} is not a NEAR account or a chain:address.",
  "error.connector.nearRefused": "The NEAR Intents Agent API refused the request: {detail}",
  "error.connector.nearUnexpected": "The NEAR Intents Agent API sent an unexpected answer: {detail}",
  "error.connector.nearUnreachable": "OpenBot cannot reach the NEAR Intents Agent API: {detail}",
  "error.connector.nearFileUnreadable": "The NEAR Intents wallet file is unreadable.",
  "error.connector.nearFileTooLarge": "The NEAR Intents wallet file is too large.",
  "error.connector.nearSigningCanceled": "The signature was canceled.",
  "error.connector.nearSigningExpired": "The signature did not arrive in time. Try again.",
  "error.connector.nearSigningInvalid": "The signature from the browser is not valid.",
  "error.connector.nearSigningBusy": "Another signature waits in the browser. Finish or cancel it first.",
  "error.connector.nearPolicyCooldown": "The NEAR Intents Agent API allows the next policy change at {time}.",
  "error.connector.nearPolicyPending": "The policy change did not finish. Try again in a few minutes.",
  "error.connector.nearDeclined": "The owner declined the payment.",
  "error.connector.nearUncertain":
    "OpenBot does not know if the payment was sent. Do not pay again. The owner can check the wallet history.",
  "error.connector.nearPaymentFailed": "The payment failed: {detail}",
  "error.connector.nearPaymentUnknown": "This payment does not wait for an answer any more.",
  "error.connector.nearRuleFull": "A payment rule can have at most {limit} recipients.",
  "error.connector.nearRulesFull": "The wallet can have at most {limit} payment rules.",
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
