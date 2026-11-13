/**
 * The fields of a workflow node that the host reads without the database. The port rules of a graph
 * are the contract's (`workflowGraphProblem`), so the mobile editor checks a graph as the host does.
 */

import type { WorkflowFieldValue, WorkflowNode, WorkflowNodeKind } from "@openbot/contracts/ipc";

/** The zone that a trigger node names, or null when it names none. */
export function nodeTimezone(node: WorkflowNode): string | null {
  const timezone = node.fields.timezone;
  return typeof timezone === "string" && timezone.length > 0 ? timezone : null;
}

/** The fields that a run reads, by kind (`WorkflowFields` in the contracts). Others are view state. */
const RUNTIME_FIELDS: Record<WorkflowNodeKind, readonly string[]> = {
  trigger: [
    "trigger",
    "timezone",
    "repositories",
    "event",
    "filters",
    "labels",
    "titleText",
    "branch",
    "connectionId",
    "placeId",
    "roles",
    "text",
  ],
  agent: ["agentId", "task"],
  llm: ["provider", "model", "effort", "prompt", "system"],
  condition: ["rule", "provider", "model", "effort"],
  approval: ["question"],
  output: [
    "target",
    "connectionId",
    "placeId",
    "channelId",
    "repository",
    "item",
    "action",
    "labels",
    "labelsFrom",
    "person",
    "reason",
    "title",
    "emoji",
  ],
  prompt: ["text"],
  text: ["text"],
  note: ["text"],
  shape: ["text"],
  asset: ["fileId"],
  image: [
    "media",
    "model",
    "account",
    "prompt",
    "aspect",
    "duration",
    "resolution",
    "firstFrame",
    "lastFrame",
    "voice",
  ],
};

/** The fields of a node that a run reads, without empty ones. */
export function runtimeFields(node: WorkflowNode): Record<string, WorkflowFieldValue> {
  return Object.fromEntries(
    RUNTIME_FIELDS[node.kind].flatMap((name) => {
      const value = node.fields[name];
      return value === undefined || value === "" ? [] : [[name, value]];
    }),
  );
}
