import { defineMessages } from "../../message";

export const messages = defineMessages("memory", {
  "memory.title": "Memories",
  "memory.description": "Saved memories for {name}",
  "memory.add": "Add memory",
  "memory.close": "Close memories",
  "memory.new": "New memory",
  "memory.newPlaceholder": "Add a durable fact or preference",
  "memory.save": "Save memory",
  "memory.limitAgent":
    "This agent has reached the limit of {limit} memories. Edit, merge, or delete a memory before you add another one.",
  "memory.limitChannel":
    "This channel has reached the limit of {limit} memories. Edit, merge, or delete a memory before you add another one.",
  "memory.loading": "Loading memories…",
  "memory.emptyAgent": "This agent has no saved memories yet.",
  "memory.emptyChannel": "This channel has no saved memories yet.",
  "memory.editText": "Edit memory: {text}",
  "memory.edit": "Edit memory",
  "memory.delete": "Delete memory",
  "memory.learned": "Learned automatically",
  "memory.manual": "Added manually",
  "memory.unknownDate": "Unknown date",
  "memory.clearAll": "Clear all memories",
  "memory.clearTitle": "Clear all memories?",
  "memory.clearDescription":
    "OpenBot will permanently remove all {total} saved memories for {name}. Original messages will stay in the conversation history.",

  "memory.loadFailed": "Could not load memories.",
  "memory.saveFailed": "Could not save the memory.",
  "memory.updateFailed": "Could not update the memory.",
  "memory.deleteFailed": "Could not delete the memory.",
  "memory.clearFailed": "Could not clear the memories.",
});
