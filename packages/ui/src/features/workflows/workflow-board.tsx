/**
 * The board under the workflow nodes: selection, connections and run status. Each port registers
 * its element, and the board measures the ports to draw a connection from an output to an input of
 * the same type. Drag between an output and an input in either direction, or press one and then the other.
 */

import type { RoutineSchedule, StoredFileRow } from "@openbot/contracts/ipc";
import type { AppTextKey, AppTranslate } from "@openbot/i18n";
import { Button, Kbd, LabelTooltip, Repeat, X } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import {
  createContext,
  createProjection,
  createSignal,
  createStore,
  For,
  onSettled,
  Show,
  untrack,
  useContext,
} from "solid-js";
import { useText } from "../../text";
import { prefersReducedMotion } from "../../utils";
import { diagramEdgeMidpoint, diagramEdgePath } from "../diagrams/diagram-graph";
import type { Box } from "./workflow-ink";
import type { WorkflowLoop } from "./workflow-loops";
import type { WorkflowCatalogs, WorkflowFeatures } from "./workflow-model";

export type WfnPortType = "text" | "image" | "file";
export type WfnPortSide = "in" | "out";
/** "approval" means the step waits for the user to approve it; "failed" means the step stopped with an error. */
export type WfnRunStatus = "waiting" | "running" | "done" | "failed" | "approval";
export type WfnEdgeTone = "idle" | "run" | "done";
/** A value that a node keeps on the board: a text, a choice or a switch. */
export type WfnFieldValue = string | number | boolean;
export type WfnFields = Record<string, WfnFieldValue>;

export interface WfnPoint {
  x: number;
  y: number;
}

/** A size the user set. A missing side keeps the default size of the node. */
export interface WfnSize {
  width?: number;
  height?: number;
  /** The font size of a text node that the user scaled, in world pixels. */
  font?: number;
}

/**
 * How a node resizes. "x": only its width changes, from each side and corner. "xy": its width and
 * height change. "text": a corner scales the text and a side sets where the text wraps.
 */
export type WfnStretch = "x" | "xy" | "text";

/** A resize handle: a corner, or a side of the card. The opposite corner or side stays in place. */
export type WfnHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/** The handles of a node. A side that cannot change size has none. */
export function resizeHandles(stretch: WfnStretch): readonly WfnHandle[] {
  return stretch === "xy" ? ["nw", "n", "ne", "e", "se", "s", "sw", "w"] : ["nw", "ne", "e", "se", "sw", "w"];
}

/** The cursor of a handle: a diagonal on a corner that changes both sides, else the axis that changes. */
export function resizeCursor(stretch: WfnStretch, handle: WfnHandle): "ew" | "ns" | "nwse" | "nesw" {
  if (handle === "e" || handle === "w") return "ew";
  if (handle === "n" || handle === "s") return "ns";
  if (stretch === "x") return "ew";
  return handle === "nw" || handle === "se" ? "nwse" : "nesw";
}

/** One result of a step, from a run of the whole workflow or from a run of the step alone. */
export interface WfnResult {
  id: string;
  /** The number of the workflow run that made it. A run of the step alone has none. */
  run?: number;
  /** When the step made it, as an ISO time. */
  at: string;
  /** The text, or the file name of an image. A failed run keeps why it stopped. */
  value: string;
  /** The run stopped with an error, so the step made no result. */
  failed?: boolean;
}

/** The result that a step made, or nothing when the run failed. */
export const resultValue = (result: WfnResult | undefined) => (result?.failed ? undefined : result?.value);

export interface WfnEdge {
  id: string;
  from: string;
  to: string;
  type: WfnPortType;
  /** The branch output of a condition that the edge leaves from, as "yes" or "no". */
  branch?: string;
}

/** The name of a port type, as its chip shows it. */
export const PORT_NAME = {
  text: "workflow.board.port.text",
  image: "workflow.board.port.image",
  file: "workflow.board.port.file",
} as const satisfies Record<WfnPortType, AppTextKey>;

/** The name of a port type inside a sentence. */
const PORT_WORD = {
  text: "workflow.board.portWord.text",
  image: "workflow.board.portWord.image",
  file: "workflow.board.portWord.file",
} as const satisfies Record<WfnPortType, AppTextKey>;

/** What the board asks for after the user presses a port of one side: a port of the other side. */
const CHOOSE_PORT = {
  out: {
    text: "workflow.board.live.chooseTextInput",
    image: "workflow.board.live.chooseImageInput",
    file: "workflow.board.live.chooseFileInput",
  },
  in: {
    text: "workflow.board.live.chooseTextOutput",
    image: "workflow.board.live.chooseImageOutput",
    file: "workflow.board.live.chooseFileOutput",
  },
} as const satisfies Record<WfnPortSide, Record<WfnPortType, AppTextKey>>;

/** The name of a condition branch, as a connection from it shows it. */
export const BRANCH_NAME = {
  yes: "workflow.board.branch.yes",
  no: "workflow.board.branch.no",
} as const satisfies Record<string, AppTextKey>;

/** The name of a branch. A branch that is not yes or no shows its value. */
export function branchName(t: AppTranslate, branch: string): string {
  return branch === "yes" || branch === "no" ? t(BRANCH_NAME[branch]) : branch;
}

interface PortEntry {
  node: string;
  side: WfnPortSide;
  type: WfnPortType;
  /** One of several outputs of the same type, as the branches of a condition. */
  branch?: string | undefined;
  element: HTMLElement;
}

/** One port. An open connection starts from one, an output or an input. */
export interface PortRef {
  node: string;
  side: WfnPortSide;
  type: WfnPortType;
  branch?: string | undefined;
}

/** What is under the pointer while a connection is dragged: a port, and why it cannot take the line. */
interface DropTarget {
  port: PortRef | null;
  reason: string | null;
}

interface PortPoint {
  /** From the top-left corner of the node, so a moved node needs no new measurement. */
  node: WfnPoint;
  /** From the top-left corner of the world. */
  world: WfnPoint;
}

/** What undo restores on the board. The canvas keeps the nodes, their positions and their sizes. */
export interface BoardSnapshot {
  edges: WfnEdge[];
  removed: string[];
  locked: string[];
  selection: string[];
  fields: Record<string, WfnFields>;
}

