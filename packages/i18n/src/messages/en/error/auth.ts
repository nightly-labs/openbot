import { defineMessages } from "../../../message";

export const messages = defineMessages("error.auth", {
  // Errors from the OpenBot account service.
  "error.auth.serviceUnavailable":
    "OpenBot could not reach the account service. Check that the API is running, then try again.",
  "error.auth.networkBlocked":
    "A firewall or proxy on this network blocked OpenBot from reaching {host}. Ask your network administrator to allow {host}, then try again.",
  "error.auth.signInFirst": "Sign in to OpenBot first.",
  "error.auth.signInRequired": "Sign in is required.",
  "error.auth.chatColorUnavailable": "The account service does not support chat colors yet. Try again later.",
  "error.auth.accountChangedDuringRegister": "The signed-in account changed while this server was being registered.",
  "error.auth.hostCredentialUnavailable": "The remote host credential is unavailable. Register the host again.",
  "error.auth.codeNotVerified": "The sign-in code could not be verified.",
  "error.auth.serviceError": "The account service returned an error.",
  "error.auth.serviceUnreachable":
    "OpenBot could not reach the account service. Check your connection, then try again.",
  "error.auth.serviceTimeout": "The account service did not answer in time. Try again.",
  "error.auth.serviceStatus": "The account service returned an error ({status}). Try again later.",
  "error.auth.invalidHostedServer": "The account service returned an invalid hosted server.",
  "error.auth.invalidServerClaim": "The account service returned an invalid server claim.",
  "error.auth.codeNotSent": "OpenBot could not send the sign-in code.",
  "error.auth.deliveryTimeout":
    "OpenBot could not confirm delivery in time. The code may still arrive; check delivery before sending again.",
  "error.auth.deliveryInterrupted":
    "The connection ended before OpenBot confirmed delivery. Check delivery to avoid sending another code.",
  "error.auth.deliveryUnknown":
    "OpenBot could not confirm whether the sign-in code was sent. Check delivery before sending again.",
  // Company sign-in, which the company's provider does in the browser.
  "error.auth.companySignInFailed": "The company sign-in did not finish. Try again.",
  "error.auth.companySignInCancelled": "The company sign-in was cancelled.",
  "error.auth.companySignInTimeout": "The company sign-in took too long. Open the sign-in page again.",
  "error.auth.companySignInRefused": "The sign-in at your company was cancelled or refused.",
  "error.auth.companySignInDomainMismatch": "The company account has an email at a domain that is not in the setup.",
  "error.auth.companySignInAccountDisabled": "Your company turned off this account. Ask your administrator.",
  "error.auth.companySignInOff": "Company sign-in is off for this email.",
  "error.auth.companySignInEmailMissing": "Your company account did not give a verified email address.",
  "error.auth.companySignInUnavailable": "This OpenBot cannot open a browser for the company sign-in.",
  "error.auth.companySignInProviderRejected": "The provider did not accept the client ID or secret.",
  "error.auth.companySignInTokenInvalid": "The provider gave a sign-in that OpenBot cannot check.",
  "error.auth.companySignInProviderUnreachable": "The company sign-in provider did not answer.",
  "error.auth.companySignInDomainTaken": "One of these domains already signs in through another server.",
  "error.auth.companySignInNoServer": "Start this server before you set up company sign-in.",
});
