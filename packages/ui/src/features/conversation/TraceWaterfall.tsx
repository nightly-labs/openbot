import type { AppTextKey } from "@openbot/i18n";
import { Dynamic, type JSX } from "@solidjs/web";
import { createMemo, createSignal, createStore, For, onCleanup, Show, untrack } from "solid-js";
import { Badge } from "../../badge";
import { Button, IconButton } from "../../button";
import { Dialog } from "../../complex";
import { createScrollFades } from "../../components/createScrollFades";
import { createDigitRoll } from "../../digit-roll";
import { Input } from "../../form";
import {
  ArrowLeftRight,
  Bot,
  Brain,
  ChevronDown,
  Clock3,
  Code,
  File,
  Globe2,
  LoaderCircle,
  MessageCircle,
  Pause,
  Pencil,
  Play,
  Puzzle,
  RotateCcw,
  Search,
  Sparkles,
  Square,
  Workflow,
  X,
} from "../../icons";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../select";
import { Kbd } from "../../surface";
import { type TextValue, useText } from "../../text";
import { prefersReducedMotion } from "../../utils";

/** What a span of the trace did. A failed span keeps its kind and sets `failed`. */
export type TraceSpanKind = "model" | "tool" | "waiting" | "handoff";

/** What a span did, more exactly than its kind. It selects the icon of the row. */
export type TraceSpanIcon = "agent" | "thinking" | "text" | "search" | "read" | "edit" | "command" | "web" | "tool";

/**
 * One timed piece of an agent run: a model call, a tool call, a wait or a handoff to another agent.
 * Spans nest through `parentId`, such as an agent, its subagents and their calls.
 */
export interface TraceSpan {
  id: string;
  /** The span that holds this one. A span with no parent in the list is a top-level row. */
  parentId: string | null;
  /** The text that the provider or the host sent, shown as it is. */
  name: string;
  /** The model or the tool source, such as "Sonnet 5.5" or "GitHub". */
  detail?: string;
  kind: TraceSpanKind;
  /** The icon of the row. Without one, the row shows the icon of its kind. */
  icon?: TraceSpanIcon;
  failed?: boolean;
  /** Epoch milliseconds. */
  start: number;
  /** Epoch milliseconds, or null while the span runs: its bar then grows to `now`. */
  end: number | null;
  /** The tokens of this span's own work, without its children. */
  tokens?: number;
  /** The cost of this span's own work, without its children. A parent row shows its total. */
  costUsd?: number;
}

/** The keyboard that the shortcut hint names. */
export type TraceKeyboard = "mac" | "pc";

export interface TraceWaterfallProps {
  spans: readonly TraceSpan[];
  /** The time now, in epoch milliseconds. The caller moves it while a span runs. */
  now: number;
  keyboard: TraceKeyboard;
  /** The search text when the trace opens. */
  defaultQuery?: string | undefined;
  /** Controls at the end of the header, such as the close button of a dialog. */
  actions?: JSX.Element;
  /** The rows that the user can pick, such as the steps that the chat can show. */
  canSelectSpan?: ((id: string) => boolean) | undefined;
  /** Called when the user picks a row that `canSelectSpan` accepts. */
  onSelectSpan?: ((id: string) => void) | undefined;
  class?: string;
}

/** About this many ticks cover the axis. */
const TICK_COUNT = 5;
const TICK_STEPS = [1, 2, 5] as const;

const KIND_LABEL = {
  model: "chat.trace.kind.model",
  tool: "chat.trace.kind.tool",
  waiting: "chat.trace.kind.waiting",
  handoff: "chat.trace.kind.handoff",
} as const satisfies Record<TraceSpanKind, AppTextKey>;

const LEGEND = ["model", "tool", "waiting"] as const satisfies readonly TraceSpanKind[];

/** How much faster than the real run a replay plays. Kobalte takes a mutable option array. */
type SpeedLevel = "1" | "2" | "5" | "10";
const SPEED_LEVELS: SpeedLevel[] = ["1", "2", "5", "10"];

/**
 * Each subagent gets the next colour of this many, and its calls share it. The top agent has no
 * colour, so its own calls stay grey. The colours are in `trace-waterfall.css`.
 */
const HUE_COUNT = 5;

const KIND_ICON = {
  model: Sparkles,
  tool: Puzzle,
  waiting: Clock3,
  handoff: ArrowLeftRight,
} as const satisfies Record<TraceSpanKind, typeof Bot>;

const SPAN_ICON = {
  agent: Bot,
  thinking: Brain,
  text: MessageCircle,
  search: Search,
  read: File,
  edit: Pencil,
  command: Code,
  web: Globe2,
  tool: Puzzle,
} as const satisfies Record<TraceSpanIcon, typeof Bot>;

const SHORTCUT = { mac: "⌘F", pc: "Ctrl F" } as const satisfies Record<TraceKeyboard, string>;

interface TraceViewState {
  /** The parent rows that the user folded. */
  collapsed: Record<string, boolean>;
  query: string;
  /** The time into the run that a replay shows, in ms. Null when the trace shows the whole run. */
  replay: number | null;
  playing: boolean;
  speed: SpeedLevel;
}

interface TraceRow {
  span: TraceSpan;
  depth: number;
  parent: boolean;
  /** The colour of the agent that did this span, from 1 to `HUE_COUNT`. Null for the top agent. */
  hue: number | null;
}

