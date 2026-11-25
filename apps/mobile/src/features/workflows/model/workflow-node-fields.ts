import type { WorkflowNode } from "@openbot/contracts/ipc";
import { isOneOf } from "@openbot/contracts/runtime-values";

export function fieldText(node: WorkflowNode | undefined, name: string): string {
  const value = node?.fields[name];
  return typeof value === "string" ? value : "";
}

export function fieldOneOf<T extends string>(
  node: WorkflowNode | undefined,
  name: string,
  values: readonly T[],
  fallback: T,
): T {
  const value = node?.fields[name];
  return isOneOf(values, value) ? value : fallback;
}
