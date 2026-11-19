import { Button, ContextMenu, Minus, Plus, Scan } from "@openbot/ui";
import { prefersReducedMotion } from "@openbot/ui/utils";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, createStore, For, onSettled, Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { DiagramCanvasMenu } from "./DiagramCanvasMenu";
import { type DiagramModelChoice, DiagramNewAgentCard, type DiagramNewAgentDraft } from "./DiagramNewAgentCard";
import { DiagramNodeCard, type DiagramPortTarget } from "./DiagramNodeCard";
import {
  type DiagramConnectionProblem,
  diagramBounds,
  diagramConnectionProblem,
  diagramEdgeArrow,
  diagramEdgeCarries,
  diagramEdgeEnd,
  diagramEdgeMidpoint,
  diagramEdgePath,
  diagramExecutionSteps,
  diagramInputPort,
  diagramOutputPort,
  diagramRoutineColor,
  diagramRoutineSteps,
  diagramRoutinesReaching,
  diagramRunOf,
} from "./diagram-graph";
import type { Diagram, DiagramEdge, DiagramNode, DiagramPoint } from "./diagram-model";

const MIN_SCALE = 0.25;
const MAX_SCALE = 2;
const ZOOM_STEP = 1.2;
const WHEEL_ZOOM_RATE = 0.01;
const KEY_STEP = 48;
const FIT_MARGIN = 64;
const DRAG_THRESHOLD = 4;
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
  source: string | null;
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
  focusRoutineId: string | null;
  editable?: boolean | undefined;
  onSelectNode: (nodeId: string | null) => void;
  onFocusRoutine: (routineId: string) => void;
  onMoveNode: (nodeId: string, position: DiagramPoint) => void;
  onConnect: (from: string, to: string) => boolean | Promise<boolean>;
  onRemoveEdge: (edgeId: string) => void;
  onRemoveNode: (nodeId: string) => void;
  onRunRoutine?: ((nodeId: string) => void) | undefined;
  connectable?: boolean;
  canRemoveNode?: ((nodeId: string) => boolean) | undefined;
  canRemoveEdge?: ((edgeId: string) => boolean) | undefined;
  addableAgents?: readonly AgentProfile[] | undefined;
  onPlaceAgent?: ((agentId: string, position: DiagramPoint) => void) | undefined;
  onCreateAgent?: ((draft: DiagramNewAgentDraft, position: DiagramPoint) => Promise<void>) | undefined;
  newAgentModels?: DiagramModelChoice | undefined;
  children?: JSX.Element;
}

