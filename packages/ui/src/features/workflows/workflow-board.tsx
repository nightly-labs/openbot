import {
  type AgentStepActivity,
  type RoutineSchedule,
  type StoredFileRow,
  type WorkflowAnswerProblem,
  type WorkflowGraph,
  workflowAnswerProblems,
  workflowInputAnswerFields,
} from "@openbot/contracts/ipc";
import type { AppTextKey, AppTranslate } from "@openbot/i18n";
import { Button, Kbd, LabelTooltip, Repeat, X } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import {
  createContext,
  createMemo,
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
import type { WorkflowGitHubCanvas } from "./workflow-github";
import type { Box } from "./workflow-ink";
import type { WorkflowLoop } from "./workflow-loops";
import type { WorkflowCatalogs, WorkflowFeatures } from "./workflow-model";

export type WfnPortType = "text" | "image" | "file";
export type WfnPortSide = "in" | "out";
export type WfnRunStatus = "waiting" | "running" | "done" | "failed" | "approval";

export interface WorkflowAgentProgress {
  agentId: string;
  detail: string;
  previous: string | undefined;
  activity: AgentStepActivity | null;
  done: number;
}

export function customStepName(value: WfnFieldValue | undefined): string | undefined {
  const name = typeof value === "string" ? value.trim() : "";
  return name || undefined;
}
export type WfnEdgeTone = "idle" | "run" | "done";
export type WfnFieldValue = string | number | boolean;
export type WfnFields = Record<string, WfnFieldValue>;

export interface WfnPoint {
  x: number;
  y: number;
}

function edgePath(from: WfnPoint, to: WfnPoint): string {
  const bend = Math.max(48, Math.abs(to.x - from.x) / 2);
  return `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`;
}

function edgeMidpoint(from: WfnPoint, to: WfnPoint): WfnPoint {
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

export interface WfnSize {
  width?: number;
  height?: number;
  font?: number;
}

export type WfnStretch = "x" | "xy" | "text";

export type WfnHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export function resizeHandles(stretch: WfnStretch): readonly WfnHandle[] {
  return stretch === "xy" ? ["nw", "n", "ne", "e", "se", "s", "sw", "w"] : ["nw", "ne", "e", "se", "sw", "w"];
}

export function resizeCursor(stretch: WfnStretch, handle: WfnHandle): "ew" | "ns" | "nwse" | "nesw" {
  if (handle === "e" || handle === "w") return "ew";
  if (handle === "n" || handle === "s") return "ns";
  if (stretch === "x") return "ew";
  return handle === "nw" || handle === "se" ? "nwse" : "nesw";
}

export interface WfnResult {
  id: string;
  run?: number;
  at: string;
  value: string;
  failed?: boolean;
  branch?: string;
}

export const resultValue = (result: WfnResult | undefined) => (result?.failed ? undefined : result?.value);

export interface WfnEdge {
  id: string;
  from: string;
  to: string;
  type: WfnPortType;
  branch?: string;
}

export const PORT_NAME = {
  text: "workflow.board.port.text",
  image: "workflow.board.port.image",
  file: "workflow.board.port.file",
} as const satisfies Record<WfnPortType, AppTextKey>;

const PORT_TYPES: readonly WfnPortType[] = ["text", "image", "file"];

const PORT_WORD = {
  text: "workflow.board.portWord.text",
  image: "workflow.board.portWord.image",
  file: "workflow.board.portWord.file",
} as const satisfies Record<WfnPortType, AppTextKey>;

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

export const BRANCH_NAME = {
  yes: "workflow.board.branch.yes",
  no: "workflow.board.branch.no",
} as const satisfies Record<string, AppTextKey>;

export function branchName(t: AppTranslate, branch: string): string {
  return branch === "yes" || branch === "no" ? t(BRANCH_NAME[branch]) : branch;
}

interface PortEntry {
  node: string;
  side: WfnPortSide;
  type: WfnPortType;
  branch?: string | undefined;
  element: HTMLElement;
}

export interface PortRef {
  node: string;
  side: WfnPortSide;
  type: WfnPortType;
  branch?: string | undefined;
}

export interface WfnAnchor {
  key: string;
  at: () => WfnPoint | undefined;
}

export type WfnFieldPatch = Record<string, Record<string, WfnFieldValue | undefined>>;

interface DropTarget {
  port: PortRef | null;
  reason: string | null;
}

interface PortPoint {
  node: WfnPoint;
  world: WfnPoint;
}

export interface BoardSnapshot {
  edges: WfnEdge[];
  removed: string[];
  locked: string[];
  selection: string[];
  fields: Record<string, WfnFields>;
}

export interface WfnBoard {
  selected: () => string | null;
  isSelected: (id: string) => boolean;
  isRemoved: (id: string) => boolean;
  remove: (id: string) => void;
  aimRemove: (ids: readonly string[]) => void;
  isDoomed: (id: string) => boolean;
  isLocked: (id: string) => boolean;
  lock: (id: string, locked: boolean) => void;
  lockedCount: () => number;
  unlockAll: () => void;
  field: (id: string, key: string) => WfnFieldValue | undefined;
  setField: (id: string, key: string, value: WfnFieldValue, typing?: boolean) => void;
  setFields: (id: string, values: WfnFields) => void;
  githubTriggers: (id: string) => string[];
  answerNames: (id: string) => readonly string[];
  answerProblems: (id: string) => readonly WorkflowAnswerProblem[];
  inputs: (id: string, type: WfnPortType) => string[];
  duplicate?: ((id: string) => void) | undefined;
  status: (id: string) => WfnRunStatus | undefined;
  progress: (id: string) => WorkflowAgentProgress | undefined;
  error: (id: string) => string | undefined;
  retry?: ((id: string) => void) | undefined;
  catalogs: () => WorkflowCatalogs;
  features: () => WorkflowFeatures | undefined;
  github: () => WorkflowGitHubCanvas | undefined;
  runFrom?: ((id: string) => void) | undefined;
  schedule: (id: string) => RoutineSchedule | undefined;
  setSchedule: (id: string, schedule: RoutineSchedule) => void;
  endScheduleEdit: () => void;
  rotateWebhookSecret?: ((id: string) => Promise<string>) | undefined;
  runStep: (id: string) => void;
  stopStep?: ((id: string) => void) | undefined;
  running: () => boolean;
  toolbarBelow: (id: string, bar: { width: number; height: number }) => boolean;
  decide: (id: string, approved: boolean) => void | Promise<unknown>;
  step: (id: string) => string | undefined;
  uploads: () => readonly StoredFileRow[];
  upload: (file: File) => Promise<StoredFileRow>;
  dropFiles?: ((id: string, files: readonly File[]) => void) | undefined;
  resizable: boolean;
  size: (id: string) => WfnSize | undefined;
  stretch: (id: string) => WfnStretch;
  resetSize?: ((id: string) => void) | undefined;
  results: (id: string) => readonly WfnResult[];
  shown: (id: string) => WfnResult | undefined;
  pick: (id: string, result: string) => void;
  record: (id: string, value: string, run?: number) => void;
  recordFailure: (id: string, message: string, run?: number) => void;
  viewing: () => number | null;
  view: (run: number | null) => void;
  connected: (node: string, side: WfnPortSide, type: WfnPortType, branch?: string) => boolean;
  drawsLine: (node: string, side: WfnPortSide, type: WfnPortType, branch?: string) => boolean;
  armed: (node: string, side: WfnPortSide, type: WfnPortType, branch?: string) => boolean;
  accepts: (node: string, side: WfnPortSide, type: WfnPortType, branch?: string) => boolean;
  refused: (node: string, side: WfnPortSide, type: WfnPortType, branch?: string) => boolean;
  connecting: () => boolean;
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
  catalogs: () => WorkflowCatalogs;
  graph?: () => WorkflowGraph;
  buildState?: (edgeId: string) => "unbuilt" | "arrived" | undefined;
  selected?: string | undefined;
  edges?: readonly WfnEdge[] | undefined;
  scale?: () => number;
  origin?: (id: string) => WfnPoint | undefined;
  box?: (id: string) => Box | undefined;
  loops?: () => ReadonlyMap<string, WorkflowLoop>;
  anchor?: (port: PortRef, other: string | undefined, slot?: string) => WfnAnchor | undefined;
  hides?: (edge: WfnEdge) => boolean;
  dropFiles?: (id: string, files: readonly File[]) => void;
  status?: (id: string) => WfnRunStatus | undefined;
  progress?: (id: string) => WorkflowAgentProgress | undefined;
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
  locked?: readonly string[] | undefined;
  size?: (id: string) => WfnSize | undefined;
  stretch?: (id: string) => WfnStretch;
  resetSize?: (id: string) => void;
  edgeTone?: (edge: WfnEdge) => WfnEdgeTone;
  focus?: () => string | null;
  results?: Record<string, readonly WfnResult[]> | undefined;
  resultsOf?: (id: string) => readonly WfnResult[];
  fields?: Record<string, WfnFields> | undefined;
  features?: () => WorkflowFeatures | undefined;
  github?: () => WorkflowGitHubCanvas | undefined;
  duplicate?: (id: string) => void;
  release?: (start: PortRef, at: WfnPoint, event: PointerEvent) => boolean;
  beforeChange?: () => void;
  canChange?: () => boolean;
  root?: () => Element | undefined;
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
  hover: string | null;
  hoverAt: { edge: string; at: WfnPoint } | null;
  removing: string | null;
  points: Record<string, PortPoint>;
  message: string;
  results: Record<string, WfnResult[]>;
  picked: Record<string, { result: string; newest: string | undefined }>;
  viewing: number | null;
}

const DRAG_THRESHOLD = 4;
const EDGE_END_CLEARANCE = { port: 14, button: 16 };
const LOOP_DROP = 56;
const LOOP_BEND = 48;

function loopPath(from: WfnPoint, to: WfnPoint, y: number): string {
  const out = from.x + LOOP_BEND;
  const back = to.x - LOOP_BEND;
  return `M ${from.x} ${from.y} C ${out} ${from.y}, ${out} ${y}, ${from.x} ${y} L ${to.x} ${y} C ${back} ${y}, ${back} ${to.y}, ${to.x} ${to.y}`;
}

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

export const MOD_KEY = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl";

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

function createMembership(ids: () => readonly string[]) {
  return createProjection<Record<string, true>>((draft) => {
    const next = new Set(ids());
    for (const id of Object.keys(draft)) if (!next.has(id)) delete draft[id];
    for (const id of next) draft[id] = true;
  }, {});
}

const KEYED_CONTROL = "[role=combobox], [role=listbox], [role^=menu], [role=option]";

export function takesKeys(element: Element | null): boolean {
  return element?.closest(KEYED_CONTROL) != null;
}

export function inCanvas(root: Element | undefined, element: Element | null): boolean {
  return (
    element === null ||
    element === document.body ||
    root?.contains(element) === true ||
    element.closest("[data-wfn-portal]") !== null
  );
}

const NO_ANSWER_PROBLEMS: readonly WorkflowAnswerProblem[] = [];

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
  let typing: string | null = null;
  const ports = new Map<string, PortEntry>();
  let world: HTMLElement | undefined;
  let frame = 0;
  let suppressPress = false;
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

  const slotsOf = (edge: WfnEdge): string[] =>
    Object.entries(state.fields[edge.to] ?? {}).flatMap(([key, value]) =>
      value === edge.from && state.points[portKey(edge.to, "in", edge.type, key)] ? [key] : [],
    );

  const heldSlots = (to: string, from: string, type: WfnPortType) =>
    Object.entries(state.fields[to] ?? {}).flatMap(([key, value]) =>
      value === from && ports.has(portKey(to, "in", type, key)) ? [key] : [],
    );

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

  const orient = (start: PortRef, end: PortRef): [PortRef, PortRef] =>
    start.side === "out" ? [start, end] : [end, start];

  const refusal = (start: PortRef, end: PortRef): string | null => {
    if (end.side === start.side) return t("workflow.board.refusal.side");
    if (end.node === start.node) return t("workflow.board.refusal.self");
    if (end.type !== start.type) {
      const types = { type: t(PORT_WORD[end.type]), other: t(PORT_WORD[start.type]) };
      return end.side === "in" ? t("workflow.board.refusal.takes", types) : t("workflow.board.refusal.gives", types);
    }
    const [from, to] = orient(start, end);
    if (!hasEdge(from.node, to.node, from.type, from.branch)) return null;
    const held = heldSlots(to.node, from.node, from.type);
    const moves = to.branch === undefined ? held.length > 0 : !held.includes(to.branch);
    return moves ? null : t("workflow.board.refusal.connected");
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
    const plain = matches.length > 1 ? matches.find((port) => port.branch === undefined) : undefined;
    const [only] = plain ? [plain] : matches;
    if (matches.length > 1 && !plain) return null;
    if (only) return { port: refOf(only), reason: refusal(start, refOf(only)) };
    const type = { type: t(PORT_WORD[start.type]) };
    return {
      port: null,
      reason: side === "in" ? t("workflow.board.refusal.noInput", type) : t("workflow.board.refusal.noOutput", type),
    };
  };

  let joined = false;

  const connect = (from: string, to: string, type: WfnPortType, branch?: string, slot?: string) => {
    if (from === to) return;
    const exists = hasEdge(from, to, type, branch);
    const held = heldSlots(to, from, type);
    if (exists && (slot === undefined ? held.length === 0 : held.includes(slot))) return;
    const loop = reaches(to, from);
    if (!joined) options.beforeChange?.();
    const fromName = nameOf(ports.get(portKey(from, "out", type, branch))?.element);
    const toName = nameOf(ports.get(portKey(to, "in", type, slot))?.element);
    const edge: WfnEdge = { id: `${from}${branch ? `.${branch}` : ""}>${to}:${type}`, from, to, type };
    if (branch) edge.branch = branch;
    const previous = slot === undefined ? undefined : state.fields[to]?.[slot];
    const replaced =
      typeof previous === "string" &&
      previous !== "" &&
      previous !== from &&
      heldSlots(to, previous, type).every((key) => key === slot)
        ? previous
        : undefined;
    setState((draft) => {
      if (!exists) draft.edges.push(edge);
      if (replaced !== undefined)
        draft.edges = draft.edges.filter((line) => !(line.from === replaced && line.to === to && line.type === type));
      const fields = { ...draft.fields[to] };
      if (slot === undefined) for (const key of held) fields[key] = "";
      else fields[slot] = from;
      if (slot !== undefined || held.length > 0) draft.fields[to] = fields;
      draft.pending = null;
      draft.message = t(loop ? "workflow.board.live.connectedLoop" : "workflow.board.live.connected", {
        from: fromName,
        to: toName,
      });
    });
  };

  const companions = (start: PortRef): PortRef[] => {
    if (state.selection.length < 2 || !state.selection.includes(start.node)) return [];
    return state.selection.flatMap((node) =>
      node !== start.node && ports.has(portKey(node, start.side, start.type, start.branch))
        ? [{ node, side: start.side, type: start.type, branch: start.branch }]
        : [],
    );
  };

  const companionsTo = (start: PortRef, end: PortRef): PortRef[] => {
    if (end.side === "in" && end.branch !== undefined) return [];
    return companions(start).filter((port) => {
      if (port.node === end.node || refusal(port, end) !== null) return false;
      const [from, to] = orient(port, end);
      return !hasEdge(from.node, to.node, from.type, from.branch);
    });
  };

  const answerProblemsByNode = createMemo(
    () => {
      const graph = options.graph?.();
      const byNode = new Map<string, WorkflowAnswerProblem[]>();
      for (const problem of graph ? workflowAnswerProblems(graph) : [])
        byNode.set(problem.nodeId, [...(byNode.get(problem.nodeId) ?? []), problem]);
      return byNode;
    },
    { lazy: true },
  );
  const pendingCompanions = createMemo(() => (state.pending ? companions(state.pending) : []));

  const isArmed = (port: PortRef) => {
    const pending = state.pending;
    return pending !== null && (samePort(pending, port) || pendingCompanions().some((other) => samePort(other, port)));
  };

  const link = (start: PortRef, end: PortRef) => {
    const others = companionsTo(start, end);
    const [from, to] = orient(start, end);
    if (others.length === 0) {
      connect(from.node, to.node, from.type, from.branch, to.branch);
      return;
    }
    const starts = [start, ...others];
    const loop = makesLoop(starts, end);
    options.beforeChange?.();
    joined = true;
    try {
      for (const port of starts) {
        const [source, target] = orient(port, end);
        connect(source.node, target.node, source.type, source.branch, target.branch);
      }
    } finally {
      joined = false;
    }
    setState((draft) => {
      draft.message = t(loop ? "workflow.board.live.connectedManyLoop" : "workflow.board.live.connectedMany", {
        count: starts.length,
      });
    });
  };

  const cancelDraft = () => {
    setState((draft) => {
      draft.pending = null;
      draft.draft = null;
      draft.target = null;
    });
  };

  const attach = (start: PortRef, node: string) => {
    const starts = start.side === "out" ? [start, ...companions(start)] : [start];
    for (const port of starts) {
      if (port.side === "out") connect(port.node, node, port.type, port.branch);
      else connect(node, port.node, port.type, undefined, port.branch);
    }
    if (starts.length > 1)
      setState((draft) => {
        draft.message = t("workflow.board.live.connectedMany", { count: starts.length });
      });
    cancelDraft();
  };

  const disconnectAll = (ids: readonly string[]) => {
    const gone = state.edges.filter((edge) => ids.includes(edge.id));
    if (gone.length === 0) return;
    const held = gone.map((edge) => ({ to: edge.to, keys: heldSlots(edge.to, edge.from, edge.type) }));
    options.beforeChange?.();
    setState((draft) => {
      draft.edges = draft.edges.filter((edge) => !ids.includes(edge.id));
      for (const { to, keys } of held)
        if (keys.length > 0)
          draft.fields[to] = { ...draft.fields[to], ...Object.fromEntries(keys.map((key) => [key, ""])) };
      draft.edge = null;
      draft.hover = null;
      draft.removing = null;
      draft.message = t("workflow.board.live.disconnected");
    });
  };
  const disconnect = (id: string) => disconnectAll([id]);

  const toWorld = (event: { clientX: number; clientY: number }): WfnPoint => {
    const origin = world?.getBoundingClientRect();
    const scale = options.scale?.() ?? 1;
    return { x: (event.clientX - (origin?.left ?? 0)) / scale, y: (event.clientY - (origin?.top ?? 0)) / scale };
  };

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

  const deleteNodes = (ids: readonly string[]) => {
    if (options.canChange?.() === false) return;
    const gone = ids.filter((id) => !state.locked.includes(id) && !state.removed.includes(id));
    if (gone.length === 0) return;
    const next = options.focusAfterRemove?.(gone, document.activeElement);
    setAiming([]);
    removeAll(gone);
    next?.focus();
  };

  const lockAll = (ids: readonly string[], locked: boolean) => {
    options.beforeChange?.();
    setState((draft) => {
      const rest = draft.locked.filter((entry) => !ids.includes(entry));
      draft.locked = locked ? [...rest, ...ids] : rest;
    });
  };

  const add = (id: string, value: string, run: number | undefined, failed: boolean) => {
    const result: WfnResult = { id: crypto.randomUUID(), at: new Date().toISOString(), value };
    if (run !== undefined) result.run = run;
    if (failed) result.failed = true;
    setState((draft) => {
      draft.results[id] = [...(draft.results[id] ?? []), result];
      delete draft.picked[id];
    });
  };

  const [uploads, setUploads] = createSignal<readonly StoredFileRow[]>([]);
  const upload = async (file: File): Promise<StoredFileRow> => {
    const host = options.catalogs().upload;
    if (host) return host(file);
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
  const latestOf = (id: string): WfnResult | undefined => {
    const list = resultsOf(id);
    const viewing = state.viewing;
    return viewing === null ? list.at(-1) : list.findLast((result) => result.run === viewing);
  };
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
    githubTriggers: (id) => {
      const found: string[] = [];
      const seen = new Set([id]);
      let layer = [id];
      while (layer.length > 0) {
        const next: string[] = [];
        for (const edge of state.edges) {
          if (!layer.includes(edge.to) || seen.has(edge.from) || state.removed.includes(edge.from)) continue;
          seen.add(edge.from);
          if (state.fields[edge.from]?.trigger === "github") found.push(edge.from);
          else next.push(edge.from);
        }
        layer = next;
      }
      return found;
    },
    answerNames: (id) => {
      const graph = options.graph?.();
      return graph ? [...workflowInputAnswerFields(graph, id).keys()] : [];
    },
    answerProblems: (id) => answerProblemsByNode().get(id) ?? NO_ANSWER_PROBLEMS,
    inputs: (id, type) =>
      state.edges.flatMap((edge) =>
        edge.to === id && edge.type === type && !state.removed.includes(edge.from) ? [edge.from] : [],
      ),
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
    github: () => options.github?.(),
    status: (id) => options.status?.(id),
    progress: (id) => options.progress?.(id),
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
    dropFiles: options.dropFiles,
    resizable: options.size !== undefined,
    size: (id) => options.size?.(id),
    stretch: (id) => options.stretch?.(id) ?? "x",
    resetSize: options.resetSize,
    results: (id) => resultsOf(id),
    shown: (id) => {
      const latest = latestOf(id);
      const picked = state.picked[id];
      const stillNewest = picked !== undefined && latest?.id === picked.newest;
      if (!stillNewest) return latest;
      return resultsOf(id).find((result) => result.id === picked.result) ?? latest;
    },
    pick: (id, result) => {
      const newest = latestOf(id)?.id;
      setState((draft) => {
        draft.picked[id] = { result, newest };
      });
    },
    record: (id, value, run) => add(id, value, run, false),
    recordFailure: (id, message, run) => add(id, message, run, true),
    viewing: () => state.viewing,
    view: (run) =>
      setState((draft) => {
        draft.viewing = run;
        draft.picked = {};
      }),
    connected: (node, side, type, branch) =>
      state.edges.some((edge) => {
        if (edge.type !== type) return false;
        if (side === "out") return edge.from === node && edge.branch === branch;
        if (edge.to !== node) return false;
        const slots = slotsOf(edge);
        return branch === undefined ? slots.length === 0 : slots.includes(branch);
      }),
    drawsLine: (node, side, type, branch) =>
      point(node, side, type, branch) !== undefined &&
      state.edges.some((edge) => {
        if (edge.type !== type || options.hides?.(edge)) return false;
        if (side === "out") {
          if (edge.from !== node || edge.branch !== branch || outAnchor(edge)) return false;
          return targets(edge).some(
            (slot) => inAnchor(edge, slot) !== undefined || point(edge.to, "in", type, slot) !== undefined,
          );
        }
        if (edge.to !== node) return false;
        const slots = slotsOf(edge);
        const slot = branch === undefined ? slots.length === 0 : slots.includes(branch);
        if (!slot || inAnchor(edge, branch)) return false;
        return outAnchor(edge, branch) !== undefined || point(edge.from, "out", type, edge.branch) !== undefined;
      }),
    armed: (node, side, type, branch) => isArmed({ node, side, type, branch }),
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
        if (nodeElement && ![...ports.values()].some((other) => other.node === entry.node))
          resize.unobserve(nodeElement);
        schedule();
      };
    },
    pressPort: (node, side, type, branch) => {
      if (suppressPress) return;
      const port: PortRef = { node, side, type, branch };
      const pending = state.pending;
      if (!pending || pending.side === side) {
        const wasArmed = isArmed(port);
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

  const selectFrom = (target: EventTarget | null, add = false) => {
    if (
      target instanceof Element &&
      target.closest("[data-wfn-portal], [data-wfn-group], .wfn-edge-actions, .wfn-port")
    )
      return;
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

  const select = (ids: readonly string[]) => {
    setState((draft) => {
      draft.selection = ids.filter((id) => !draft.removed.includes(id));
      draft.edge = null;
    });
  };

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

  const restore = (saved: BoardSnapshot) => {
    typing = null;
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

  const sync = (saved: BoardSnapshot) => {
    const gone = new Set(saved.removed);
    const kept = (id: string) => id in saved.fields && !gone.has(id);
    const edgeIds = new Set(saved.edges.map((edge) => edge.id));
    if (typing !== null && !kept(typing.slice(0, typing.lastIndexOf(":")))) typing = null;
    setState((draft) => {
      if (JSON.stringify(draft.edges) !== JSON.stringify(saved.edges)) {
        draft.edges = saved.edges.map((edge) => ({ ...edge }));
      }
      if (draft.removed.join("\u0000") !== saved.removed.join("\u0000")) draft.removed = [...saved.removed];
      if (draft.locked.join("\u0000") !== saved.locked.join("\u0000")) draft.locked = [...saved.locked];
      for (const id of Object.keys(draft.fields)) if (!(id in saved.fields)) delete draft.fields[id];
      for (const [id, fields] of Object.entries(saved.fields)) {
        if (JSON.stringify(draft.fields[id]) !== JSON.stringify(fields)) draft.fields[id] = { ...fields };
      }
      if (draft.selection.some((id) => !kept(id))) draft.selection = draft.selection.filter(kept);
      if (draft.pending && !kept(draft.pending.node)) {
        draft.pending = null;
        draft.draft = null;
        draft.target = null;
      }
      if (draft.edge !== null && !edgeIds.has(draft.edge)) draft.edge = null;
      if (draft.hover !== null && !edgeIds.has(draft.hover)) draft.hover = null;
      if (draft.hoverAt && !edgeIds.has(draft.hoverAt.edge)) draft.hoverAt = null;
      if (draft.removing !== null && !edgeIds.has(draft.removing)) draft.removing = null;
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
        disconnectAll(bundledIds(edge));
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
  const leaveEdge = (id: string, to: EventTarget | null) => {
    if (to instanceof Element && (to.closest(".wfn-edge-actions") || to.closest(`[data-edge-id="${id}"]`))) return;
    if (state.hover === id)
      setState((draft) => {
        draft.hover = null;
      });
  };
  const aimDisconnect = (id: string | null) =>
    setState((draft) => {
      if (id !== null || draft.removing !== null) draft.removing = id;
    });
  const showsActions = (id: string) => state.edge === id || (state.hover === id && state.pending === null);
  const motion = !prefersReducedMotion();

  const shapeOf = (edge: WfnEdge, from: WfnPoint, to: WfnPoint) => {
    const loop = options.loops?.().get(edge.id);
    if (!loop) return { path: edgePath(from, to), middle: edgeMidpoint(from, to), turn: undefined };
    const bottoms = loop.body.flatMap((id) => {
      const box = options.box?.(id);
      return box ? [box.y + box.height] : [];
    });
    const y = Math.max(from.y, to.y, ...bottoms) + LOOP_DROP;
    return {
      path: loopPath(from, to, y),
      middle: { x: (from.x + to.x) / 2, y },
      turn: { x: from.x + LOOP_BEND * 0.75, y: (from.y + y) / 2 },
    };
  };
  const makesLoop = (starts: readonly PortRef[], end: PortRef) =>
    starts.some((port) => {
      const [from, to] = orient(port, end);
      return reaches(to.node, from.node);
    });
  const draftLoops = () => {
    const pending = state.pending;
    const port = state.target?.reason === null ? state.target.port : null;
    if (!pending || !port) return false;
    return makesLoop([pending, ...companionsTo(pending, port)], port);
  };

  const targets = (edge: WfnEdge): (string | undefined)[] => {
    const slots = slotsOf(edge);
    return slots.length > 0 ? slots : [undefined];
  };
  const outAnchor = (edge: WfnEdge, slot: string | undefined = targets(edge)[0]) =>
    options.anchor?.({ node: edge.from, side: "out", type: edge.type, branch: edge.branch }, edge.to, slot);
  const inAnchor = (edge: WfnEdge, slot: string | undefined) =>
    options.anchor?.({ node: edge.to, side: "in", type: edge.type, branch: slot }, edge.from);
  const lineId = (edge: WfnEdge, slot: string | undefined) => `${edge.id}\u0000${slot ?? ""}`;
  const bundles = createMemo(
    () => {
      const lines = new Map<string, WfnEdge[]>();
      const bundleOf = new Map<string, WfnEdge[]>();
      for (const edge of state.edges) {
        if (options.hides?.(edge)) continue;
        for (const slot of targets(edge)) {
          const from = outAnchor(edge, slot)?.key ?? `${edge.from}\u0000${edge.branch ?? ""}`;
          const to = inAnchor(edge, slot)?.key ?? `${edge.to}\u0000${slot ?? ""}`;
          const key = `${from}>${to}:${edge.type}`;
          const bundle = lines.get(key) ?? [];
          if (!bundle.includes(edge)) bundle.push(edge);
          lines.set(key, bundle);
          bundleOf.set(lineId(edge, slot), bundle);
        }
      }
      return bundleOf;
    },
    { lazy: true },
  );
  const bundled = (edge: WfnEdge, slot: string | undefined = targets(edge)[0]) =>
    bundles().get(lineId(edge, slot)) ?? [];
  const bundledIds = (id: string) => {
    const edge = state.edges.find((entry) => entry.id === id);
    const ids = edge ? bundled(edge).map((entry) => entry.id) : [];
    return ids.length > 0 ? ids : [id];
  };

  function Edges() {
    const endsAt = (edge: WfnEdge, slot: string | undefined) => {
      const from = outAnchor(edge, slot)?.at() ?? point(edge.from, "out", edge.type, edge.branch);
      const to = inAnchor(edge, slot)?.at() ?? point(edge.to, "in", edge.type, slot);
      return from && to ? shapeOf(edge, from, to) : null;
    };
    const ends = (edge: WfnEdge) => endsAt(edge, targets(edge)[0]);
    const leads = (edge: WfnEdge, slot: string | undefined) => bundled(edge, slot)[0] === edge;
    const count = (edge: WfnEdge) => bundled(edge).length;
    const draftTarget = () => (state.target?.reason === null ? state.target.port : null);
    const draftEnd = () => {
      const port = draftTarget();
      return (port && point(port.node, port.side, port.type, port.branch)) ?? state.draft;
    };
    const draftLine = (from: PortRef) => {
      const anchor = options.anchor?.(from, undefined)?.at() ?? point(from.node, from.side, from.type, from.branch);
      const end = draftEnd();
      if (!anchor || !end) return null;
      return from.side === "out" ? edgePath(anchor, end) : edgePath(end, anchor);
    };
    const draftPath = () => (state.pending ? draftLine(state.pending) : null);
    const companionPaths = () => {
      const pending = state.pending;
      if (!pending || !state.draft) return [];
      const port = draftTarget();
      const others = port ? companionsTo(pending, port) : pendingCompanions();
      const drawn = new Set([options.anchor?.(pending, undefined)?.key]);
      return others.flatMap((other) => {
        const key = options.anchor?.(other, undefined)?.key;
        if (key !== undefined && drawn.has(key)) return [];
        drawn.add(key);
        return draftLine(other) ?? [];
      });
    };
    const draftState = () => {
      const target = state.target;
      if (!target) return undefined;
      if (target.reason !== null) return "refused";
      return draftLoops() ? "loop" : "ok";
    };
    const draftNote = () => {
      const reason = state.target?.reason;
      if (reason) return { text: reason, tone: "refused" };
      return draftLoops() ? { text: t("workflow.board.loop.makes"), tone: "loop" } : null;
    };
    const isFocusEdge = (edge: WfnEdge, slot: string | undefined) => {
      const focus = options.focus?.() ?? null;
      return focus !== null && bundled(edge, slot).some((entry) => entry.from === focus || entry.to === focus);
    };
    const EdgeLine = (props: { edge: WfnEdge; path: string; focus: boolean; hit?: boolean }) => (
      <g
        class="wfn-edge"
        data-type={props.edge.type}
        data-tone={tone(props.edge)}
        data-selected={state.edge === props.edge.id ? "" : undefined}
        data-focus={props.focus ? "" : undefined}
        data-removing={
          state.removing === props.edge.id || isDoomed(props.edge.from) || isDoomed(props.edge.to) ? "" : undefined
        }
        data-motion={motion ? "" : undefined}
        data-build={options.buildState?.(props.edge.id)}
      >
        <path class="wfn-edge-line" d={props.path} />
        <Show when={tone(props.edge) === "run"}>
          <path class="wfn-edge-comet" d={props.path} pathLength="1" />
        </Show>
        <Show when={props.hit}>
          <path
            class="wfn-edge-hit"
            data-edge-id={props.edge.id}
            d={props.path}
            onPointerDown={() =>
              setState((draft) => {
                draft.edge = props.edge.id;
              })
            }
            onPointerMove={(event) => trackEdge(props.edge.id, event)}
            onPointerLeave={(event) => leaveEdge(props.edge.id, event.relatedTarget)}
          />
        </Show>
      </g>
    );
    return (
      <>
        <svg ref={edgeLayer} class="wfn-edges" aria-hidden="true">
          <For each={state.edges}>
            {(edge) => (
              <For each={targets(edge)}>
                {(slot) => (
                  <Show when={leads(edge, slot) ? endsAt(edge, slot) : undefined}>
                    {(line) => <EdgeLine edge={edge} path={line().path} focus={isFocusEdge(edge, slot)} hit />}
                  </Show>
                )}
              </For>
            )}
          </For>
          <Show when={draftPath()}>
            {(path) => <path class="wfn-edge-draft" data-state={draftState()} d={path()} />}
          </Show>
          <For each={companionPaths()}>
            {(path) => <path class="wfn-edge-draft" data-state={draftState()} d={path} />}
          </For>
        </svg>
        <svg class="wfn-edges wfn-edges-focus" aria-hidden="true">
          <For each={state.edges}>
            {(edge) => (
              <For each={targets(edge)}>
                {(slot) => (
                  <Show when={leads(edge, slot) && isFocusEdge(edge, slot) ? endsAt(edge, slot) : undefined}>
                    {(line) => <EdgeLine edge={edge} path={line().path} focus />}
                  </Show>
                )}
              </For>
            )}
          </For>
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
                      onClick={() => disconnectAll(bundledIds(edge.id))}
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
            <Show
              when={count(edge) > 1 && leads(edge, targets(edge)[0]) && !showsActions(edge.id) ? ends(edge) : undefined}
            >
              {(line) => (
                <span
                  class="wfn-edge-label wfn-edge-count"
                  aria-hidden="true"
                  style={{ left: `${line().middle.x}px`, top: `${line().middle.y}px` }}
                >
                  {count(edge)}
                </span>
              )}
            </Show>
          )}
        </For>
        <For each={state.edges}>
          {(edge) => (
            <Show
              when={
                edge.branch !== undefined && leads(edge, targets(edge)[0]) && !showsActions(edge.id)
                  ? ends(edge)
                  : undefined
              }
            >
              {(line) => {
                const spot = () => line().turn ?? line().middle;
                return (
                  <span
                    class="wfn-edge-label"
                    data-branch={edge.branch}
                    data-build={options.buildState?.(edge.id)}
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
            <Show
              when={
                leads(edge, targets(edge)[0]) && !showsActions(edge.id) ? options.loops?.().get(edge.id) : undefined
              }
            >
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
    sync,
    endTyping: () => {
      typing = null;
    },
    fields: (id: string): WfnFields => ({ ...state.fields[id] }),
    slots: (edge: WfnEdge) => slotsOf(edge),
    patchFields: (changes: WfnFieldPatch, burst?: string) => {
      const differs = Object.entries(changes).some(([id, values]) =>
        Object.entries(values).some(([key, value]) => state.fields[id]?.[key] !== value),
      );
      if (!differs) return;
      if (burst === undefined || typing !== burst) options.beforeChange?.();
      typing = burst ?? null;
      setState((draft) => {
        for (const [id, values] of Object.entries(changes)) {
          const next = { ...draft.fields[id] };
          for (const [key, value] of Object.entries(values)) {
            if (value === undefined) delete next[key];
            else next[key] = value;
          }
          draft.fields[id] = next;
        }
      });
    },
    outputs: (node: string): WfnPortType[] =>
      PORT_TYPES.filter((type) => state.points[portKey(node, "out", type)] !== undefined),
    putFields: (id: string, fields: WfnFields) => {
      if (Object.keys(fields).length === 0) return;
      setState((draft) => {
        draft.fields[id] = { ...fields };
      });
    },
    disconnect,
    disconnectAll,
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
