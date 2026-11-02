/** The minimap: the nodes, the drawn lines and the view, scaled down into one corner of the canvas. */

import type { WorkflowNodeKind } from "@openbot/contracts/ipc";
import { For } from "solid-js";
import type { WfnPoint } from "./workflow-board";
import { type Box, inkPath, type Stroke, strokeBox } from "./workflow-ink";
import { colorVar } from "./workflow-node-parts";

/** The minimap size. The world fits inside it with its aspect ratio kept. */
const MINIMAP = { width: 200, height: 128, margin: 8 };

export interface MinimapLayout {
  nodes: readonly ({ id: string; kind: WorkflowNodeKind } & Box)[];
  lines: readonly { id: string; brush: Stroke["brush"]; color: Stroke["color"]; d: string }[];
  view: Box;
  /** The world point under a minimap point. */
  toWorld: (point: WfnPoint) => WfnPoint;
}

/** Fits the node boxes, the lines and the box that the view shows, in world pixels, into the minimap. */
export function minimapLayout(
  boxes: readonly ({ id: string; kind: WorkflowNodeKind } & Box)[],
  strokes: readonly Stroke[],
  seen: Box,
): MinimapLayout {
  const lines = strokes.filter((stroke) => stroke.points.length > 0);
  const all = [...boxes, ...lines.map(strokeBox), seen];
  const left = Math.min(...all.map((box) => box.x));
  const top = Math.min(...all.map((box) => box.y));
  const right = Math.max(...all.map((box) => box.x + box.width));
  const bottom = Math.max(...all.map((box) => box.y + box.height));
  const room = { width: MINIMAP.width - MINIMAP.margin * 2, height: MINIMAP.height - MINIMAP.margin * 2 };
  const scale = Math.min(room.width / (right - left), room.height / (bottom - top));
  const offset = {
    x: MINIMAP.margin + (room.width - (right - left) * scale) / 2,
    y: MINIMAP.margin + (room.height - (bottom - top) * scale) / 2,
  };
  const place = (box: Box) => ({
    x: offset.x + (box.x - left) * scale,
    y: offset.y + (box.y - top) * scale,
    width: box.width * scale,
    height: box.height * scale,
  });
  const placePoint = (point: WfnPoint) => ({
    x: offset.x + (point.x - left) * scale,
    y: offset.y + (point.y - top) * scale,
  });
  return {
    nodes: boxes.map((box) => ({ id: box.id, kind: box.kind, ...place(box) })),
    lines: lines.map((stroke) => ({
      id: stroke.id,
      brush: stroke.brush,
      color: stroke.color,
      d: inkPath(stroke.points.map(placePoint)),
    })),
    view: place(seen),
    toWorld: (point) => ({ x: left + (point.x - offset.x) / scale, y: top + (point.y - offset.y) / scale }),
  };
}

export function WorkflowMinimap(props: {
  map: MinimapLayout;
  selected: string | null;
  /** A press, and a drag with the button down, in minimap pixels. */
  onPan: (event: PointerEvent & { currentTarget: SVGSVGElement }) => void;
}) {
  return (
    <div class="wfn-hud wfn-minimap" aria-hidden="true">
      <svg
        aria-hidden="true"
        width={MINIMAP.width}
        height={MINIMAP.height}
        viewBox={`0 0 ${MINIMAP.width} ${MINIMAP.height}`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          props.onPan(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 1) props.onPan(event);
        }}
      >
        {/* Keyed by node, so a camera move changes the boxes and does not make new ones. */}
        <For each={props.map.nodes} keyed={(box) => box.id}>
          {(box) => (
            <rect
              class="wfn-minimap-node"
              data-kind={box().kind}
              data-selected={props.selected === box().id ? "" : undefined}
              x={box().x}
              y={box().y}
              width={Math.max(box().width, 2)}
              height={Math.max(box().height, 2)}
              rx={2}
            />
          )}
        </For>
        <For each={props.map.lines} keyed={(line) => line.id}>
          {(line) => (
            <path
              class="wfn-minimap-line"
              d={line().d}
              data-brush={line().brush}
              style={{ "--wfn-ink": colorVar(line().color) }}
            />
          )}
        </For>
        <rect
          class="wfn-minimap-view"
          x={props.map.view.x}
          y={props.map.view.y}
          width={props.map.view.width}
          height={props.map.view.height}
          rx={4}
        />
      </svg>
    </div>
  );
}
