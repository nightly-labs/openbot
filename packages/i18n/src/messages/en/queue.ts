import { defineMessages } from "../../message";

export const messages = defineMessages("queue", {
  "queue.label": "Message queue",
  "queue.moved": "Moved queued message to position {position} of {total}.",
  "queue.attachment": "Attachment",
  "queue.hold.named": "Waiting - {name} is working in {channel}",
  "queue.hold.unnamed": "Waiting - this agent is working in {channel}",
  "queue.item.label": "Queued message {position}: {preview}",
  "queue.item.labelEditing": "Queued message {position}, editing: {preview}",
  "queue.item.editing": "Editing",
  "queue.item.steerLabel": "Steer queued message {position}",
  "queue.item.steerTooltip": "Steer message",
  "queue.item.steering": "Steering",
  "queue.item.steer": "Steer",
  "queue.item.deleteLabel": "Delete queued message {position}",
  "queue.item.deleteTooltip": "Delete message",
  "queue.item.editLabel": "Edit queued message {position}",
  "queue.item.editTooltip": "Edit message",
  "queue.deleteHeld.title": "Delete queued message?",
  "queue.deleteHeld.body": "Another device is editing this message. The agent will not receive it.",
  "queue.deleteHeld.keep": "Keep",
});
