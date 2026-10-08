import { defineMessages } from "../../message";

export const messages = defineMessages("uiBlock", {
  "uiBlock.status.pending": "Needs your answer",
  "uiBlock.status.answered": "Answered",
  "uiBlock.status.expired": "Expired",
  "uiBlock.status.closed": "Closed",
  "uiBlock.outcome.expired": "No answer was given in time",
  "uiBlock.outcome.closed": "Closed without an answer",
  "uiBlock.confirm.holdHint": "Hold the button to confirm",
  "uiBlock.confirm.previewLabel": "Preview",
  "uiBlock.choice.submit": "Send",
  "uiBlock.choice.shortcutHint": "Press {first} to {last} to choose",
  "uiBlock.choice.selectedCount": { one: "{count} selected", other: "{count} selected" },
  "uiBlock.choice.noneSelected": "Nothing selected",
  "uiBlock.quick.label": "Quick replies",
  "uiBlock.quick.textLabel": "Your own reply",
  "uiBlock.quick.textPlaceholder": "Or type your own reply",
  "uiBlock.quick.send": "Send",
  "uiBlock.form.submit": "Submit",
  "uiBlock.form.required": "This field is required",
  "uiBlock.form.choose": "Choose an option",
  "uiBlock.form.notSet": "Not set",
});
