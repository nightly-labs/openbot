import type { WorkflowFieldValue, WorkflowNode, WorkflowNodeKind } from "@openbot/contracts/ipc";

export function nodeTimezone(node: WorkflowNode): string | null {
  const timezone = node.fields.timezone;
  return typeof timezone === "string" && timezone.length > 0 ? timezone : null;
}

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
    "width",
    "height",
    "background",
    "duration",
    "resolution",
    "firstFrame",
    "lastFrame",
    "voice",
  ],
};

export function runtimeFields(node: WorkflowNode): Record<string, WorkflowFieldValue> {
  return Object.fromEntries(
    RUNTIME_FIELDS[node.kind].flatMap((name) => {
      const value = node.fields[name];
      return value === undefined || value === "" ? [] : [[name, value]];
    }),
  );
}
