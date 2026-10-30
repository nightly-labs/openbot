/** The nodes that the user copied on a workflow canvas. */

import { createSignal } from "solid-js";
import type { WfnEdge, WfnFields, WfnPoint, WfnSize } from "./workflow-board";
import type { CanvasItem } from "./workflow-history";

/** Copied nodes, where they were, their sizes, their text and style, and the connections between them. */
export interface Clip {
  nodes: readonly (CanvasItem & { at: WfnPoint })[];
  sizes: Record<string, WfnSize>;
  fields: Record<string, WfnFields>;
  edges: readonly WfnEdge[];
}

/** The type that marks copied nodes on the system clipboard. */
export const CLIP_TYPE = "application/x-openbot-workflow-nodes";

/**
 * The last copied nodes, for every canvas on the page. The system clipboard holds only the key of the
 * copy, so text that is copied later replaces it, and a paste does not put back old nodes.
 */
export const [copied, setCopied] = createSignal<{ key: string; clip: Clip }>();