export interface WfnBoard {
  /** The selected node when exactly one is selected. A node shows its toolbar only then. */
  selected: () => string | null;
  /** Whether a node is in the selection, alone or with others. */
  isSelected: (id: string) => boolean;
  isRemoved: (id: string) => boolean;
  remove: (id: string) => void;
  /** Shows the nodes in red, with their connections, while a Delete control points at them. */
  aimRemove: (ids: readonly string[]) => void;
  /** Whether a Delete control points at the node, so a press removes it. */
  isDoomed: (id: string) => boolean;
  /** A locked node does not move, resize or delete. */
  isLocked: (id: string) => boolean;
  lock: (id: string, locked: boolean) => void;
  lockedCount: () => number;
  unlockAll: () => void;
  /** The text or style that the user set on a node. Copy, paste and undo keep it. */
  field: (id: string, key: string) => WfnFieldValue | undefined;
  /** Sets a field as one change. Each key stroke of one burst of typing joins the same change. */
  setField: (id: string, key: string, value: WfnFieldValue, typing?: boolean) => void;
  /** Sets several fields as one change, such as the connection and the place of a channel. */
  setFields: (id: string, values: WfnFields) => void;
  /** Copies a node. Only the canvas has it. */
  duplicate?: ((id: string) => void) | undefined;
  status: (id: string) => WfnRunStatus | undefined;
  /** Why a failed step stopped. */
  error: (id: string) => string | undefined;
  /** Runs a failed step again. Without it, a failed step shows no Retry. */
  retry?: ((id: string) => void) | undefined;
  /** The agents, models, places and files that the nodes offer. */
  catalogs: () => WorkflowCatalogs;
  /** The node kinds, triggers and outputs that the host runs. Without it, the nodes offer all of them. */
  features: () => WorkflowFeatures | undefined;
  /** Runs the workflow from one trigger. Only the canvas has it; elsewhere a trigger runs by itself. */
  runFrom?: ((id: string) => void) | undefined;
  /** The schedule of a trigger node. The canvas keeps it with the node, not in the fields. */
  schedule: (id: string) => RoutineSchedule | undefined;
  /** Changes the schedule of a trigger node. The changes until `endScheduleEdit` are one undo step. */
  setSchedule: (id: string, schedule: RoutineSchedule) => void;
  endScheduleEdit: () => void;
  /** Makes a new signing secret for a webhook trigger, and gives it. Without it, a trigger offers no secret. */
  rotateWebhookSecret?: ((id: string) => Promise<string>) | undefined;
  /**
   * Runs one step alone, with the inputs that it has now. The step shows the run states, and the host
   * records its result. A step does not run alone while a workflow run is active.
   */
  runStep: (id: string) => void;
  /** Stops a step that runs alone. The step keeps the result that it had before the run. */
  stopStep?: ((id: string) => void) | undefined;
  /** Whether a workflow run is active, so a trigger cannot start a second one. */
  running: () => boolean;
  /**
   * Whether the toolbar of a node goes under the node, because above it the toolbar covers another
   * node. `bar` is the size of the toolbar on the screen. Only the canvas moves it.
   */
  toolbarBelow: (id: string, bar: { width: number; height: number }) => boolean;
  /**
   * Tells the run what the user answered at an approval step. When the promise rejects, the answer did
   * not get to the run, and the step asks again.
   */
  decide: (id: string, approved: boolean) => void | Promise<unknown>;
  /** The id of the newest step of a node, so the approval of a new run asks again. */
  step: (id: string) => string | undefined;
  /** The files that the user added from the computer while the board is open, newest first. */
  uploads: () => readonly StoredFileRow[];
  /** Adds a file from the computer to the files of the board. An image shows its own preview. */
  upload: (file: File) => StoredFileRow;
  /** Whether the nodes show a resize handle. Only the canvas resizes them. */
  resizable: boolean;
  size: (id: string) => WfnSize | undefined;
  stretch: (id: string) => WfnStretch;
  /** Gives a node its default size again. Only the canvas has it. */
  resetSize?: ((id: string) => void) | undefined;
  /** Every result of a step, oldest first. */
  results: (id: string) => readonly WfnResult[];
  /** The result that the step picked, else its result from the run on view, else its latest. */
  shown: (id: string) => WfnResult | undefined;
  pick: (id: string, result: string) => void;
  /** Adds a result and shows it. */
  record: (id: string, value: string, run?: number) => void;
  /** Adds a failed run to the results, with why it stopped, and shows it. */
  recordFailure: (id: string, message: string, run?: number) => void;
  /** The workflow run on view, or null for the latest results. */
  viewing: () => number | null;
  view: (run: number | null) => void;
  connected: (node: string, side: WfnPortSide, type: WfnPortType, branch?: string) => boolean;
  armed: (node: string, side: WfnPortSide, type: WfnPortType, branch?: string) => boolean;
  /** While a connection is open: whether this port can take it. */
  accepts: (node: string, side: WfnPortSide, type: WfnPortType, branch?: string) => boolean;
  /** While a connection is dragged over this port: whether the port cannot take it. */
  refused: (node: string, side: WfnPortSide, type: WfnPortType, branch?: string) => boolean;
  connecting: () => boolean;
  /** Registers a port element; the return value removes it. */
  port: (entry: PortEntry) => () => void;
  pressPort: (node: string, side: WfnPortSide, type: WfnPortType, branch?: string) => void;
  dragPort: (node: string, side: WfnPortSide, type: WfnPortType, event: PointerEvent, branch?: string) => void;
}

const BoardContext = createContext<WfnBoard>();

export function useBoard(): WfnBoard {
  const board = useContext(BoardContext);
  if (!board) throw new Error("A workflow node must be inside a board.");
  return board;
}

export function BoardProvider(props: { board: WfnBoard; children: JSX.Element }) {
  return <BoardContext value={props.board}>{props.children}</BoardContext>;
}