/**
 * A row and the rows under it. A parent row stays at the top while its rows scroll under it. A folded
 * row keeps its rows, so they can slide closed and open.
 */
interface TraceBranch {
  row: TraceRow;
  open: boolean;
  children: TraceBranch[];
}

/** A piece of a parent's lane: one direct child of the parent, from 0 to 1 on the timeline. */
interface TraceSegment {
  id: string;
  kind: TraceSpanKind;
  failed: boolean;
  running: boolean;
  start: number;
  end: number;
}

/**
 * The line from a parent row down to the last of the subagents that it starts at one time. Rows
 * count from the first row. Each subagent's row draws the branch into its bar.
 */
interface TraceHandoff {
  id: string;
  at: number;
  from: number;
  to: number;
  /** The colour of the agent that hands off. */
  hue: number | null;
}

/** A piece of a handoff line that one row draws. */
interface TraceLine {
  at: number;
  hue: number | null;
}

/**
 * The handoff lines that a row draws itself: the branch into its own bar, and the lines that pass a
 * parent row, whose background covers the overlay.
 */
interface TraceRowLines {
  /** `last` is true on the last subagent of a line, where the line turns and stops. */
  branch: (TraceLine & { last: boolean }) | null;
  passes: TraceLine[];
}

function hueValue(hue: number | null): string | undefined {
  return hue === null ? undefined : String(hue);
}

/** The spans under each span id, in start order. Null holds the top-level spans. */
function childrenOf(spans: readonly TraceSpan[]): Map<string | null, TraceSpan[]> {
  const ids = new Set(spans.map((span) => span.id));
  const children = new Map<string | null, TraceSpan[]>();
  for (const span of spans) {
    const parentId = span.parentId !== null && ids.has(span.parentId) ? span.parentId : null;
    const siblings = children.get(parentId) ?? [];
    siblings.push(span);
    children.set(parentId, siblings);
  }
  for (const siblings of children.values()) siblings.sort((left, right) => left.start - right.start);
  return children;
}

function spanEnd(span: TraceSpan, now: number): number {
  return span.end ?? now;
}

/** A span as it was before it ended: it has no result, tokens or cost yet. */
function unfinished(span: TraceSpan): TraceSpan {
  const { failed: _failed, tokens: _tokens, costUsd: _costUsd, ...open } = span;
  return { ...open, end: null };
}

/** "11ms", "1.4s", "17s", "2m 5s". A short tool call is not "0s". */
function formatDuration(ms: number, format: TextValue["format"]): string {
  const seconds = Math.max(0, ms) / 1_000;
  if (ms > 0 && ms < 100) {
    return format.number(Math.max(1, Math.round(ms)), {
      style: "unit",
      unit: "millisecond",
      unitDisplay: "narrow",
    });
  }
  if (seconds < 60) {
    const digits = seconds < 10 ? 1 : 0;
    return format.number(seconds, {
      style: "unit",
      unit: "second",
      unitDisplay: "narrow",
      maximumFractionDigits: digits,
    });
  }
  const total = Math.round(seconds);
  const minutes = format.number(Math.floor(total / 60), { style: "unit", unit: "minute", unitDisplay: "narrow" });
  const rest = format.number(total % 60, { style: "unit", unit: "second", unitDisplay: "narrow" });
  return `${minutes} ${rest}`;
}

/** "$0.27", and three digits under a cent: "$0.004". */
function formatCost(value: number, format: TextValue["format"]): string {
  return format.currencyUsd(value, {
    minimumFractionDigits: 2,
    maximumFractionDigits: value > 0 && value < 0.01 ? 3 : 2,
  });
}

/** The smallest 1, 2 or 5 × 10ⁿ ms step that cuts `range` into at most `count` parts. */
function tickStep(range: number, count: number): number {
  const raw = range / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  for (const step of TICK_STEPS) if (step * power >= raw) return step * power;
  return 10 * power;
}

/**
 * A live trace of an agent run: each span is a bar on one timeline, under a strip of totals. The tree
 * folds, the search keeps the matches and their parents, and a replay plays the run again.
 */
