import { defineMessages } from "../../message";

export const messages = defineMessages("notification", {
  // Desktop notifications, raised by the main process while the window may be closed.
  "notification.needsInput": "Needs your input.",
  "notification.needsApproval": "Needs your approval.",
  "notification.finished": "Finished working.",
  "notification.failed": "Stopped with an error.",
  "notification.test": "Notifications are working.",
  "notification.welcome": "OpenBot will tell you here when an agent needs you.",
});
