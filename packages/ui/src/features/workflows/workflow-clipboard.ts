import { createSignal } from "solid-js";
import type { WfnEdge, WfnFields, WfnPoint, WfnSize } from "./workflow-board";
import type { CanvasItem } from "./workflow-history";

export interface Clip {
  nodes: readonly (CanvasItem & { at: WfnPoint })[];
  sizes: Record<string, WfnSize>;
  fields: Record<string, WfnFields>;
  edges: readonly WfnEdge[];
}

export const CLIP_TYPE = "application/x-openbot-workflow-nodes";

export const [copied, setCopied] = createSignal<{ key: string; clip: Clip }>();