export function TraceWaterfall(props: TraceWaterfallProps) {
  const text = useText();
  const { t, format } = text;
  const [state, setState] = createStore<TraceViewState>({
    collapsed: {},
    query: untrack(() => props.defaultQuery) ?? "",
    replay: null,
    playing: false,
    speed: "1",
  });
  let searchInput: HTMLInputElement | undefined;
  let root: HTMLElement | undefined;
  /* A menu belongs to the trace dialog when the trace is in it: outside it, the modal dialog blocks the
     pointer and hides the menu from assistive technology. Without a dialog, the menu goes to the body. */
  const [menuMount, setMenuMount] = createSignal<HTMLElement | undefined>();
  const onMenuOpen = (open: boolean) => {
    if (open) setMenuMount(root?.closest<HTMLElement>(".trace-dialog") ?? undefined);
  };

  const range = createMemo(() => {
    if (props.spans.length === 0) return { origin: props.now, duration: 0 };
    let origin = Number.POSITIVE_INFINITY;
    let end = Number.NEGATIVE_INFINITY;
    for (const span of props.spans) {
      origin = Math.min(origin, span.start);
      end = Math.max(end, spanEnd(span, props.now));
    }
    return { origin, duration: Math.max(0, end - origin) };
  });

  /**
   * The spans as the trace shows them. A replay shows the run as it was at `replay`: later spans are
   * not there yet, and a span that ends later still runs. The axis keeps the range of the whole run.
   */
  const view = createMemo(() => {
    if (state.replay === null) return { spans: props.spans, now: props.now };
    const now = range().origin + state.replay;
    const spans = props.spans
      .filter((span) => span.start <= now)
      .map((span) => (span.end !== null && span.end <= now ? span : unfinished(span)));
    return { spans, now };
  });

  const tree = createMemo(() => childrenOf(view().spans));

  /**
   * The colour of each span. It comes from the whole run, not the replay, so an agent keeps its colour
   * while the replay plays.
   */
  const hues = createMemo(() => {
    const children = childrenOf(props.spans);
    const result = new Map<string, number | null>();
    let next = 0;
    const visit = (parentId: string | null, depth: number, inherited: number | null) => {
      for (const span of children.get(parentId) ?? []) {
        const agent = depth > 0 && (span.icon === "agent" || children.has(span.id));
        const hue = agent ? (next++ % HUE_COUNT) + 1 : inherited;
        result.set(span.id, hue);
        visit(span.id, depth + 1, hue);
      }
    };
    visit(null, 0, null);
    return result;
  });

  const parentOf = createMemo(() => {
    const parents = new Map<string, string>();
    for (const [parentId, siblings] of tree()) {
      if (parentId === null) continue;
      for (const span of siblings) parents.set(span.id, parentId);
    }
    return parents;
  });

  /** The matches and every span above one. Null when there is no search. */
  const matches = createMemo(() => {
    const query = state.query.trim().toLocaleLowerCase();
    if (!query) return null;
    const kept = new Set<string>();
    const parents = parentOf();
    for (const span of view().spans) {
      const haystack = `${span.name} ${span.detail ?? ""}`.toLocaleLowerCase();
      if (!haystack.includes(query)) continue;
      for (let id: string | undefined = span.id; id !== undefined && !kept.has(id); id = parents.get(id)) kept.add(id);
    }
    return kept;
  });

  /** The rows as a tree for the list, and in order for the handoff lines. */
  const layout = createMemo(() => {
    const children = tree();
    const kept = matches();
    const colours = hues();
    const rows: TraceRow[] = [];
    /** `shown` is false under a folded row: those rows are in the tree, but not in the row order. */
    const visit = (parentId: string | null, depth: number, shown: boolean): TraceBranch[] => {
      const branches: TraceBranch[] = [];
      for (const span of children.get(parentId) ?? []) {
        if (kept && !kept.has(span.id)) continue;
        const parent = children.has(span.id);
        const row: TraceRow = { span, depth, parent, hue: colours.get(span.id) ?? null };
        if (shown) rows.push(row);
        // A search shows each match, also one under a folded row.
        const open = kept !== null || !state.collapsed[span.id];
        branches.push({ row, open, children: parent ? visit(span.id, depth + 1, shown && open) : [] });
      }
      return branches;
    };
    const branches = visit(null, 0, true);
    return { branches, rows };
  });

  const rows = () => layout().rows;

  /** The row under the pointer, or the row of the lane piece under it. The two light up together. */
  const [hovered, setHovered] = createSignal<string | null>(null);
  const onPointerOver = (event: PointerEvent) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-span-id]") : null;
    setHovered(target?.dataset.spanId ?? null);
  };

  /** The row that the Tab key goes to. The arrow keys move it; it is the first row until then. */
  const [active, setActive] = createSignal<string | null>(null);
  const activeId = createMemo(() => {
    const id = active();
    const shown = rows();
    return shown.some((row) => row.span.id === id) ? id : (shown[0]?.span.id ?? null);
  });
  const focusRow = (id: string) => {
    setActive(id);
    body?.querySelector<HTMLElement>(`.trace-row[data-span-id="${CSS.escape(id)}"] .trace-name-button`)?.focus();
  };
  const rowOpen = (id: string) => matches() !== null || !state.collapsed[id];

  /** Up and Down move between rows. Right unfolds a row, then goes to its first row; Left goes back. */
  const onRowKeyDown = (event: KeyboardEvent, row: TraceRow) => {
    const shown = rows();
    const at = shown.findIndex((item) => item.span.id === row.span.id);
    const open = rowOpen(row.span.id);
    let target: string | undefined;
    if (event.key === "ArrowDown") target = shown[at + 1]?.span.id;
    else if (event.key === "ArrowUp") target = shown[at - 1]?.span.id;
    else if (event.key === "Home") target = shown[0]?.span.id;
    else if (event.key === "End") target = shown.at(-1)?.span.id;
    else if (event.key === "ArrowRight") {
      if (!row.parent) return;
      if (open) target = shown[at + 1]?.span.id;
      else toggle(row.span.id);
    } else if (event.key === "ArrowLeft") {
      // A search shows the rows under each match, so it does not fold.
      if (row.parent && open && matches() === null) toggle(row.span.id);
      else target = parentOf().get(row.span.id);
    } else return;
    event.preventDefault();
    if (target !== undefined) focusRow(target);
  };

  const canSelect = (id: string) => props.onSelectSpan !== undefined && (props.canSelectSpan?.(id) ?? true);

  /** Where a time is on the timeline, from 0 to 1. */
  const position = (time: number) => {
    const { origin, duration } = range();
    return duration === 0 ? 0 : Math.min(1, Math.max(0, (time - origin) / duration));
  };

  const ticks = createMemo(() => {
    const { duration } = range();
    if (duration === 0) return [0];
    const step = tickStep(duration, TICK_COUNT);
    const result: number[] = [];
    for (let time = 0; time <= duration + step / 1_000; time += step) result.push(time);
    return result;
  });

  const totals = createMemo(() => {
    const children = tree();
    let cost: number | null = null;
    let tokens: number | null = null;
    let modelCalls = 0;
    let toolCalls = 0;
    let errors = 0;
    for (const span of view().spans) {
      if (span.costUsd !== undefined) cost = (cost ?? 0) + span.costUsd;
      if (span.tokens !== undefined) tokens = (tokens ?? 0) + span.tokens;
      if (span.failed) errors += 1;
      // An agent row holds calls; it is not one.
      if (children.has(span.id)) continue;
      if (span.kind === "model") modelCalls += 1;
      // A handoff is the tool call that sends a message or starts a subagent.
      else if (span.kind === "tool" || span.kind === "handoff") toolCalls += 1;
    }
    return { cost, tokens, modelCalls, toolCalls, errors };
  });

  /** The cost of each span with all the spans under it. */
  const subtreeCost = createMemo(() => {
    const children = tree();
    const costs = new Map<string, number | null>();
    const total = (span: TraceSpan): number | null => {
      let sum = span.costUsd ?? null;
      for (const child of children.get(span.id) ?? []) {
        const part = total(child);
        if (part !== null) sum = (sum ?? 0) + part;
      }
      costs.set(span.id, sum);
      return sum;
    };
    for (const span of children.get(null) ?? []) total(span);
    return costs;
  });

  /** The finished model or tool call that took longest. A wait is not work, and one call has no slowest. */
  const slowestId = createMemo(() => {
    const children = tree();
    const finished = view().spans.filter(
      (span) => span.end !== null && !children.has(span.id) && (span.kind === "model" || span.kind === "tool"),
    );
    if (finished.length < 2) return null;
    const took = (span: TraceSpan) => spanEnd(span, 0) - span.start;
    return finished.reduce((slowest, span) => (took(span) > took(slowest) ? span : slowest)).id;
  });

  /** The direct children of a parent row, as pieces of its lane. A subagent is a wait for the parent. */
  const segments = (id: string): TraceSegment[] => {
    const children = tree();
    return (children.get(id) ?? []).map((child) => ({
      id: child.id,
      kind: children.has(child.id) ? "waiting" : child.kind,
      failed: child.failed === true,
      running: child.end === null,
      start: position(child.start),
      end: position(spanEnd(child, view().now)),
    }));
  };

  /**
   * The row that a handoff line starts from: the parent's last handoff step that ends by the time the
   * subagents start, or else the parent row. A line from the parent row would cross that step's bar.
   */
  const handoffRow = (shown: TraceRow[], parentId: string, from: number, to: number, start: number) => {
    for (let at = to - 1; at > from; at--) {
      const span = shown[at]?.span;
      if (span?.kind !== "handoff" || span.end === null || span.end > start) continue;
      if (parentOf().get(span.id) === parentId) return at;
    }
    return from;
  };

  /**
   * The handoff lines. Subagents that one parent starts at one time share one line, so that their
   * lines do not lie on top of each other, and each subagent gets a branch from it.
   */
  const handoffs = createMemo(() => {
    const shown = rows();
    const index = new Map(shown.map((row, at) => [row.span.id, at]));
    const trunks = new Map<string, TraceHandoff>();
    const branches = new Map<string, TraceHandoff>();
    shown.forEach((row, at) => {
      const parentId = parentOf().get(row.span.id);
      if (parentId === undefined || row.hue === null || row.hue === hues().get(parentId)) return;
      const from = index.get(parentId);
      if (from === undefined) return;
      const start = position(row.span.start);
      const id = `${parentId}@${start}`;
      const trunk = trunks.get(id) ?? {
        id,
        at: start,
        from: handoffRow(shown, parentId, from, at, row.span.start),
        to: at,
        hue: hues().get(parentId) ?? null,
      };
      trunk.to = at;
      trunks.set(id, trunk);
      branches.set(row.span.id, trunk);
    });
    const lines = new Map<string, TraceRowLines>();
    const linesOf = (id: string) => {
      const known = lines.get(id);
      if (known) return known;
      const created: TraceRowLines = { branch: null, passes: [] };
      lines.set(id, created);
      return created;
    };
    for (const [id, trunk] of branches)
      linesOf(id).branch = { at: trunk.at, hue: trunk.hue, last: index.get(id) === trunk.to };
    for (const trunk of trunks.values())
      for (const row of shown.slice(trunk.from + 1, trunk.to))
        if (row.parent) linesOf(row.span.id).passes.push({ at: trunk.at, hue: trunk.hue });
    return { trunks: [...trunks.values()], lines };
  });

  const running = createMemo(() => view().spans.some((span) => span.end === null));
  const showNow = () => state.replay !== null || running();

  const barLabel = (span: TraceSpan) => {
    const duration = formatDuration(spanEnd(span, view().now) - span.start, format);
    const cost = subtreeCost().get(span.id);
    return cost === null || cost === undefined ? duration : `${duration} · ${formatCost(cost, format)}`;
  };

  const toggle = (id: string) =>
    setState((draft) => {
      draft.collapsed[id] = !draft.collapsed[id];
    });

  // The replay moves on each animation frame. It keeps its own clock, so a slow frame does not slow it.
  let frame = 0;
  let lastFrame = 0;
  let replayAt = 0;

  const stopFrames = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };
  onCleanup(stopFrames);

  /*
   * The list fades at an edge where it has more rows. The axis row and the parent rows stay at the
   * top as the list scrolls, so the top fade starts under the last of them, not at the top edge.
   */
  const fades = createScrollFades();
  const [stack, setStack] = createSignal(0);
  let body: HTMLElement | undefined;
  const measureStack = () => {
    if (!body) return;
    const top = body.getBoundingClientRect().top;
    let bottom = 0;
    for (const row of body.querySelectorAll<HTMLElement>(".trace-axis-row, .trace-row[data-parent]")) {
      if (row.closest("[inert]")) continue;
      const rect = row.getBoundingClientRect();
      // A row is at the top when it is at or above the place where it stops.
      const stuck = rect.top - top <= Number.parseFloat(getComputedStyle(row).top) + 1;
      if (stuck && rect.bottom > top) bottom = Math.max(bottom, rect.bottom - top);
    }
    setStack(bottom);
  };
  const measureScroll = () => {
    fades.measure();
    measureStack();
  };
  const scrollObserver = new ResizeObserver(measureScroll);
  onCleanup(() => scrollObserver.disconnect());
  const bindBody = (element: HTMLElement) => {
    body = element;
    fades.adopt(element);
    scrollObserver.observe(element);
  };
  const stackStyle = () => ({ "--trace-stack": `${stack()}px` });

  const onFrame = (time: number) => {
    replayAt += (time - lastFrame) * Number(state.speed);
    lastFrame = time;
    if (replayAt >= range().duration) {
      stopReplay();
      return;
    }
    setState((draft) => {
      draft.replay = replayAt;
    });
    frame = requestAnimationFrame(onFrame);
  };

  const playFrames = () => {
    stopFrames();
    lastFrame = performance.now();
    frame = requestAnimationFrame(onFrame);
  };

  const stopReplay = () => {
    stopFrames();
    setState((draft) => {
      draft.replay = null;
      draft.playing = false;
    });
  };

  /** Starts a replay from the start of the run, or pauses or resumes the replay that shows. */
  const togglePlay = () => {
    if (state.replay === null) replayAt = 0;
    const playing = !state.playing;
    setState((draft) => {
      draft.replay = replayAt;
      draft.playing = playing;
    });
    if (playing) playFrames();
    else stopFrames();
  };

  /** Plays the replay again from the start of the run. */
  const restartReplay = () => {
    replayAt = 0;
    setState((draft) => {
      draft.replay = 0;
      draft.playing = true;
    });
    playFrames();
  };

  const playLabel = () => {
    if (state.playing) return t("chat.trace.pauseReplay");
    return state.replay === null ? t("chat.trace.replay") : t("chat.trace.resumeReplay");
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
    if (event.key.toLocaleLowerCase() !== "f") return;
    event.preventDefault();
    event.stopPropagation();
    searchInput?.focus();
    searchInput?.select();
  };

  // Named functions, not ternaries in props: see `AgentActivity.tsx`.
  const nowStyle = () => ({ "--trace-at": String(position(view().now)) });
  const speedLabel = (level: SpeedLevel) => t("chat.trace.speedLevel", { speed: format.number(Number(level)) });
  const handoffStyle = (handoff: TraceHandoff) => ({
    "--trace-at": String(handoff.at),
    "--trace-from": String(handoff.from),
    "--trace-to": String(handoff.to),
  });
  const shownDuration = () => state.replay ?? range().duration;
  const formatShownDuration = (ms: number) => formatDuration(ms, format);
  const formatShownCost = (usd: number) => formatCost(usd, format);

  /** One row of the list, with the values that it reads from the whole trace. */
  const rowView = (row: () => TraceRow) => (
    <TraceRowView
      row={row()}
      open={matches() !== null || !state.collapsed[row().span.id]}
      slowest={slowestId() === row().span.id}
      label={barLabel(row().span)}
      start={position(row().span.start)}
      end={position(spanEnd(row().span, view().now))}
      segments={rowSegments(row())}
      lines={handoffs().lines.get(row().span.id)}
      hovered={hovered()}
      focusable={activeId() === row().span.id}
      selectable={canSelect(row().span.id)}
      onToggle={() => toggle(row().span.id)}
      onFocus={() => setActive(row().span.id)}
      onKeyDown={(event) => onRowKeyDown(event, row())}
      onSelect={() => props.onSelectSpan?.(row().span.id)}
    />
  );
  const rowSegments = (row: TraceRow) => (row.parent ? segments(row.span.id) : []);

  return (
    <section
      ref={root}
      class={["trace", props.class]}
      data-slot="trace"
      data-running={running() ? "" : undefined}
      data-replay={state.replay === null ? undefined : ""}
      aria-label={t("chat.trace.title")}
      onKeyDown={onKeyDown}
    >
      <header class="trace-header">
        <h2 class="trace-title">{t("chat.trace.title")}</h2>
        <div class="trace-search">
          <Search class="trace-search-icon" aria-hidden="true" />
          <Input
            ref={searchInput}
            type="search"
            size="sm"
            class="trace-search-input"
            placeholder={t("chat.trace.search")}
            aria-label={t("chat.trace.search")}
            value={state.query}
            onValueChange={(query) =>
              setState((draft) => {
                draft.query = query;
              })
            }
          />
          <Kbd class="trace-search-kbd" aria-hidden="true">
            {SHORTCUT[props.keyboard]}
          </Kbd>
        </div>
        {props.actions}
      </header>

      <dl class="trace-totals">
        <TraceTotal label={t("chat.trace.duration")} value={shownDuration()} format={formatShownDuration} />
        <Show when={totals().cost}>
          {(cost) => <TraceTotal label={t("chat.trace.cost")} value={cost()} format={formatShownCost} />}
        </Show>
        <Show when={totals().tokens}>
          {(tokens) => <TraceTotal label={t("chat.trace.tokens")} value={tokens()} format={format.compact} />}
        </Show>
        <TraceTotal label={t("chat.trace.llmCalls")} value={totals().modelCalls} format={format.number} />
        <TraceTotal label={t("chat.trace.toolCalls")} value={totals().toolCalls} format={format.number} />
        <TraceTotal label={t("chat.trace.errors")} value={totals().errors} format={format.number} />
      </dl>

      <div class={["trace-body", fades.classes()]} style={stackStyle()} ref={bindBody} onScroll={measureScroll}>
        <div
          class="trace-grid"
          ref={(element) => scrollObserver.observe(element)}
          onPointerOver={onPointerOver}
          onPointerLeave={() => setHovered(null)}
        >
          <div class="trace-row trace-axis-row">
            <div class="trace-name trace-axis-name">
              <Workflow class="trace-icon" aria-hidden="true" />
              {t("chat.trace.steps")}
            </div>
            <div class="trace-lane" aria-hidden="true">
              <For each={ticks()} keyed={false}>
                {(time) => (
                  <span class="trace-tick" style={{ "--trace-at": String(position(range().origin + time())) }}>
                    {formatDuration(time(), format)}
                  </span>
                )}
              </For>
              <Show when={showNow()}>
                <span class="trace-now-dot" style={nowStyle()} />
              </Show>
            </div>
          </div>

          <Show when={rows().length > 0}>
            <div class="trace-overlay" aria-hidden="true">
              <For each={ticks()} keyed={false}>
                {(time) => (
                  <span class="trace-gridline" style={{ "--trace-at": String(position(range().origin + time())) }} />
                )}
              </For>
              <For each={handoffs().trunks} keyed={(handoff) => handoff.id}>
                {(handoff) => (
                  <span class="trace-handoff" data-hue={hueValue(handoff().hue)} style={handoffStyle(handoff())} />
                )}
              </For>
              <Show when={showNow()}>
                <span class="trace-now" style={nowStyle()} />
              </Show>
            </div>
          </Show>

          <Show
            when={rows().length > 0}
            fallback={
              <Show when={state.query.trim()}>
                {(query) => (
                  <div class="trace-empty" role="status">
                    <p class="trace-empty-title">{t("chat.trace.empty.title")}</p>
                    <p class="trace-empty-description">{t("chat.trace.empty.description", { query: query() })}</p>
                  </div>
                )}
              </Show>
            }
          >
            <TraceBranches branches={layout().branches} row={rowView} />
          </Show>
        </div>
      </div>

      <footer class="trace-footer">
        <div class="trace-replay">
          <IconButton
            label={playLabel()}
            variant="outline"
            size="icon-sm"
            class="trace-play"
            disabled={range().duration === 0}
            onClick={togglePlay}
          >
            <Show when={state.playing} fallback={<Play />}>
              <Pause />
            </Show>
          </IconButton>
          <IconButton
            label={t("chat.trace.restartReplay")}
            variant="ghost"
            size="icon-sm"
            disabled={range().duration === 0}
            onClick={restartReplay}
          >
            <RotateCcw />
          </IconButton>
          <Show when={state.replay !== null}>
            <IconButton label={t("chat.trace.stopReplay")} variant="ghost" size="icon-sm" onClick={stopReplay}>
              <Square />
            </IconButton>
          </Show>
          <Select<SpeedLevel>
            class="trace-select"
            options={SPEED_LEVELS}
            value={state.speed}
            onChange={(level) => {
              if (level)
                setState((draft) => {
                  draft.speed = level;
                });
            }}
            placement="top-start"
            onOpenChange={onMenuOpen}
            itemComponent={(itemProps) => (
              <SelectItem item={itemProps.item}>{speedLabel(itemProps.item.rawValue)}</SelectItem>
            )}
          >
            <SelectTrigger size="sm" class="trace-select-trigger" aria-label={t("chat.trace.replaySpeed")}>
              <SelectValue<SpeedLevel>>{(select) => speedLabel(select.selectedOption())}</SelectValue>
            </SelectTrigger>
            <SelectContent mount={menuMount()} />
          </Select>
        </div>
        <ul class="trace-legend" aria-label={t("chat.trace.legend")}>
          <For each={LEGEND}>
            {(kind) => (
              <li class="trace-legend-item">
                <span class="trace-swatch" data-kind={kind} aria-hidden="true" />
                {t(KIND_LABEL[kind])}
              </li>
            )}
          </For>
          <li class="trace-legend-item">
            <span class="trace-swatch" data-kind="handoff" aria-hidden="true" />
            {t("chat.trace.kind.handoff")}
          </li>
          <li class="trace-legend-item">
            <span class="trace-swatch" data-kind="model" data-failed="" aria-hidden="true" />
            {t("chat.trace.kind.failed")}
          </li>
        </ul>
      </footer>
    </section>
  );
}

