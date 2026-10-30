import { defineMessages } from "../../../message";

export const messages = defineMessages("mobile.share", {
  "mobile.share.signInTitle": "Sign in to share",
  "mobile.share.signInDescription":
    "Scan the QR code in OpenBot on your computer. Then you can choose the agent that gets what you shared.",
  "mobile.share.reading": "Reading what you shared…",
  "mobile.share.readFailed": "OpenBot could not read what you shared. Share it again.",
  "mobile.share.content": "To share",
  "mobile.share.footer": "The chat opens with this in the message field. Nothing is sent until you send it.",
  "mobile.share.lastUsed": "Last used",
  "mobile.share.noAgents": "No agents",
  "mobile.share.chooseAgent": "Choose an agent",
  "mobile.share.action": "Share with {name}",
  "mobile.share.extension.send": "Send",
  "mobile.share.extension.footer": "OpenBot sends this to the agent now. The app does not open.",
  "mobile.share.extension.sending": "Sending to {name}…",
  "mobile.share.extension.sent": "Sent to {name}",
  "mobile.share.extension.failed": "OpenBot could not send this. Open the app to send it from there.",
  "mobile.share.extension.unconfirmed":
    "The server did not confirm the message. Look in the chat before you send it again.",
  "mobile.share.extension.openApp": "Open OpenBot",
});