export interface BoardOptions {
  /** The agents, models, places and files that the nodes offer. The host reads them. */
  catalogs: () => WorkflowCatalogs;
  selected?: string | undefined;
  edges?: readonly WfnEdge[] | undefined;
  /** The world scale. The canvas zooms; the gallery does not. */
  scale?: () => number;
  /** The position of a node in the world. Without it, the board measures where the node is. */
  origin?: (id: string) => WfnPoint | undefined;
  /** The box of a node in the world. A loop goes under the boxes of the nodes it runs again. */
  box?: (id: string) => Box | undefined;
  /** The connections that go back to an earlier node, by connection ID. */
  loops?: () => ReadonlyMap<string, WorkflowLoop>;
  status?: (id: string) => WfnRunStatus | undefined;
  error?: (id: string) => string | undefined;
  retry?: (id: string) => void;
  runFrom?: (id: string) => void;
  schedule?: (id: string) => RoutineSchedule | undefined;
  setSchedule?: (id: string, schedule: RoutineSchedule) => void;
  endScheduleEdit?: () => void;
  rotateWebhookSecret?: ((id: string) => Promise<string>) | undefined;
  runStep?: (id: string) => void;
  stopStep?: (id: string) => void;
  running?: () => boolean;
  toolbarBelow?: (id: string, bar: { width: number; height: number }) => boolean;
  decide?: (id: string, approved: boolean) => void | Promise<unknown>;
  step?: (id: string) => string | undefined;
  /** The nodes that are locked when the story opens. */
  locked?: readonly string[] | undefined;
  /** The size the user set on a node. With it, the nodes show a resize handle. */
  size?: (id: string) => WfnSize | undefined;
  /** How each node resizes. Without it, a node changes only its width. */
  stretch?: (id: string) => WfnStretch;
  resetSize?: (id: string) => void;
  edgeTone?: (edge: WfnEdge) => WfnEdgeTone;
  /** The results that the steps have before the story opens. */
  results?: Record<string, readonly WfnResult[]> | undefined;
  /**
   * The results of each step from the host. With it, the board shows these results, not the ones that
   * `record` and `recordFailure` add.
   */
  resultsOf?: (id: string) => readonly WfnResult[];
  /** The fields of the nodes when the board opens, such as the fields of a saved graph. */
  fields?: Record<string, WfnFields> | undefined;
  features?: () => WorkflowFeatures | undefined;
  duplicate?: (id: string) => void;
  /**
   * A connection dropped on the empty canvas. When it returns true, the line stays drawn to the drop
   * point until the canvas calls `attach` or `cancelDraft`.
   */
  release?: (start: PortRef, at: WfnPoint, event: PointerEvent) => boolean;
  /** Called before each change that undo can restore: a connection, a removal or a lock. */
  beforeChange?: () => void;
  /** False while no node can be deleted, such as when a version shows or the canvas is read-only. */
  canChange?: () => boolean;
  /** The element that holds the board and its controls. Delete acts only when the focus is in it or on the page. */
  root?: () => Element | undefined;
  /**
   * The element that gets the focus after the user confirms a deletion, such as the next node. `from`
   * had the focus when the user asked to delete.
   */
  focusAfterRemove?: (ids: readonly string[], from: Element | null) => HTMLElement | undefined;
}

interface BoardState {
  selection: string[];
  removed: string[];
  locked: string[];
  edges: WfnEdge[];
  fields: Record<string, WfnFields>;
  pending: PortRef | null;
  draft: WfnPoint | null;
  target: DropTarget | null;
  edge: string | null;
  /** The connection under the pointer, which shows its remove button. */
  hover: string | null;
  /** Where the remove button sits: the point of the line nearest to the pointer. */
  hoverAt: { edge: string; at: WfnPoint } | null;
  /** The connection whose remove button is under the pointer. Its line turns red. */
  removing: string | null;
  points: Record<string, PortPoint>;
  message: string;
  results: Record<string, WfnResult[]>;
  /** A result that the user picked in one step. It stays until the run on view changes. */
  picked: Record<string, string>;
  viewing: number | null;
}

const DRAG_THRESHOLD = 4;
/**
 * The remove button of a connection keeps clear of the port at each end of the line: half a port, in
 * world units, plus half the button and a gap, in screen pixels.
 */
const EDGE_END_CLEARANCE = { port: 14, button: 16 };
/** How far a loop goes under the lowest node it runs again, and how wide it turns at each end. */
const LOOP_DROP = 56;
const LOOP_BEND = 48;

/** A loop: out of its port to the right, down and back under its nodes, then into the earlier node's port. */
function loopPath(from: WfnPoint, to: WfnPoint, y: number): string {
  const out = from.x + LOOP_BEND;
  const back = to.x - LOOP_BEND;
  return `M ${from.x} ${from.y} C ${out} ${from.y}, ${out} ${y}, ${from.x} ${y} L ${to.x} ${y} C ${back} ${y}, ${back} ${to.y}, ${to.x} ${to.y}`;
}

/**
 * The point of a path nearest to a world point. A coarse pass finds the nearest of 32 samples, then
 * a search in halving steps refines it. The result stays `clearance` from each end of the path.
 */
function nearestOnPath(path: SVGPathElement, to: WfnPoint, clearance: number): WfnPoint {
  const length = path.getTotalLength();
  const start = Math.min(clearance, length / 2);
  const end = Math.max(length - clearance, length / 2);
  const sample = (at: number) => {
    const point = path.getPointAtLength(at);
    return { at, point, distance: (point.x - to.x) ** 2 + (point.y - to.y) ** 2 };
  };
  const step = (end - start) / 32;
  let best = sample(start);
  for (let index = 1; index <= 32; index++) {
    const next = sample(start + step * index);
    if (next.distance < best.distance) best = next;
  }
  for (let span = step / 2; span > 0.25; span /= 2) {
    const before = sample(Math.max(start, best.at - span));
    const after = sample(Math.min(end, best.at + span));
    if (before.distance < best.distance) best = before;
    if (after.distance < best.distance) best = after;
  }
  return { x: best.point.x, y: best.point.y };
}

const portKey = (node: string, side: WfnPortSide, type: WfnPortType, branch?: string) =>
  `${node}:${side}:${type}${branch ? `:${branch}` : ""}`;

function nodeName(element: Element | null | undefined, fallback: string): string {
  return element?.closest("[data-node-id]")?.getAttribute("aria-label") ?? fallback;
}

/** The modifier key name for shortcuts: ⌘ on a Mac, Ctrl elsewhere. */
export const MOD_KEY = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl";

/**
 * The tooltip of a canvas control: its name, and its shortcut keys when it has one. It has a 1px
 * ring and no shadow. Put one `LabelTooltipTrigger` inside.
 */
export function Hint(props: {
  label: string;
  keys?: readonly string[] | undefined;
  placement?: "top" | "bottom" | "left" | "right";
  children: JSX.Element;
}) {
  return (
    <LabelTooltip
      class="wfn-tooltip"
      placement={props.placement ?? "top"}
      content={
        <span class="wfn-hint">
          {props.label}
          <Show when={props.keys?.length}>
            <span class="wfn-keys">
              <For each={props.keys}>{(key) => <Kbd>{key}</Kbd>}</For>
            </span>
          </Show>
        </span>
      }
    >
      {props.children}
    </LabelTooltip>
  );
}

