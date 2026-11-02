/**
 * The workflow canvas: the node components on a board that pans, zooms and runs. Drag empty space
 * to pan, scroll to pan, and pinch or hold Ctrl or ⌘ and scroll to zoom. Drag a node by its card,
 * and resize the selected node by a corner handle. Right-click a node, a connection or empty canvas
 * for its actions. History lists the past runs of the workflow; pick one to show its results on
 * every step. The Draw tool draws lines over the canvas with a pen or a marker, and the eraser
 * removes them. The Sticky note and Shapes tools show the item under the pointer, and a click puts it
 * there.
 *
 * The canvas is controlled by its host. It edits a local copy of the graph and gives each change to
 * `onGraphChange`. The runs, the versions and the other workflows come from props, and each action on
 * them goes back to the host.
 */

import {
  isWorkflowStepKind,
  type WorkflowDetail,
  type WorkflowGraph,
  type WorkflowNodeKind,
  type WorkflowSummary,
  type WorkflowTriggerState,
  type WorkflowVersion,
  type WorkflowVersionKind,
} from "@openbot/contracts/ipc";
import type { AppTextKey, AppTranslate } from "@openbot/i18n";
import {
  BringToFront,
  Button,
  buttonVariants,
  ChevronDown,
  ClipboardPaste,
  ContextMenu,
  Copy,
  CopyPlus,
  DropdownMenu,
  Eraser,
  Eye,
  EyeOff,
  Hand,
  Highlighter,
  Kbd,
  Lock,
  LockOpen,
  MousePointer2,
  Pencil,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Scan,
  Search,
  SendToBack,
  Trash2,
  Type,
  Undo2,
  Zap,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import {
  createEffect,
  createMemo,
  createSignal,
  createStore,
  createUniqueId,
  For,
  onCleanup,
  onSettled,
  Show,
  untrack,
} from "solid-js";
import { useText } from "../../text";
import {
  type AddItem,
  addGroups,
  dropKinds,
  insertKinds,
  KIND_LABEL,
  WorkflowAddMenu,
  WorkflowDropMenu,
} from "./WorkflowAddMenu";
import { AgentNode } from "./WorkflowAgentNode";
import { ApprovalNode } from "./WorkflowApprovalNode";
import { AssetNode } from "./WorkflowAssetNode";
import {
  ColorButtons,
  HudButton,
  type HudRun,
  type HudStep,
  hudBarRect,
  timeLabel,
  WorkflowCanvasHeader,
} from "./WorkflowCanvasHud";
import { ConditionNode } from "./WorkflowConditionNode";
import { showWorkflowDeleteToast } from "./WorkflowDeleteUndoToast";
import { ImageNode } from "./WorkflowImageNode";
import { LlmNode } from "./WorkflowLlmNode";
import { minimapLayout, WorkflowMinimap } from "./WorkflowMinimap";
import { NoteNode } from "./WorkflowNoteNode";
import { OutputNode } from "./WorkflowOutputNode";
import { type PickerGroup, PickerMenu } from "./WorkflowPicker";
import { PromptNode } from "./WorkflowPromptNode";
import { WorkflowSearch } from "./WorkflowSearch";
import { SHAPES, ShapeIcon, ShapeNode, ShapeSurface, shapeSize } from "./WorkflowShapeNode";
import { type SwitcherAction, type SwitcherWorkflow, WorkflowSwitcher } from "./WorkflowSwitcher";
import { TextNode } from "./WorkflowTextNode";
import { TriggerNode } from "./WorkflowTriggerNode";
import { WorkflowVersionBar } from "./WorkflowVersionBar";
import { WorkflowZoomMenu } from "./WorkflowZoomMenu";
import {
  BoardProvider,
  createBoard,
  inCanvas,
  isEditable,
  MOD_KEY,
  type PortRef,
  resizeCursor,
  takesKeys,
  type WfnEdge,
  type WfnHandle,
  type WfnPoint,
  type WfnSize,
  type WfnStretch,
} from "./workflow-board";
import { type Camera, type CameraMotion, glideCamera } from "./workflow-camera";
import { CLIP_TYPE, type Clip, copied, setCopied } from "./workflow-clipboard";
import type { WorkflowGitHubCanvas } from "./workflow-github";
import {
  type CanvasItem,
  type CanvasSnapshot,
  createCanvasHistory,
  graphFromSnapshot,
  hostDefaults,
  newTriggerSchedule,
  snapshotFromGraph,
  stableJson,
} from "./workflow-history";
import {
  type Box,
  type Brush,
  ERASER_RADIUS,
  INK_STEP,
  INK_WIDTH,
  inkPath,
  overlaps,
  type Stroke,
  strokeBox,
  touches,
  union,
} from "./workflow-ink";
import { workflowLoops } from "./workflow-loops";
import type { WorkflowCatalogs, WorkflowFeatures } from "./workflow-model";
import {
  BLOCK_RESIZE,
  type CanvasColor,
  COLORS,
  colorVar,
  type NoteTone,
  type ShapeKind,
  Swatch,
  TONES,
  ToolAction,
  translated,
} from "./workflow-node-parts";
import { activeRun, indexRunView, isOpenRun, type WorkflowRunView } from "./workflow-run-view";
import { DrawArt, ShapesArt, StickyArt } from "./workflow-tool-art";

export interface WorkflowCanvasProps {
  /** The open workflow. The canvas reads its graph only when it opens, or when `resetKey` changes. */
  workflow: WorkflowDetail;
  /**
   * A new value loads `workflow.graph` again, as after a restore or a change from another device. Undo
   * then puts back the canvas from before. A save of the changes of this canvas must not change it.
   */
  resetKey?: number | undefined;
  runs: WorkflowRunView;
  /** What this host supports. The canvas hides the kinds, triggers and outputs that it does not list. */
  features: WorkflowFeatures;
  catalogs: WorkflowCatalogs;
  /** What the GitHub trigger and output cards read from the host. Without it, they show no GitHub data. */
  github?: WorkflowGitHubCanvas | undefined;
  /** The saved versions of this workflow, newest first. */
  versions: readonly WorkflowVersion[];
  /** The version that the canvas shows, read-only, in place of the live canvas. */
  versionPreview?: { versionId: string; graph: WorkflowGraph } | undefined;
  /** The workflows of this host, for the switcher. */
  library: readonly WorkflowSummary[];
  /** The canvas shows the graph and the runs; nothing on it changes. */
  readOnly?: boolean | undefined;
  /** In the desktop window, the top bar is the window's top row, and the canvas fills the card below it. */
  frame?: "window" | undefined;
  /**
   * Each change to the graph, after it is done: a drag gives one change when it ends, but a field gives
   * one for each edit, so the host can wait for a pause before it saves.
   */
  onGraphChange: (graph: WorkflowGraph) => void;
  onRun: (input: { fromNodeId?: string }) => void;
  onRunStep: (nodeId: string) => void;
  onStopStep: (stepId: string) => void;
  onStopRun: (runId: string) => void;
  onRetry: (stepId: string) => void;
  /** Sends the answer of an approval. A promise that rejects shows the approval again. */
  onDecide: (stepId: string, approved: boolean) => Promise<unknown>;
  /**
   * Makes a new signing secret for a webhook trigger, after the graph that has the trigger is saved.
   * The first secret also makes the address. Without it, a webhook trigger offers no secret.
   */
  onRotateWebhookSecret?: ((nodeId: string) => Promise<string>) | undefined;
  onLoadOlderRuns: () => void;
  onRestoreVersion: (versionId: string) => void;
  /** Shows a version, or the live canvas again with null. Without it, a version in the list restores at once. */
  onPreviewVersion?: ((versionId: string | null) => void) | undefined;
  onSelect: (workflowId: string) => void;
  onCreate: (input: { title: string; graph?: WorkflowGraph }) => void;
  onRename: (workflowId: string, title: string) => void;
  /** Runs when the Undo toast of a delete closes without Undo. A promise that rejects shows the workflow again. */
  onDelete: (workflowId: string) => Promise<unknown>;
}

/** What a right-click hit. The canvas keeps the world point, so a new node opens there. */
type MenuTarget =
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string; at: WfnPoint }
  | { kind: "canvas"; at: WfnPoint };

const MENU_LABEL = {
  node: "workflow.canvas.menu.node",
  edge: "workflow.canvas.menu.edge",
  canvas: "workflow.canvas.menu.canvas",
} satisfies Record<MenuTarget["kind"], AppTextKey>;

/** Why the host saved a version. */
const VERSION_NOTE = {
  auto: "workflow.canvas.version.auto",
  restore: "workflow.canvas.version.restore",
  run: "workflow.canvas.version.run",
} satisfies Record<WorkflowVersionKind, AppTextKey>;

function MenuItem(props: {
  icon: JSX.Element;
  label: string;
  keys?: readonly string[];
  danger?: boolean;
  /** Runs while the item has the focus, with true, and when it loses it, with false. */
  onAim?: (aimed: boolean) => void;
  onSelect: () => void;
}) {
  return (
    <ContextMenu.Item
      class={props.danger ? "ui-action-menu-danger" : ""}
      onFocus={() => props.onAim?.(true)}
      onBlur={() => props.onAim?.(false)}
      onSelect={props.onSelect}
    >
      <span class="wfn-menu-glyph" aria-hidden="true">
        {props.icon}
      </span>
      <span class="wfn-menu-text">{props.label}</span>
      <Show when={props.keys}>
        {(keys) => (
          <span class="wfn-keys" aria-hidden="true">
            <For each={keys()}>{(key) => <Kbd>{key}</Kbd>}</For>
          </span>
        )}
      </Show>
    </ContextMenu.Item>
  );
}

interface Range {
  min: number;
  max: number;
}

/** The font sizes that the grip of a text node can give, in world pixels. */
const TEXT_FONT = { min: 12, max: 120 };

/** The widths a user can give each kind, and the height where the kind has a free height. */
const RESIZE: Record<WorkflowNodeKind, { width: Range; height?: Range }> = {
  text: { width: { min: 120, max: 960 } },
  prompt: { width: { min: 240, max: 640 }, height: { min: 151, max: 640 } },
  asset: { width: { min: 200, max: 480 }, height: { min: 136, max: 480 } },
  llm: { width: { min: 304, max: 720 }, height: { min: 160, max: 960 } },
  agent: { width: { min: 304, max: 720 }, height: { min: 160, max: 960 } },
  image: { width: { min: 200, max: 720 } },
  ...BLOCK_RESIZE,
};

const MIN_SCALE = 0.25;
const MAX_SCALE = 2;
const ZOOM_STEP = 1.2;
/** The share of a scroll that pans the canvas. A full scroll moved too far, so this is half, as React Flow does. */
const WHEEL_PAN_SPEED = 0.5;
/**
 * The zoom for each pixel of a scroll. A pinch (the browser adds Ctrl) sends many small steps, and a
 * mouse wheel with ⌘ sends few large ones, so the two rates differ.
 */
const PINCH_ZOOM_RATE = 0.007;
const WHEEL_ZOOM_RATE = 0.002;
/** One scroll event zooms no more than one press of the zoom buttons, so a fast wheel does not jump. */
const WHEEL_ZOOM_MAX = Math.log(ZOOM_STEP);
const FIT_MARGIN = 64;
/**
 * In screen pixels, as in workflows.css: the gap between a node and its toolbar, and the room that
 * the results strip takes under a node with its gap.
 */
const TOOLBAR_GAP = 12;
const STRIP_ROOM = 8 + 52 + 8;
const DRAG_THRESHOLD = 4;
const SNAP = 8;
const GRID = 20;
/** How far a copy sits from its original. */
const DUPLICATE_OFFSET = 32;
/** The room that a new node takes before it renders and has a measured size. */
const NEW_NODE = { width: 300, height: 240 };
/** The fields of each kind that hold text that the user wrote, in the order that the card shows them. */
const SEARCH_FIELDS: Record<WorkflowNodeKind, readonly string[]> = {
  trigger: [],
  prompt: ["text"],
  asset: ["file"],
  llm: ["prompt", "system"],
  agent: ["task"],
  image: ["prompt"],
  condition: ["rule"],
  approval: ["question"],
  output: ["path", "title"],
  text: ["text"],
  note: ["text"],
  shape: ["text"],
};
/** The arrow keys move the selection by one snap step, or by four with Shift. */
const NUDGE = { step: SNAP, large: SNAP * 4 };
/** A box edge or centre this close to another one, in screen pixels, snaps to it and shows a guide. */
const GUIDE_DISTANCE = 6;
/** The space on each side of a node that goes into a connection. */
const INSERT_GAP = 64;
/** The add menu at the end of a dropped connection: its width, its gap from the line end, and its inset in the view. */
const DROP_MENU = { width: 240, gap: 8, inset: 16 };

/** What a press on the canvas does. Sticky note and Shapes put their item where the user clicks. */
type Tool = "select" | "pan" | "draw" | "note" | "shape";
/** What a press does with the Draw tool. */
type DrawMode = Brush | "eraser";

/** The size of a new sticky note, as its card in the CSS. */
const NOTE_SIZE = { width: 240, height: 240 };

function InkLine(props: {
  stroke: Stroke;
  erasing?: boolean;
  /** The points of the line that the user draws now, in place of the points of the stroke. */
  points?: readonly WfnPoint[];
}) {
  return (
    <path
      class="wfn-ink-line"
      d={inkPath(props.points ?? props.stroke.points)}
      stroke-width={props.stroke.width}
      data-brush={props.stroke.brush}
      data-erasing={props.erasing ? "" : undefined}
      style={{ "--wfn-ink": colorVar(props.stroke.color) }}
    />
  );
}

