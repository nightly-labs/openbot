/**
 * The fields of a workflow node that the host reads without the database. The port rules of a graph
 * are the contract's (`workflowGraphProblem`), so the mobile editor checks a graph as the host does.
 */

import type { WorkflowNode } from "@openbot/contracts/ipc";

/** The zone that a trigger node names, or null when it names none. */
export function nodeTimezone(node: WorkflowNode): string | null {
  const timezone = node.fields.timezone;
  return typeof timezone === "string" && timezone.length > 0 ? timezone : null;
}
