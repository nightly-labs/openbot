import type { PluginGuide } from "./plugin-guide";

// Every statement about the email server here is taken from the @sarequl/email-mcp repository
// and Google's app password help page. Each page used is in `sources`. Check the sources again,
// and move `checkedAt`, whenever this file changes.

export const EMAIL_PLUGIN_GUIDE: PluginGuide = {
  uses: [
    {
      title: "Read and search your mail",
      text: "The agent lists your folders and newest messages, opens a message with its text and attachment list, and searches by sender, recipient, subject, text, date, unread, flagged or attachment. It shows a whole thread and counts your mail per folder and per sender, and it saves an attachment to a local folder.",
    },
    {
      title: "Write, reply and forward",
      text: "The agent sends a new message, replies or replies to all in the same thread, and forwards a message with its attachments. It can save a draft for you to check and send it later, fill a template from your templates folder, or schedule a message for a later time.",
    },
    {
      title: "Keep the inbox in order",
      text: "The agent marks messages read, unread or flagged, moves and archives them, and acts on many messages at once. It creates, renames and deletes folders. It finds contacts in your mail and reads calendar invites that a message carries.",
    },
    {
      title: "Know about new mail",
      text: "While the server runs, it watches the inbox and tells the agent when new mail arrives, so the agent can read it and act on it.",
    },
  ],
  faq: [
    {
      question: "Which mailboxes does the Email plugin support?",
      answer:
        "Any mailbox with IMAP and SMTP. The server finds the mail servers from the address for Gmail, Google Workspace, Yahoo, iCloud, Zoho, Fastmail, GMX and AOL, and finds them for other domains through DNS. Outlook and Hotmail are not supported yet, because Microsoft is removing password sign-in for IMAP.",
    },
    {
      question: "What password do I type?",
      answer:
        "An app password where your provider has one. For Gmail, turn on 2-Step Verification, then create an app password at myaccount.google.com/apppasswords and type the 16 characters in the connect dialog. A Google Workspace administrator must allow app passwords and IMAP. OpenBot gives the address and password to the local server as environment variables. The plugin catalog holds no secret.",
    },
    {
      question: "Where does my mail go?",
      answer:
        "The server runs on the computer that runs OpenBot and connects only to your mail provider. The agent reads the messages that it opens, as for any other app. The server never writes the password to its logs and removes it from error messages.",
    },
    {
      question: "Can the agent delete my email?",
      answer:
        "It can move messages to Trash, and the provider empties Trash on its own schedule. The server never deletes a message for good. It never deletes a special folder such as the inbox, and deletes a folder that still holds mail only when the agent asks for that on purpose. The server marks the tools that send or delete mail as destructive and the tools that move or archive mail as changes, so a client that reads these marks can ask first. In OpenBot, whether the agent asks you before it runs a tool depends on the agent's access setting: with Full access it does not ask.",
    },
    {
      question: "Who makes this server?",
      answer:
        "An independent developer publishes it as @sarequl/email-mcp on npm under the MIT license. The code is on GitHub. It is not made by Google or any other mail provider. The listing runs one pinned version.",
    },
  ],
  sources: [
    { label: "@sarequl/email-mcp: README", url: "https://github.com/sarequl/email-mcp#readme" },
    {
      label: "@sarequl/email-mcp: Setting up your provider",
      url: "https://github.com/sarequl/email-mcp#setting-up-your-provider",
    },
    {
      label: "Google: Sign in with app passwords",
      url: "https://support.google.com/accounts/answer/185833",
    },
  ],
  checkedAt: "2026-11-05",
};
