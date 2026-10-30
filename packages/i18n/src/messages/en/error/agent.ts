import { defineMessages } from "../../../message";

export const messages = defineMessages("error.agent", {
  "error.agent.historyUnavailable":
    "History is unavailable for this request. Read recent history again, or use channel_history for channel work.",
  "error.agent.toolRequestInvalid":
    "Invalid tool discovery arguments. Use the declared schema and an original qualified tool name.",
  // Agent errors that the main process and the backend send.
  "error.agent.approvalWhileDeleting": "Cannot grant approval while the agent is being deleted.",
  "error.agent.accessLocalOnly": "Agent access can only be changed on the computer that runs the agent.",
  "error.agent.duplicateCleanupFailed": "Agent duplication failed and the incomplete copy could not be removed.",
  "error.agent.commitEffectsFailed": "The transaction committed, but its saved effects failed.",
  "error.agent.settingsLocalOnly": "Agent settings can only be changed on the computer that runs the agent.",
  "error.agent.skillsLocalOnly": "Skills can only be changed on the computer that runs the agent.",
  "error.agent.addLocalOnly": "Agents can only be added on the computer that runs them.",
  "error.agent.joinedServerUpdate": "An agent on a joined server cannot be updated from here.",
  "error.agent.searchQueryRequired": "A search query is required.",
  "error.agent.messageTooLong": "Message is too long.",
  "error.agent.messageOrAttachmentRequired": "A message or attachment is required.",
  "error.agent.promptAnswersTooLong": "Prompt answers are too long.",
  "error.agent.gone": "This agent no longer exists.",
  "error.agent.profileGenerationBusy": "Profile generation is busy. Try again shortly.",
  "error.agent.initialMessageRequired": "Initial message is required.",
  "error.agent.initialMessageTooLong": "Initial message is too long.",
  "error.agent.setupCleanupFailed": "Agent setup failed and the incomplete agent could not be removed.",
  "error.agent.modelUnavailable": "The selected agent model is unavailable.",
  "error.agent.modelProviderNotConnected":
    'The selected agent model "{model}" is unavailable: {provider} is not connected.',
  "error.agent.modelListEmpty":
    'The selected agent model "{model}" is unavailable: {provider} listed no models. Last error: {detail}',
  "error.agent.modelListEmptyNoError":
    'The selected agent model "{model}" is unavailable: {provider} listed no models.',
  "error.agent.modelNotInProviderList":
    'The selected agent model "{model}" is unavailable: {provider} does not list it.',
  "error.agent.modelProviderMismatch": "The selected model does not belong to that provider.",
  "error.agent.modelNotListed": 'Model "{model}" is not available. Available models: {models}.',
  "error.agent.providerNotListed":
    "No {provider} model is available now. Call list_models to see the available models.",
  "error.agent.reasoningEffortUnsupported":
    'Model "{model}" does not support reasoning effort "{effort}". Supported efforts: {efforts}.',
  "error.agent.noStartingModelInSettings":
    "{provider} has no model available, and no other signed-in provider has one. Sign in to a provider, or change the default provider in Server settings → Providers.",
  "error.agent.noStartingModel":
    "{provider} has no model available, and no other signed-in provider has one. Sign in to a provider, or change the default provider in Providers & permissions.",
  "error.agent.waitBeforeProviderChange": "Wait for the active turn and queue to finish before changing provider.",
  "error.agent.waitForTasksBeforeProviderChange":
    "Tasks of this agent are running. Wait for them to finish, or stop them, before changing provider.",
  "error.agent.waitBeforeClearContext": "Wait for the active turn and queue to finish before starting a new chat.",
  "error.agent.waitBeforeCompactContext": "Wait for the active turn and queue to finish before compacting the context.",
  "error.agent.compactContextUnavailable": "This agent cannot compact its context now.",
  "error.agent.unknown": "Unknown agent: {id}",
  "error.agent.onlyUserWidensSettings":
    "Only the user can give an agent Full access or turn Computer Use on. Ask the user to change it in the agent's settings.",
  "error.agent.queuedMessageCreateFailed": "Unable to create queued message.",
  "error.agent.messageUnavailable": "The message is no longer available.",
  "error.agent.hostLimit": "A host can have up to {limit} agents.",
  "error.agent.changedWhileDuplicating": "The agent changed while it was being duplicated. Try again.",
  "error.agent.duplicatedAgentGone": "The duplicated agent no longer exists.",
  "error.agent.stateCorrupt": "Agent state is corrupt or from a newer OpenBot version; refusing to overwrite it.",
  "error.agent.oldRoleField": "Stored agent profiles use the old role field; update the data before starting OpenBot.",
  "error.agent.duplicateIds": "Agent state contains duplicate agent ids; refusing to overwrite it.",
  "error.agent.copyNameFailed": "OpenBot could not create a unique agent copy name.",
  "error.agent.endpointRemoved": "The endpoint this agent used was removed. Choose another model for it.",
  "error.agent.turnStalled":
    "{provider} stopped responding, so OpenBot ended this turn. Send the message again, or choose another model.",
  "error.agent.selectedGone": "The selected agent no longer exists.",
  "error.agent.profileEndpointsChanged": "The custom endpoints changed while this was generating. Try again.",
  "error.agent.profileInvalid": "The provider returned an invalid profile. Try revising your prompt.",
  "error.agent.profileSectionUnavailable":
    "The generated section is unavailable. Try again or choose a section manually.",
  "error.agent.profileTimedOut": "Profile generation timed out. Try again.",
  "error.agent.profileDisconnected": "The provider disconnected while generating the profile.",
  "error.agent.profileToolUse": "The provider attempted to use a tool. Try revising your prompt.",
  "error.agent.profileFailed": "The provider could not generate a profile. Try again.",
  "error.agent.profileTooLarge": "The generated profile is too large. Try a shorter prompt.",
  "error.agent.profileNotStarted": "The provider could not start profile generation.",
  "error.agent.deletionBusy": "Agent deletion is already in progress.",
  "error.agent.stopBeforeDelete": "Stop the agent and cancel its queued messages before deleting it.",
  "error.agent.deleteIncomplete": "The agent data could not be removed completely. Retry deleting the agent.",
  "error.agent.duplicationBusy": "This agent is already being duplicated.",
  "error.agent.waitBeforeDuplicate": "Wait for the agent to finish and clear its queue before duplicating it.",
  "error.agent.saveOtherAgent": "This save belongs to another agent.",
  "error.agent.savedGone": "The saved agent no longer exists.",
  "error.agent.storedProfileUnreadable":
    'A stored agent profile has an unreadable "{field}" value; update the data before starting OpenBot.',
  "error.agent.storedProfileUnreadableId":
    'Stored agent profile {id} has an unreadable "{field}" value; update the data before starting OpenBot.',
  // Written by `QueueEditRejectedError` in @openbot/contracts, which cannot import this package.
  "error.agent.queueEditRejected": "Queue edit rejected: {reason}",
  "error.agent.computerUseLocalOnly": "Computer Use can only be changed on the computer that runs the agent.",
  "error.agent.automationLocalOnly": "Local scripts can only be allowed on the computer that runs the agent.",
  "error.agent.newChatLocalOnly": "Only the computer that runs the agent can let it start new chats.",
  "error.agent.quickAcknowledgementLocalOnly": "Only the computer that runs the agent can change this setting.",
  "error.agent.sideQuestionBusy": "Too many side questions are running. Try again shortly.",
  "error.agent.sideQuestionFailed": "The agent could not answer the side question. Try again.",
  "error.agent.busyMessageModeLocalOnly":
    "What messages do while the agent works can only be set on the computer that runs the agent.",
  "error.agent.backupModelsLocalOnly": "Backup models can only be set on the computer that runs the agent.",
  "error.agent.taskLimitLocalOnly": "The task limit can only be set on the computer that runs the agent.",
  "error.agent.localScriptsOff": "This agent does not allow local scripts.",
  "error.agent.localScriptsRateLimited":
    "Local scripts sent this agent {limit} message or routine requests in the last hour. Try again later.",
  "error.agent.automationOff": "This agent does not allow local scripts to run its routines.",
  "error.agent.automationPayloadTooLong": "The payload is longer than {limit} characters.",
  "error.agent.automationRateLimited":
    "Local scripts ran this agent's routines {limit} times in the last hour. Try again later.",
  "error.agent.workspaceOnlyMacOnly":
    "Workspace only is available for this provider on macOS only. Choose Full access in the agent settings.",
  "error.agent.lowMemory":
    "This server is low on memory. Your message waits in the queue and starts when memory is free. A larger plan gives the server more memory.",
  "error.agent.lowMemoryServer":
    "This server is low on memory. Your message waits in the queue and starts when memory is free.",
  "error.agent.workspaceOnlyToolMissing":
    "Workspace only needs {tool}, which OpenBot did not find. Install it, or choose Full access in the agent settings.",
  "error.agent.claudeSandboxUnavailable":
    "Workspace only needs the Claude sandbox, which Claude cannot start on this computer: {reason}. Choose Full access or another provider in the agent settings.",
  "error.agent.screenCaptureOff":
    "Screen capture is off for this agent. The user can turn on Computer Use in the agent settings.",
  "error.agent.screenCaptureUnavailable": "Screen capture is not available on this computer.",
  "error.agent.screenCaptureShared":
    "Screen capture does not work in a Slack, Discord or Telegram conversation, because other people get its files.",
  "error.agent.screenCaptureDeclined": "The user did not allow this screen capture. Nothing was captured.",
  "error.agent.mcpServerDeclined": "The user did not allow this MCP server change. Nothing changed.",
  "error.agent.mcpServerNotSaved": "The MCP server did not answer, so it was not saved. {error}",
  "error.agent.mcpServerKeysMove":
    "The MCP server {name} holds keys for its current server. Ask the user to change its address, command, arguments or transport in Server settings, MCP.",
  "error.agent.mcpServerUnknown": "No MCP server is named {name}. Call list_mcp_servers for the names.",
  "error.agent.screenCaptureWindowMissing":
    "That window is not open now. Call list_capture_sources to get the current window ids.",
  "error.agent.screenCaptureDisplayMissing":
    "That display is not connected now. Call list_capture_sources to get the current display ids.",
  "error.agent.screenCaptureRegionOutside":
    "The region is not inside one display. Use desktop points inside the bounds of one display from list_capture_sources.",
  "error.agent.screenCapturePermissionMissing":
    "OpenBot does not have the Screen Recording permission. Ask the user to open System Settings > Privacy & Security > Screen & System Audio Recording, turn on OpenBot, then quit and open OpenBot again.",
  "error.agent.screenCaptureEmptyWindows":
    "Windows gave an empty image. Ask the user to unlock the computer and close protected content. A policy of the organization can also stop screen capture.",
  "error.agent.screenCaptureFailed": "The screen capture failed. Try again.",
});