/**
 * A total. When it changes, the digits that change roll in: from below when the total grows, from
 * above when it shrinks, as a replay restarts. Assistive technology reads the plain text.
 */
function TraceTotal(props: { label: string; value: number; format: (value: number) => string }) {
  const roll = createDigitRoll(() => props.value, { animate: () => !prefersReducedMotion() });
  const shown = createMemo<{ value: number; text: string; previous: string }>((last) => {
    const value = roll.displayed();
    const text = props.format(value);
    return { value, text, previous: last?.text ?? text };
  });
  const direction = createMemo<{ value: number; up: boolean }>((last) => ({
    value: shown().value,
    up: last === undefined || shown().value >= last.value,
  }));
  // The texts line up at their ends, so "9.9s" to "10s" rolls the digits, not the unit.
  const changed = (character: string, index: number) => {
    const { text, previous } = shown();
    return /\d/u.test(character) && previous[previous.length - text.length + index] !== character;
  };
  return (
    <div class="trace-total">
      <dt class="trace-total-label">{props.label}</dt>
      <dd class="trace-total-value">
        <span class="sr-only">{props.format(props.value)}</span>
        <span
          ref={roll.ref}
          class="t-digit-group"
          style={{ "--digit-dir-y": direction().up ? 1 : -1 }}
          aria-hidden="true"
        >
          <For each={shown().text.split("")} keyed={false}>
            {(character, index) => (
              <span class={changed(character(), index) ? "t-digit" : undefined}>{character()}</span>
            )}
          </For>
        </span>
      </dd>
    </div>
  );
}

