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
  // An agent that does not say how many times it tries, such as OpenCode, with the model provider behind it.
  "status.provider.modelRetryUnreachable":
    "{provider} cannot connect to the model provider. It tries again: attempt {attempt}.",
  "status.provider.modelRetryServerError":
    "The model provider is busy or has an error. {provider} tries again: attempt {attempt}.",
  "status.provider.modelRetryOutOfMemory":
    "The model server ran out of memory for this chat. {provider} tries again: attempt {attempt}. A new chat needs less memory.",
  "status.provider.modelRetryRecovered": "The model provider answers again.",
  "status.provider.retryRecovered": "{provider} gets answers from its server again.",
  // Claude Code ran a fast mode turn at the standard speed, with the reason.
  "status.provider.claudeFastModeNeedsUsageCredits":
    "Claude answered at the standard speed. Fast mode with a Claude subscription uses usage credits. Turn them on in your Claude account.",
  "status.provider.claudeFastModeNotOnPlan":
    "Claude answered at the standard speed. Your Claude plan does not include fast mode.",
  "status.provider.claudeFastModeNotFirstParty":
    "Claude answered at the standard speed. Fast mode works only with an Anthropic API key or a Claude subscription, not with Bedrock, Vertex, Foundry or a gateway.",
  "status.provider.claudeFastModeModelNotAllowed":
    "Claude answered at the standard speed. This model cannot use fast mode on your account.",
  "status.provider.claudeFastModeTurnedOff":
    "Claude answered at the standard speed. Fast mode is turned off in the Claude Code settings or by your organization.",
  "status.provider.claudeFastModeUnavailable":
    "Claude answered at the standard speed. Claude Code could not use fast mode for this turn.",
  // A Claude sign-in whose CLI uses an API key from the Claude Code settings or the environment.
  "status.provider.claudeOwnApiKey":
    "Claude Code is set to use an Anthropic API key. Anthropic bills each request to the key's API credit, not to your Claude plan. To use your plan, remove the key from the Claude Code settings or the environment variables, then restart OpenBot.",
});