/** Smooth Hermite step from 0 to 1 while the value goes from `from` to `to`. */
function smoothstep(from: number, to: number, value: number) {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/**
 * The dot grid follows the Higgsfield canvas. A dot is 1 screen pixel at every zoom. Above 100% the
 * dots spread with the zoom. Below it, each halving of the zoom doubles the world step, so the screen
 * step stays between one and two grid steps; the dots of the half step fade in as they spread from
 * two thirds of a grid step to a full one. One dot in each tile is on the world origin.
 */
function dotGrid(camera: Camera) {
  const level = Math.max(0, Math.ceil(Math.log2(1 / camera.scale) - 1e-9));
  const step = GRID * 2 ** level * camera.scale;
  const quarter = step / 4;
  const wrap = (value: number) => (((value - quarter) % step) + step) % step;
  return {
    x: wrap(camera.x),
    y: wrap(camera.y),
    step,
    quarter,
    minor: level === 0 ? 0 : smoothstep((GRID * 2) / 3, GRID, step / 2),
  };
}

function DotGrid(props: { camera: Camera }) {
  const id = createUniqueId();
  const grid = createMemo(() => dotGrid(props.camera));
  const far = () => grid().quarter * 3;
  return (
    <svg class="wfn-dots" aria-hidden="true">
      <pattern id={id} x={grid().x} y={grid().y} width={grid().step} height={grid().step} patternUnits="userSpaceOnUse">
        <circle cx={grid().quarter} cy={grid().quarter} r="1" />
        <g opacity={grid().minor}>
          <circle cx={far()} cy={grid().quarter} r="1" />
          <circle cx={grid().quarter} cy={far()} r="1" />
          <circle cx={far()} cy={far()} r="1" />
        </g>
      </pattern>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

const snapWithin = (value: number, range: Range) =>
  Math.min(Math.max(Math.round(value / SNAP) * SNAP, range.min), range.max);

/** A screen offset on a whole device pixel. On a half pixel, the icons and text of the world blur. */
const devicePixel = (value: number) => Math.round(value * window.devicePixelRatio) / window.devicePixelRatio;

/** How a kind resizes. An image keeps its aspect ratio, so its height changes with its width. */
function stretchOf(kind: WorkflowNodeKind): WfnStretch {
  if (kind === "text") return "text";
  return RESIZE[kind].height || kind === "image" ? "xy" : "x";
}

/** Whether a handle moves the right or the left side of a box (1 or -1), or neither (0). */
const sideX = (handle: string) => (handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0);
/** Whether a handle moves the bottom or the top side of a box (1 or -1), or neither (0). */
const sideY = (handle: string) => (handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0);

const HANDLES: readonly WfnHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** The height of a card with no height set, which is the height of its content. */
function contentHeight(node: HTMLElement, card: HTMLElement) {
  const set = node.style.getPropertyValue("--wfn-height");
  node.style.setProperty("--wfn-height", "0px");
  const height = card.offsetHeight;
  if (set) node.style.setProperty("--wfn-height", set);
  else node.style.removeProperty("--wfn-height");
  return height;
}

/** The font size that a text node shows now, in world pixels. */
function textFont(node: HTMLElement) {
  const input = node.querySelector(".wfn-text-input");
  return input ? Number.parseFloat(getComputedStyle(input).fontSize) : TEXT_FONT.min;
}

/** A press on these starts their own action, not a node drag. */
const NO_DRAG = [
  ".wfn-port",
  "input",
  "textarea:not(.wfn-text-input)",
  "[data-wfn-portal]",
  ".wfn-edge-actions",
  "button:not(.wfn-asset-trigger)",
  "[role=tab]",
].join(", ");

/** A node of the canvas. Its fields are on the board, so each node reads them from there. */
function CanvasNodeView(props: { node: CanvasItem; trigger: WorkflowTriggerState | undefined }) {
  const node = untrack(() => props.node);
  switch (node.kind) {
    case "text":
      return <TextNode id={node.id} />;
    case "prompt":
      return <PromptNode id={node.id} />;
    case "asset":
      return <AssetNode id={node.id} />;
    case "llm":
      return <LlmNode id={node.id} />;
    case "agent":
      return <AgentNode id={node.id} />;
    case "image":
      return <ImageNode id={node.id} />;
    case "trigger":
      return (
        <TriggerNode
          id={node.id}
          webhookUrl={props.trigger?.webhookUrl ?? undefined}
          nextRun={props.trigger?.nextDueAt ?? undefined}
        />
      );
    case "condition":
      return <ConditionNode id={node.id} />;
    case "approval":
      return <ApprovalNode id={node.id} />;
    case "output":
      return <OutputNode id={node.id} />;
    case "note":
      return <NoteNode id={node.id} />;
    case "shape":
      return <ShapeNode id={node.id} />;
  }
}

/** An alignment guide in world pixels: a vertical line at `at` for the x axis, else a horizontal one. */
interface Guide {
  axis: "x" | "y";
  at: number;
  from: number;
  to: number;
}

/** The colours of the fill menu of the Shapes tool. */
const fillMenu = (t: AppTranslate): readonly PickerGroup<CanvasColor>[] => [
  {
    options: COLORS.map((color) => ({
      value: color.value,
      label: t(color.label),
      tile: () => <Swatch color={color.value} />,
    })),
  },
];

/** A graph as the canvas saves it, so a graph from the host and the same graph from the canvas compare equal. */
const savedJson = (graph: WorkflowGraph) => stableJson(graphFromSnapshot(snapshotFromGraph(graph)));

/**
 * The workflow canvas.
 *
 * Reset rule: the canvas loads `workflow.graph` when it opens, and again only when `workflow.summary.id`
 * or `resetKey` changes. A save of its own changes gives a new `workflow` with the same id and the same
 * key, so the local state, the selection and the undo history stay. A change that the host makes, such
 * as a restore, must change `resetKey`.
 */
export function WorkflowCanvas(props: WorkflowCanvasProps) {
  const { t, format } = useText();
  const initial = untrack(() => snapshotFromGraph(props.workflow.graph));
  const [nodes, setNodes] = createSignal<readonly CanvasItem[]>(initial.nodes);
  const [positions, setPositions] = createStore<Record<string, WfnPoint>>(initial.positions);
  const [sizes, setSizes] = createStore<Record<string, WfnSize>>(initial.sizes);
  /** The rendered size of each slot, so a frame around nodes follows new nodes and new content. */
  const [slotSizes, setSlotSizes] = createStore<Record<string, { width: number; height: number }>>({});
  const slotResize = new ResizeObserver((entries) =>
    setSlotSizes((draft) => {
      for (const entry of entries) {
        if (!(entry.target instanceof HTMLElement)) continue;
        const id = entry.target.dataset.slot;
        if (id) draft[id] = { width: entry.target.offsetWidth, height: entry.target.offsetHeight };
      }
    }),
  );
  const [camera, setCamera] = createStore({ x: 0, y: 0, scale: 1 });

  const running = () => openRun() !== undefined;
  const statusOf = (id: string) => runIndex().get(id)?.status;
  /** The id of the newest step of a node, which Retry, Stop and the approval act on. */
  const stepOf = (id: string) => runIndex().get(id)?.step.id;

  let viewport: HTMLElement | undefined;
  /** The canvas with its bars. Its keys act only when the focus is in it, in its menus or on the page. */
  let root: HTMLElement | undefined;
  let cameraMoved = false;
  /** The camera glide that runs: how to stop it, and where it ends. */
  const glide: { stop: () => void; goal: Camera | undefined } = { stop: () => {}, goal: undefined };
  /**
   * The add menu of a connection: one that the user dropped on the empty canvas, with the world point
   * where it ends, or one that a node goes into, with its midpoint.
   */
  const [drop, setDrop] = createSignal<
    { start: PortRef; at: WfnPoint } | { edge: WfnEdge; at: WfnPoint } | { at: WfnPoint }
  >();
  const [dropQuery, setDropQuery] = createSignal("");
  /** The selection box while the user drags it, in view pixels. */
  const [marquee, setMarquee] = createSignal<Box>();
  const [guides, setGuides] = createSignal<readonly Guide[]>([]);
  /** A press focuses the node too; only a focus from the keyboard selects. */
  let pressing = false;
  /** The trigger whose schedule the open undo step changes. */
  let scheduleEdit: string | undefined;
  const [dropHeight, setDropHeight] = createSignal(0);

  const canvas = createBoard({
    catalogs: () => props.catalogs,
    github: () => props.github,
    features: () => props.features,
    edges: initial.board.edges,
    locked: initial.board.locked,
    fields: initial.board.fields,
    // A node deleted from the keyboard gives the focus to the next node, as in a list.
    focusAfterRemove: (ids, from) => {
      const deleted = from instanceof HTMLElement && from.matches("[data-node-id]") ? from.dataset.nodeId : undefined;
      if (!deleted) return undefined;
      const order = (step: 1 | -1) => {
        let id: string | undefined = deleted;
        do id = nextNode(id, step);
        while (id && ids.includes(id));
        return id;
      };
      const after = order(1) ?? order(-1);
      if (!after) return undefined;
      reveal(after);
      return slot(after)?.querySelector<HTMLElement>("[data-node-id]") ?? undefined;
    },
    scale: () => camera.scale,
    origin: (id) => positions[id],
    // The rendered size, as a result can make a card taller than its stored size, and the results strip.
    box: (id) => {
      const at = positions[id];
      const rendered = slotSizes[id];
      if (!at || !rendered) return undefined;
      const strip = board.results(id).length > 1 ? STRIP_ROOM / camera.scale : 0;
      return { ...at, width: rendered.width, height: rendered.height + strip };
    },
    loops: () => loops(),
    size: (id) => sizes[id],
    stretch: (id) => {
      const kind = kindOf(id);
      return kind ? stretchOf(kind) : "x";
    },
    status: statusOf,
    error: (id) => runIndex().get(id)?.error,
    resultsOf: (id) => runIndex().get(id)?.results ?? [],
    duplicate: (id) => duplicateNodes([id]),
    resetSize: (id) => resetSize(id),
    beforeChange: () => commit(),
    canChange: () => !frozen() && !deleted(),
    root: () => root,
    retry: (id) => {
      const step = stepOf(id);
      if (step) props.onRetry(step);
    },
    runFrom: (id) => props.onRun({ fromNodeId: id }),
    schedule: (id) => nodes().find((node) => node.id === id)?.schedule,
    setSchedule: (id, schedule) => {
      if (scheduleEdit !== id) {
        commit();
        scheduleEdit = id;
      }
      setNodes((list) => list.map((node) => (node.id === id ? { ...node, schedule } : node)));
    },
    endScheduleEdit: () => {
      scheduleEdit = undefined;
    },
    // A host without it gives a webhook trigger no secret, and the host does not change.
    rotateWebhookSecret: untrack(() => props.onRotateWebhookSecret),
    runStep: (id) => props.onRunStep(id),
    stopStep: (id) => {
      const step = stepOf(id);
      if (step) props.onStopStep(step);
    },
    running,
    toolbarBelow: (id, bar) => toolbarBelow(id, bar),
    release: (start, at, event) => {
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      if (!hit || !viewport?.contains(hit) || hit.closest("[data-node-id], .wfn-hud, [data-wfn-portal]")) return false;
      if (dropKinds(start, props.features.kinds).length === 0) return false;
      setDropQuery("");
      setDrop({ start, at });
      return true;
    },
    decide: (id, approved) => {
      const step = stepOf(id);
      return step && statusOf(id) === "approval" ? props.onDecide(step, approved) : undefined;
    },
    step: stepOf,
    edgeTone: (edge) => {
      const viewing = viewedRun();
      if (viewing) return ranIn(edge.from, viewing) && ranIn(edge.to, viewing) ? "done" : "idle";
      const from = toneOf(edge.from);
      const to = toneOf(edge.to);
      if (to === "running" && (from === "done" || !running())) return "run";
      if (from === "done" && to === "done") return "done";
      return "idle";
    },
  });
  const board = canvas.board;
  /**
   * The run that has not ended and that the run bar acts on: the open run that the user views, else
   * the newest open run. GitHub runs on different items can be open at the same time.
   */
  const openRun = createMemo(() => {
    const number = board.viewing();
    const viewed = props.runs.runs.find((entry) => entry.run.number === number);
    return viewed && isOpenRun(viewed) ? viewed : activeRun(props.runs);
  });
  /** The run state of each node, from the runs of the host. A viewed open run shows its own steps. */
  const runIndex = createMemo(() => indexRunView(props.runs, openRun()?.run.id));

  /* ---------------------------------------------------------- History */

  /** The lines drawn on the canvas, oldest first. */
  const [strokes, setStrokes] = createSignal<readonly Stroke[]>(initial.strokes);
  /** The line that the pointer draws now, the lines that the eraser has touched, and the eraser on the screen. */
  const [ink, setInk] = createStore<{ sketch: Stroke | null; erasing: readonly string[]; eraser: WfnPoint | null }>({
    sketch: null,
    erasing: [],
    eraser: null,
  });
  /**
   * The points of the line that the pointer draws now. Each move adds to the same array and sets it
   * again, so the signal does not compare the values, and a move does not copy the line.
   */
  const [sketchPoints, setSketchPoints] = createSignal<readonly WfnPoint[]>([], { equals: false });

  const capture = (): CanvasSnapshot => ({
    nodes: nodes(),
    positions: Object.fromEntries(Object.entries(positions).map(([id, at]) => [id, { ...at }])),
    sizes: Object.fromEntries(Object.entries(sizes).map(([id, size]) => [id, { ...size }])),
    board: canvas.snapshot(),
    strokes: strokes(),
  });
  const putPlaces = (saved: CanvasSnapshot) => {
    // Copies, so a later edit does not change a snapshot that the history keeps.
    setPositions((draft) => {
      for (const id of Object.keys(draft)) if (!(id in saved.positions)) delete draft[id];
      for (const [id, at] of Object.entries(saved.positions)) draft[id] = { ...at };
    });
    setSizes((draft) => {
      for (const id of Object.keys(draft)) if (!(id in saved.sizes)) delete draft[id];
      for (const [id, size] of Object.entries(saved.sizes)) draft[id] = { ...size };
    });
  };
  /**
   * Puts a snapshot back. A node that the snapshot does not have stays mounted but removed, so its
   * fields keep what the user wrote when redo brings it back.
   */
  const apply = (saved: CanvasSnapshot) => {
    scheduleEdit = undefined;
    const ids = new Set(saved.nodes.map((node) => node.id));
    const later = nodes().filter((node) => !ids.has(node.id));
    setNodes([...saved.nodes, ...later]);
    putPlaces(saved);
    canvas.restore({ ...saved.board, removed: [...saved.board.removed, ...later.map((node) => node.id)] });
    setStrokes(saved.strokes);
  };
  const edits = createCanvasHistory({
    capture,
    apply,
    beforeCommit: () => {
      canvas.endTyping();
      scheduleEdit = undefined;
    },
  });
  const { steps, commit } = edits;

  /** The layout frames that wait to place a new node, each with what to do when it drops. */
  const frames = new Map<number, () => void>();
  /** Runs `run` after the next layout. When undo or unmount drops the frame first, `drop` runs in its place. */
  const afterLayout = (run: () => void, drop: () => void = () => {}) => {
    const frame = requestAnimationFrame(() => {
      frames.delete(frame);
      run();
    });
    frames.set(frame, drop);
  };
  const dropFrames = () => {
    for (const [frame, drop] of frames) {
      cancelAnimationFrame(frame);
      drop();
    }
    frames.clear();
  };
  onCleanup(dropFrames);
  /** Ends a drag on the canvas with no change. The gesture code sets it when the canvas is on screen. */
  let stopGesture = () => {};
  /** A drag or a frame that is still open must not change the canvas after an undo or a redo. */
  const undo = () => {
    stopGesture();
    dropFrames();
    edits.undo();
  };
  const redo = () => {
    stopGesture();
    dropFrames();
    edits.redo();
  };

  /* --------------------------------------------------------- Versions */

  /** The live canvas while a version shows, so Back puts it back. */
  let liveCanvas: CanvasSnapshot | undefined;
  const previewing = () => props.versionPreview !== undefined;
  /** Nothing on the canvas changes while a version shows or the canvas is read-only. */
  const frozen = () => previewing() || props.readOnly === true;
  const versionList = () =>
    props.versions.map((version) => ({
      id: version.id,
      label: timeLabel(t, format, version.at),
      meta: t(VERSION_NOTE[version.kind]),
    }));
  /** Shows a version in place of the live canvas. Nothing on it can change until Back or Make current. */
  const openVersion = (id: string) => {
    if (running()) return;
    if (!props.onPreviewVersion) return props.onRestoreVersion(id);
    canvas.endTyping();
    closeDrop();
    closeSearch();
    setTool("select");
    setUi((draft) => {
      draft.hidden = false;
    });
    props.onPreviewVersion(id);
  };
  createEffect(
    () => props.versionPreview,
    (open) =>
      untrack(() => {
        if (open) {
          liveCanvas ??= capture();
          apply(snapshotFromGraph(open.graph));
          canvas.select([]);
          return;
        }
        const live = liveCanvas;
        liveCanvas = undefined;
        if (live) apply(live);
      }),
  );
  const closeVersion = () => {
    if (previewing()) props.onPreviewVersion?.(null);
  };
  /**
   * Keeps the version as the canvas. Undo puts the live canvas back, and the host keeps the live canvas
   * as a version too, so nothing is lost.
   */
  const makeCurrent = () => {
    const open = props.versionPreview;
    const live = liveCanvas;
    if (!open || !live) return;
    edits.push(live);
    // The host restores the version, so the canvas does not save it again.
    savedGraph = stableJson(graph());
    liveCanvas = undefined;
    props.onRestoreVersion(open.versionId);
    props.onPreviewVersion?.(null);
  };

  /* -------------------------------------------------------- Selection */

  /** The selected nodes that are on the canvas. */
  const group = () => canvas.selection().filter((id) => !board.isRemoved(id));
  const selectAll = () => canvas.select(live().map((node) => node.id));
  /** A menu on a node of the selection acts on all of it. */
  const targets = (id: string) => (board.isSelected(id) && group().length > 1 ? group() : [id]);
  const groupLocked = () => group().every((id) => board.isLocked(id));

  /** The nodes on the canvas. Many views read the list, so it is made once for each change. */
  const live = createMemo(() => nodes().filter((node) => !board.isRemoved(node.id)));
  const kindOf = (id: string) => nodes().find((node) => node.id === id)?.kind;
  /** The saved trigger of each trigger node, by node id. The first trigger of a node wins, as before. */
  const triggers = createMemo(() => {
    const byNode = new Map<string, WorkflowDetail["triggers"][number]>();
    for (const trigger of props.workflow.triggers) if (!byNode.has(trigger.nodeId)) byNode.set(trigger.nodeId, trigger);
    return byNode;
  });
  const triggerOf = (id: string) => triggers().get(id);
  /** A prompt or a file gives its value with no step, so it counts as done when the steps after it run. */
  const passive = (id: string) => {
    const kind = kindOf(id);
    return kind === "prompt" || kind === "asset";
  };
  /** The status that the tone of a connection reads. */
  const toneOf = (id: string) => statusOf(id) ?? (passive(id) && props.runs.runs.length > 0 ? "done" : undefined);
  /** The run whose results the steps show. */
  const viewedRun = () => {
    const number = board.viewing();
    return number === null ? undefined : props.runs.runs.find((entry) => entry.run.number === number);
  };
  /** Whether a step is done in a run. A node with no step counts as run. */
  const ranIn = (id: string, detail: NonNullable<ReturnType<typeof viewedRun>>) =>
    passive(id) || detail.steps.some((step) => step.nodeId === id && step.status === "done");
  const [menuTarget, setMenuTarget] = createSignal<MenuTarget>({ kind: "canvas", at: { x: 0, y: 0 } });
  const [name, setName] = createSignal(untrack(() => props.workflow.summary.title));
  /** Rename puts a field in place of the switcher until Enter, Escape or a click outside. */
  const [renaming, setRenaming] = createSignal(false);
  let nameBefore = untrack(() => props.workflow.summary.title);
  // A rename from another device shows, but not over the name that the user types.
  createEffect(
    () => props.workflow.summary.title,
    (title) => {
      if (!untrack(renaming)) setName(title);
    },
  );
  /** A deleted workflow hides until its Undo toast closes. Undo brings it back as it was. */
  const [deleted, setDeleted] = createSignal(false);
  /** Closes the open Undo toast of a delete and keeps the delete. */
  let closeDelete: (() => void) | undefined;
  let workflowMenu: HTMLButtonElement | undefined;
  /**
   * Hides the workflow and shows a toast with Undo, as an agent delete does. The host deletes it when
   * the toast closes without Undo. Undo brings the workflow back and puts focus on its menu button.
   */
  const deleteWorkflow = () => {
    if (deleted()) return;
    const id = props.workflow.summary.id;
    canvas.endTyping();
    setDeleted(true);
    closeDelete = showWorkflowDeleteToast(name(), {
      onUndo: () => {
        closeDelete = undefined;
        setDeleted(false);
        requestAnimationFrame(() => workflowMenu?.focus());
      },
      onKeep: () => {
        closeDelete = undefined;
        props.onDelete(id).catch(() => {
          if (props.workflow.summary.id === id) setDeleted(false);
        });
      },
    });
  };
  // A canvas that closes keeps the delete. The toast runs the delete in a microtask.
  onCleanup(() => closeDelete?.());
  /**
   * The canvas tool, the options of the Draw, Sticky note and Shapes tools, the open HUD panels, and
   * whether the HUD shows.
   */
  const [ui, setUi] = createStore<{
    tool: Tool;
    draw: DrawMode;
    ink: CanvasColor;
    note: NoteTone;
    shape: ShapeKind;
    fill: CanvasColor;
    minimap: boolean;
    hidden: boolean;
    search: boolean;
  }>({
    tool: "select",
    draw: "pen",
    ink: "ink",
    note: "yellow",
    shape: "rectangle",
    fill: "ink",
    minimap: false,
    hidden: false,
    search: false,
  });
  /** The Draw tool and the tools that place an item act over the nodes, so they clear the selection. */
  const setTool = (tool: Tool) => {
    if (tool !== "select" && tool !== "pan") canvas.select([]);
    setUi((draft) => {
      draft.tool = tool;
    });
  };
  const setDraw = (mode: DrawMode) => {
    setTool("draw");
    setUi((draft) => {
      draft.draw = mode;
    });
  };
  /** A colour picked with the eraser on goes back to the pen. */
  const setInkColor = (color: CanvasColor) =>
    setUi((draft) => {
      draft.ink = color;
      if (draft.draw === "eraser") draft.draw = "pen";
    });
  const setNoteTone = (tone: NoteTone) =>
    setUi((draft) => {
      draft.note = tone;
    });
  const setShape = (shape: ShapeKind) =>
    setUi((draft) => {
      draft.shape = shape;
    });
  const setFill = (color: CanvasColor) =>
    setUi((draft) => {
      draft.fill = color;
    });
  /** The kinds that this host can add. */
  const allows = (kind: WorkflowNodeKind) => props.features.kinds.includes(kind);
  /** Where the item of the Sticky note or Shapes tool shows under the pointer, in view pixels. */
  const [ghost, setGhost] = createSignal<WfnPoint | null>(null);
  const placing = () => ui.tool === "note" || ui.tool === "shape";
  /** The box that a drag with Shapes draws, in world pixels, until the pointer goes up. */
  const [drawn, setDrawn] = createSignal<Box | null>(null);
  const toggleHud = () =>
    setUi((draft) => {
      draft.hidden = !draft.hidden;
    });
  const [query, setQuery] = createSignal("");
  /** The nodes that Copy keeps, with their positions at the time of the copy. */
  const clipboard = () => copied()?.clip;
  /** The pointer on the canvas, in screen pixels, where a paste puts the nodes. */
  let pointer: WfnPoint | undefined;
  /** The nodes that a Copy item of a menu copies, while the copy event of that item runs. */
  let copying: readonly string[] | undefined;
  /** The point of the last paste. A paste at the same point goes next to the nodes of that paste. */
  let pastedAt: WfnPoint | undefined;

  /* ------------------------------------------------------------- Save */

  /** While a node drag or a resize runs, the graph waits for the release, so one gesture is one change. */
  const [gesturing, setGesturing] = createSignal(false);
  const graph = createMemo<WorkflowGraph>((previous) =>
    previous && gesturing() ? previous : graphFromSnapshot(capture()),
  );
  const loops = createMemo(() => workflowLoops(graph()));
  /**
   * A bar that keeps its screen size in the world, such as a node toolbar, lands on part pixels at a zoom other than
   * 100%. Then its icons and text blur. After the camera, a node or the selection moves, each bar moves by less than a
   * pixel onto whole device pixels. The move is in screen pixels; the CSS divides it by the zoom.
   */
  let worldElement: HTMLElement | undefined;
  let snapFrame = 0;
  const snapBars = () => {
    const bars = [...(worldElement?.querySelectorAll<HTMLElement>(".wfn-toolbar, .wfn-strip") ?? [])];
    const moves = bars.map((bar) => {
      const box = bar.getBoundingClientRect();
      const x = box.x - Number(bar.dataset.snapX ?? 0);
      const y = box.y - Number(bar.dataset.snapY ?? 0);
      return { bar, x: devicePixel(x) - x, y: devicePixel(y) - y };
    });
    // All reads come before the writes, so the frame lays out once.
    for (const { bar, x, y } of moves) {
      bar.dataset.snapX = String(x);
      bar.dataset.snapY = String(y);
      bar.style.setProperty("--wfn-snap-x", `${x}px`);
      bar.style.setProperty("--wfn-snap-y", `${y}px`);
    }
  };
  createEffect(
    () => [camera.x, camera.y, camera.scale, graph(), canvas.selection()],
    () => {
      cancelAnimationFrame(snapFrame);
      snapFrame = requestAnimationFrame(snapBars);
    },
  );
  onCleanup(() => cancelAnimationFrame(snapFrame));
  /** The graph that the host has, as the canvas saves it. */
  let savedGraph = untrack(() => savedJson(props.workflow.graph));
  createEffect(
    () => (frozen() || deleted() ? undefined : graph()),
    (next) => {
      if (!next) return;
      const json = stableJson(next);
      if (json === savedGraph) return;
      savedGraph = json;
      // The host reads its own state in the callback. That read must not track.
      untrack(() => props.onGraphChange(next));
    },
  );

  /**
   * Loads a graph from the host, as when the canvas opens. For the same workflow, the canvas from
   * before goes on the undo stack, so undo gets back edits that another device replaced.
   */
  const reset = (next: WorkflowGraph, same: boolean) => {
    const before = same ? (liveCanvas ?? capture()) : undefined;
    const snapshot = snapshotFromGraph(next);
    savedGraph = savedJson(next);
    liveCanvas = undefined;
    scheduleEdit = undefined;
    canvas.endTyping();
    closeDrop();
    closeSearch();
    setNodes(snapshot.nodes);
    // Only a reset unmounts a node: undo keeps it mounted but removed.
    const kept = new Set(snapshot.nodes.map((node) => node.id));
    setSlotSizes((draft) => {
      for (const id of Object.keys(draft)) if (!kept.has(id)) delete draft[id];
    });
    putPlaces(snapshot);
    canvas.restore(snapshot.board);
    setStrokes(snapshot.strokes);
    if (!before) edits.clear();
    else if (stableJson(graphFromSnapshot(before)) !== savedGraph) edits.push(before);
    board.view(null);
    cameraMoved = false;
    requestAnimationFrame(() => fitView(false));
  };
  // The reset rule of the component comment. The first run is the graph that the canvas opened with.
  // The memo stops a new `workflow` object with the same id and key: an effect runs on each change of
  // what its compute function reads, even when the value is the same.
  const resetToken = createMemo(() => `${props.workflow.summary.id}\u0000${props.resetKey ?? ""}`);
  let openedId: string | undefined;
  createEffect(resetToken, () => {
    const id = untrack(() => props.workflow.summary.id);
    const before = openedId;
    openedId = id;
    if (before !== undefined) untrack(() => reset(props.workflow.graph, before === id));
  });
  // The host opens another workflow when a delete is kept, so the canvas shows again. A switch while
  // the Undo toast is open keeps that delete.
  const workflowId = createMemo(() => props.workflow.summary.id);
  createEffect(workflowId, () => {
    closeDelete?.();
    setDeleted(false);
  });

  /* --------------------------------------------------------- Switcher */

  const openId = () => props.workflow.summary.id;
  /** The workflows with the name and the step count of the open one as they are now. */
  const listed = (): readonly SwitcherWorkflow[] => {
    const list = props.library.some((workflow) => workflow.id === openId())
      ? props.library
      : [props.workflow.summary, ...props.library];
    return list.map((workflow) =>
      workflow.id === openId()
        ? { id: workflow.id, title: name(), steps: live().filter((node) => isWorkflowStepKind(node.kind)).length }
        : { id: workflow.id, title: workflow.title, steps: workflow.steps },
    );
  };
  const onSwitcher = (action: SwitcherAction) => {
    if (action.startsWith("version:")) return openVersion(action.slice("version:".length));
    if (action === "live") return closeVersion();
    // Another action leaves the version first. A rename changes only the name.
    if (action !== "rename") closeVersion();
    if (action === "new") props.onCreate({ title: t("workflow.canvas.untitled") });
    else if (action === "rename") startRename();
    else if (action === "duplicate")
      props.onCreate({
        title: t("workflow.canvas.copyOf", { name: name() }),
        graph: liveCanvas ? graphFromSnapshot(liveCanvas) : graph(),
      });
    else if (action === "delete") deleteWorkflow();
    else if (action !== `open:${openId()}`) props.onSelect(action.slice("open:".length));
  };
  const startRename = () => {
    nameBefore = name();
    setRenaming(true);
  };
  const endRename = (keep: boolean) => {
    if (!renaming()) return;
    const trimmed = name().trim();
    const next = keep && trimmed ? trimmed : nameBefore;
    setName(next);
    setRenaming(false);
    if (next !== nameBefore) props.onRename(openId(), next);
    requestAnimationFrame(() => workflowMenu?.focus());
  };

  /* ----------------------------------------------------------- Camera */

  const clampScale = (scale: number) => Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE);
  const view = () => ({ width: viewport?.clientWidth ?? 0, height: viewport?.clientHeight ?? 0 });
  const local = (event: { clientX: number; clientY: number }): WfnPoint => {
    const rect = viewport?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };
  const toWorld = (point: WfnPoint): WfnPoint => ({
    x: (point.x - camera.x) / camera.scale,
    y: (point.y - camera.y) / camera.scale,
  });
  const placeCamera = (next: Camera) => {
    setCamera((draft) => {
      draft.x = next.x;
      draft.y = next.y;
      draft.scale = clampScale(next.scale);
    });
  };
  /** Stops a glide where it is. A gesture or a move without motion stops it. */
  const stopGlide = () => {
    glide.stop();
    glide.goal = undefined;
    if (viewport) delete viewport.dataset.cameraMoving;
  };
  /** The wheel, a pinch, a pan and the automatic fit move the camera at once, as on Higgsfield. */
  const moveCamera = (next: Camera, byUser = true) => {
    stopGlide();
    cameraMoved ||= byUser;
    placeCamera(next);
  };
  /** A button, a key, a menu item or a jump moves the camera over some frames. */
  const glideTo = (next: Camera, motion: CameraMotion) => {
    stopGlide();
    cameraMoved = true;
    const goal = { ...next, scale: clampScale(next.scale) };
    glide.goal = goal;
    if (viewport) viewport.dataset.cameraMoving = "";
    glide.stop = glideCamera({ x: camera.x, y: camera.y, scale: camera.scale }, goal, motion, view(), (at, done) => {
      placeCamera(at);
      if (!done) return;
      glide.goal = undefined;
      if (viewport) delete viewport.dataset.cameraMoving;
    });
  };
  /** Where the camera is, or where it glides to, so quick presses add up. */
  const target = (): Camera => glide.goal ?? camera;
  const zoomAround = (scale: number, point: WfnPoint, from: Camera = camera) => {
    const next = clampScale(scale);
    return {
      scale: next,
      x: point.x - ((point.x - from.x) * next) / from.scale,
      y: point.y - ((point.y - from.y) * next) / from.scale,
    };
  };
  const zoomTo = (scale: number) =>
    glideTo(zoomAround(scale, { x: view().width / 2, y: view().height / 2 }, target()), "step");
  const zoomBy = (factor: number) => zoomTo(target().scale * factor);
  /** Fits the nodes and the drawn lines. */
  const fitView = (byUser: boolean) => {
    const { width, height } = view();
    const boxes = [
      // The resize observer gives the sizes. A node that mounted in this frame has none yet, so the
      // fit reads its element.
      ...live().flatMap((node) => {
        const box = boxOf(node.id);
        if (box) return [box];
        const element = slot(node.id);
        const at = positions[node.id];
        return element && at ? [{ ...at, width: element.offsetWidth, height: element.offsetHeight }] : [];
      }),
      ...strokes()
        .filter((stroke) => stroke.points.length > 0)
        .map(strokeBox),
    ];
    if (!width || !height || boxes.length === 0) return;
    const left = Math.min(...boxes.map((box) => box.x));
    const top = Math.min(...boxes.map((box) => box.y));
    const right = Math.max(...boxes.map((box) => box.x + box.width));
    const bottom = Math.max(...boxes.map((box) => box.y + box.height));
    const scale = clampScale(
      Math.min((width - FIT_MARGIN * 2) / (right - left), (height - FIT_MARGIN * 2) / (bottom - top), 1),
    );
    const next = {
      scale,
      x: (width - (right - left) * scale) / 2 - left * scale,
      y: (height - (bottom - top) * scale) / 2 - top * scale,
    };
    if (byUser) glideTo(next, "flight");
    else moveCamera(next, false);
  };

  /* -------------------------------------------------------------- Run */

  const canRun = () => !props.readOnly && live().some((node) => isWorkflowStepKind(node.kind));
  /** Runs that ended, newest first. A run that is still going is in the run bar, not in History. */
  const pastRuns = (): readonly HudRun[] =>
    props.runs.runs.flatMap(({ run }) =>
      run.endedAt === null
        ? []
        : [
            {
              number: run.number,
              at: run.startedAt,
              status: run.status,
              seconds: Math.max(0, (Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000),
              item: runItems().get(run.id),
            },
          ],
    );
  /** The issue or pull request of each GitHub run. */
  const runItems = createMemo(
    () => new Map(props.github?.history().runs.map((entry) => [entry.runId, `#${entry.item.number}`]) ?? []),
  );
  /** Runs that have not ended, newest first. */
  const openRuns = (): readonly HudRun[] =>
    props.runs.runs.flatMap(({ run }) =>
      run.endedAt === null
        ? [{ number: run.number, at: run.startedAt, status: run.status, seconds: null, item: runItems().get(run.id) }]
        : [],
    );
  const waitingEvents = () =>
    props.github?.history().deliveries.filter((delivery) => delivery.outcome === "waiting").length ?? 0;
  /** The steps of the open run that are done, of the steps on the canvas. */
  const progress = () => {
    const total = live().filter((node) => isWorkflowStepKind(node.kind)).length;
    const detail = openRun();
    if (!detail) return { done: 0, total };
    const newest = new Map<string, string>();
    for (const step of [...detail.steps].sort((left, right) => left.attempt - right.attempt))
      newest.set(step.nodeId, step.status);
    const done = [...newest.values()].filter((status) => status === "done" || status === "skipped").length;
    return { done: Math.min(done, total), total };
  };
  const stopRun = () => {
    const detail = openRun();
    if (detail) props.onStopRun(detail.run.id);
  };

  /**
   * The step that the run is on: an approval that waits for the user first, else the first step that
   * runs. After a failed run, the failed step.
   */
  const current = (): HudStep | undefined => {
    const shown = live().flatMap((node) => {
      const status = statusOf(node.id);
      return status ? [{ id: node.id, status }] : [];
    });
    const find = (status: HudStep["status"]) =>
      shown.filter((entry) => entry.status === status).map((entry) => entry.id);
    for (const status of ["approval", "failed", "running"] as const) {
      const ids = find(status);
      const id = ids[0];
      if (id !== undefined) return { id, status, name: stepName(id), more: ids.length - 1 };
    }
    return undefined;
  };
  /** The name of a step: its kind, and the first words of its first field, as "LLM · Summarize the findings". */
  const stepName = (id: string) => {
    const [label = t("workflow.canvas.step"), ...fields] = searchTexts(id);
    const words = fields
      .find((field) => field.trim())
      ?.replace(/\s+/g, " ")
      .trim();
    if (!words) return label;
    return `${label} · ${words.length > 32 ? `${words.slice(0, 31).trimEnd()}…` : words}`;
  };

  /* -------------------------------------------------------------- Add */

  const snapPoint = (point: WfnPoint): WfnPoint => ({
    x: Math.round(point.x / SNAP) * SNAP,
    y: Math.round(point.y / SNAP) * SNAP,
  });
  /**
   * The box of a shape that a drag draws between two screen points, on the grid and in the size range
   * of a shape. The corner where the drag starts stays in place.
   */
  const drawnBox = (from: WfnPoint, to: WfnPoint): Box => {
    const start = snapPoint(toWorld(from));
    const end = toWorld(to);
    const limits = RESIZE.shape;
    const width = snapWithin(Math.abs(end.x - start.x), limits.width);
    const height = snapWithin(Math.abs(end.y - start.y), limits.height ?? limits.width);
    return {
      x: end.x < start.x ? start.x - width : start.x,
      y: end.y < start.y ? start.y - height : start.y,
      width,
      height,
    };
  };

  /**
   * Adds a node with its top-left corner at a world point, or centred in the view. A node centred in the
   * view moves to the right past each card that it would cover, so it does not hide them.
   */
  const addNode = (kind: WorkflowNodeKind, point?: WfnPoint): string => {
    commit();
    const { width, height } = view();
    const center = toWorld({ x: width / 2, y: height / 2 });
    const id = `${kind}-${crypto.randomUUID()}`;
    let at = snapPoint(point ?? { x: center.x - NEW_NODE.width / 2, y: center.y - NEW_NODE.height / 2 });
    if (!point) {
      const cards = untrack(() =>
        boxesOf(live().flatMap((node) => (node.kind === "text" || node.kind === "shape" ? [] : [node.id]))),
      );
      // Each move passes one card, so the loop ends after one move for each card at most.
      for (let hit = cards.find((box) => overlaps({ ...at, ...NEW_NODE }, box)); hit; ) {
        at = snapPoint({ x: hit.x + hit.width + GRID * 2, y: at.y });
        hit = cards.find((box) => overlaps({ ...at, ...NEW_NODE }, box));
      }
    }
    setPositions((draft) => {
      draft[id] = at;
    });
    canvas.putFields(id, hostDefaults(kind, props.catalogs, props.features));
    setNodes((list) => [...list, kind === "trigger" ? { id, kind, schedule: newTriggerSchedule() } : { id, kind }]);
    return id;
  };

  /**
   * Puts a note or a shape with its card centred on a world point, or a shape in the box that a drag
   * drew. Then it selects the item and puts the cursor in its text. The tool goes back to Select, as on
   * Higgsfield.
   */
  const placeItem = (tool: "note" | "shape", point: WfnPoint, box?: Box) => {
    commit();
    const id = `${tool}-${crypto.randomUUID()}`;
    const size = box ? { width: box.width, height: box.height } : tool === "shape" ? shapeSize(ui.shape) : NOTE_SIZE;
    const at = box ? { x: box.x, y: box.y } : snapPoint({ x: point.x - size.width / 2, y: point.y - size.height / 2 });
    setPositions((draft) => {
      draft[id] = at;
    });
    if (tool === "shape")
      setSizes((draft) => {
        draft[id] = { ...size };
      });
    const writer = props.catalogs.self;
    canvas.putFields(
      id,
      tool === "note"
        ? { tone: ui.note, ...(writer ? { authorName: writer } : {}) }
        : { shape: ui.shape, color: ui.fill },
    );
    setNodes((list) => [...list, { id, kind: tool }]);
    setGhost(null);
    setTool("select");
    afterLayout(() => {
      const element = slot(id);
      // A label above the card moves the node up by its height, so the card stays in place. The layout
      // offset is in world pixels, and the enter animation that scales the card does not change it.
      let label = 0;
      for (
        let part = element?.querySelector<HTMLElement>(".wfn-card") ?? null;
        part && part !== element;
        part = part.offsetParent instanceof HTMLElement ? part.offsetParent : null
      )
        label += part.offsetTop;
      if (label > 0)
        setPositions((draft) => {
          draft[id] = snapPoint({ x: at.x, y: at.y - label });
        });
      canvas.select([id]);
      element?.querySelector<HTMLElement>(".wfn-card textarea")?.focus();
    });
  };

  /** Nodes with their place, their size, their text and style, and the connections between them. */
  const collect = (ids: readonly string[]): Clip => {
    const picked = nodes().flatMap((node) => {
      const at = positions[node.id];
      return ids.includes(node.id) && at && !board.isRemoved(node.id) ? [{ ...node, at: { ...at } }] : [];
    });
    const inside = new Set(picked.map((node) => node.id));
    return {
      nodes: picked,
      sizes: Object.fromEntries(picked.flatMap((node) => (sizes[node.id] ? [[node.id, { ...sizes[node.id] }]] : []))),
      fields: Object.fromEntries(picked.map((node) => [node.id, canvas.fields(node.id)])),
      edges: canvas.edges().filter((edge) => inside.has(edge.from) && inside.has(edge.to)),
    };
  };

  /** Adds copies of nodes, moved by `shift`, with the connections between them, and selects them. */
  const place = (clip: Clip, shift: WfnPoint, tag: string) => {
    if (clip.nodes.length === 0) return;
    commit();
    const ids = new Map<string, string>();
    for (const node of clip.nodes) {
      ids.set(node.id, `${node.kind}-${tag}-${crypto.randomUUID()}`);
    }
    const copies = clip.nodes.map((node) => ({
      ...node,
      id: ids.get(node.id) ?? node.id,
      at: { x: node.at.x + shift.x, y: node.at.y + shift.y },
    }));
    setPositions((draft) => {
      for (const node of copies) draft[node.id] = node.at;
    });
    setSizes((draft) => {
      for (const [id, size] of Object.entries(clip.sizes)) draft[ids.get(id) ?? id] = { ...size };
    });
    for (const [id, fields] of Object.entries(clip.fields)) canvas.putFields(ids.get(id) ?? id, fields);
    setNodes((list) => [...list, ...copies]);
    canvas.addEdges(
      clip.edges.flatMap((edge) => {
        const from = ids.get(edge.from);
        const to = ids.get(edge.to);
        if (!from || !to) return [];
        const copy: WfnEdge = {
          id: `${from}${edge.branch ? `.${edge.branch}` : ""}>${to}:${edge.type}`,
          from,
          to,
          type: edge.type,
        };
        if (edge.branch) copy.branch = edge.branch;
        return [copy];
      }),
    );
    canvas.select(copies.map((node) => node.id));
  };

  /** Copies nodes next to themselves, without the connections to other nodes. */
  const duplicateNodes = (ids: readonly string[]) =>
    place(collect(ids), { x: DUPLICATE_OFFSET, y: DUPLICATE_OFFSET }, "copy");

  const resetSize = (id: string) => {
    if (!sizes[id]) return;
    commit();
    setSizes((draft) => {
      delete draft[id];
    });
  };

  const slot = (id: string) => viewport?.querySelector<HTMLElement>(`[data-slot="${id}"]`) ?? undefined;
  /** The box of a node in world pixels. */
  const boxOf = (id: string): Box | undefined => {
    const at = positions[id];
    const rendered = slotSizes[id];
    return at && rendered
      ? { ...at, width: sizes[id]?.width ?? rendered.width, height: sizes[id]?.height ?? rendered.height }
      : undefined;
  };
  const boxesOf = (ids: readonly string[]) => ids.flatMap((id) => boxOf(id) ?? []);
  /**
   * The toolbar of a node goes under the node, and under its results strip, only when above it the
   * toolbar covers another card and under it the toolbar does not. Text and shapes do not count: a
   * heading sits above its column, and a shape can be under a group of nodes. The toolbar keeps its
   * screen size, so the zoom changes the room that it takes in the world.
   */
  const toolbarBelow = (id: string, bar: { width: number; height: number }) => {
    const box = boxOf(id);
    if (!box) return false;
    const width = bar.width / camera.scale;
    const height = bar.height / camera.scale;
    const zone = (y: number): Box => ({ x: box.x + (box.width - width) / 2, y, width, height });
    const covers = (area: Box) =>
      live().some((node) => {
        const other = node.id === id || node.kind === "text" || node.kind === "shape" ? undefined : boxOf(node.id);
        return other !== undefined && overlaps(area, other);
      });
    if (!covers(zone(box.y - (TOOLBAR_GAP / camera.scale + height)))) return false;
    const room = board.results(id).length > 1 ? STRIP_ROOM : TOOLBAR_GAP;
    return !covers(zone(box.y + box.height + room / camera.scale));
  };

  /** The frame around a selection of more than one node. */
  const groupBox = createMemo(() => {
    const ids = group();
    return ids.length > 1 ? union(boxesOf(ids)) : undefined;
  });

  /** Moves the selected nodes that are not locked by a world distance. */
  const nudge = (dx: number, dy: number, again: boolean) => {
    const ids = group().filter((id) => !board.isLocked(id));
    if (ids.length === 0) return;
    // Held keys repeat; the whole move is one undo step.
    if (!again) commit();
    setPositions((draft) => {
      for (const id of ids) {
        const at = draft[id];
        if (at) draft[id] = { x: at.x + dx, y: at.y + dy };
      }
    });
  };

  const closeDrop = () => {
    setDrop(undefined);
    canvas.cancelDraft();
  };
  /** The kinds that the open menu offers and that match the search, in the groups of the add menu. */
  const dropGroups = (): { label: AppTextKey; items: AddItem[] }[] => {
    const open = drop();
    if (!open) return [];
    const words = dropQuery().trim().toLowerCase();
    const allowed = props.features.kinds;
    const kinds =
      "edge" in open
        ? insertKinds(open.edge.type, allowed)
        : "start" in open
          ? dropKinds(open.start, allowed)
          : addGroups(allowed).flatMap((group) => group.items);
    return addGroups(allowed)
      .map((group) => ({
        label: group.label,
        items: group.items.filter(
          (item) => kinds.includes(item) && t(KIND_LABEL[item.kind]).toLowerCase().includes(words),
        ),
      }))
      .filter((group) => group.items.length > 0);
  };
  /**
   * The menu opens at the end of the line: right of it for an output, left of it for an input, so it
   * does not cover the node that the line comes from. On a connection, it opens under the midpoint.
   * It stays in the view. The point is in client pixels.
   */
  const dropAt = () => {
    const open = drop();
    const frame = viewport?.getBoundingClientRect();
    if (!open || !frame) return { x: 0, y: 0 };
    const { width, height } = view();
    const x = camera.x + open.at.x * camera.scale;
    const y = camera.y + open.at.y * camera.scale;
    const left =
      "edge" in open
        ? x - DROP_MENU.width / 2
        : !("start" in open) || open.start.side === "out"
          ? x + DROP_MENU.gap
          : x - DROP_MENU.gap - DROP_MENU.width;
    return {
      x: frame.left + Math.max(DROP_MENU.inset, Math.min(left, width - DROP_MENU.width - DROP_MENU.inset)),
      y: frame.top + Math.max(DROP_MENU.inset, Math.min(y + DROP_MENU.gap, height - dropHeight() - DROP_MENU.inset)),
    };
  };
  const dropConnected = () => {
    const open = drop();
    return open !== undefined && ("edge" in open || "start" in open);
  };
  /** Adds a node where the line ends, with its matching port on the end, and connects it. */
  const pickDrop = (kind: WorkflowNodeKind) => {
    const open = drop();
    if (!open) return;
    setDrop(undefined);
    if ("edge" in open) return insertNode(kind, open.edge, open.at);
    if (!("start" in open)) {
      canvas.select([addNode(kind, open.at)]);
      return;
    }
    const { start } = open;
    // The node, its place and its connection are one undo step.
    commit();
    const release = edits.join();
    const id = addNode(kind, open.at);
    afterLayout(() => {
      const element = slot(id);
      const side = start.side === "out" ? "in" : "out";
      const port = element?.querySelector(
        `.wfn-port[data-wfn-port-side="${side}"][data-wfn-port-type="${start.type}"]`,
      );
      if (element && port) {
        const box = element.getBoundingClientRect();
        const dot = port.getBoundingClientRect();
        const offset = {
          x: (dot.left + dot.width / 2 - box.left) / camera.scale,
          y: (dot.top + dot.height / 2 - box.top) / camera.scale,
        };
        setPositions((draft) => {
          draft[id] = snapPoint({ x: open.at.x - offset.x, y: open.at.y - offset.y });
        });
      }
      canvas.attach(start, id);
      canvas.select([id]);
      release();
    }, release);
  };

  /**
   * Puts a new node in the middle of a connection. When the nodes are too close for it, the nodes
   * from the end of the connection to the right move right to make room.
   */
  const insertNode = (kind: WorkflowNodeKind, edge: WfnEdge, at: WfnPoint) => {
    commit();
    const release = edits.join();
    const id = addNode(kind, at);
    afterLayout(() => {
      const element = slot(id);
      const from = boxOf(edge.from);
      const to = positions[edge.to];
      // On a loop, the new node goes where it was dropped, under the nodes the loop runs again.
      if (element && loops().has(edge.id))
        setPositions((draft) => {
          draft[id] = snapPoint({ x: at.x - element.offsetWidth / 2, y: at.y - element.offsetHeight / 2 });
        });
      else if (element && from && to) {
        const width = element.offsetWidth;
        const room = to.x - (from.x + from.width);
        // The new node keeps the gap that the two nodes had on each side of it.
        const need = width + Math.max(INSERT_GAP, room) * 2;
        const shift = Math.ceil(Math.max(0, need - room) / SNAP) * SNAP;
        setPositions((draft) => {
          if (shift > 0)
            for (const node of live()) {
              const point = draft[node.id];
              if (point && node.id !== id && point.x >= to.x) draft[node.id] = { x: point.x + shift, y: point.y };
            }
          draft[id] = snapPoint({
            x: from.x + from.width + (room + shift - width) / 2,
            // Between two nodes in one row, the new node goes in that row.
            y: from.y === to.y ? from.y : at.y - element.offsetHeight / 2,
          });
        });
      }
      canvas.splice(edge.id, id);
      canvas.select([id]);
      release();
    }, release);
  };

  /** Puts nodes on the system clipboard, as ⌘C does, so that ⌘V and other canvases can paste them. */
  const copyNodes = (ids: readonly string[]) => {
    const clip = collect(ids);
    if (clip.nodes.length === 0) return;
    copying = ids;
    // The copy event writes the key. Without the event, only the Paste items of the menus can paste.
    const written = document.execCommand("copy");
    copying = undefined;
    if (!written) setCopied({ key: "", clip });
  };

  /**
   * Pastes the copied nodes with their top-left corner at a world point, or next to the place they
   * were copied from. A second paste at the same point goes next to the first.
   */
  const pasteNodes = (point?: WfnPoint) => {
    const held = copied();
    const clip = held?.clip;
    const box = clip ? union(clip.nodes.map((node) => ({ ...node.at, width: 0, height: 0 }))) : undefined;
    if (!held || !clip || !box) return;
    const at = point && snapPoint(point);
    const again = at && pastedAt && at.x === pastedAt.x && at.y === pastedAt.y;
    const target = at && !again ? at : snapPoint({ x: box.x + DUPLICATE_OFFSET, y: box.y + DUPLICATE_OFFSET });
    pastedAt = at;
    const shift = { x: target.x - box.x, y: target.y - box.y };
    place(clip, shift, "paste");
    setCopied({
      key: held.key,
      clip: {
        ...clip,
        nodes: clip.nodes.map((node) => ({ ...node, at: { x: node.at.x + shift.x, y: node.at.y + shift.y } })),
      },
    });
  };

  /** Later nodes paint over earlier ones, so the order of the list is the stack order. */
  const restack = (id: string, where: "front" | "back") => {
    commit();
    setNodes((list) => {
      const node = list.find((entry) => entry.id === id);
      if (!node) return list;
      const rest = list.filter((entry) => entry.id !== id);
      return where === "front" ? [...rest, node] : [node, ...rest];
    });
  };

  /**
   * Whether the context menu of a node can run it: a step that is not an approval, or a trigger, while
   * no run is open and the canvas can change.
   */
  const runnable = (id: string) => {
    const kind = kindOf(id);
    return kind !== undefined && kind !== "approval" && isWorkflowStepKind(kind) && !running() && !frozen();
  };
  const runNode = (id: string) => {
    if (kindOf(id) === "trigger") props.onRun({ fromNodeId: id });
    else props.onRunStep(id);
  };

  /** Moves the camera so a node is in the centre of the view, and selects it. */
  const showNode = (id: string) => {
    const at = positions[id];
    const element = slot(id);
    if (!at || !element) return;
    const { width, height } = view();
    const scale = clampScale(Math.max(target().scale, 0.75));
    glideTo(
      {
        scale,
        x: width / 2 - (at.x + element.offsetWidth / 2) * scale,
        y: height / 2 - (at.y + element.offsetHeight / 2) * scale,
      },
      "flight",
    );
    canvas.select([id]);
  };

  /** Pans the least distance that shows a whole node, with a margin. */
  const reveal = (id: string) => {
    const box = boxOf(id);
    if (!box) return;
    const { width, height } = view();
    const margin = 48;
    const from = target();
    const left = from.x + box.x * from.scale;
    const top = from.y + box.y * from.scale;
    const right = left + box.width * from.scale;
    const bottom = top + box.height * from.scale;
    const dx = left < margin ? margin - left : right > width - margin ? width - margin - right : 0;
    const dy = top < margin ? margin - top : bottom > height - margin ? height - margin - bottom : 0;
    if (dx !== 0 || dy !== 0) glideTo({ scale: from.scale, x: from.x + dx, y: from.y + dy }, "flight");
  };

  /** Gives a node the focus, which selects it, and pans to show it. */
  const focusNode = (id: string) => {
    reveal(id);
    slot(id)?.querySelector<HTMLElement>("[data-node-id]")?.focus({ preventScroll: true });
  };

  /**
   * The node after or before a node, column by column from the left, then from the top. Past the
   * last node there is none, so Tab leaves the canvas.
   */
  const nextNode = (id: string, step: 1 | -1) => {
    const order = live()
      .flatMap((node) => {
        const at = positions[node.id];
        return at ? [{ id: node.id, at }] : [];
      })
      .sort((a, b) => a.at.x - b.at.x || a.at.y - b.at.y)
      .map((node) => node.id);
    const index = order.indexOf(id);
    return index < 0 ? undefined : order[index + step];
  };

  /** The texts that search looks in: the name of the kind of a node, then the text that its fields hold. */
  const searchTexts = (id: string) => {
    const kind = kindOf(id);
    if (!kind) return [];
    const fields = SEARCH_FIELDS[kind].map((key) => {
      const value = board.field(id, key);
      return typeof value === "string" ? value : "";
    });
    return [t(KIND_LABEL[kind]), ...fields];
  };
  /** Each match shows the field that holds the words, or its first field when only the label matches. */
  const matches = () => {
    const words = query().trim().toLowerCase();
    if (!words) return [];
    return live()
      .flatMap((node) => {
        const [label = "", ...fields] = searchTexts(node.id);
        const hit = fields.find((field) => field.toLowerCase().includes(words));
        if (!hit && !label.toLowerCase().includes(words)) return [];
        return [{ node, text: hit ?? fields.find((field) => field.trim()) ?? "" }];
      })
      .slice(0, 8);
  };
  const openSearch = () => {
    setUi((draft) => {
      draft.search = true;
      draft.hidden = false;
    });
  };
  const closeSearch = () => {
    setUi((draft) => {
      draft.search = false;
    });
    setQuery("");
  };

  /** The boxes of the nodes and of the view, and the drawn lines, in minimap pixels. */
  const minimap = createMemo(() => {
    if (!ui.minimap) return undefined;
    const boxes = live().flatMap((node) => {
      const box = boxOf(node.id);
      return box ? [{ id: node.id, kind: node.kind, ...box }] : [];
    });
    const { width, height } = view();
    const seen = { ...toWorld({ x: 0, y: 0 }), width: width / camera.scale, height: height / camera.scale };
    return minimapLayout(boxes, strokes(), seen);
  });
  /** Where a press on the minimap started. A drag from it follows the pointer at once. */
  let minimapPress: WfnPoint | undefined;
  /** A press on the minimap glides the view to centre that point, and a drag then pans it. */
  const panMinimap = (event: PointerEvent & { currentTarget: SVGSVGElement }) => {
    const map = minimap();
    if (!map) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const press = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const pressed = event.type === "pointerdown";
    if (pressed) minimapPress = press;
    else if (minimapPress && Math.hypot(press.x - minimapPress.x, press.y - minimapPress.y) < DRAG_THRESHOLD) return;
    else minimapPress = undefined;
    const point = map.toWorld(press);
    const { width, height } = view();
    const from = target();
    const next = { scale: from.scale, x: width / 2 - point.x * from.scale, y: height / 2 - point.y * from.scale };
    if (pressed) glideTo(next, "flight");
    else moveCamera(next);
  };

  /** Notes what a right-click hit before the menu opens. */
  const onContextMenu = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    const node = target?.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
    const edge = target?.closest<HTMLElement>("[data-edge-id]")?.dataset.edgeId;
    setMenuTarget(
      node
        ? { kind: "node", id: node }
        : edge
          ? { kind: "edge", id: edge, at: toWorld(local(event)) }
          : { kind: "canvas", at: toWorld(local(event)) },
    );
  };
  const menuNode = () => {
    const target = menuTarget();
    return target.kind === "node" ? target.id : undefined;
  };
  const menuEdge = () => {
    const target = menuTarget();
    return target.kind === "edge" ? target : undefined;
  };
  /** Opens the add menu at the right-click point, to put a node in the middle of a connection. */
  const insertAt = (id: string, at: WfnPoint) => {
    const edge = canvas.edges().find((entry) => entry.id === id);
    if (!edge) return;
    setDropQuery("");
    setDrop({ edge, at });
  };
  /** Opens the add menu at the right-click point on the empty canvas. */
  const addAt = (at: WfnPoint) => {
    setDropQuery("");
    setDrop({ at });
  };
  const menuPoint = () => {
    const target = menuTarget();
    return target.kind === "canvas" ? target.at : undefined;
  };

  /* ---------------------------------------------------------- Drawing */

  /** Marks each line that the eraser touches between two points. Release removes them in one step. */
  const eraseAlong = (from: WfnPoint, to: WfnPoint) => {
    const radius = ERASER_RADIUS / camera.scale;
    const count = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / radius));
    const samples = Array.from({ length: count + 1 }, (_, index) => ({
      x: from.x + ((to.x - from.x) * index) / count,
      y: from.y + ((to.y - from.y) * index) / count,
    }));
    const hit = strokes().filter(
      (stroke) => !ink.erasing.includes(stroke.id) && samples.some((at) => touches(stroke, at, radius)),
    );
    if (hit.length === 0) return;
    setInk((draft) => {
      draft.erasing = [...draft.erasing, ...hit.map((stroke) => stroke.id)];
    });
  };

  /* --------------------------------------------------------- Gestures */

  onSettled(() => {
    const area = viewport;
    if (!area) return;
    let gesture:
      | { kind: "pan"; start: WfnPoint; camera: WfnPoint; moved: boolean }
      | {
          kind: "node";
          id: string;
          start: WfnPoint;
          origin: WfnPoint;
          moved: boolean;
          focus?: HTMLElement;
          /** The nodes that move together, with their places at the start. */
          group: readonly { id: string; origin: WfnPoint }[];
          /** The box around the moving nodes at the start. */
          box: Box;
          /** The boxes of the other nodes, for the alignment guides. */
          others: readonly Box[];
        }
      | {
          kind: "box";
          start: WfnPoint;
          /** With Shift, the box adds to the selection that was there. */
          base: readonly string[];
          boxes: readonly { id: string; box: Box }[];
          moved: boolean;
        }
      | {
          kind: "resize";
          id: string;
          start: WfnPoint;
          node: WorkflowNodeKind;
          /** The handle: a corner or a side. The opposite corner or side stays in place. */
          corner: WfnHandle;
          cursor: string;
          /** The node that resizes. Only it shows its handles until the pointer goes up. */
          element: HTMLElement;
          /**
           * The font size of a text node, which a corner scales with its box. The floor is the height
           * of the content, so a card does not get smaller than what it holds.
           */
          origin: { at: WfnPoint; width: number; height: number; floor: number; font?: number; wrap?: number };
          moved: boolean;
        }
      | { kind: "draw"; start: WfnPoint; moved: boolean; stroke: Stroke; points: WfnPoint[] }
      | { kind: "erase"; start: WfnPoint; moved: boolean; last: WfnPoint }
      | { kind: "place"; start: WfnPoint; moved: boolean }
      | undefined;
    let space = false;
    const onResize = new ResizeObserver(() => {
      if (!cameraMoved) fitView(false);
    });
    const stopClick = (event: MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();
    };
    const onWheel = (event: WheelEvent) => {
      if (event.target instanceof Element && event.target.closest("textarea, [data-wfn-portal]")) return;
      event.preventDefault();
      // A wheel can count in lines or in pages, not pixels.
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? view().height
            : 1;
      const dx = event.deltaX * unit;
      const dy = event.deltaY * unit;
      if (event.ctrlKey || event.metaKey) {
        const zoom = -dy * (event.ctrlKey ? PINCH_ZOOM_RATE : WHEEL_ZOOM_RATE);
        const step = Math.max(-WHEEL_ZOOM_MAX, Math.min(WHEEL_ZOOM_MAX, zoom));
        moveCamera(zoomAround(camera.scale * Math.exp(step), local(event)));
        return;
      }
      moveCamera({
        x: camera.x - dx * WHEEL_PAN_SPEED,
        y: camera.y - dy * WHEEL_PAN_SPEED,
        scale: camera.scale,
      });
    };
    const onMove = (event: PointerEvent) => {
      const current = gesture;
      if (!current) return;
      if (current.kind === "draw" || current.kind === "erase") {
        current.moved = true;
        // The coalesced events keep a fast line smooth.
        const coalesced = event.getCoalescedEvents?.() ?? [];
        for (const sample of coalesced.length > 0 ? coalesced : [event]) {
          const at = toWorld(local(sample));
          if (current.kind === "erase") {
            eraseAlong(current.last, at);
            current.last = at;
            continue;
          }
          const last = current.points.at(-1);
          if (last && Math.hypot(at.x - last.x, at.y - last.y) * camera.scale < INK_STEP) continue;
          current.points.push(at);
        }
        if (current.kind === "draw") setSketchPoints(current.points);
        return;
      }
      const point = local(event);
      const dx = point.x - current.start.x;
      const dy = point.y - current.start.y;
      if (!current.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!current.moved && (current.kind === "node" || current.kind === "resize")) {
        commit();
        // A drag saves once, when it ends.
        setGesturing(true);
      }
      current.moved = true;
      if (current.kind === "place") {
        setDrawn(drawnBox(current.start, point));
        return;
      }
      if (current.kind === "box") {
        const left = Math.min(point.x, current.start.x);
        const top = Math.min(point.y, current.start.y);
        const screen = { x: left, y: top, width: Math.abs(dx), height: Math.abs(dy) };
        setMarquee(screen);
        const world = {
          ...toWorld(screen),
          width: screen.width / camera.scale,
          height: screen.height / camera.scale,
        };
        const hits = current.boxes.filter((entry) => overlaps(entry.box, world)).map((entry) => entry.id);
        canvas.select([...current.base, ...hits.filter((id) => !current.base.includes(id))]);
        return;
      }
      if (current.kind === "pan") {
        area.dataset.panning = "";
        moveCamera({ x: current.camera.x + dx, y: current.camera.y + dy, scale: camera.scale });
        return;
      }
      if (current.kind === "resize") {
        area.dataset.resizing = current.cursor;
        const { origin } = current;
        const { font: base, wrap } = origin;
        const across = sideX(current.corner);
        const down = sideY(current.corner);
        const limits = RESIZE[current.node];
        // The opposite corner or side stays in place.
        const place = (width: number, height: number) =>
          setPositions((draft) => {
            draft[current.id] = {
              x: across < 0 ? origin.at.x + origin.width - width : origin.at.x,
              y: down < 0 ? origin.at.y + origin.height - height : origin.at.y,
            };
          });
        if (base !== undefined && down !== 0) {
          // A corner scales a text: it follows the pointer along the diagonal of the box, as on other canvases.
          const { width, height } = origin;
          const ratio =
            1 + (across * dx * width + down * dy * height) / camera.scale / (width * width + height * height);
          const font = Math.min(Math.max(Math.round(base * ratio), TEXT_FONT.min), TEXT_FONT.max);
          setSizes((draft) => {
            // A text that wraps at a set width keeps the same line breaks.
            draft[current.id] = wrap === undefined ? { font } : { font, width: Math.round((wrap * font) / base) };
          });
          place((width * font) / base, (height * font) / base);
          return;
        }
        if (base !== undefined) {
          // A side of a text sets where it wraps, and the font stays.
          const width = snapWithin(origin.width + (across * dx) / camera.scale, limits.width);
          setSizes((draft) => {
            draft[current.id] = { ...draft[current.id], width };
          });
          place(width, origin.height);
          return;
        }
        const free = limits.height;
        let width = across === 0 ? origin.width : snapWithin(origin.width + (across * dx) / camera.scale, limits.width);
        let height = origin.height;
        if (free && down !== 0) {
          height = Math.max(snapWithin(origin.height + (down * dy) / camera.scale, free), origin.floor);
        } else if (current.node === "image") {
          // An image keeps its aspect ratio. A top or bottom side sets the width through the height.
          if (across === 0)
            width = snapWithin(
              (origin.width * (origin.height + (down * dy) / camera.scale)) / origin.height,
              limits.width,
            );
          height = (origin.height * width) / origin.width;
        }
        setSizes((draft) => {
          // A side keeps the size that the user set on the other axis.
          const set = draft[current.id];
          draft[current.id] = free
            ? {
                ...(across === 0 && set?.width === undefined ? {} : { width }),
                ...(down === 0 && set?.height === undefined ? {} : { height }),
              }
            : { width };
        });
        place(width, height);
        return;
      }
      area.dataset.dragging = "";
      const x = align("x", current, dx / camera.scale);
      const y = align("y", current, dy / camera.scale);
      setGuides([...x.guides, ...y.guides]);
      setPositions((draft) => {
        for (const member of current.group)
          draft[member.id] = { x: member.origin.x + x.delta, y: member.origin.y + y.delta };
      });
    };
    /**
     * The move along one axis. An edge or the centre of the moving box that comes near the same line
     * of another node snaps to it and shows a guide; else the pressed node snaps to the grid.
     */
    const align = (
      axis: "x" | "y",
      current: { origin: WfnPoint; box: Box; others: readonly Box[] },
      move: number,
    ): { delta: number; guides: Guide[] } => {
      const across = axis === "x" ? "y" : "x";
      const length = (box: Box) => (axis === "x" ? box.width : box.height);
      const lines = (box: Box) => [box[axis], box[axis] + length(box) / 2, box[axis] + length(box)];
      const moved = { ...current.box, [axis]: current.box[axis] + move };
      let best: number | undefined;
      for (const other of current.others)
        for (const line of lines(other))
          for (const mine of lines(moved)) {
            const gap = line - mine;
            if (
              Math.abs(gap) <= GUIDE_DISTANCE / camera.scale &&
              (best === undefined || Math.abs(gap) < Math.abs(best))
            )
              best = gap;
          }
      if (best === undefined) {
        const start = current.origin[axis];
        return { delta: Math.round((start + move) / SNAP) * SNAP - start, guides: [] };
      }
      const delta = move + best;
      const placed = { ...current.box, [axis]: current.box[axis] + delta };
      const guides: Guide[] = [];
      for (const line of lines(placed)) {
        const matched = current.others.filter((other) => lines(other).some((value) => Math.abs(value - line) < 0.5));
        if (matched.length === 0) continue;
        const span = [placed, ...matched];
        guides.push({
          axis,
          at: line,
          from: Math.min(...span.map((box) => box[across])),
          to: Math.max(...span.map((box) => box[across] + (across === "x" ? box.width : box.height))),
        });
      }
      return { delta, guides };
    };
    /** Ends the gesture and gives it back. */
    const endGesture = () => {
      const current = gesture;
      gesture = undefined;
      setGesturing(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      delete area.dataset.panning;
      delete area.dataset.dragging;
      delete area.dataset.resizing;
      if (current?.kind === "resize") delete current.element.dataset.resizing;
      setMarquee(undefined);
      setGuides([]);
      return current;
    };
    stopGesture = () => {
      const current = endGesture();
      if (current?.kind === "place") setDrawn(null);
      if (current?.kind === "draw" || current?.kind === "erase")
        setInk((draft) => {
          draft.sketch = null;
          draft.erasing = [];
        });
    };
    const onUp = (event: PointerEvent) => {
      const current = endGesture();
      if (!current) return;
      if (current.kind === "draw") {
        const stroke = { ...current.stroke, points: current.points };
        commit();
        setStrokes((list) => [...list, stroke]);
        setInk((draft) => {
          draft.sketch = null;
        });
        return;
      }
      if (current.kind === "erase") {
        const gone = new Set(ink.erasing);
        if (gone.size > 0) {
          commit();
          setStrokes((list) => list.filter((stroke) => !gone.has(stroke.id)));
        }
        setInk((draft) => {
          draft.erasing = [];
        });
        return;
      }
      if (current.kind === "place") {
        const box = drawn();
        setDrawn(null);
        if (event.type !== "pointercancel")
          placeItem("shape", toWorld(current.start), current.moved && box ? box : undefined);
        return;
      }
      if (current.kind === "node" && !current.moved) {
        current.focus?.focus();
        // A click without a move on a node of a group selects only that node.
        if (current.group.length > 1) canvas.select([current.id]);
      }
      if (current.moved) {
        // A drag that ends on a button must not press it.
        window.addEventListener("click", stopClick, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", stopClick, { capture: true }));
      }
    };
    const onDown = (event: PointerEvent) => {
      if ((event.button !== 0 && event.button !== 1) || !(event.target instanceof Element)) return;
      // A press takes the camera where it is.
      stopGlide();
      const target = event.target;
      const start = local(event);
      // The middle button, Space held, or the Pan tool pans, and any drag on a version or a read-only canvas. Else a drag on the empty canvas selects.
      if ((event.button === 1 || space || ui.tool === "pan" || frozen()) && !target.closest("[data-wfn-portal]")) {
        event.preventDefault();
        gesture = { kind: "pan", start, camera: { x: camera.x, y: camera.y }, moved: false };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
        return;
      }
      if (event.button !== 0) return;
      // The Draw tool draws or erases from any press on the canvas, over the nodes too.
      if (ui.tool === "draw" && !target.closest("[data-wfn-portal]")) {
        event.preventDefault();
        const at = toWorld(start);
        const mode = ui.draw;
        if (mode === "eraser") {
          gesture = { kind: "erase", start, moved: false, last: at };
          eraseAlong(at, at);
        } else {
          const stroke: Stroke = {
            id: crypto.randomUUID(),
            brush: mode,
            color: ui.ink,
            width: INK_WIDTH[mode] / camera.scale,
            points: [at],
          };
          const points = [at];
          gesture = { kind: "draw", start, moved: false, stroke, points };
          setSketchPoints(points);
          setInk((draft) => {
            draft.sketch = stroke;
          });
        }
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
        return;
      }
      // Sticky note puts its item where the user clicks.
      if (ui.tool === "note" && !target.closest("[data-wfn-portal]")) {
        event.preventDefault();
        placeItem("note", toWorld(start));
        return;
      }
      // A click with Shapes puts the shape at its usual size. A drag draws it from corner to corner.
      if (ui.tool === "shape" && !target.closest("[data-wfn-portal]")) {
        event.preventDefault();
        gesture = { kind: "place", start, moved: false };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
        return;
      }
      const handle = target.closest<HTMLElement>("[data-wfn-resize]");
      const resized = handle?.dataset.wfnResize;
      const resizedKind = resized ? kindOf(resized) : undefined;
      const resizedAt = resized ? positions[resized] : undefined;
      const node = handle?.closest<HTMLElement>("[data-node-id]");
      if (handle && resized && resizedKind && resizedAt && node) {
        event.preventDefault();
        const card = node.querySelector<HTMLElement>(".wfn-card") ?? node;
        const corner = HANDLES.find((value) => value === handle.dataset.corner) ?? "se";
        const wrap = sizes[resized]?.width;
        const cursor = resizeCursor(stretchOf(resizedKind), corner);
        // The live resize has no transition from here, so the measures below are the current ones.
        area.dataset.resizing = cursor;
        node.dataset.resizing = "";
        gesture = {
          kind: "resize",
          id: resized,
          node: resizedKind,
          corner,
          cursor,
          element: node,
          start,
          origin: {
            at: resizedAt,
            width: node.offsetWidth,
            height: card.offsetHeight,
            floor: contentHeight(node, card),
            ...(resizedKind === "text" ? { font: textFont(node), ...(wrap === undefined ? {} : { wrap }) } : {}),
          },
          moved: false,
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
        return;
      }
      if (target.closest(NO_DRAG) || target.closest(".wfn-edge-hit")) return;
      const id = target.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
      const at = id && !board.isLocked(id) ? positions[id] : undefined;
      if (id && at) {
        const text = target.closest<HTMLTextAreaElement>(".wfn-text-input");
        // A press on free text moves it; a press without a move edits it.
        if (text && document.activeElement === text) return;
        // Shift and a press adds the node to the selection or takes it out; it does not move.
        if (event.shiftKey) return;
        if (text) event.preventDefault();
        // A press on a node of the selection moves all of it.
        const members = board.isSelected(id)
          ? group().filter((member) => member === id || !board.isLocked(member))
          : [id];
        const moving = members.flatMap((member) => {
          const origin = positions[member];
          return origin ? [{ id: member, origin }] : [];
        });
        const box = union(boxesOf(members));
        if (!box) return;
        gesture = {
          kind: "node",
          id,
          start,
          origin: at,
          moved: false,
          group: moving,
          box,
          others: boxesOf(live().flatMap((node) => (members.includes(node.id) ? [] : [node.id]))),
          ...(text ? { focus: text } : {}),
        };
      } else if (!target.closest("[data-node-id]")) {
        event.preventDefault();
        gesture = {
          kind: "box",
          start,
          base: event.shiftKey ? group() : [],
          boxes: live().flatMap((node) => {
            const box = boxOf(node.id);
            return box ? [{ id: node.id, box }] : [];
          }),
          moved: false,
        };
      } else {
        return;
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    };
    /** A double click on a resize handle restores the default size. */
    const onDoubleClick = (event: MouseEvent) => {
      const id =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("[data-wfn-resize]")?.dataset.wfnResize
          : undefined;
      if (id) resetSize(id);
    };
    /** The eraser shows as a ring under the pointer, and a note or a shape as the item to place. */
    const onHover = (event: PointerEvent) => {
      const over = event.target instanceof Element && !event.target.closest("[data-wfn-portal]");
      pointer = over ? local(event) : undefined;
      if (placing()) setGhost(over ? local(event) : null);
      const show = ui.tool === "draw" && ui.draw === "eraser" && over;
      if (!show && ink.eraser === null) return;
      const at = show ? local(event) : null;
      setInk((draft) => {
        draft.eraser = at;
      });
    };
    const onLeave = () => {
      pointer = undefined;
      setGhost(null);
      setInk((draft) => {
        draft.eraser = null;
      });
    };
    area.addEventListener("wheel", onWheel, { passive: false });
    area.addEventListener("pointerdown", onDown);
    area.addEventListener("pointermove", onHover);
    area.addEventListener("pointerleave", onLeave);
    /** A text field that has focus keeps the menu of the system, for copy and paste. */
    const onNativeMenu = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target === document.activeElement && isEditable(event.target))
        event.stopPropagation();
    };
    /** ⌘ or Ctrl with =, - or 0 zooms, ⇧1 fits the view, and ⌘ or Ctrl with Enter runs the workflow. */
    const withMod: Partial<Record<string, () => void>> = {
      "=": () => zoomBy(ZOOM_STEP),
      "+": () => zoomBy(ZOOM_STEP),
      "-": () => zoomBy(1 / ZOOM_STEP),
      "0": () => zoomTo(1),
      Enter: () => {
        if (canRun() && !running()) props.onRun({});
      },
    };
    /** Shortcuts that act on the selected nodes. A text field keeps its own undo. */
    const onNodes: Partial<Record<string, (ids: readonly string[]) => void>> = {
      d: duplicateNodes,
    };
    /** True when the focus is a field with selected text. Then copy and cut act on the text. */
    const selectsText = () => {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)
        return active.selectionStart !== active.selectionEnd;
      return !(document.getSelection()?.isCollapsed ?? true);
    };
    /**
     * ⌘C and ⌘X copy the selected nodes when no text is selected. In a field of a node, they copy that
     * node, or the selection that holds it. The system clipboard gets only the key of the copy, so a
     * paste in another app gets no text.
     */
    const onCopy = (event: ClipboardEvent) => {
      const active = document.activeElement;
      const owner =
        active instanceof HTMLElement ? active.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId : undefined;
      const ids = copying ?? (owner ? targets(owner) : group());
      if (deleted() || !inCanvas(root, active) || (!copying && selectsText())) return;
      if (ids.length === 0 || !event.clipboardData) return;
      const clip = collect(ids);
      if (clip.nodes.length === 0) return;
      event.preventDefault();
      const key = crypto.randomUUID();
      event.clipboardData.setData(CLIP_TYPE, key);
      setCopied({ key, clip });
      pastedAt = undefined;
      if (event.type === "cut") canvas.deleteNodes(ids);
    };
    /** ⌘V pastes copied nodes at the pointer, also into a field, because the clipboard has no text then. */
    const onPaste = (event: ClipboardEvent) => {
      const key = event.clipboardData?.getData(CLIP_TYPE);
      if (deleted() || frozen() || !inCanvas(root, document.activeElement)) return;
      if (!key || copied()?.key !== key) return;
      event.preventDefault();
      pasteNodes(pointer && toWorld(pointer));
    };
    const ARROWS: Partial<Record<string, WfnPoint>> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    /** Where the arrow keys move nodes: the canvas or a node has focus, not a field, a button or a menu. */
    const onCanvas = (element: Element | null) =>
      element === null ||
      element === document.body ||
      (element instanceof HTMLElement && (element.matches("[data-node-id]") || element === area));
    /** Keys without a modifier, as on the Higgsfield canvas. */
    const plain: Partial<Record<string, () => void>> = {
      v: () => setTool("select"),
      h: () => setTool("pan"),
      p: () => setDraw("pen"),
      m: () => setDraw("marker"),
      e: () => setDraw("eraser"),
      n: () => setTool("note"),
      r: () => setTool("shape"),
    };
    const onShortcut = (event: KeyboardEvent) => {
      const active = document.activeElement;
      if (deleted() || !inCanvas(root, active)) return;
      const editing = isEditable(active);
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const ids = group();
      const inMenu = Boolean(active?.closest("[data-wfn-portal]"));
      const node = active instanceof HTMLElement ? active.closest<HTMLElement>("[data-node-id]") : null;
      const arrow = ARROWS[event.key];
      const action = (() => {
        // A version and a read-only canvas take only the camera keys. Escape goes back to the live canvas.
        if (frozen()) {
          if (inMenu) return undefined;
          if (event.key === "Escape") return previewing() ? closeVersion : undefined;
          if (event.shiftKey && event.code === "Digit1") return () => fitView(true);
          return mod && event.key !== "Enter" ? withMod[event.key] : undefined;
        }
        if (mod && key === "f") return openSearch;
        if (mod && key === "/") return toggleHud;
        if (mod && event.shiftKey && key === "l" && ids.length > 0)
          return () => canvas.lockAll(ids, !ids.every((id) => board.isLocked(id)));
        if (mod && !editing && key === "z") return event.shiftKey ? redo : undo;
        if (mod && !editing && key === "y") return redo;
        if (mod && !editing && key === "a") return selectAll;
        if (mod && !editing && ids.length > 0 && onNodes[key]) return () => onNodes[key]?.(ids);
        if (mod) return withMod[event.key];
        // Escape in a field of a node gives the focus back to the node.
        if (event.key === "Escape" && editing && node && !inMenu) return () => node.focus();
        if (editing || event.altKey) return undefined;
        if (arrow && ids.length > 0 && onCanvas(active)) {
          const step = event.shiftKey ? NUDGE.large : NUDGE.step;
          return () => nudge(arrow.x * step, arrow.y * step, event.repeat);
        }
        // Tab on a node goes to the next node; in a node, Tab goes through its fields.
        const next =
          event.key === "Tab" && node && active === node
            ? nextNode(node.dataset.nodeId ?? "", event.shiftKey ? -1 : 1)
            : undefined;
        if (next) return () => focusNode(next);
        // Enter on a node goes into its first field or control.
        if (event.key === "Enter" && node && active === node)
          return () =>
            node
              .querySelector<HTMLElement>(
                ".wfn-card :is(textarea, input, button:not(:disabled)), .wfn-text-input, textarea, input",
              )
              ?.focus();
        if (event.shiftKey && event.code === "Digit1") return () => fitView(true);
        if (event.key === "Escape" && ui.search) return closeSearch;
        if (event.key === "Escape" && (ui.tool === "draw" || placing()) && !inMenu) return () => setTool("select");
        if (event.key === "Escape" && ids.length > 0 && !inMenu && !drop()) return () => canvas.select([]);
        // A menu or a list box takes letters itself, to go to an item.
        return event.shiftKey || inMenu || takesKeys(active) ? undefined : plain[key];
      })();
      if (!action) return;
      event.preventDefault();
      action();
    };
    /** Space held turns a drag into a pan, as on other canvases. */
    const onSpace = (event: KeyboardEvent) => {
      if (event.code !== "Space" || isEditable(document.activeElement)) return;
      if (event.type === "keydown" && !onCanvas(document.activeElement)) return;
      space = event.type === "keydown";
      if (space) {
        event.preventDefault();
        area.dataset.space = "";
      } else delete area.dataset.space;
    };
    area.addEventListener("dblclick", onDoubleClick);
    area.addEventListener("contextmenu", onNativeMenu, { capture: true });
    document.addEventListener("keydown", onShortcut);
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCopy);
    document.addEventListener("paste", onPaste);
    document.addEventListener("keydown", onSpace);
    document.addEventListener("keyup", onSpace);
    onResize.observe(area);
    return () => {
      area.removeEventListener("wheel", onWheel);
      area.removeEventListener("pointerdown", onDown);
      area.removeEventListener("pointermove", onHover);
      area.removeEventListener("pointerleave", onLeave);
      area.removeEventListener("dblclick", onDoubleClick);
      area.removeEventListener("contextmenu", onNativeMenu, { capture: true });
      document.removeEventListener("keydown", onShortcut);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCopy);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("keydown", onSpace);
      document.removeEventListener("keyup", onSpace);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      onResize.disconnect();
      slotResize.disconnect();
      glide.stop();
    };
  });

  return (
    <BoardProvider board={board}>
      <main
        ref={root}
        class="wfn-stage wfn-canvas"
        inert={deleted()}
        data-deleted={deleted() ? "" : undefined}
        data-preview={previewing() ? "" : undefined}
        data-tool={ui.tool}
        data-draw={ui.tool === "draw" ? ui.draw : undefined}
        data-hud-hidden={ui.hidden ? "" : undefined}
        data-frame={props.frame}
        aria-label={t("workflow.canvas.label", { name: name() })}
        onPointerDown={(event) => {
          if (drop() && !(event.target instanceof Element && event.target.closest(".wfn-drop-menu"))) closeDrop();
          pressing = true;
          const release = () => {
            pressing = false;
            window.removeEventListener("pointerup", release, { capture: true });
            window.removeEventListener("pointercancel", release, { capture: true });
          };
          window.addEventListener("pointerup", release, { capture: true });
          window.addEventListener("pointercancel", release, { capture: true });
          // A pan keeps the selection.
          const panning = event.button === 1 || ui.tool === "pan" || frozen() || viewport?.hasAttribute("data-space");
          if (!panning && ui.tool === "select") canvas.selectFrom(event.target, event.shiftKey);
        }}
        onFocusIn={(event) => {
          if (!pressing) canvas.selectFrom(event.target);
        }}
      >
        <ContextMenu.Root modal={false}>
          <ContextMenu.Trigger
            ref={(element: HTMLElement) => {
              viewport = element;
            }}
            class="wfn-viewport"
            disabled={frozen()}
            onContextMenu={onContextMenu}
          >
            <DotGrid camera={camera} />
            <div
              ref={(element: HTMLElement) => {
                worldElement = element;
                canvas.setWorld(element);
              }}
              class="wfn-world"
              inert={frozen()}
              data-group={groupBox() ? "" : undefined}
              style={{
                transform: `translate(${devicePixel(camera.x)}px, ${devicePixel(camera.y)}px) scale(${camera.scale})`,
                "--wfn-scale": camera.scale,
              }}
            >
              <canvas.Edges />
              {/* Keyed by id, so a node keeps its element when undo or a schedule change gives a new item. */}
              <For each={nodes()} keyed={(node) => node.id}>
                {(node) => {
                  let slotElement: HTMLElement | undefined;
                  // A cleanup runs while the list updates, where a write halts Solid: `reset` drops the size.
                  onCleanup(() => {
                    if (slotElement) slotResize.unobserve(slotElement);
                  });
                  return (
                    <div
                      class="wfn-slot"
                      data-slot={node().id}
                      ref={(element) => {
                        slotElement = element;
                        slotResize.observe(element);
                      }}
                      data-kind={node().kind}
                      style={{
                        left: `${positions[node().id]?.x ?? 0}px`,
                        top: `${positions[node().id]?.y ?? 0}px`,
                      }}
                    >
                      <CanvasNodeView node={node()} trigger={triggerOf(node().id)} />
                    </div>
                  );
                }}
              </For>
              <svg class="wfn-ink" aria-hidden="true">
                <For each={strokes()}>
                  {(stroke) => <InkLine stroke={stroke} erasing={ink.erasing.includes(stroke.id)} />}
                </For>
                <Show when={ink.sketch}>{(stroke) => <InkLine stroke={stroke()} points={sketchPoints()} />}</Show>
              </svg>
              {/* Keyed by its line, so a guide that stays during a drag keeps its element and fades in once. */}
              <For each={guides()} keyed={(guide) => `${guide.axis}:${guide.at}`}>
                {(guide) => (
                  <span
                    class="wfn-guide"
                    data-axis={guide().axis}
                    style={
                      guide().axis === "x"
                        ? {
                            left: `${guide().at}px`,
                            top: `${guide().from}px`,
                            height: `${guide().to - guide().from}px`,
                          }
                        : { top: `${guide().at}px`, left: `${guide().from}px`, width: `${guide().to - guide().from}px` }
                    }
                  />
                )}
              </For>
              <Show when={groupBox()}>
                {(box) => (
                  <div
                    class="wfn-group"
                    style={{
                      left: `${box().x}px`,
                      top: `${box().y}px`,
                      width: `${box().width}px`,
                      height: `${box().height}px`,
                    }}
                  >
                    <div
                      class="wfn-toolbar wfn-group-bar"
                      data-wfn-portal=""
                      role="toolbar"
                      aria-label={t("workflow.canvas.selection")}
                    >
                      <span class="wfn-group-count">{t("workflow.canvas.selected", { count: group().length })}</span>
                      <span class="wfn-toolbar-separator" aria-hidden="true" />
                      <ToolAction
                        text={t("workflow.node.toolbar.duplicate")}
                        keys={[MOD_KEY, "D"]}
                        icon={<CopyPlus />}
                        onClick={() => duplicateNodes(group())}
                      />
                      <ToolAction
                        text={groupLocked() ? t("workflow.node.toolbar.unlock") : t("workflow.node.toolbar.lock")}
                        keys={["⇧", MOD_KEY, "L"]}
                        pressed={groupLocked()}
                        icon={
                          <Show when={groupLocked()} fallback={<Lock />}>
                            <LockOpen />
                          </Show>
                        }
                        onClick={() => canvas.lockAll(group(), !groupLocked())}
                      />
                      <Show when={!groupLocked()}>
                        <ToolAction
                          text={t("workflow.node.toolbar.delete")}
                          keys={["⌫"]}
                          tone="danger"
                          icon={<Trash2 />}
                          onAim={(aimed) => canvas.aimRemove(aimed ? group() : [])}
                          onClick={() => canvas.deleteNodes(group())}
                        />
                      </Show>
                    </div>
                  </div>
                )}
              </Show>
            </div>
            <Show when={marquee()}>
              {(box) => (
                <div
                  class="wfn-marquee"
                  aria-hidden="true"
                  style={{
                    left: `${box().x}px`,
                    top: `${box().y}px`,
                    width: `${box().width}px`,
                    height: `${box().height}px`,
                  }}
                />
              )}
            </Show>
            <Show when={ui.tool === "draw" && ui.draw === "eraser" ? ink.eraser : null}>
              {(at) => (
                <span class="wfn-eraser" aria-hidden="true" style={{ left: `${at().x}px`, top: `${at().y}px` }} />
              )}
            </Show>
            <Show when={drawn()}>
              {(box) => (
                <span
                  class="wfn-ghost"
                  data-kind="shape"
                  data-drawn=""
                  aria-hidden="true"
                  style={{
                    left: `${box().x * camera.scale + camera.x}px`,
                    top: `${box().y * camera.scale + camera.y}px`,
                    width: `${box().width * camera.scale}px`,
                    height: `${box().height * camera.scale}px`,
                    "--wfn-shape": colorVar(ui.fill),
                  }}
                >
                  <ShapeSurface shape={ui.shape} color={ui.fill} />
                </span>
              )}
            </Show>
            <Show when={placing() && !drawn() ? ghost() : null}>
              {(at) => {
                const size = () => (ui.tool === "shape" ? shapeSize(ui.shape) : NOTE_SIZE);
                return (
                  <span
                    class="wfn-ghost"
                    data-kind={ui.tool}
                    aria-hidden="true"
                    style={{
                      left: `${at().x}px`,
                      top: `${at().y}px`,
                      width: `${size().width * camera.scale}px`,
                      height: `${size().height * camera.scale}px`,
                      "--wfn-note": colorVar(ui.note),
                      "--wfn-shape": colorVar(ui.fill),
                    }}
                  >
                    <Show when={ui.tool === "shape"}>
                      <ShapeSurface shape={ui.shape} color={ui.fill} />
                    </Show>
                  </span>
                );
              }}
            </Show>
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content class="wfn-menu" data-wfn-portal="" aria-label={t(MENU_LABEL[menuTarget().kind])}>
              <Show when={menuNode()}>
                {(id) => (
                  <>
                    <Show when={runnable(id())}>
                      <ContextMenu.Item onSelect={() => runNode(id())}>
                        <Play aria-hidden="true" />
                        <span class="wfn-menu-text">
                          {kindOf(id()) === "trigger"
                            ? t("workflow.canvas.action.runFromTrigger")
                            : t("workflow.canvas.action.runStep")}
                        </span>
                      </ContextMenu.Item>
                      <ContextMenu.Separator />
                    </Show>
                    <MenuItem
                      icon={<Copy />}
                      label={t("workflow.canvas.action.copy")}
                      keys={[MOD_KEY, "C"]}
                      onSelect={() => copyNodes(targets(id()))}
                    />
                    <Show when={clipboard()}>
                      <MenuItem
                        icon={<ClipboardPaste />}
                        label={t("workflow.canvas.action.paste")}
                        keys={[MOD_KEY, "V"]}
                        onSelect={() => pasteNodes()}
                      />
                    </Show>
                    <MenuItem
                      icon={<CopyPlus />}
                      label={t("workflow.node.toolbar.duplicate")}
                      keys={[MOD_KEY, "D"]}
                      onSelect={() => duplicateNodes(targets(id()))}
                    />
                    <ContextMenu.Separator />
                    <MenuItem
                      icon={<BringToFront />}
                      label={t("workflow.canvas.action.bringToFront")}
                      onSelect={() => restack(id(), "front")}
                    />
                    <MenuItem
                      icon={<SendToBack />}
                      label={t("workflow.canvas.action.sendToBack")}
                      onSelect={() => restack(id(), "back")}
                    />
                    <Show when={sizes[id()]}>
                      <MenuItem
                        icon={<RotateCcw />}
                        label={t("workflow.canvas.action.resetSize")}
                        onSelect={() => resetSize(id())}
                      />
                    </Show>
                    <MenuItem
                      icon={board.isLocked(id()) ? <LockOpen /> : <Lock />}
                      label={board.isLocked(id()) ? t("workflow.node.toolbar.unlock") : t("workflow.node.toolbar.lock")}
                      keys={["⇧", MOD_KEY, "L"]}
                      onSelect={() => canvas.lockAll(targets(id()), !board.isLocked(id()))}
                    />
                    <Show when={!targets(id()).every((target) => board.isLocked(target))}>
                      <ContextMenu.Separator />
                      <MenuItem
                        danger
                        icon={<Trash2 />}
                        label={t("workflow.node.toolbar.delete")}
                        keys={["⌫"]}
                        onAim={(aimed) => canvas.aimRemove(aimed ? targets(id()) : [])}
                        onSelect={() => canvas.deleteNodes(targets(id()))}
                      />
                    </Show>
                  </>
                )}
              </Show>
              <Show when={menuEdge()}>
                {(target) => (
                  <>
                    <MenuItem
                      icon={<Plus />}
                      label={t("workflow.canvas.action.addHere")}
                      onSelect={() => insertAt(target().id, target().at)}
                    />
                    <ContextMenu.Separator />
                    <MenuItem
                      danger
                      icon={<Trash2 />}
                      label={t("workflow.canvas.action.deleteConnection")}
                      onAim={(aimed) => canvas.aimDisconnect(aimed ? target().id : null)}
                      onSelect={() => canvas.disconnect(target().id)}
                    />
                  </>
                )}
              </Show>
              <Show when={menuPoint()}>
                {(at) => (
                  <>
                    <MenuItem icon={<Plus />} label={t("workflow.canvas.add.node")} onSelect={() => addAt(at())} />
                    <Show when={clipboard()}>
                      <MenuItem
                        icon={<ClipboardPaste />}
                        label={t("workflow.canvas.action.pasteHere")}
                        keys={[MOD_KEY, "V"]}
                        onSelect={() => pasteNodes(at())}
                      />
                    </Show>
                    <Show when={live().length > 0}>
                      <MenuItem
                        icon={<MousePointer2 />}
                        label={t("workflow.canvas.action.selectAll")}
                        keys={[MOD_KEY, "A"]}
                        onSelect={selectAll}
                      />
                    </Show>
                    <Show when={steps().undo > 0}>
                      <MenuItem
                        icon={<Undo2 />}
                        label={t("workflow.canvas.action.undo")}
                        keys={[MOD_KEY, "Z"]}
                        onSelect={undo}
                      />
                    </Show>
                    <Show when={steps().redo > 0}>
                      <MenuItem
                        icon={<Redo2 />}
                        label={t("workflow.canvas.action.redo")}
                        keys={["⇧", MOD_KEY, "Z"]}
                        onSelect={redo}
                      />
                    </Show>
                    <ContextMenu.Separator />
                    <MenuItem
                      icon={<Search />}
                      label={t("workflow.canvas.action.search")}
                      keys={[MOD_KEY, "F"]}
                      onSelect={openSearch}
                    />
                    <MenuItem
                      icon={<Scan />}
                      label={t("workflow.canvas.zoom.fit")}
                      keys={["⇧", "1"]}
                      onSelect={() => fitView(true)}
                    />
                    <MenuItem
                      icon={ui.hidden ? <Eye /> : <EyeOff />}
                      label={ui.hidden ? t("workflow.canvas.hud.show") : t("workflow.canvas.hud.hide")}
                      keys={[MOD_KEY, "/"]}
                      onSelect={toggleHud}
                    />
                    <Show when={board.lockedCount() > 0}>
                      <ContextMenu.Separator />
                      <MenuItem
                        icon={<LockOpen />}
                        label={t("workflow.canvas.action.unlockAll")}
                        onSelect={board.unlockAll}
                      />
                    </Show>
                  </>
                )}
              </Show>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>
        <Show when={live().length === 0 && !frozen() && allows("trigger")}>
          <div class="wfn-empty">
            <span class="wfn-menu-icon wfn-empty-icon" data-kind="trigger" aria-hidden="true">
              <Zap />
            </span>
            <h2 class="wfn-empty-title">{t("workflow.canvas.empty.title")}</h2>
            <Button size="sm" onClick={() => addNode("trigger")}>
              <Plus aria-hidden="true" />
              {t("workflow.canvas.empty.add")}
            </Button>
          </div>
        </Show>

        <WorkflowCanvasHeader
          frame={props.frame}
          name={name()}
          renaming={renaming()}
          menuRef={(element) => {
            workflowMenu = element;
          }}
          switcher={
            <WorkflowSwitcher
              workflows={listed()}
              current={openId()}
              versions={versionList()}
              viewing={props.versionPreview?.versionId}
              versionsDisabled={running()}
              readOnly={props.readOnly === true}
              onAction={onSwitcher}
            />
          }
          onName={setName}
          onEndRename={endRename}
          previewing={previewing()}
          viewing={board.viewing()}
          onView={board.view}
          pastRuns={pastRuns()}
          openRuns={openRuns()}
          waiting={waitingEvents()}
          olderRuns={props.runs.nextBefore !== null}
          onLoadOlderRuns={props.onLoadOlderRuns}
          step={current()}
          onShowStep={showNode}
          canRun={canRun()}
          running={running()}
          progress={progress()}
          onRun={() => props.onRun({})}
          onStop={stopRun}
        />

        <Show when={ui.tool === "draw"}>
          <div class="wfn-hud wfn-hud-sub" role="toolbar" aria-label={t("workflow.canvas.tool.draw")}>
            <HudButton
              label={t("workflow.canvas.tool.pen")}
              keys={["P"]}
              pressed={ui.draw === "pen"}
              onClick={() => setDraw("pen")}
            >
              <Pencil />
            </HudButton>
            <HudButton
              label={t("workflow.canvas.tool.marker")}
              keys={["M"]}
              pressed={ui.draw === "marker"}
              onClick={() => setDraw("marker")}
            >
              <Highlighter />
            </HudButton>
            <HudButton
              label={t("workflow.canvas.tool.eraser")}
              keys={["E"]}
              pressed={ui.draw === "eraser"}
              onClick={() => setDraw("eraser")}
            >
              <Eraser />
            </HudButton>
            <span class="wfn-hud-separator" aria-hidden="true" />
            <ColorButtons
              options={translated(t, COLORS)}
              value={ui.ink}
              name={(label) => t("workflow.canvas.tool.inkColor", { name: label })}
              onPick={setInkColor}
            />
          </div>
        </Show>
        <Show when={ui.tool === "note"}>
          <div class="wfn-hud wfn-hud-sub" role="toolbar" aria-label={t("workflow.canvas.tool.note")}>
            <ColorButtons
              options={translated(t, TONES)}
              value={ui.note}
              name={(label) => t("workflow.canvas.tool.noteTone", { name: label })}
              onPick={setNoteTone}
            />
          </div>
        </Show>
        <Show when={ui.tool === "shape"}>
          <div class="wfn-hud wfn-hud-sub" role="toolbar" aria-label={t("workflow.canvas.tool.shapes")}>
            <DropdownMenu.Root placement="top" gutter={8} getAnchorRect={hudBarRect} modal={false}>
              <DropdownMenu.Trigger
                class={`${buttonVariants({ variant: "ghost", size: "sm" })} wfn-hud-button wfn-hud-fill`}
                aria-label={t("workflow.canvas.tool.fillNamed", {
                  name: t(COLORS.find((option) => option.value === ui.fill)?.label ?? "workflow.color.ink"),
                })}
              >
                <Swatch color={ui.fill} />
                <ChevronDown class="wfn-hud-chevron" aria-hidden="true" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <PickerMenu
                  label={t("workflow.canvas.tool.fill")}
                  groups={fillMenu(t)}
                  value={ui.fill}
                  onSelect={setFill}
                />
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            <span class="wfn-hud-separator" aria-hidden="true" />
            <For each={SHAPES}>
              {(option) => (
                <HudButton
                  label={t(option.label)}
                  pressed={ui.shape === option.value}
                  onClick={() => setShape(option.value)}
                >
                  <ShapeIcon shape={option.value} />
                </HudButton>
              )}
            </For>
          </div>
        </Show>
        <Show when={props.versionPreview}>
          {(open) => (
            <WorkflowVersionBar
              at={versionList().find((version) => version.id === open().versionId)?.label ?? ""}
              onBack={closeVersion}
              onMakeCurrent={makeCurrent}
            />
          )}
        </Show>
        <div
          class="wfn-hud wfn-hud-tools"
          role="toolbar"
          aria-label={t("workflow.canvas.tool.label")}
          hidden={frozen()}
        >
          <HudButton
            label={t("workflow.canvas.tool.select")}
            keys={["V"]}
            pressed={ui.tool === "select"}
            onClick={() => setTool("select")}
          >
            <MousePointer2 class="wfn-hud-arrow" />
          </HudButton>
          <HudButton
            label={t("workflow.canvas.tool.pan")}
            keys={["H"]}
            pressed={ui.tool === "pan"}
            onClick={() => setTool("pan")}
          >
            <Hand />
          </HudButton>
          <span class="wfn-hud-separator" aria-hidden="true" />
          <HudButton
            label={t("workflow.canvas.tool.draw")}
            keys={["P"]}
            art="draw"
            pressed={ui.tool === "draw"}
            onClick={() => setTool("draw")}
          >
            <DrawArt color={ui.ink} eraser={ui.draw === "eraser"} />
          </HudButton>
          <Show when={allows("note")}>
            <HudButton
              label={t("workflow.canvas.tool.note")}
              keys={["N"]}
              art="note"
              pressed={ui.tool === "note"}
              onClick={() => setTool("note")}
            >
              <StickyArt tone={ui.note} />
            </HudButton>
          </Show>
          <Show when={allows("shape")}>
            <HudButton
              label={t("workflow.canvas.tool.shapes")}
              keys={["R"]}
              art="shape"
              pressed={ui.tool === "shape"}
              onClick={() => setTool("shape")}
            >
              <ShapesArt shape={ui.shape} color={ui.fill} />
            </HudButton>
          </Show>
          <Show when={allows("text")}>
            <HudButton label={t("workflow.canvas.tool.text")} onClick={() => addNode("text")}>
              <Type />
            </HudButton>
          </Show>
          <span class="wfn-hud-separator" aria-hidden="true" />
          <HudButton
            label={t("workflow.canvas.action.search")}
            keys={[MOD_KEY, "F"]}
            pressed={ui.search}
            onClick={() => (ui.search ? closeSearch() : openSearch())}
          >
            <Search />
          </HudButton>
          <WorkflowAddMenu allowed={props.features.kinds} getAnchorRect={hudBarRect} onAdd={(kind) => addNode(kind)} />
        </div>

        <Show when={ui.search}>
          <WorkflowSearch
            query={query()}
            matches={matches()}
            onQuery={setQuery}
            onShow={showNode}
            onClose={closeSearch}
          />
        </Show>

        <WorkflowDropMenu
          open={drop() !== undefined}
          at={dropAt}
          connected={dropConnected()}
          query={dropQuery()}
          groups={dropGroups()}
          onQuery={setDropQuery}
          onPick={pickDrop}
          onClose={closeDrop}
          onHeight={setDropHeight}
        />

        <Show when={minimap()}>
          {(map) => <WorkflowMinimap map={map()} selected={board.selected()} onPan={panMinimap} />}
        </Show>

        <WorkflowZoomMenu
          scale={camera.scale}
          minScale={MIN_SCALE}
          maxScale={MAX_SCALE}
          minimap={ui.minimap}
          onZoom={(action) => {
            if (action === "in") zoomBy(ZOOM_STEP);
            else if (action === "out") zoomBy(1 / ZOOM_STEP);
            else if (action === "reset") zoomTo(1);
            else fitView(true);
          }}
          onZoomTo={zoomTo}
          onToggleMinimap={() =>
            setUi((draft) => {
              draft.minimap = !draft.minimap;
            })
          }
        />

        <Show when={ui.hidden}>
          <Button variant="secondary" size="sm" class="wfn-hud-show" onClick={toggleHud}>
            <Eye aria-hidden="true" />
            {t("workflow.canvas.hud.show")}
          </Button>
        </Show>
      </main>
    </BoardProvider>
  );
}