/** The rows of a tree level. Each parent row and its rows sit in one item, so the parent row stays at the
 * top only while its own rows scroll under it. */
function TraceBranches(props: { branches: TraceBranch[]; row: (row: () => TraceRow) => JSX.Element }) {
  /** The rows under a folded row stay in the page while they slide closed; no one can reach them. */
  const folded = (branch: TraceBranch) => (branch.open ? undefined : true);
  return (
    <ol class="trace-rows">
      <For each={props.branches} keyed={(branch) => branch.row.span.id}>
        {(branch) => (
          <li class="trace-branch">
            {props.row(() => branch().row)}
            <Show when={branch().children.length > 0}>
              <div class="trace-branch-children" data-open={branch().open ? "" : undefined} inert={folded(branch())}>
                <div class="trace-branch-clip">
                  <TraceBranches branches={branch().children} row={props.row} />
                </div>
              </div>
            </Show>
          </li>
        )}
      </For>
    </ol>
  );
}

function TraceRowView(props: {
  row: TraceRow;
  open: boolean;
  slowest: boolean;
  label: string;
  /** Where the bar starts and ends on the timeline, from 0 to 1. */
  start: number;
  end: number;
  /** The pieces of a parent row's lane. A parent row shows these and no bar of its own. */
  segments: TraceSegment[];
  /** The handoff lines that this row draws over its own background. */
  lines: TraceRowLines | undefined;
  /** The span under the pointer: this row, or a piece of this row's lane. */
  hovered: string | null;
  /** True on the one row that the Tab key goes to. */
  focusable: boolean;
  selectable: boolean;
  onToggle: () => void;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onSelect: () => void;
}) {
  const { t } = useText();
  const span = () => props.row.span;
  const running = () => span().end === null;
  const rowStyle = () => ({ "--trace-depth": String(props.row.depth) });
  const barStyle = () => ({ "--trace-at": String(props.start), "--trace-width": String(props.end - props.start) });
  const segmentStyle = (segment: TraceSegment) => ({
    "--trace-at": String(segment.start),
    "--trace-width": String(segment.end - segment.start),
  });
  const labelStyle = () => ({ "--trace-at": String(props.end) });
  const lineStyle = (line: TraceLine) => ({ "--trace-at": String(line.at) });
  const toggleLabel = () =>
    props.open ? t("chat.trace.collapse", { name: span().name }) : t("chat.trace.expand", { name: span().name });
  const expanded = () => (props.open ? "true" : "false");
  const tabIndex = () => (props.focusable ? 0 : -1);
  const select = () => {
    if (props.selectable) props.onSelect();
  };
  return (
    <div
      class="trace-row"
      data-span-id={span().id}
      data-hovered={props.hovered === span().id ? "" : undefined}
      data-selectable={props.selectable ? "" : undefined}
      data-parent={props.row.parent ? "" : undefined}
      data-failed={span().failed ? "" : undefined}
      data-running={running() ? "" : undefined}
      data-hue={hueValue(props.row.hue)}
      style={rowStyle()}
    >
      <div class="trace-name">
        <Show when={props.row.parent} fallback={<span class="trace-toggle-space" />}>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            class="trace-toggle"
            tabindex={-1}
            aria-expanded={expanded()}
            aria-label={toggleLabel()}
            onClick={() => props.onToggle()}
          >
            <ChevronDown class="trace-toggle-icon" aria-hidden="true" />
          </Button>
        </Show>
        {/* The keyboard stop of the row. Left and Right fold the row, so the chevron needs no stop. */}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          class="trace-name-button"
          tabindex={tabIndex()}
          aria-expanded={props.row.parent ? expanded() : undefined}
          aria-label={`${span().name}, ${props.label}`}
          onFocus={() => props.onFocus()}
          onKeyDown={(event: KeyboardEvent) => props.onKeyDown(event)}
          onClick={select}
        >
          <TraceGlyph span={span()} />
          <Show when={running()}>
            <LoaderCircle class="trace-spinner" aria-hidden="true" />
          </Show>
          <span class="trace-span-name" title={span().name}>
            {span().name}
          </span>
          <Show when={span().detail}>{(detail) => <span class="trace-span-detail">{detail()}</span>}</Show>
        </Button>
      </div>
      <div class="trace-lane">
        <For each={props.lines?.passes ?? []} keyed={false}>
          {(line) => (
            <span
              class="trace-handoff trace-handoff-pass"
              data-hue={hueValue(line().hue)}
              style={lineStyle(line())}
              aria-hidden="true"
            />
          )}
        </For>
        <Show when={props.lines?.branch}>
          {(branch) => (
            <span
              class="trace-handoff trace-handoff-end"
              data-last={branch().last ? "" : undefined}
              data-hue={hueValue(branch().hue)}
              style={lineStyle(branch())}
              aria-hidden="true"
            />
          )}
        </Show>
        <Show
          when={props.row.parent}
          fallback={
            <span
              class="trace-bar"
              data-kind={span().kind}
              data-failed={span().failed ? "" : undefined}
              data-running={running() ? "" : undefined}
              style={barStyle()}
            >
              <Show when={span().failed}>
                <X class="trace-bar-icon" aria-hidden="true" />
              </Show>
            </span>
          }
        >
          {/* The track is the parent's own time, so a wait before its first child still shows. */}
          <span class="trace-bar trace-track" data-kind={span().kind} style={barStyle()} aria-hidden="true" />
          <For each={props.segments} keyed={(segment) => segment.id}>
            {(segment) => (
              <span
                class="trace-bar trace-segment"
                data-span-id={segment().id}
                data-hovered={props.hovered === segment().id ? "" : undefined}
                data-kind={segment().kind}
                data-failed={segment().failed ? "" : undefined}
                data-running={segment().running ? "" : undefined}
                style={segmentStyle(segment())}
              />
            )}
          </For>
        </Show>
        <span class="trace-bar-label" style={labelStyle()}>
          {props.label}
          <Show when={props.slowest}>
            <Badge variant="warning-light" class="trace-slowest">
              {t("chat.trace.slowest")}
            </Badge>
          </Show>
        </span>
      </div>
    </div>
  );
}

