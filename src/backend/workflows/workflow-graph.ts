import { WORKFLOW_RUNTIME_FIELDS, type WorkflowFieldValue, type WorkflowNode } from "@openbot/contracts/ipc";

export function nodeTimezone(node: WorkflowNode): string | null {
  const timezone = node.fields.timezone;
  return typeof timezone === "string" && timezone.length > 0 ? timezone : null;
}

export function runtimeFields(node: WorkflowNode): Record<string, WorkflowFieldValue> {
  return Object.fromEntries(
    WORKFLOW_RUNTIME_FIELDS[node.kind].flatMap((name) => {
      const value = node.fields[name];
      return value === undefined || value === "" ? [] : [[name, value]];
    }),
  );
}
