import { defineMessages } from "../../message";

/**
 * Short words with no context of their own: a button or a menu item that means the same thing on
 * every screen. A word whose translation can change with the screen gets a key in that screen's
 * area instead, even when the English is the same.
 */
export const messages = defineMessages("common", {
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.close": "Close",
  "common.delete": "Delete",
  "common.remove": "Remove",
  "common.edit": "Edit",
  "common.rename": "Rename",
  "common.retry": "Retry",
  "common.copy": "Copy",
  "common.copied": "Copied",
  "common.done": "Done",
  "common.back": "Back",
  "common.continue": "Continue",
  "common.add": "Add",
  "common.create": "Create",
  "common.open": "Open",
  "common.search": "Search",
  "common.loading": "Loading…",
  "common.saving": "Saving…",
  "common.tryAgain": "Try again",
  "common.connecting": "Connecting…",
  "common.download": "Download",
  "common.removing": "Removing…",
  "common.sending": "Sending…",
});
