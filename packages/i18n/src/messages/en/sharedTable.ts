import { defineMessages } from "../../message";

export const messages = defineMessages("sharedTable", {
  "sharedTable.title": "Tables",
  "sharedTable.description": "What the agents keep between tasks, with the agent that started each set of records",
  "sharedTable.close": "Close tables",
  "sharedTable.loading": "Loading tables…",
  "sharedTable.empty":
    "No tables yet. An agent makes one itself when a task needs records between turns, and every agent can use it.",
  "sharedTable.loadFailed": "Could not load the tables.",
  "sharedTable.deleteFailed": "Could not delete this.",
  "sharedTable.madeOutside": "Made outside OpenBot · any agent can delete it",
  "sharedTable.keptBy": "Kept by {name}",
  "sharedTable.keptByDeleted": "Kept by an agent that no longer exists",
  "sharedTable.deleteName": "Delete {name}",
  "sharedTable.confirmDelete": "Delete this for every agent? The records cannot be recovered.",
  "sharedTable.notCounted": "not counted",
  "sharedTable.records": { one: "{count} record", other: "{count} records" },
});
