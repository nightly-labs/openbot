import { defineMessages } from "../../../message";

export const messages = defineMessages("error.auth", {
  // Errors from the OpenBot account service.
  "error.auth.serviceUnavailable":
    "OpenBot could not reach the account service. Check that the API is running, then try again.",
  "error.auth.signInFirst": "Sign in to OpenBot first.",
  "error.auth.signInRequired": "Sign in is required.",
  "error.auth.accountChangedDuringRegister": "The signed-in account changed while this server was being registered.",
  "error.auth.hostCredentialUnavailable": "The remote host credential is unavailable. Register the host again.",
  "error.auth.codeNotVerified": "The sign-in code could not be verified.",
  "error.auth.serviceError": "The account service returned an error.",
  "error.auth.codeNotSent": "OpenBot could not send the sign-in code.",
  "error.auth.deliveryTimeout":
    "OpenBot could not confirm delivery in time. The code may still arrive; check delivery before sending again.",
  "error.auth.deliveryInterrupted":
    "The connection ended before OpenBot confirmed delivery. Check delivery to avoid sending another code.",
  "error.auth.deliveryUnknown":
    "OpenBot could not confirm whether the sign-in code was sent. Check delivery before sending again.",
});