export function DiagramBoard(props: DiagramBoardProps) {
  const { t, format } = useText();
  const editable = () => props.editable !== false;
  const connectable = () => editable() && props.connectable !== false;
  const nodeRemovable = (nodeId: string) => editable() && (props.canRemoveNode?.(nodeId) ?? true);
  const edgeRemovable = (edgeId: string) => editable() && (props.canRemoveEdge?.(edgeId) ?? true);
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
  let suppressClick = false;
  let cameraMoved = false;

  const nodeById = createMemo(() => new Map(props.diagram.nodes.map((node) => [node.id, node])));
  const agentById = createMemo(() => new Map(props.agents.map((agent) => [agent.id, agent])));
  const reachable = createMemo(() => diagramExecutionSteps(props.diagram.nodes, props.diagram.edges));
  const focusSteps = createMemo(() =>
    props.focusRoutineId ? diagramRoutineSteps(props.diagram.edges, props.focusRoutineId) : null,
  );
  const steps = () => focusSteps() ?? reachable();
  const stepRuns = createMemo(
    () => new Map((diagramRunOf(props.diagram, props.focusRoutineId)?.steps ?? []).map((step) => [step.nodeId, step])),
  );
  const dimmed = (nodeId: string) => {
    const focus = props.focusRoutineId;
    return focus !== null && nodeId !== focus && !focusSteps()?.has(nodeId);
  };
  const routineCount = createMemo(() => props.diagram.nodes.filter((node) => node.kind === "routine").length);
  const routineChips = (nodeId: string) =>
    routineCount() < 2
      ? []
      : diagramRoutinesReaching(props.diagram.nodes, props.diagram.edges, nodeId).map((routine) => ({
          id: routine.id,
          name: routine.name,
          color: diagramRoutineColor(props.diagram.nodes, routine.id),
          status: diagramRunOf(props.diagram, routine.id)?.steps.find((step) => step.nodeId === nodeId)?.status,
        }));
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
  const snapped = (point: DiagramPoint): DiagramPoint => ({
    x: Math.round(point.x / SNAP) * SNAP,
    y: Math.round(point.y / SNAP) * SNAP,
  });
  let menuPoint: { screen: DiagramPoint; world: DiagramPoint } | null = null;
  const [newAgentAt, setNewAgentAt] = createSignal<{ screen: DiagramPoint; world: DiagramPoint } | null>(null);
  const canAddAgents = () => editable() && Boolean(props.onPlaceAgent);
  const clampScale = (scale: number) => Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE);
  const moveCamera = (next: { x: number; y: number; scale: number }, animate: boolean, byUser = true) => {
    cameraMoved ||= byUser;
    setCamera((state) => {
      state.x = next.x;
      state.y = next.y;
      state.scale = clampScale(next.scale);
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
  const problemFor = (from: string, to: string) => {
    const focus = props.focusRoutineId;
    const edges = focus ? props.diagram.edges.filter((edge) => diagramEdgeCarries(edge, focus)) : props.diagram.edges;
    return diagramConnectionProblem(props.diagram.nodes, edges, from, to);
  };
  const inputTarget = (nodeId: string): DiagramPortTarget => {
    const source = interaction.source;
    if (!source) return "none";
    return problemFor(source, nodeId) ? "invalid" : "valid";
  };
  const tryConnect = (from: string, to: string) => {
    cancelConnection();
    if (!nodeById().has(from) || !nodeById().has(to)) return;
    const problem = problemFor(from, to);
    if (problem) {
      announce(t(PROBLEM_KEY[problem]), "danger");
      return;
    }
    const done = () =>
      announce(t("diagram.connect.done", { from: nodeName(nodeById().get(from)), to: nodeName(nodeById().get(to)) }));
    void Promise.resolve(props.onConnect(from, to)).then((saved) => {
      if (saved) done();
    });
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
      if (!edgeRemovable(edgeId)) return false;
      props.onRemoveEdge(edgeId);
      setInteraction((state) => {
        state.selectedEdgeId = null;
      });
      return true;
    }
    if (props.selectedNodeId && nodeRemovable(props.selectedNodeId)) {
      if (interaction.source === props.selectedNodeId) cancelConnection();
      props.onRemoveNode(props.selectedNodeId);
      return true;
    }
    return false;
  };

  onSettled(() => {
    const area = viewport;
    if (!area) return;
    const onResize = new ResizeObserver(() => {
      if (!cameraMoved && area.clientWidth) fitView(false);
    });
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
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
      if (current.kind === "node" && !current.moved) {
        setInteraction((state) => {
          state.selectedEdgeId = null;
        });
        props.onSelectNode(current.nodeId);
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
      if (port && nodeId && connectable()) {
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

  const edgeState = (edge: DiagramEdge) => {
    const focus = props.focusRoutineId;
    if (dimmed(edge.from) || dimmed(edge.to) || (focus && !diagramEdgeCarries(edge, focus))) return "dimmed";
    const to = edge.to;
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
      <ContextMenu.Root>
        <ContextMenu.Trigger
          as="div"
          class="diagram-board-menu-area"
          disabled={!canAddAgents()}
          onContextMenu={(event: MouseEvent) => {
            const screen = local(event);
            menuPoint = { screen, world: toWorld(screen) };
            if (document.activeElement instanceof HTMLElement && viewport?.contains(document.activeElement))
              document.activeElement.blur();
          }}
        >
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
              data-routine-color={
                props.focusRoutineId ? diagramRoutineColor(props.diagram.nodes, props.focusRoutineId) : undefined
              }
              style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }}
            >
              <svg class="diagram-edges" aria-hidden="true">
                <For each={props.diagram.edges}>
                  {(edge) => (
                    <Show when={nodeById().get(edge.from) && nodeById().get(edge.to) ? edge : undefined}>
                      {(current) => {
                        const ports = () => {
                          const from = nodeById().get(current().from);
                          const to = nodeById().get(current().to);
                          return from && to ? { from: diagramOutputPort(from), to: diagramInputPort(to) } : undefined;
                        };
                        const hit = () => {
                          const ends = ports();
                          return ends ? diagramEdgePath(ends.from, ends.to) : "";
                        };
                        const line = () => {
                          const ends = ports();
                          return ends ? diagramEdgePath(ends.from, diagramEdgeEnd(ends.to)) : "";
                        };
                        const arrow = () => {
                          const ends = ports();
                          return ends ? diagramEdgeArrow(ends.to) : "";
                        };
                        return (
                          <g
                            class="diagram-edge"
                            data-diagram-edge={current().id}
                            data-state={edgeState(current())}
                            data-routine-color={
                              current().routineId
                                ? diagramRoutineColor(props.diagram.nodes, current().routineId ?? "")
                                : undefined
                            }
                            data-selected={interaction.selectedEdgeId === current().id ? "" : undefined}
                          >
                            <path class="diagram-edge-hit" d={hit()} />
                            <path class="diagram-edge-line" d={line()} />
                            <path class="diagram-edge-arrow" d={arrow()} />
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
                          diagramEdgeMidpoint(
                            diagramOutputPort(pair().from),
                            diagramEdgeEnd(diagramInputPort(pair().to)),
                          );
                        return (
                          <Show when={edgeRemovable(edge.id)}>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              class="diagram-edge-remove"
                              data-diagram-control=""
                              data-selected={interaction.selectedEdgeId === edge.id ? "" : undefined}
                              style={{
                                "--diagram-edge-x": `${midpoint().x}px`,
                                "--diagram-edge-y": `${midpoint().y}px`,
                              }}
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
                    unreachable={node.kind === "agent" && !reachable().has(node.id)}
                    dimmed={dimmed(node.id)}
                    routineColor={
                      node.kind === "routine" ? diagramRoutineColor(props.diagram.nodes, node.id) : undefined
                    }
                    routines={node.kind === "agent" ? routineChips(node.id) : []}
                    focusRoutineId={props.focusRoutineId}
                    onFocusRoutine={props.onFocusRoutine}
                    stepRun={stepRuns().get(node.id)}
                    selected={props.selectedNodeId === node.id}
                    connectable={connectable()}
                    removable={nodeRemovable(node.id)}
                    connecting={interaction.source === node.id}
                    inputTarget={inputTarget(node.id)}
                    firing={diagramRunOf(props.diagram, node.id)?.status === "running"}
                    onSelect={() => {
                      if (suppressClick) return;
                      setInteraction((state) => {
                        state.selectedEdgeId = null;
                      });
                      props.onSelectNode(node.id);
                    }}
                    onRemove={() => {
                      if (interaction.source === node.id) cancelConnection();
                      props.onRemoveNode(node.id);
                    }}
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
          </div>
        </ContextMenu.Trigger>
        <Show when={props.onPlaceAgent}>
          {(place) => (
            <DiagramCanvasMenu
              addableAgents={props.addableAgents ?? []}
              onPlaceAgent={(agentId) => {
                if (menuPoint) place()(agentId, snapped(menuPoint.world));
                viewport?.focus();
              }}
              onNewAgent={props.onCreateAgent ? () => setNewAgentAt(menuPoint) : undefined}
            />
          )}
        </Show>
      </ContextMenu.Root>

      <Show when={newAgentAt()}>
        {(at) => (
          <DiagramNewAgentCard
            at={at().screen}
            models={props.newAgentModels}
            onCreate={async (draft) => {
              await props.onCreateAgent?.(draft, snapped(at().world));
              setNewAgentAt(null);
            }}
            onCancel={() => setNewAgentAt(null)}
          />
        )}
      </Show>

      <div class="diagram-board-zoom" role="toolbar" aria-label={t("diagram.zoom.label")} data-diagram-overlay="">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={t("diagram.zoom.in")}
          title={t("diagram.zoom.in")}
          onClick={() => zoomBy(ZOOM_STEP)}
        >
          <Plus aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={t("diagram.zoom.out")}
          title={t("diagram.zoom.out")}
          onClick={() => zoomBy(1 / ZOOM_STEP)}
        >
          <Minus aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={t("diagram.zoom.fit", { zoom: format.percent(camera.scale, { maximumFractionDigits: 0 }) })}
          title={t("diagram.zoom.fit", { zoom: format.percent(camera.scale, { maximumFractionDigits: 0 }) })}
          onClick={() => fitView(true)}
        >
          <Scan aria-hidden="true" />
        </Button>
      </div>

      <p class="diagram-board-status" data-tone={interaction.messageTone} role="status" aria-live="polite">
        {interaction.message}
      </p>

      {props.children}
    </div>
  );
}
