import { defineMessages } from "../../../message";

export const messages = defineMessages("status.messaging", {
  // Text that OpenBot posts in a Slack conversation. Slack users read it. It names no agent: in
  // Slack, every answer comes from OpenBot.
  "status.messaging.working": "Working on it…",
  "status.messaging.queued": "Waiting: OpenBot is working on another request. The answer comes here.",
  "status.messaging.busy": "Too many requests are waiting. Try again later.",
  "status.messaging.failed": "OpenBot could not finish this request. The OpenBot host has the details.",
  "status.messaging.noAnswer": "OpenBot finished without a written answer.",
  "status.messaging.routeFailed": "OpenBot could not find who answers this request. The OpenBot host has the details.",
  "status.messaging.noAgent": "No agent can answer here yet. Add one in OpenBot.",
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
  "status.messaging.questionOnHost": "OpenBot asked a question. Answer it on the OpenBot host.",
  "status.messaging.filesSkipped": "Some files were not sent: {names}.",
});