function copyFields(fields: Record<string, WfnFields>): Record<string, WfnFields> {
  return Object.fromEntries(Object.entries(fields).map(([id, entry]) => [id, { ...entry }]));
}

export function isEditable(element: Element | null): boolean {
  return (
    element instanceof HTMLElement && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName))
  );
}

/**
 * A store with a key for each id of a list. A node that reads its own key runs again only when its id
 * joins or leaves the list, not on each change of the list.
 */
function createMembership(ids: () => readonly string[]) {
  return createProjection<Record<string, true>>((draft) => {
    const next = new Set(ids());
    for (const id of Object.keys(draft)) if (!next.has(id)) delete draft[id];
    for (const id of next) draft[id] = true;
  }, {});
}

/** The roles of controls that use letter, arrow and Delete keys themselves. */
const KEYED_CONTROL = "[role=combobox], [role=listbox], [role^=menu], [role=option]";

/** True when the focus is in a control that uses keys itself, such as a menu or a list box. */
export function takesKeys(element: Element | null): boolean {
  return element?.closest(KEYED_CONTROL) != null;
}

/**
 * True when a key is for the canvas: the focus is in `root`, in a menu of the canvas, or on the page.
 * A key in another part of the app, such as the sidebar or a dialog, is not.
 */
export function inCanvas(root: Element | undefined, element: Element | null): boolean {
  return (
    element === null ||
    element === document.body ||
    root?.contains(element) === true ||
    element.closest("[data-wfn-portal]") !== null
  );
}

