import { defineMessages } from "../../message";

export const messages = defineMessages("notification", {
  // Desktop notifications, raised by the main process while the window may be closed, and browser
  // notifications, raised by the web client while its tab is open.
  "notification.needsInput": "Needs your input.",
  "notification.needsApproval": "Needs your approval.",
  "notification.needsBrowserStep": "Needs you to finish a step in the browser.",
  "notification.needsApprovalFor": "Needs your approval: {action}",
  "notification.finished": "Finished working.",
  // A workflow step that waits for a person to approve or reject it.
  "notification.workflowApproval": "A step waits for your approval.",
  // A workflow output step that tells the user its result.
  "notification.workflowOutput": "A workflow has a new result.",
  "notification.failed": "Stopped with an error.",
  // The title of a notification about an agent in a channel: the agent and the channel name.
  "notification.channelTitle": "{agent} in {channel}",
  // The body of a channel reply notification when the preview of agent words is off.
  "notification.channelMessage": "Sent a message.",
  "notification.usageLimit.title": "{provider} account reached its limit",
  "notification.usageLimit.body": {
    one: "{count} agent waits. OpenBot will try again later.",
    other: "{count} agents wait. OpenBot will try again later.",
  },
  "notification.usageLimit.bodyResets": {
    one: "{count} agent waits. Resets {reset}.",
    other: "{count} agents wait. Resets {reset}.",
  },
  // A metric of a server machine passed its alert level. {percent} and {level} are formatted percents.
  "notification.machineAlert.disk": "{server}: disk {percent} full",
  "notification.machineAlert.memory": "{server}: memory {percent} used",
  "notification.machineAlert.cpu": "{server}: CPU {percent} busy",
  "notification.machineAlert.body": "It passed the alert level of {level}. See Server settings > Storage.",
  "notification.test": "Notifications are working.",
  "notification.welcome": "OpenBot will tell you here when an agent needs you.",
  // The toast region in each window.
  "notification.toast.region": "Notifications",
  "notification.toast.close": "Close notification",
});
