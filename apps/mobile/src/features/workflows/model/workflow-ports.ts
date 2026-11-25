import { WORKFLOW_PORTS, type WorkflowNode, type WorkflowPortType, workflowMediaKind } from "@openbot/contracts/ipc";

type PortNode = Pick<WorkflowNode, "kind" | "fields">;

function outputTypes(node: PortNode): readonly WorkflowPortType[] {
  if (node.kind === "image") return [workflowMediaKind(node.fields) === "video" ? "file" : "image"];
  if (node.kind === "asset") return ["image"];
  return WORKFLOW_PORTS[node.kind].out;
}

export function linkType(from: PortNode, to: PortNode): WorkflowPortType | null {
  const accepts = WORKFLOW_PORTS[to.kind].in;
  return outputTypes(from).find((type) => accepts.includes(type)) ?? null;
}

export function edgeTypeFor(from: PortNode, to: PortNode, kept: WorkflowPortType | undefined): WorkflowPortType | null {
  if (kept && WORKFLOW_PORTS[from.kind].out.includes(kept) && WORKFLOW_PORTS[to.kind].in.includes(kept)) return kept;
  return linkType(from, to);
}