export function createBoard(options: BoardOptions) {
  const { t } = useText();
  const nameOf = (element: Element | null | undefined) => nodeName(element, t("workflow.board.stepFallback"));
  const [state, setState] = createStore<BoardState>({
    selection: untrack(() => (options.selected ? [options.selected] : [])),
    removed: [],
    locked: untrack(() => [...(options.locked ?? [])]),
    edges: untrack(() => [...(options.edges ?? [])]),
    fields: untrack(() => copyFields(options.fields ?? {})),
    pending: null,
    draft: null,
    target: null,
    edge: null,
    hover: null,
    hoverAt: null,
    removing: null,
    points: {},
    message: "",
    results: untrack(() =>
      Object.fromEntries(Object.entries(options.results ?? {}).map(([id, list]) => [id, [...list]])),
    ),
    picked: {},
    viewing: null,
  });
  /** The field that the user types in now. Each other change ends the typing burst. */
  let typing: string | null = null;
  const ports = new Map<string, PortEntry>();
  let world: HTMLElement | undefined;
  let frame = 0;
  let suppressPress = false;
  /** Ends the connection that the pointer drags now, with no change. */
  let stopDrag: (() => void) | undefined;
  const resize = new ResizeObserver(() => schedule());

  const measure = () => {
    frame = 0;
    if (!world) return;
    const origin = world.getBoundingClientRect();
    const points: Record<string, PortPoint> = {};
    for (const [key, entry] of ports) {
      const nodeElement = entry.element.closest<HTMLElement>("[data-node-id]");
      if (!entry.element.isConnected || !nodeElement) continue;
      const box = nodeElement.getBoundingClientRect();
      // The rendered scale, so a zoom that is still moving does not skew the points.
      const scale = nodeElement.offsetWidth ? box.width / nodeElement.offsetWidth : 1;
      const rect = entry.element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      points[key] = {
        node: { x: (x - box.left) / scale, y: (y - box.top) / scale },
        world: { x: (x - origin.left) / scale, y: (y - origin.top) / scale },
      };
    }
    setState((draft) => {
      draft.points = points;
    });
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(measure);
  };

  const point = (node: string, side: WfnPortSide, type: WfnPortType, branch?: string): WfnPoint | undefined => {
    const measured = state.points[portKey(node, side, type, branch)];
    if (!measured) return undefined;
    const origin = options.origin?.(node);
    return origin ? { x: origin.x + measured.node.x, y: origin.y + measured.node.y } : measured.world;
  };

  const hasEdge = (from: string, to: string, type: WfnPortType, branch?: string) =>
    state.edges.some((edge) => edge.from === from && edge.to === to && edge.type === type && edge.branch === branch);

  /** Whether a path of edges already goes from one node to the other. */
  const reaches = (from: string, to: string) => {
    const seen = new Set<string>();
    const next = [from];
    for (let node = next.pop(); node !== undefined; node = next.pop()) {
      if (node === to) return true;
      if (seen.has(node)) continue;
      seen.add(node);
      for (const edge of state.edges) if (edge.from === node) next.push(edge.to);
    }
    return false;
  };

  const samePort = (a: PortRef, b: PortRef) =>
    a.node === b.node && a.side === b.side && a.type === b.type && a.branch === b.branch;

  /** The two ends of a connection from one port to another, the output first. */
  const orient = (start: PortRef, end: PortRef): [PortRef, PortRef] =>
    start.side === "out" ? [start, end] : [end, start];

  /**
   * Why a connection from one port cannot end on another, or null when it can. A connection back to an
   * earlier node is a loop, which the run takes as its next pass.
   */
  const refusal = (start: PortRef, end: PortRef): string | null => {
    if (end.side === start.side) return t("workflow.board.refusal.side");
    if (end.node === start.node) return t("workflow.board.refusal.self");
    if (end.type !== start.type) {
      const types = { type: t(PORT_WORD[end.type]), other: t(PORT_WORD[start.type]) };
      return end.side === "in" ? t("workflow.board.refusal.takes", types) : t("workflow.board.refusal.gives", types);
    }
    const [from, to] = orient(start, end);
    if (hasEdge(from.node, to.node, from.type, from.branch)) return t("workflow.board.refusal.connected");
    return null;
  };

  const accepts = (port: PortRef) => {
    const pending = state.pending;
    return pending !== null && !samePort(pending, port) && refusal(pending, port) === null;
  };

  const refOf = (entry: PortEntry): PortRef => ({
    node: entry.node,
    side: entry.side,
    type: entry.type,
    branch: entry.branch,
  });

  /**
   * The port under the pointer. On the body of a node, the one port of the other side and the same
   * type; a node with two such ports, as the branches of a condition, waits for the user to pick one.
   */
  const dropTarget = (start: PortRef, x: number, y: number): DropTarget | null => {
    const element = document.elementFromPoint(x, y);
    const portElement = element?.closest(".wfn-port");
    if (portElement) {
      const entry = [...ports.values()].find((port) => port.element.contains(portElement));
      if (!entry || samePort(start, refOf(entry))) return null;
      return { port: refOf(entry), reason: refusal(start, refOf(entry)) };
    }
    const node = element?.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
    if (!node || node === start.node) return null;
    const side = start.side === "out" ? "in" : "out";
    const matches = [...ports.values()].filter(
      (port) => port.node === node && port.side === side && port.type === start.type,
    );
    const [only] = matches;
    if (matches.length > 1) return null;
    if (only) return { port: refOf(only), reason: refusal(start, refOf(only)) };
    const type = { type: t(PORT_WORD[start.type]) };
    return {
      port: null,
      reason: side === "in" ? t("workflow.board.refusal.noInput", type) : t("workflow.board.refusal.noOutput", type),
    };
  };

  const connect = (from: string, to: string, type: WfnPortType, branch?: string) => {
    if (from === to || hasEdge(from, to, type, branch)) return;
    const loop = reaches(to, from);
    options.beforeChange?.();
    const fromName = nameOf(ports.get(portKey(from, "out", type, branch))?.element);
    const toName = nameOf(ports.get(portKey(to, "in", type))?.element);
    const edge: WfnEdge = { id: `${from}${branch ? `.${branch}` : ""}>${to}:${type}`, from, to, type };
    if (branch) edge.branch = branch;
    setState((draft) => {
      draft.edges.push(edge);
      draft.pending = null;
      draft.message = t(loop ? "workflow.board.live.connectedLoop" : "workflow.board.live.connected", {
        from: fromName,
        to: toName,
      });
    });
  };

  const link = (start: PortRef, end: PortRef) => {
    const [from, to] = orient(start, end);
    connect(from.node, to.node, from.type, from.branch);
  };

  const cancelDraft = () => {
    setState((draft) => {
      draft.pending = null;
      draft.draft = null;
      draft.target = null;
    });
  };

  /** Connects an open connection to a node that the canvas added at its drop point. */
  const attach = (start: PortRef, node: string) => {
    if (start.side === "out") connect(start.node, node, start.type, start.branch);
    else connect(node, start.node, start.type);
    cancelDraft();
  };

  const disconnect = (id: string) => {
    options.beforeChange?.();
    setState((draft) => {
      draft.edges = draft.edges.filter((edge) => edge.id !== id);
      draft.edge = null;
      draft.hover = null;
      draft.removing = null;
      draft.message = t("workflow.board.live.disconnected");
    });
  };

  const toWorld = (event: { clientX: number; clientY: number }): WfnPoint => {
    const origin = world?.getBoundingClientRect();
    const scale = options.scale?.() ?? 1;
    return { x: (event.clientX - (origin?.left ?? 0)) / scale, y: (event.clientY - (origin?.top ?? 0)) / scale };
  };

  /** Removes the nodes that are not locked, and their connections, as one change. */
  const removeAll = (ids: readonly string[]) => {
    const gone = ids.filter((id) => !state.locked.includes(id) && !state.removed.includes(id));
    if (gone.length === 0) return;
    options.beforeChange?.();
    const name = nameOf(world?.querySelector(`[data-node-id="${gone[0]}"]`));
    setState((draft) => {
      draft.removed.push(...gone);
      draft.edges = draft.edges.filter((edge) => !gone.includes(edge.from) && !gone.includes(edge.to));
      draft.selection = draft.selection.filter((id) => !gone.includes(id));
      if (draft.pending && gone.includes(draft.pending.node)) draft.pending = null;
      draft.message =
        gone.length === 1
          ? t("workflow.board.live.deleted", { name })
          : t("workflow.board.live.deletedMany", { count: gone.length });
    });
    schedule();
  };

  const [aiming, setAiming] = createSignal<readonly string[]>([]);
  const isDoomed = (id: string) => aiming().includes(id);

  /**
   * Deletes the nodes that are not locked at once, with no confirmation: undo brings them back. A
   * node deleted from the keyboard gives the focus to the next node.
   */
  const deleteNodes = (ids: readonly string[]) => {
    if (options.canChange?.() === false) return;
    const gone = ids.filter((id) => !state.locked.includes(id) && !state.removed.includes(id));
    if (gone.length === 0) return;
    const next = options.focusAfterRemove?.(gone, document.activeElement);
    setAiming([]);
    removeAll(gone);
    next?.focus();
  };

  /** Locks or unlocks nodes as one change. */
  const lockAll = (ids: readonly string[], locked: boolean) => {
    options.beforeChange?.();
    setState((draft) => {
      const rest = draft.locked.filter((entry) => !ids.includes(entry));
      draft.locked = locked ? [...rest, ...ids] : rest;
    });
  };

  /** Adds a result of a step and shows it. */
  const add = (id: string, value: string, run: number | undefined, failed: boolean) => {
    const result: WfnResult = { id: crypto.randomUUID(), at: new Date().toISOString(), value };
    if (run !== undefined) result.run = run;
    if (failed) result.failed = true;
    setState((draft) => {
      draft.results[id] = [...(draft.results[id] ?? []), result];
      draft.picked[id] = result.id;
    });
  };

  /** Files from the computer. Their previews are blob addresses, which the board frees when it closes. */
  const [uploads, setUploads] = createSignal<readonly StoredFileRow[]>([]);
  const upload = (file: File): StoredFileRow => {
    const image = file.type.startsWith("image/");
    const row: StoredFileRow = {
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      kind: image ? "image" : "file",
      mimeType: file.type || "application/octet-stream",
      previewKind: image ? "image" : file.type === "application/pdf" ? "pdf" : "none",
      previewUrl: image ? URL.createObjectURL(file) : null,
      source: "workspace",
      agentId: null,
      conversation: null,
      messageId: null,
      createdAt: new Date().toISOString(),
      status: "available",
      deletable: false,
    };
    setUploads((list) => [row, ...list]);
    return row;
  };

  const resultsOf = (id: string): readonly WfnResult[] => options.resultsOf?.(id) ?? state.results[id] ?? [];
  const selectedIds = createMembership(() => state.selection);
  const removedIds = createMembership(() => state.removed);
  const lockedIds = createMembership(() => state.locked);

  const board: WfnBoard = {
    selected: () => (state.selection.length === 1 ? (state.selection[0] ?? null) : null),
    isSelected: (id) => selectedIds[id] === true,
    isRemoved: (id) => removedIds[id] === true,
    remove: (id) => deleteNodes([id]),
    aimRemove: setAiming,
    isDoomed,
    isLocked: (id) => lockedIds[id] === true,
    lock: (id, locked) => lockAll([id], locked),
    lockedCount: () => state.locked.length,
    unlockAll: () => {
      if (state.locked.length > 0) lockAll(state.locked, false);
    },
    field: (id, key) => state.fields[id]?.[key],
    setField: (id, key, value, burst = false) => {
      if (state.fields[id]?.[key] === value) return;
      const edit = `${id}:${key}`;
      if (!burst || typing !== edit) options.beforeChange?.();
      typing = burst ? edit : null;
      setState((draft) => {
        draft.fields[id] = { ...draft.fields[id], [key]: value };
      });
    },
    setFields: (id, values) => {
      const entry = state.fields[id];
      if (Object.entries(values).every(([key, value]) => entry?.[key] === value)) return;
      options.beforeChange?.();
      typing = null;
      setState((draft) => {
        draft.fields[id] = { ...draft.fields[id], ...values };
      });
    },
    duplicate: options.duplicate,
    catalogs: () => options.catalogs(),
    features: () => options.features?.(),
    status: (id) => options.status?.(id),
    error: (id) => options.error?.(id),
    retry: options.retry,
    runFrom: options.runFrom,
    schedule: (id) => options.schedule?.(id),
    setSchedule: (id, schedule) => options.setSchedule?.(id, schedule),
    endScheduleEdit: () => options.endScheduleEdit?.(),
    rotateWebhookSecret: options.rotateWebhookSecret,
    runStep: (id) => options.runStep?.(id),
    stopStep: options.stopStep,
    running: () => options.running?.() ?? false,
    toolbarBelow: (id, bar) => options.toolbarBelow?.(id, bar) ?? false,
    decide: (id, approved) => options.decide?.(id, approved),
    step: (id) => options.step?.(id),
    uploads,
    upload,
    resizable: options.size !== undefined,
    size: (id) => options.size?.(id),
    stretch: (id) => options.stretch?.(id) ?? "x",
    resetSize: options.resetSize,
    results: (id) => resultsOf(id),
    shown: (id) => {
      const list = resultsOf(id);
      const picked = state.picked[id];
      if (picked) return list.find((result) => result.id === picked);
      const viewing = state.viewing;
      // A retried run has its failure first and its result after it.
      if (viewing !== null) return list.findLast((result) => result.run === viewing);
      return list.at(-1);
    },
    pick: (id, result) =>
      setState((draft) => {
        draft.picked[id] = result;
      }),
    record: (id, value, run) => add(id, value, run, false),
    recordFailure: (id, message, run) => add(id, message, run, true),
    viewing: () => state.viewing,
    view: (run) =>
      setState((draft) => {
        draft.viewing = run;
        draft.picked = {};
      }),
    connected: (node, side, type, branch) =>
      state.edges.some(
        (edge) =>
          edge.type === type && (side === "out" ? edge.from === node && edge.branch === branch : edge.to === node),
      ),
    armed: (node, side, type, branch) =>
      state.pending !== null && samePort(state.pending, { node, side, type, branch }),
    accepts: (node, side, type, branch) => accepts({ node, side, type, branch }),
    refused: (node, side, type, branch) => {
      const target = state.target;
      return target?.port != null && target.reason !== null && samePort(target.port, { node, side, type, branch });
    },
    connecting: () => state.pending !== null,
    port: (entry) => {
      const key = portKey(entry.node, entry.side, entry.type, entry.branch);
      ports.set(key, entry);
      const nodeElement = entry.element.closest("[data-node-id]");
      if (nodeElement) resize.observe(nodeElement);
      schedule();
      return () => {
        if (ports.get(key) === entry) ports.delete(key);
        // The node stops being measured when its last port goes.
        if (nodeElement && ![...ports.values()].some((other) => other.node === entry.node))
          resize.unobserve(nodeElement);
        schedule();
      };
    },
    pressPort: (node, side, type, branch) => {
      if (suppressPress) return;
      const port: PortRef = { node, side, type, branch };
      const pending = state.pending;
      // With no open connection, or one from the same side, the press arms this port or disarms it.
      if (!pending || pending.side === side) {
        const wasArmed = pending !== null && samePort(pending, port);
        setState((draft) => {
          draft.pending = wasArmed ? null : port;
          draft.message = wasArmed ? "" : t(CHOOSE_PORT[side][type]);
        });
        return;
      }
      const reason = refusal(pending, port);
      if (reason === null) link(pending, port);
      else
        setState((draft) => {
          draft.message = t("workflow.board.live.refused", { reason });
        });
    },
    dragPort: (node, side, type, event, branch) => {
      if (event.button !== 0) return;
      const start = { x: event.clientX, y: event.clientY };
      const from: PortRef = { node, side, type, branch };
      let moved = false;
      const onMove = (move: PointerEvent) => {
        if (!moved && Math.hypot(move.clientX - start.x, move.clientY - start.y) < DRAG_THRESHOLD) return;
        moved = true;
        const target = dropTarget(from, move.clientX, move.clientY);
        setState((draft) => {
          draft.pending = from;
          draft.draft = toWorld(move);
          draft.target = target;
        });
      };
      const end = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        stopDrag = undefined;
      };
      const onUp = (up: PointerEvent) => {
        end();
        if (!moved) return;
        // The click that follows this pointer-up must not arm the port again.
        suppressPress = true;
        setTimeout(() => {
          suppressPress = false;
        });
        const target = dropTarget(from, up.clientX, up.clientY);
        if (target === null && options.release?.(from, toWorld(up), up)) {
          setState((draft) => {
            draft.draft = toWorld(up);
            draft.target = null;
          });
          return;
        }
        if (target?.port && target.reason === null) link(from, target.port);
        setState((draft) => {
          draft.pending = null;
          draft.draft = null;
          draft.target = null;
          if (target?.reason) draft.message = `${target.reason}.`;
        });
      };
      stopDrag?.();
      stopDrag = end;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
  };

  /**
   * Selects the node under a press, or clears the selection on the empty canvas. With `add`, as with
   * Shift held, a press adds the node to the selection or takes it out. A press on a node that is
   * already in a group keeps the group, so that the group can move together.
   */
  const selectFrom = (target: EventTarget | null, add = false) => {
    // Menus and popovers are portalled, but Solid still sends their events up the component tree. A port
    // connects and does not select: a selected node can show its missing-input warning, which moves the
    // port away from the pointer before the click.
    if (target instanceof Element && target.closest("[data-wfn-portal], .wfn-edge-actions, .wfn-port")) return;
    const element = target instanceof Element ? target.closest<HTMLElement>("[data-node-id]") : null;
    const node = element?.dataset.nodeId;
    const onEdge = target instanceof Element && target.closest(".wfn-edge-hit");
    setState((draft) => {
      if (node && add)
        draft.selection = draft.selection.includes(node)
          ? draft.selection.filter((id) => id !== node)
          : [...draft.selection, node];
      else if (node) draft.selection = draft.selection.includes(node) ? draft.selection : [node];
      else if (!add) draft.selection = [];
      if (!onEdge) draft.edge = null;
      if (!node && !onEdge) draft.pending = null;
    });
  };

  /** Selects these nodes, and no connection. */
  const select = (ids: readonly string[]) => {
    setState((draft) => {
      draft.selection = ids.filter((id) => !draft.removed.includes(id));
      draft.edge = null;
    });
  };

  /** Puts a node in the middle of a connection: the connection goes into the node and out again. */
  const splice = (id: string, node: string) => {
    const edge = state.edges.find((entry) => entry.id === id);
    if (!edge) return;
    options.beforeChange?.();
    const into: WfnEdge = {
      id: `${edge.from}${edge.branch ? `.${edge.branch}` : ""}>${node}:${edge.type}`,
      from: edge.from,
      to: node,
      type: edge.type,
    };
    if (edge.branch) into.branch = edge.branch;
    const out: WfnEdge = { id: `${node}>${edge.to}:${edge.type}`, from: node, to: edge.to, type: edge.type };
    setState((draft) => {
      draft.edges = [...draft.edges.filter((entry) => entry.id !== id), into, out];
      draft.edge = null;
      draft.hover = null;
      draft.message = t("workflow.board.live.inserted");
    });
  };

  /** Adds connections that a pasted group had between its own nodes. */
  const addEdges = (edges: readonly WfnEdge[]) => {
    const fresh = edges.filter((edge) => !hasEdge(edge.from, edge.to, edge.type, edge.branch));
    if (fresh.length === 0) return;
    setState((draft) => {
      draft.edges.push(...fresh);
    });
  };

  const snapshot = (): BoardSnapshot => ({
    edges: state.edges.map((edge) => ({ ...edge })),
    removed: [...state.removed],
    locked: [...state.locked],
    selection: [...state.selection],
    fields: copyFields(state.fields),
  });

  /**
   * Puts the board back as a snapshot has it, with the selection of that time. An open connection and a
   * selected connection close.
   */
  const restore = (saved: BoardSnapshot) => {
    typing = null;
    // A connection that the pointer drags would open again on the next move.
    stopDrag?.();
    setState((draft) => {
      draft.edges = saved.edges.map((edge) => ({ ...edge }));
      draft.removed = [...saved.removed];
      draft.locked = [...saved.locked];
      draft.selection = saved.selection.filter((id) => !saved.removed.includes(id));
      draft.fields = copyFields(saved.fields);
      draft.pending = null;
      draft.draft = null;
      draft.target = null;
      draft.edge = null;
      draft.hover = null;
    });
    schedule();
  };

  onSettled(() => {
    const onKey = (event: KeyboardEvent) => {
      const active = document.activeElement;
      if (options.root && !inCanvas(options.root(), active)) return;
      if (event.key === "Escape" && (state.pending || state.edge)) {
        setState((draft) => {
          draft.pending = null;
          draft.draft = null;
          draft.target = null;
          draft.edge = null;
        });
        return;
      }
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (isEditable(active) || takesKeys(active) || active?.closest("[data-wfn-portal]")) return;
      if (options.canChange?.() === false) return;
      const edge = state.edge;
      if (edge) {
        event.preventDefault();
        disconnect(edge);
      } else if (state.selection.length > 0) {
        event.preventDefault();
        deleteNodes(state.selection);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      stopDrag?.();
      resize.disconnect();
      cancelAnimationFrame(frame);
      for (const row of untrack(uploads)) if (row.previewUrl) URL.revokeObjectURL(row.previewUrl);
    };
  });

  const tone = (edge: WfnEdge) => options.edgeTone?.(edge) ?? "idle";

  let edgeLayer: SVGSVGElement | undefined;
  /**
   * Moves the remove button to the point of the line nearest to the pointer, so the button follows the
   * pointer along the line. The button keeps clear of the ports at the two ends.
   */
  const trackEdge = (id: string, event: PointerEvent) => {
    if (state.pending !== null) return;
    const path = edgeLayer?.querySelector<SVGPathElement>(`[data-edge-id="${CSS.escape(id)}"]`);
    if (!path) return;
    const clearance = EDGE_END_CLEARANCE.port + EDGE_END_CLEARANCE.button / (options.scale?.() ?? 1);
    const at = nearestOnPath(path, toWorld(event), clearance);
    setState((draft) => {
      draft.hover = id;
      draft.hoverAt = { edge: id, at };
    });
  };
  /** The pointer can go from the line to its button, and back, without the button closing. */
  const leaveEdge = (id: string, to: EventTarget | null) => {
    if (to instanceof Element && (to.closest(".wfn-edge-actions") || to.closest(`[data-edge-id="${id}"]`))) return;
    if (state.hover === id)
      setState((draft) => {
        draft.hover = null;
      });
  };
  /** Shows the connection in red while a Delete control points at it, or `null` to stop. */
  const aimDisconnect = (id: string | null) =>
    setState((draft) => {
      if (id !== null || draft.removing !== null) draft.removing = id;
    });
  const showsActions = (id: string) => state.edge === id || (state.hover === id && state.pending === null);
  const motion = !prefersReducedMotion();

  /** The line of a connection and the point where its controls sit. A loop goes back under its nodes. */
  const shapeOf = (edge: WfnEdge, from: WfnPoint, to: WfnPoint) => {
    const loop = options.loops?.().get(edge.id);
    if (!loop) return { path: diagramEdgePath(from, to), middle: diagramEdgeMidpoint(from, to), turn: undefined };
    const bottoms = loop.body.flatMap((id) => {
      const box = options.box?.(id);
      return box ? [box.y + box.height] : [];
    });
    const y = Math.max(from.y, to.y, ...bottoms) + LOOP_DROP;
    return {
      path: loopPath(from, to, y),
      middle: { x: (from.x + to.x) / 2, y },
      // The middle of the first bend, where the branch name of a loop goes.
      turn: { x: from.x + LOOP_BEND * 0.75, y: (from.y + y) / 2 },
    };
  };
  /** Whether the open connection would close a loop on the port under the pointer. */
  const draftLoops = () => {
    const pending = state.pending;
    const port = state.target?.reason === null ? state.target.port : null;
    if (!pending || !port) return false;
    const [from, to] = orient(pending, port);
    return reaches(to.node, from.node);
  };

  /** The connections, under the nodes. Put it first inside the world element. */
  function Edges() {
    const ends = (edge: WfnEdge) => {
      const from = point(edge.from, "out", edge.type, edge.branch);
      const to = point(edge.to, "in", edge.type);
      return from && to ? shapeOf(edge, from, to) : null;
    };
    /** The line follows the pointer, and snaps to a port that can take it. */
    const draftPath = () => {
      const pending = state.pending;
      const pointer = state.draft;
      const anchor = pending ? point(pending.node, pending.side, pending.type, pending.branch) : undefined;
      if (!pending || !anchor || !pointer) return null;
      const port = state.target?.reason === null ? state.target.port : null;
      const end = (port && point(port.node, port.side, port.type, port.branch)) ?? pointer;
      return pending.side === "out" ? diagramEdgePath(anchor, end) : diagramEdgePath(end, anchor);
    };
    const draftState = () => {
      const target = state.target;
      if (!target) return undefined;
      if (target.reason !== null) return "refused";
      return draftLoops() ? "loop" : "ok";
    };
    /** Next to the pointer: why the line cannot end here, or that it makes a loop. */
    const draftNote = () => {
      const reason = state.target?.reason;
      if (reason) return { text: reason, tone: "refused" };
      return draftLoops() ? { text: t("workflow.board.loop.makes"), tone: "loop" } : null;
    };
    return (
      <>
        <svg ref={edgeLayer} class="wfn-edges" aria-hidden="true">
          <For each={state.edges}>
            {(edge) => (
              <Show when={ends(edge)}>
                {(line) => (
                  <g
                    class="wfn-edge"
                    data-type={edge.type}
                    data-tone={tone(edge)}
                    data-selected={state.edge === edge.id ? "" : undefined}
                    data-removing={
                      state.removing === edge.id || isDoomed(edge.from) || isDoomed(edge.to) ? "" : undefined
                    }
                    data-motion={motion ? "" : undefined}
                  >
                    <path class="wfn-edge-line" d={line().path} />
                    <Show when={tone(edge) === "run"}>
                      <path class="wfn-edge-comet" d={line().path} pathLength="1" />
                    </Show>
                    <path
                      class="wfn-edge-hit"
                      data-edge-id={edge.id}
                      d={line().path}
                      onPointerDown={() =>
                        setState((draft) => {
                          draft.edge = edge.id;
                        })
                      }
                      onPointerMove={(event) => trackEdge(edge.id, event)}
                      onPointerLeave={(event) => leaveEdge(edge.id, event.relatedTarget)}
                    />
                  </g>
                )}
              </Show>
            )}
          </For>
          <Show when={draftPath()}>
            {(path) => <path class="wfn-edge-draft" data-state={draftState()} d={path()} />}
          </Show>
        </svg>
        <Show when={draftNote()}>
          {(note) => (
            <span
              class="wfn-draft-reason"
              data-tone={note().tone}
              aria-hidden="true"
              style={{ left: `${state.draft?.x ?? 0}px`, top: `${state.draft?.y ?? 0}px` }}
            >
              {note().text}
            </span>
          )}
        </Show>
        <For each={state.edges}>
          {(edge) => (
            <Show when={showsActions(edge.id) && ends(edge)}>
              {(line) => {
                const spot = () => {
                  const hovered = state.hoverAt;
                  return hovered?.edge === edge.id ? hovered.at : line().middle;
                };
                return (
                  <div
                    class="wfn-edge-actions"
                    style={{ left: `${spot().x}px`, top: `${spot().y}px` }}
                    onPointerMove={(event) => trackEdge(edge.id, event)}
                    onPointerLeave={(event) => leaveEdge(edge.id, event.relatedTarget)}
                  >
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      class="wfn-edge-remove"
                      aria-label={t("workflow.board.removeConnection")}
                      onPointerEnter={() => aimDisconnect(edge.id)}
                      onPointerLeave={() => aimDisconnect(null)}
                      onClick={() => disconnect(edge.id)}
                    >
                      <X />
                    </Button>
                  </div>
                );
              }}
            </Show>
          )}
        </For>
        <For each={state.edges}>
          {(edge) => (
            <Show when={edge.branch !== undefined && !showsActions(edge.id) ? ends(edge) : undefined}>
              {(line) => {
                const spot = () => line().turn ?? line().middle;
                return (
                  <span
                    class="wfn-edge-label"
                    data-branch={edge.branch}
                    aria-hidden="true"
                    style={{ left: `${spot().x}px`, top: `${spot().y}px` }}
                  >
                    {branchName(t, edge.branch ?? "")}
                  </span>
                );
              }}
            </Show>
          )}
        </For>
        <For each={state.edges}>
          {(edge) => (
            <Show when={!showsActions(edge.id) ? options.loops?.().get(edge.id) : undefined}>
              {(loop) => (
                <Show when={ends(edge)}>
                  {(line) => (
                    <span
                      class="wfn-edge-loop"
                      data-endless={loop().endless ? "" : undefined}
                      style={{ left: `${line().middle.x}px`, top: `${line().middle.y}px` }}
                    >
                      <Repeat aria-hidden="true" />
                      {t(loop().endless ? "workflow.board.loop.endless" : "workflow.board.loop.badge")}
                    </span>
                  )}
                </Show>
              )}
            </Show>
          )}
        </For>
        <p class="sr-only" role="status" aria-live="polite">
          {state.message}
        </p>
      </>
    );
  }

  return {
    board,
    edges: () => state.edges,
    selection: () => state.selection,
    select,
    removeAll,
    deleteNodes,
    aimRemove: setAiming,
    aimDisconnect,
    lockAll,
    splice,
    addEdges,
    snapshot,
    restore,
    /** Ends the typing burst, so the next key stroke is a new change. */
    endTyping: () => {
      typing = null;
    },
    /** The fields of a node, to copy it. */
    fields: (id: string): WfnFields => ({ ...state.fields[id] }),
    /** Gives a new node the fields of the node it copies. */
    putFields: (id: string, fields: WfnFields) => {
      if (Object.keys(fields).length === 0) return;
      setState((draft) => {
        draft.fields[id] = { ...fields };
      });
    },
    disconnect,
    attach,
    cancelDraft,
    selectFrom,
    setWorld: (element: HTMLElement) => {
      world = element;
      resize.observe(element);
      schedule();
    },
    Edges,
  };
}