/** The icon of a row on a small tile. An agent's icon has the agent's colour. */
function TraceGlyph(props: { span: TraceSpan }) {
  const icon = () => (props.span.icon === undefined ? KIND_ICON[props.span.kind] : SPAN_ICON[props.span.icon]);
  return (
    <span
      class="trace-glyph"
      data-agent={props.span.icon === "agent" ? "" : undefined}
      data-failed={props.span.failed ? "" : undefined}
      aria-hidden="true"
    >
      <Dynamic component={icon()} class="trace-glyph-icon" />
    </span>
  );
}

export interface TraceWaterfallDialogProps extends Omit<TraceWaterfallProps, "actions" | "class"> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The trace of a turn in a dialog, as the steps row of the turn opens it. */
export function TraceWaterfallDialog(props: TraceWaterfallDialogProps) {
  const { t } = useText();
  // A controlled dialog has no Kobalte trigger, so it keeps the element that opened it itself.
  let opener: HTMLElement | undefined;
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay>
          <Dialog.Content
            as="div"
            class="trace-dialog"
            aria-label={t("chat.trace.title")}
            onOpenAutoFocus={() => {
              const active = document.activeElement;
              opener = active instanceof HTMLElement && active !== document.body ? active : undefined;
            }}
            onCloseAutoFocus={(event) => {
              if (!opener?.isConnected) return;
              event.preventDefault();
              opener.focus({ preventScroll: true });
            }}
          >
            <TraceWaterfall
              spans={props.spans}
              now={props.now}
              keyboard={props.keyboard}
              defaultQuery={props.defaultQuery}
              canSelectSpan={props.canSelectSpan}
              onSelectSpan={props.onSelectSpan}
              class="trace-in-dialog"
              actions={
                <IconButton label={t("common.close")} variant="ghost" onClick={() => props.onOpenChange(false)}>
                  <X />
                </IconButton>
              }
            />
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
