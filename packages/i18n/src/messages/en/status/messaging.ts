import { defineMessages } from "../../../message";

export const messages = defineMessages("status.messaging", {
  // Text that OpenBot posts in a Slack conversation. Slack users read it. It names no agent: in
  // Slack, every answer comes from OpenBot.
  "status.messaging.working": "Working on it…",
  "status.messaging.queued": "Waiting: OpenBot is working on another request. The answer comes here.",
  "status.messaging.busy": "Too many requests are waiting. Try again later.",
  "status.messaging.failed": "OpenBot could not finish this request. The OpenBot host has the details.",
  "status.messaging.noAnswer": "OpenBot finished without a written answer.",
  "status.messaging.noAgent": "No agent can answer here yet. Add the Slack Orchestrator in OpenBot.",
  "status.messaging.delegated": "A teammate is working on it. The answer comes here.",
  "status.messaging.stopped": "Stopped.",
  "status.messaging.stop": "Stop",
  "status.messaging.approvalTitle": "OpenBot asks for approval to continue.",
  "status.messaging.approvalCommand": "Run a command",
  "status.messaging.approvalFileChange": "Change files",
  "status.messaging.approvalPermissions": "Get more permissions",
  "status.messaging.approve": "Approve",
  "status.messaging.deny": "Deny",
  "status.messaging.approvedBy": "Approved by {user}.",
  "status.messaging.deniedBy": "Denied by {user}.",
  "status.messaging.answeredOnHost": "Answered on the OpenBot host.",
  "status.messaging.requestInactive": "This request is no longer active.",
  "status.messaging.onlyRequester": "Only {user} can do this. The OpenBot host can also answer.",
  "status.messaging.hostOnly": "Only the OpenBot host can answer this request.",
  "status.messaging.filesSkipped": "Some files were not sent: {names}.",
  // The name and title of the agent that OpenBot adds to answer in Slack. The user can rename it.
  "status.messaging.orchestratorName": "Slack Orchestrator",
  "status.messaging.orchestratorTitle": "Answers in Slack and asks the team",
  // The same texts for Discord. Discord users read the first one.
  "status.messaging.discordNoAgent": "No agent can answer here yet. Add the Discord Orchestrator in OpenBot.",
  "status.messaging.discordOrchestratorName": "Discord Orchestrator",
  "status.messaging.discordOrchestratorTitle": "Answers in Discord and asks the team",
  // The sidebar section that OpenBot puts the Slack Orchestrator in. The user can rename it.
  "status.messaging.integrationsSection": "Integrations",
  // The page a development Slack install ends on.
  "status.messaging.signInReceived": "OpenBot received the Slack install. You can close this tab.",
  "status.messaging.signInUnknown": "OpenBot did not start this Slack install. Start it again in OpenBot.",
});
