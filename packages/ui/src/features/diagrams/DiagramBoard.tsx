/**
 * The infinite canvas a diagram is drawn on. Drag the background or scroll to move it; pinch, or
 * hold Command or Ctrl and scroll, to zoom around the pointer. Drag a card to move it, and drag
 * from a card's output port to another card's input port to connect them. Each port is also a
 * button, so a click on an output port and then on an input port connects them from the keyboard.
 * While a connection is in progress, each input port shows whether it accepts it.
 *
 * The board owns only the camera and the gesture in progress. The diagram itself is a prop, and
 * every edit goes out through a callback, so the caller decides what an edit does.
 */

import { Button, Maximize2, Minus, Plus } from "@openbot/ui";
import { prefersReducedMotion } from "@openbot/ui/utils";
import type { JSX } from "@solidjs/web";
import { createMemo, createStore, For, onSettled, Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { DiagramNodeCard, type DiagramPortTarget } from "./DiagramNodeCard";
import {
  type DiagramConnectionProblem,
  diagramBounds,
  diagramConnectionProblem,
  diagramEdgeMidpoint,
  diagramEdgePath,
  diagramExecutionSteps,
  diagramInputPort,
  diagramOutputPort,
} from "./diagram-graph";
import type { Diagram, DiagramNode, DiagramPoint } from "./diagram-model";

const MIN_SCALE = 0.25;
const MAX_SCALE = 2;
const ZOOM_STEP = 1.2;
const WHEEL_ZOOM_RATE = 0.01;
const KEY_STEP = 48;
const FIT_MARGIN = 64;
/** A press that moves less than this is a click, not a drag. */
const DRAG_THRESHOLD = 4;
/** Cards land on this grid, so a row of them lines up without effort. */
const SNAP = 8;
const GRID = 24;

const PROBLEM_KEY = {
  "same-node": "diagram.connect.sameNode",
  "into-routine": "diagram.connect.intoRoutine",
  duplicate: "diagram.connect.duplicate",
  cycle: "diagram.connect.cycle",
} as const satisfies Record<DiagramConnectionProblem, string>;

type Gesture =
  | { kind: "pan"; start: DiagramPoint; camera: { x: number; y: number }; moved: boolean }
  | { kind: "node"; nodeId: string; start: DiagramPoint; origin: DiagramPoint; moved: boolean }
  | { kind: "connect"; from: string; start: DiagramPoint; moved: boolean };

interface BoardInteraction {
  /** The output a connection starts from, while one is in progress. */
  source: string | null;
  /** The pointer, in canvas coordinates, while a connection is dragged. */
  pointer: DiagramPoint | null;
  hoverTarget: string | null;
  selectedEdgeId: string | null;
  dragging: boolean;
  message: string;
  messageTone: "neutral" | "danger";
}

export interface DiagramBoardProps {
  diagram: Diagram;
  agents: AgentProfile[];
  selectedNodeId: string | null;
  /** The day the routine week strips start on. */
  now: Date;
  editable?: boolean;
  onSelectNode: (nodeId: string | null) => void;
  onMoveNode: (nodeId: string, position: DiagramPoint) => void;
  onConnect: (from: string, to: string) => void;
  onRemoveEdge: (edgeId: string) => void;
  onRemoveNode: (nodeId: string) => void;
  onRunRoutine?: ((nodeId: string) => void) | undefined;
  onAddRoutine?: (() => void) | undefined;
  onAddAgent?: (() => void) | undefined;
  /** Panels that float over the canvas, such as the assistant. */
  children?: JSX.Element;
}

export function DiagramBoard(props: DiagramBoardProps) {
  const { t, format } = useText();
  const editable = () => props.editable !== false;
  const [camera, setCamera] = createStore({ x: 0, y: 0, scale: 1, settling: false });
  const [interaction, setInteraction] = createStore<BoardInteraction>({
    source: null,
    pointer: null,
    hoverTarget: null,
    selectedEdgeId: null,
    dragging: false,
    message: "",
    messageTone: "neutral",
  });
  let viewport: HTMLDivElement | undefined;
  let gesture: Gesture | undefined;
  /** The click that ends a drag must not also select or connect. */
  let suppressClick = false;
  let cameraMoved = false;

  const nodeById = createMemo(() => new Map(props.diagram.nodes.map((node) => [node.id, node])));
  const agentById = createMemo(() => new Map(props.agents.map((agent) => [agent.id, agent])));
  const steps = createMemo(() => diagramExecutionSteps(props.diagram.nodes, props.diagram.edges));
  const stepRuns = createMemo(() => new Map((props.diagram.lastRun?.steps ?? []).map((step) => [step.nodeId, step])));
  const nodeName = (node: DiagramNode | undefined) => {
    if (!node) return "";
    if (node.kind === "routine") return node.name;
    return agentById().get(node.agentId)?.name ?? node.agentId;
  };

  const view = () => ({ width: viewport?.clientWidth ?? 0, height: viewport?.clientHeight ?? 0 });
  const local = (event: { clientX: number; clientY: number }): DiagramPoint => {
    const rect = viewport?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };
  const toWorld = (point: DiagramPoint): DiagramPoint => ({
    x: (point.x - camera.x) / camera.scale,
    y: (point.y - camera.y) / camera.scale,
  });
  const clampScale = (scale: number) => Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE);
  const moveCamera = (next: { x: number; y: number; scale: number }, animate: boolean, byUser = true) => {
    cameraMoved ||= byUser;
    setCamera((state) => {
      state.x = next.x;
      state.y = next.y;
      state.scale = clampScale(next.scale);
      // Buttons and keys glide to the new view; a drag, a scroll or a pinch follows at once.
      state.settling = animate && !prefersReducedMotion();
    });
  };
  const zoomAround = (scale: number, point: DiagramPoint) => {
    const next = clampScale(scale);
    return {
      scale: next,
      x: point.x - ((point.x - camera.x) * next) / camera.scale,
      y: point.y - ((point.y - camera.y) * next) / camera.scale,
    };
  };
  const zoomBy = (factor: number) =>
    moveCamera(zoomAround(camera.scale * factor, { x: view().width / 2, y: view().height / 2 }), true);
  const fitView = (animate: boolean) => {
    const bounds = diagramBounds(props.diagram.nodes);
    const { width, height } = view();
    if (!width || !height) return;
    if (!bounds.width) {
      moveCamera({ x: width / 2, y: height / 2, scale: 1 }, animate, false);
      return;
    }
    const scale = clampScale(
      Math.min((width - FIT_MARGIN * 2) / bounds.width, (height - FIT_MARGIN * 2) / bounds.height, 1),
    );
    moveCamera(
      {
        scale,
        x: (width - bounds.width * scale) / 2 - bounds.x * scale,
        y: (height - bounds.height * scale) / 2 - bounds.y * scale,
      },
      animate,
      false,
    );
  };

  const announce = (message: string, tone: "neutral" | "danger" = "neutral") =>
    setInteraction((state) => {
      state.message = message;
      state.messageTone = tone;
    });
  const cancelConnection = () =>
    setInteraction((state) => {
      state.source = null;
      state.pointer = null;
      state.hoverTarget = null;
    });
  const problemFor = (from: string, to: string) =>
    diagramConnectionProblem(props.diagram.nodes, props.diagram.edges, from, to);
  const inputTarget = (nodeId: string): DiagramPortTarget => {
    const source = interaction.source;
    if (!source) return "none";
    return problemFor(source, nodeId) ? "invalid" : "valid";
  };
  const tryConnect = (from: string, to: string) => {
    const problem = problemFor(from, to);
    cancelConnection();
    if (problem) {
      announce(t(PROBLEM_KEY[problem]), "danger");
      return;
    }
    props.onConnect(from, to);
    announce(t("diagram.connect.done", { from: nodeName(nodeById().get(from)), to: nodeName(nodeById().get(to)) }));
  };
  const startConnection = (from: string) => {
    setInteraction((state) => {
      state.source = from;
      state.selectedEdgeId = null;
    });
    announce(t("diagram.port.choose", { name: nodeName(nodeById().get(from)) }));
  };
  const removeSelection = () => {
    const edgeId = interaction.selectedEdgeId;
    if (edgeId) {
      props.onRemoveEdge(edgeId);
      setInteraction((state) => {
        state.selectedEdgeId = null;
      });
      return true;
    }
    if (props.selectedNodeId) {
      props.onRemoveNode(props.selectedNodeId);
      return true;
    }
    return false;
  };

  onSettled(() => {
    const area = viewport;
    if (!area) return;
    // The diagram stays fitted to the area while it resizes, until the user moves the camera.
    const onResize = new ResizeObserver(() => {
      if (!cameraMoved && area.clientWidth) fitView(false);
    });
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      // A trackpad pinch arrives as a wheel event with Ctrl held.
      if (event.ctrlKey || event.metaKey) {
        moveCamera(zoomAround(camera.scale * Math.exp(-event.deltaY * WHEEL_ZOOM_RATE), local(event)), false);
        return;
      }
      const sideways = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
      const down = event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY;
      moveCamera({ x: camera.x - sideways, y: camera.y - down, scale: camera.scale }, false);
    };
    const onMove = (event: PointerEvent) => {
      const current = gesture;
      if (!current) return;
      const point = local(event);
      const dx = point.x - current.start.x;
      const dy = point.y - current.start.y;
      if (!current.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      current.moved = true;
      if (current.kind === "pan") {
        moveCamera({ x: current.camera.x + dx, y: current.camera.y + dy, scale: camera.scale }, false);
        return;
      }
      if (current.kind === "node") {
        setInteraction((state) => {
          state.dragging = true;
        });
        props.onMoveNode(current.nodeId, {
          x: Math.round((current.origin.x + dx / camera.scale) / SNAP) * SNAP,
          y: Math.round((current.origin.y + dy / camera.scale) / SNAP) * SNAP,
        });
        return;
      }
      const port = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-diagram-port='in']");
      const target = port?.closest<HTMLElement>("[data-diagram-node]")?.dataset.diagramNode ?? null;
      setInteraction((state) => {
        state.source = current.from;
        state.pointer = toWorld(point);
        state.hoverTarget = target;
      });
    };
    const onUp = () => {
      const current = gesture;
      gesture = undefined;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      delete area.dataset.panning;
      setInteraction((state) => {
        state.dragging = false;
      });
      if (!current) return;
      if (current.moved) {
        suppressClick = true;
        queueMicrotask(() => {
          suppressClick = false;
        });
      }
      if (current.kind === "pan" && !current.moved) {
        cancelConnection();
        setInteraction((state) => {
          state.selectedEdgeId = null;
        });
        props.onSelectNode(null);
      }
      if (current.kind === "connect" && current.moved) {
        const target = interaction.hoverTarget;
        if (target) tryConnect(current.from, target);
        else cancelConnection();
      }
    };
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      const target = event.target;
      const start = local(event);
      const edgeId = target.closest<SVGElement>("[data-diagram-edge]")?.dataset.diagramEdge;
      if (edgeId) {
        cancelConnection();
        props.onSelectNode(null);
        setInteraction((state) => {
          state.selectedEdgeId = edgeId;
        });
        return;
      }
      const port = target.closest<HTMLElement>("[data-diagram-port='out']");
      const nodeId = target.closest<HTMLElement>("[data-diagram-node]")?.dataset.diagramNode;
      if (port && nodeId && editable()) {
        gesture = { kind: "connect", from: nodeId, start, moved: false };
      } else if (target.closest("[data-diagram-control], [data-diagram-overlay]")) {
        return;
      } else if (nodeId && editable()) {
        const node = nodeById().get(nodeId);
        if (!node) return;
        gesture = { kind: "node", nodeId, start, origin: { ...node.position }, moved: false };
      } else if (!nodeId) {
        gesture = { kind: "pan", start, camera: { x: camera.x, y: camera.y }, moved: false };
        area.dataset.panning = "";
      } else {
        return;
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    };
    area.addEventListener("wheel", onWheel, { passive: false });
    area.addEventListener("pointerdown", onDown);
    onResize.observe(area);
    return () => {
      area.removeEventListener("wheel", onWheel);
      area.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      onResize.disconnect();
    };
  });

  const edgeState = (to: string) => {
    const status = stepRuns().get(to)?.status;
    if (status === "running") return "running";
    if (status === "succeeded" || status === "failed") return "delivered";
    return "idle";
  };
  const draftPath = () => {
    const source = nodeById().get(interaction.source ?? "");
    const pointer = interaction.pointer;
    if (!source || !pointer) return null;
    return diagramEdgePath(diagramOutputPort(source), pointer);
  };

  return (
    <div class="diagram-board">
      <div
        ref={(element) => (viewport = element)}
        class="diagram-board-viewport"
        style={{
          "--diagram-grid-size": `${GRID * camera.scale}px`,
          "--diagram-grid-x": `${camera.x}px`,
          "--diagram-grid-y": `${camera.y}px`,
        }}
        data-connecting={interaction.source ? "" : undefined}
        data-dragging={interaction.dragging ? "" : undefined}
        // The canvas takes the arrow keys, so a screen reader passes them through to it.
        role="application"
        aria-label={t("diagram.board.label", { name: props.diagram.name })}
        tabindex="0"
        onKeyDown={(event: KeyboardEvent) => {
          if (event.target instanceof HTMLElement && event.target.closest("[data-diagram-overlay]")) return;
          const step = {
            ArrowLeft: [KEY_STEP, 0],
            ArrowRight: [-KEY_STEP, 0],
            ArrowUp: [0, KEY_STEP],
            ArrowDown: [0, -KEY_STEP],
          }[event.key];
          if (step)
            moveCamera({ x: camera.x + (step[0] ?? 0), y: camera.y + (step[1] ?? 0), scale: camera.scale }, true);
          else if (event.key === "+" || event.key === "=") zoomBy(ZOOM_STEP);
          else if (event.key === "-") zoomBy(1 / ZOOM_STEP);
          else if (event.key === "0") fitView(true);
          else if (event.key === "Escape" && interaction.source) cancelConnection();
          else if ((event.key === "Delete" || event.key === "Backspace") && editable()) {
            if (!removeSelection()) return;
          } else return;
          event.preventDefault();
        }}
      >
        <div
          class="diagram-board-world"
          data-settling={camera.settling ? "" : undefined}
          style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }}
        >
          <svg class="diagram-edges" aria-hidden="true">
            <For each={props.diagram.edges}>
              {(edge) => (
                <Show when={nodeById().get(edge.from) && nodeById().get(edge.to) ? edge : undefined}>
                  {(current) => {
                    const path = () => {
                      const from = nodeById().get(current().from);
                      const to = nodeById().get(current().to);
                      return from && to ? diagramEdgePath(diagramOutputPort(from), diagramInputPort(to)) : "";
                    };
                    return (
                      <g
                        class="diagram-edge"
                        data-diagram-edge={current().id}
                        data-state={edgeState(current().to)}
                        data-selected={interaction.selectedEdgeId === current().id ? "" : undefined}
                      >
                        <path class="diagram-edge-hit" d={path()} />
                        <path class="diagram-edge-line" d={path()} />
                      </g>
                    );
                  }}
                </Show>
              )}
            </For>
            <Show when={draftPath()}>
              {(path) => (
                <path
                  class="diagram-edge-draft"
                  data-target={interaction.hoverTarget ? inputTarget(interaction.hoverTarget) : "none"}
                  d={path()}
                />
              )}
            </Show>
          </svg>

          {/* An edge is a thin line, so the button that selects it sits on its midpoint, where a
              pointer and the keyboard can both reach it. */}
          <For each={props.diagram.edges}>
            {(edge) => {
              const ends = () => {
                const from = nodeById().get(edge.from);
                const to = nodeById().get(edge.to);
                return from && to ? { from, to } : undefined;
              };
              return (
                <Show when={ends()}>
                  {(pair) => {
                    const midpoint = () =>
                      diagramEdgeMidpoint(diagramOutputPort(pair().from), diagramInputPort(pair().to));
                    return (
                      <Show when={editable()}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          class="diagram-edge-remove"
                          data-diagram-control=""
                          data-selected={interaction.selectedEdgeId === edge.id ? "" : undefined}
                          style={{ "--diagram-edge-x": `${midpoint().x}px`, "--diagram-edge-y": `${midpoint().y}px` }}
                          aria-label={t("diagram.edge.remove", {
                            from: nodeName(pair().from),
                            to: nodeName(pair().to),
                          })}
                          onClick={() => {
                            props.onRemoveEdge(edge.id);
                            setInteraction((state) => {
                              state.selectedEdgeId = null;
                            });
                          }}
                        >
                          <Minus aria-hidden="true" />
                        </Button>
                      </Show>
                    );
                  }}
                </Show>
              );
            }}
          </For>

          <For each={props.diagram.nodes}>
            {(node) => (
              <DiagramNodeCard
                node={node}
                name={nodeName(node)}
                agent={node.kind === "agent" ? agentById().get(node.agentId) : undefined}
                step={steps().get(node.id)}
                stepRun={stepRuns().get(node.id)}
                selected={props.selectedNodeId === node.id}
                editable={editable()}
                connecting={interaction.source === node.id}
                inputTarget={inputTarget(node.id)}
                now={props.now}
                firing={props.diagram.lastRun?.status === "running" && props.diagram.lastRun.routineNodeId === node.id}
                onSelect={() => {
                  if (suppressClick) return;
                  setInteraction((state) => {
                    state.selectedEdgeId = null;
                  });
                  props.onSelectNode(node.id);
                }}
                onRemove={() => props.onRemoveNode(node.id)}
                onOutputPort={() => {
                  if (suppressClick) return;
                  if (interaction.source === node.id) cancelConnection();
                  else startConnection(node.id);
                }}
                onInputPort={() => {
                  const source = interaction.source;
                  if (source) tryConnect(source, node.id);
                }}
                onRunRoutine={props.onRunRoutine ? () => props.onRunRoutine?.(node.id) : undefined}
              />
            )}
          </For>
        </div>

        <Show when={props.diagram.nodes.length === 0}>
          <div class="diagram-board-empty">
            <strong>{t("diagram.board.emptyTitle")}</strong>
            <p>{t("diagram.board.emptyBody")}</p>
          </div>
        </Show>
      </div>

      <Show when={editable() && (props.onAddRoutine || props.onAddAgent)}>
        <div class="diagram-board-tools" role="toolbar" aria-label={t("diagram.toolbar.label")} data-diagram-overlay="">
          <Show when={props.onAddRoutine}>
            <Button type="button" variant="ghost" size="sm" onClick={() => props.onAddRoutine?.()}>
              <Plus aria-hidden="true" />
              {t("diagram.toolbar.addRoutine")}
            </Button>
          </Show>
          <Show when={props.onAddAgent}>
            <Button type="button" variant="ghost" size="sm" onClick={() => props.onAddAgent?.()}>
              <Plus aria-hidden="true" />
              {t("diagram.toolbar.addAgent")}
            </Button>
          </Show>
        </div>
      </Show>

      <div class="diagram-board-zoom" role="toolbar" aria-label={t("diagram.zoom.label")} data-diagram-overlay="">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("diagram.zoom.out")}
          title={t("diagram.zoom.out")}
          onClick={() => zoomBy(1 / ZOOM_STEP)}
        >
          <Minus aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="diagram-board-zoom-level"
          aria-label={t("diagram.zoom.fit", { zoom: format.percent(camera.scale, { maximumFractionDigits: 0 }) })}
          title={t("diagram.zoom.fit", { zoom: format.percent(camera.scale, { maximumFractionDigits: 0 }) })}
          onClick={() => fitView(true)}
        >
          <Maximize2 aria-hidden="true" />
          {format.percent(camera.scale, { maximumFractionDigits: 0 })}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("diagram.zoom.in")}
          title={t("diagram.zoom.in")}
          onClick={() => zoomBy(ZOOM_STEP)}
        >
          <Plus aria-hidden="true" />
        </Button>
      </div>

      <p class="diagram-board-status" data-tone={interaction.messageTone} role="status" aria-live="polite">
        {interaction.message}
      </p>

      {props.children}
    </div>
  );
}
