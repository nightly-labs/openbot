import { defineMessages } from "../../../message";

export const messages = defineMessages("status.provider", {
  // Provider runtime download status.
  "status.provider.downloadStopped": "Download stopped. Try again.",
  "status.provider.downloadFailed": "Download failed. Try again.",
  "status.provider.updateWaiting": "The update starts when the current turn ends.",
  "status.provider.confirmContinue": "Continue",
  "status.provider.confirmCancel": "Cancel",
  // A provider that tries a failed API request again during a turn.
  "status.provider.retryUnreachable": "{provider} cannot connect to its server. Retry {attempt} of {maxAttempts}.",
  "status.provider.retryServerError":
    "The {provider} server is busy or has an error. Retry {attempt} of {maxAttempts}.",
  "status.provider.retryRecovered": "{provider} gets answers from its server again.",
});
