import { defineMessages } from "../../../message";

export const messages = defineMessages("status.agent", {
  "status.agent.channelInstructionAccepted": "The worker accepted the follow-up instruction.",
  "status.agent.channelInstructionQueued": "The follow-up instruction is queued for the worker's next turn.",
  "status.agent.channelInstructionUncertain": "The worker has not confirmed receipt of the follow-up instruction.",
  "status.agent.claudeWriteOutside":
    "Write {path}, outside the agent's workspace, the shared folder and the temporary folders.",
  "status.agent.contextCleared": "Context cleared. A new chat starts here.",
  "status.agent.marketplaceSuggested": "Suggested a Marketplace app: {app}.",
});
