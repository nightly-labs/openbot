import type { ChannelIcon, ChannelMember } from "@openbot/contracts/ipc";
import {
  AppWindow,
  ContextMenu,
  DropdownMenu,
  EyeOff,
  Input,
  Maximize2,
  PanelRight,
  Plus,
  Search,
  Settings,
} from "@openbot/ui";
import {
  createEffect,
  createMemo,
  createSignal,
  createStore,
  createUniqueId,
  For,
  flush,
  onCleanup,
  onSettled,
  Show,
  untrack,
} from "solid-js";
import { AmbientMotion } from "../../ambient-motion";
import type { AvatarMood } from "../../bloub-avatar";
import { createMenuSearch } from "../../components/createMenuSearch";
import { createScrollFades } from "../../components/createScrollFades";
import type { ComposerAgent } from "../../data";
import {
  createMotion,
  GooFilter,
  LIQUID_CLOSE,
  LIQUID_OPEN,
  LIQUID_PAD,
  SLIDE_END,
  SNAPPY,
  SOFT,
  type Spring,
  stagedCurve,
  WOBBLY,
} from "../../liquid";
import { useText } from "../../text";
import { prefersReducedMotion } from "../../utils";
import { AgentAvatar } from "../agents/AgentAvatar";
import { ChannelAvatar } from "../channels/ChannelAvatar";
import type { VoicePhase } from "../conversation/VoiceRecordingMorph";
import { SidebarAgentIndicator, SidebarPinnedAvatar } from "../sidebar/SidebarAgentIndicator";
import type { SidebarAgentState } from "../sidebar/sidebar-types";
import {
  AgentDockChat,
  type AgentDockChatAnswers,
  type AgentDockChatModel,
  type AgentDockChatVoice,
  type AgentDockPendingMessage,
  pendingMessageDelivered,
} from "./AgentDockChat";
import { AgentDockShelf, type AgentDockShelfResult } from "./AgentDockShelf";
import {
  addCenterY,
  DOCK_LEFT,
  DOCK_PAD,
  DOCK_WIDTH,
  dockBand,
  dockHandlePath,
  dockHeight,
  dockPath,
  HANDLE_STROKE,
  LIQUID_HEIGHT,
  LIQUID_WIDTH,
  MAX_STRETCH,
  neckCenterInBand,
  neckPath,
  PANEL_GAP,
  PANEL_HEIGHT,
  PANEL_RADIUS,
  PANEL_WIDTH,
  SEAT,
  SEAT_CENTER_X,
  SEAT_PITCH,
  SEAT_VIEW_INSET,
  STAGE_WIDTH,
  STRETCH_FOLLOW,
  STRETCH_PER_SPEED,
  seatCenterY,
  seatsHeight,
  seatView,
  seatViewTop,
  TUCK,
  TUCK_DISTANCE,
} from "./agent-dock-motion";

export type { AgentDockChatAnswers, AgentDockChatModel } from "./AgentDockChat";
export type { AgentDockShelfResult } from "./AgentDockShelf";

export interface AgentDockSeatRef {
  kind: "agent" | "channel";
  id: string;
}

export interface AgentDockChannel {
  id: string;
  name: string;
  title: string;
  members: ChannelMember[];
  icon: ChannelIcon | null;
  imageUrl: string | null;
}

export type AgentDockSeat =
  | {
      kind: "agent";
      agent: ComposerAgent;
      mood: AvatarMood;
      state: SidebarAgentState | undefined;
      temporary?: boolean | undefined;
    }
  | {
      kind: "channel";
      channel: AgentDockChannel;
      state: SidebarAgentState | undefined;
      temporary?: boolean | undefined;
    };

export function agentDockBody(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".agent-dock .agent-dock-hit");
}

export function agentDockSeatKey(seat: AgentDockSeatRef): string {
  return `${seat.kind}:${seat.id}`;
}

function seatRef(seat: AgentDockSeat): AgentDockSeatRef {
  return seat.kind === "agent" ? { kind: "agent", id: seat.agent.id } : { kind: "channel", id: seat.channel.id };
}

function refOfKey(key: string): AgentDockSeatRef {
  const kind = key.startsWith("channel:") ? "channel" : "agent";
  return { kind, id: key.slice(kind.length + 1) };
}

function seatName(seat: AgentDockSeat): string {
  return seat.kind === "agent" ? seat.agent.name : seat.channel.name;
}

export type AgentDockSendResult = { messageId: string } | { error: string };

export interface AgentDockVoiceTarget {
  seatKey: string;
  draft: () => string;
  setDraft: (text: string) => void;
  send: (text: string) => void;
  showError: (message: string) => void;
  focus: () => void;
}

export interface AgentDockVoice {
  phase: VoicePhase;
  seatKey: string | null;
  levels: readonly number[];
  elapsedSeconds: number;
  liveText: string;
  modelProgress: number | null;
  onStart: (target: AgentDockVoiceTarget) => void;
  onCancel: () => void;
  onFinish: () => void;
  onSend: () => void;
}

export type AgentDockDragPhase = "start" | "move" | "end";

export interface AgentDockShapeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AgentDockProps {
  seats: readonly AgentDockSeat[];
  available: readonly ComposerAgent[];
  availableChannels: readonly AgentDockChannel[];
  chat: (seat: AgentDockSeatRef) => AgentDockChatModel;
  onOpenChange?: ((seat: AgentDockSeatRef | null) => void) | undefined;
  onAdd: (seat: AgentDockSeatRef) => void;
  onRemove: (seat: AgentDockSeatRef) => void;
  onSend: (seat: AgentDockSeatRef, text: string) => Promise<AgentDockSendResult>;
  onOpenInMain: (seat: AgentDockSeatRef) => void;
  onOpenWindow?: ((agentId: string) => void) | undefined;
  agents: ComposerAgent[];
  onSelectAgent?: ((agentId: string) => void) | undefined;
  onOpenLink?: ((url: string) => void) | undefined;
  answers?: AgentDockChatAnswers | undefined;
  onOpenSettings?: (() => void) | undefined;
  onHide?: (() => void) | undefined;
  onMove?: ((seat: AgentDockSeatRef, before: AgentDockSeatRef | null) => Promise<void> | void) | undefined;
  closeRequest?: number | undefined;
  blurRequest?: number | undefined;
  side?: "left" | "right" | undefined;
  tucked?: boolean | undefined;
  onDrag?: ((phase: AgentDockDragPhase) => void) | undefined;
  results?: readonly AgentDockShelfResult[] | undefined;
  onShelfChange?: ((shown: boolean) => void) | undefined;
  voice?: AgentDockVoice | undefined;
  onShapeChange?: ((parts: readonly AgentDockShapeRect[] | null) => void) | undefined;
}

interface DockState {
  seats: string[];
  open: string | null;
  shown: string | null;
  drafts: Record<string, string>;
  pending: Record<string, AgentDockPendingMessage[]>;
  errors: Record<string, string | null>;
  sending: Record<string, boolean>;
  focus: number;
  pinned: boolean;
}

let pendingKey = 0;

const SEAT_LAG = 0.3;
const SHELF_GAP = 12;
const SEAT_FADE = 24;
const ADD_SEARCH_MIN = 9;
const ADD_MORPH_MS = 200;
const ADD_MORPH_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const SHAPE_MARGIN = 14;
const SEAT_DRAG_START = 4;
const SEAT_DRAG_SCROLL = 0.25;

export function AgentDock(props: AgentDockProps) {
  const { t } = useText();
  const filterId = `agent-dock-goo-${createUniqueId()}`;
  const initialSeats = untrack(() => props.seats.map((seat) => agentDockSeatKey(seatRef(seat))));
  const [state, setState] = createStore<DockState>({
    seats: [...initialSeats],
    open: null,
    shown: null,
    drafts: {},
    pending: {},
    errors: {},
    sending: {},
    focus: 0,
    pinned: false,
  });
  const seatProps = createMemo((previous?: Map<string, AgentDockSeat>) => {
    const next = new Map(previous);
    for (const seat of props.seats) next.set(agentDockSeatKey(seatRef(seat)), seat);
    return next;
  });
  const seatFor = (id: string) => seatProps().get(id);
  const seatAgent = (agentId: string) => {
    const seat = seatFor(agentDockSeatKey({ kind: "agent", id: agentId }));
    return seat?.kind === "agent" ? seat.agent : undefined;
  };
  const leaving = new Set<string>();

  let stage!: HTMLDivElement;
  let liquid!: HTMLDivElement;
  let dockBody!: SVGPathElement;
  let dockEdge!: SVGPathElement;
  let panelEdge!: SVGRectElement;
  let panelBody!: HTMLDivElement;
  let neck!: SVGPathElement;
  let drop!: HTMLDivElement;
  let panelContent!: HTMLElement;
  let addSeat!: HTMLDivElement;
  let hitArea!: HTMLDivElement;
  let handleArc!: SVGPathElement;
  let handleHit!: SVGPathElement;
  let shelf: HTMLUListElement | undefined;
  let shelfShown = false;
  let shelfAgent: string | null = null;
  let shelfHeight = 0;
  let shelfCard = 0;
  let seatScroll!: HTMLDivElement;
  let seatList!: HTMLDivElement;
  const seatElements = new Map<string, HTMLElement>();
  const seatFades = createScrollFades();
  onCleanup(() => seatFades.stop());

  let moving = false;
  const motion = createMotion(
    () => render(),
    (value) => {
      moving = value;
      reportShape();
    },
  );
  const initialCount = initialSeats.length;
  const dockH = motion.spring(dockHeight(initialCount), WOBBLY);
  const addY = motion.spring(addCenterY(initialCount), WOBBLY);
  const shelfOffset = motion.spring(0, WOBBLY);
  const listH = motion.spring(SEAT_VIEW_INSET + seatsHeight(initialCount), SOFT);
  const panelOpen = motion.spring(0, LIQUID_OPEN);
  const closing = motion.spring(0, SOFT);
  const neckY = motion.spring(PANEL_HEIGHT / 2, WOBBLY);
  const neckSize = motion.spring(0, SNAPPY);
  const originY = motion.spring(PANEL_HEIGHT / 2, SNAPPY);
  const dropX = motion.spring(SEAT_CENTER_X, SOFT);
  const dropY = motion.spring(PANEL_HEIGHT / 2, SOFT);
  const dropR = motion.spring(0, SNAPPY);
  const stretch = motion.spring(0, STRETCH_FOLLOW);
  const tuck = motion.spring(untrack(() => props.tucked) ? TUCK_DISTANCE : 0, TUCK);
  const [dragging, setDragging] = createSignal(false);
  const [pointerOn, setPointerOn] = createSignal(false);
  const ambientMotion = () => pointerOn() || dragging() || state.open !== null;
  const seatMotion = new Map<string, { y: Spring; scale: Spring }>();

  function seatSprings(id: string, y = PANEL_HEIGHT / 2) {
    let entry = seatMotion.get(id);
    if (!entry) {
      entry = { y: motion.spring(y, WOBBLY), scale: motion.spring(1, WOBBLY) };
      seatMotion.set(id, entry);
    }
    return entry;
  }
  initialSeats.forEach((id, index) => {
    seatSprings(id, seatCenterY(index, initialCount));
  });

  function placeSeat(element: HTMLElement, springs: { y: Spring; scale: Spring }) {
    const y = springs.y.value - SEAT / 2 - seatViewTop(dockH.value);
    element.style.transform = `translateY(${y}px) scale(${Math.max(0, springs.scale.value)})`;
  }

  function maxScroll(count: number) {
    return seatsHeight(count) - seatView(count);
  }

  function seatY(id: string, seats: readonly string[] = state.seats, scroll = seatScroll.scrollTop) {
    const count = seats.length;
    const first = seatCenterY(0, count);
    const last = first + Math.max(0, seatView(count) - SEAT_PITCH);
    return Math.min(last, Math.max(first, seatCenterY(seats.indexOf(id), count) - scroll));
  }

  function shelfTarget(seats: readonly string[] = state.seats) {
    const id = shelfAgent === null ? null : agentDockSeatKey({ kind: "agent", id: shelfAgent });
    if (id === null || !seats.includes(id) || leaving.has(id)) return 0;
    const line = Math.min(PANEL_HEIGHT, Math.max(shelfHeight, seatY(id, seats) + shelfCard / 2));
    return line - (addCenterY(seats.length) - SEAT / 2);
  }

  function placeShelf() {
    const target = shelfTarget();
    if (!shelfShown) {
      shelfOffset.jump(target);
      return;
    }
    if (shelfOffset.target === target) return;
    shelfOffset.to(target);
    motion.kick();
  }

  function drawShelf() {
    if (!shelf) return;
    const line = addY.value - SEAT / 2 + shelfOffset.value - stretch.value * SEAT_LAG;
    shelf.style.bottom = `${PANEL_HEIGHT - line}px`;
  }

  function measureShelf() {
    if (!shelf) return;
    shelfHeight = shelf.offsetHeight;
    const card = shelf.lastElementChild;
    shelfCard = card instanceof HTMLElement ? card.offsetHeight : 0;
  }

  function revealScroll(index: number) {
    const count = state.seats.length;
    const top = SEAT_VIEW_INSET + index * SEAT_PITCH;
    const height = SEAT_VIEW_INSET + seatView(count);
    const current = seatScroll.scrollTop;
    const scroll = Math.min(top - SEAT_FADE, Math.max(current, top + SEAT + SEAT_FADE - height));
    return Math.min(maxScroll(count), Math.max(0, scroll));
  }

  function scrollSeats(top: number) {
    if (Math.abs(seatScroll.scrollTop - top) < 1) return;
    seatScroll.scrollTo({ top, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }

  function followScroll() {
    seatFades.measure();
    placeShelf();
    const open = state.open;
    if (!open) return;
    neckY.to(seatY(open));
    motion.kick();
  }

  function render() {
    const height = dockH.value;
    const pull = stretch.value;
    const body = dockPath(height, pull);
    dockBody.setAttribute("d", body);
    dockEdge.setAttribute("d", body);
    const { top: bandTop, bottom: bandBottom } = dockBand(height, pull);
    const cut = LIQUID_PAD + DOCK_LEFT - 2;
    liquid.style.clipPath = `polygon(0 0, ${cut}px 0, ${cut}px ${bandTop}px, 100% ${bandTop}px, 100% ${bandBottom}px, ${cut}px ${bandBottom}px, ${cut}px 100%, 0 100%)`;
    addSeat.style.transform = `translateY(${addY.value - SEAT / 2 - pull * SEAT_LAG}px)`;
    seatScroll.style.top = `${seatViewTop(height) - pull * SEAT_LAG}px`;
    seatScroll.style.height = `${Math.max(0, height - DOCK_PAD * 2 - SEAT + SEAT_VIEW_INSET)}px`;
    seatList.style.height = `${Math.max(0, listH.value)}px`;
    drawShelf();
    const arc = dockHandlePath(height, pull);
    handleArc.setAttribute("d", arc);
    handleHit.setAttribute("d", arc);
    hitArea.style.top = `${bandTop - LIQUID_PAD}px`;
    hitArea.style.height = `${bandBottom - bandTop}px`;
    stage.style.setProperty("--agent-dock-tuck", `${tuck.value}px`);

    for (const [id, element] of seatElements) {
      const springs = seatMotion.get(id);
      if (springs) placeSeat(element, springs);
    }

    const px = Math.max(0, panelOpen.value);
    const slide = Math.min(1, px / SLIDE_END);
    const start = SEAT_CENTER_X + SEAT / 2;
    const end = DOCK_LEFT - PANEL_GAP;
    const rightEdge = start + (end - start) * (1 - (1 - slide) ** 2);
    const seatTop = originY.value - SEAT / 2;
    const roomTop = (PANEL_HEIGHT - height) / 2 + DOCK_PAD;
    const roomBottom = (PANEL_HEIGHT + height) / 2 - DOCK_PAD;
    const dropHalf = SEAT * 1.1;
    const dropTop = Math.max(roomTop, originY.value - dropHalf);
    const dropBottom = Math.min(roomBottom, originY.value + dropHalf);
    const mode = Math.min(1, Math.max(0, closing.value));
    const top = stagedCurve(px, seatTop, roomTop + (dropTop - roomTop) * mode, 0);
    const bottom = stagedCurve(px, seatTop + SEAT, roomBottom + (dropBottom - roomBottom) * mode, PANEL_HEIGHT);
    const panelHeight = bottom - top;
    const width = SEAT + (PANEL_WIDTH - SEAT) * px ** (1 + 0.7 * mode);
    const py = (panelHeight - SEAT) / (PANEL_HEIGHT - SEAT);
    const openFree = (px - SLIDE_END * 0.8) / 0.3;
    const closeFree = (px - 0.16) / 0.2;
    const free = Math.min(1, Math.max(0, openFree + (closeFree - openFree) * mode));
    const radius = SEAT / 2 + (PANEL_RADIUS - SEAT / 2) * Math.min(1, py);
    panelBody.style.left = `${rightEdge - width}px`;
    panelBody.style.top = `${top}px`;
    panelBody.style.width = `${width}px`;
    panelBody.style.height = `${panelHeight}px`;
    panelBody.style.borderRadius = `${radius}px`;
    panelBody.style.opacity = px > 0.001 || py > 0.001 ? "1" : "0";
    panelEdge.setAttribute("x", `${LIQUID_PAD + rightEdge - width}`);
    panelEdge.setAttribute("y", `${LIQUID_PAD + top}`);
    panelEdge.setAttribute("width", `${Math.max(0, width)}`);
    panelEdge.setAttribute("height", `${Math.max(0, panelHeight)}`);
    panelEdge.setAttribute("rx", `${radius}`);
    panelEdge.style.opacity = `${Math.min(1, Math.max(0, (Math.min(px, py) - 0.5) / 0.3))}`;

    const reveal = Math.min(1, Math.max(0, (Math.min(px, py) - 0.86) / 0.14));
    panelContent.style.opacity = `${reveal}`;
    panelContent.style.transform = `scale(${0.96 + 0.04 * reveal})`;

    const neckOpen = Math.max(0, Math.min(neckSize.value, free));
    neck.setAttribute("d", neckPath(neckCenterInBand(neckY.value, neckOpen, height, pull), neckOpen));

    const r = Math.max(0, dropR.value);
    drop.style.transform = `translate(${dropX.value}px, ${dropY.value}px) translate(-50%, -50%) scale(${r / (SEAT / 2)})`;
  }

  function reportShape() {
    const report = props.onShapeChange;
    if (!report) return;
    if (moving) return report(null);
    const parts: Element[] = [dockEdge, ...(props.onDrag ? [handleHit] : [])];
    if (panelOpen.value > 0.001) parts.push(panelEdge);
    if (shelf && !shelf.hidden) parts.push(shelf);
    report(
      parts
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => ({
          x: rect.x - SHAPE_MARGIN,
          y: rect.y - SHAPE_MARGIN,
          width: rect.width + SHAPE_MARGIN * 2,
          height: rect.height + SHAPE_MARGIN * 2,
        })),
    );
  }

  const menuPlacement = (): "right-end" | "left-end" => (props.side === "left" ? "right-end" : "left-end");

  const [addQuery, setAddQuery] = createSignal("");
  const addSearch = () => props.available.length + props.availableChannels.length >= ADD_SEARCH_MIN;
  const addMenuClass = () => (addSearch() ? "agent-dock-add-menu agent-dock-add-menu-search" : "agent-dock-add-menu");
  const addText = () => (addSearch() ? addQuery().trim().toLocaleLowerCase() : "");
  const addMatches = createMemo(() => {
    const text = addText();
    return text ? props.available.filter((agent) => agent.name.toLocaleLowerCase().includes(text)) : props.available;
  });
  const addChannelMatches = createMemo(() => {
    const text = addText();
    return text
      ? props.availableChannels.filter((channel) => channel.name.toLocaleLowerCase().includes(text))
      : props.availableChannels;
  });
  const addEmpty = () => addMatches().length === 0 && addChannelMatches().length === 0;
  const addEmptyText = () =>
    props.available.length === 0 && props.availableChannels.length === 0
      ? t("agent.dock.allAdded")
      : t("agent.dock.noMatch", { query: addQuery().trim() });
  const addFades = createScrollFades();
  onCleanup(() => addFades.stop());
  const addMenu = createMenuSearch({
    row: '[role="menuitem"]:not([data-disabled])',
    enabled: addSearch,
    enter: () => addQuery().trim() !== "",
  });
  let addMorphs: Animation[] = [];
  const searchAdd = (value: string) => {
    const list = addMenu.list();
    if (!list || typeof list.animate !== "function" || prefersReducedMotion()) {
      setAddQuery(value);
      if (list) list.scrollTop = 0;
      addFades.remeasure();
      return;
    }
    const rows = () => Array.from(list.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const listTop = list.getBoundingClientRect().top;
    const fromHeight = list.getBoundingClientRect().height;
    const fromTops = new Map(rows().map((row) => [row, row.getBoundingClientRect().top - listTop]));
    for (const animation of addMorphs) animation.cancel();
    addMorphs = [];
    setAddQuery(value);
    flush();
    list.scrollTop = 0;
    addFades.remeasure();
    const timing = { duration: ADD_MORPH_MS, easing: ADD_MORPH_EASE };
    const toHeight = list.getBoundingClientRect().height;
    if (Math.abs(toHeight - fromHeight) > 0.5)
      addMorphs.push(list.animate([{ height: `${fromHeight}px` }, { height: `${toHeight}px` }], timing));
    const top = list.getBoundingClientRect().top;
    for (const row of rows()) {
      const from = fromTops.get(row);
      if (from === undefined) {
        addMorphs.push(
          row.animate(
            [
              { opacity: 0, filter: "blur(2px)", transform: "translateY(4px)" },
              { opacity: 1, filter: "blur(0)", transform: "none" },
            ],
            timing,
          ),
        );
        continue;
      }
      const shift = from - (row.getBoundingClientRect().top - top);
      if (Math.abs(shift) > 0.5)
        addMorphs.push(row.animate([{ transform: `translateY(${shift}px)` }, { transform: "none" }], timing));
    }
  };
  const bindAddList = (element: HTMLDivElement) => {
    addMenu.bindList(element);
    addFades.bind(element);
  };

  let endDrag: (() => void) | undefined;
  onCleanup(() => endDrag?.());

  function startDrag(event: PointerEvent & { currentTarget: Element }) {
    const drag = props.onDrag;
    if (!drag || event.button !== 0 || endDrag) return;
    event.preventDefault();
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    drag("start");
    setDragging(true);
    const still = prefersReducedMotion();
    let moved = false;
    let lastY = window.screenY;
    let lastTime = performance.now();
    let speed = 0;
    const step = (now: number) => {
      if (moved) {
        moved = false;
        drag("move");
      }
      const elapsed = now - lastTime;
      if (elapsed > 0) {
        speed = speed * 0.5 + ((window.screenY - lastY) / elapsed) * 0.5;
        lastY = window.screenY;
        lastTime = now;
      }
      if (!still) {
        const pull = Math.max(-MAX_STRETCH, Math.min(MAX_STRETCH, speed * STRETCH_PER_SPEED));
        stretch.to(pull, undefined, Math.abs(pull) < 1 ? WOBBLY : STRETCH_FOLLOW);
        motion.kick();
      }
      frame = requestAnimationFrame(step);
    };
    let frame = requestAnimationFrame(step);
    const move = () => {
      moved = true;
    };
    const end = () => {
      endDrag = undefined;
      cancelAnimationFrame(frame);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", end);
      element.removeEventListener("pointercancel", end);
      element.removeEventListener("lostpointercapture", end);
      drag("end");
      setDragging(false);
      stretch.to(0, undefined, WOBBLY);
      motion.kick();
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", end);
    element.addEventListener("pointercancel", end);
    element.addEventListener("lostpointercapture", end);
    endDrag = end;
  }

  function layout(seats: readonly string[], instant = false) {
    const count = seats.length;
    const move = (spring: Spring, value: number) => (instant ? spring.jump(value) : spring.to(value));
    move(dockH, dockHeight(count));
    move(addY, addCenterY(count));
    move(shelfOffset, shelfTarget(seats));
    const listHeight = SEAT_VIEW_INSET + seatsHeight(count);
    if (listHeight > listH.value) listH.jump(listHeight);
    else move(listH, listHeight);
    seats.forEach((id, index) => {
      move(seatSprings(id).y, seatCenterY(index, count));
    });
    const open = state.open;
    if (open) move(neckY, seatY(open, seats));
    motion.kick();
  }

  function openChat(id: string) {
    const index = state.seats.indexOf(id);
    if (index < 0) return;
    finishRecording(id);
    const scroll = revealScroll(index);
    scrollSeats(scroll);
    const y = seatY(id, state.seats, scroll);
    const wasOpen = state.open !== null;
    setState((draft) => {
      draft.open = id;
      draft.shown = id;
      draft.focus += 1;
    });
    props.onOpenChange?.(refOfKey(id));
    neckY.to(y);
    neckSize.to(1);
    if (!wasOpen) {
      originY.jump(y);
      if (panelOpen.value < 0.02) closing.jump(0);
      else closing.to(0);
      panelOpen.to(1, undefined, LIQUID_OPEN);
    }
    motion.kick();
  }

  function finishRecording(keepFor?: string) {
    const voice = props.voice;
    if (voice?.phase === "recording" && voice.seatKey !== keepFor) voice.onFinish();
  }

  function chatVoice(id: string): AgentDockChatVoice | undefined {
    const voice = props.voice;
    if (!voice) return undefined;
    const own = () => voice.seatKey === id;
    return {
      get phase() {
        return own() ? voice.phase : "idle";
      },
      get levels() {
        return voice.levels;
      },
      get elapsedSeconds() {
        return voice.elapsedSeconds;
      },
      get liveText() {
        return own() ? voice.liveText : "";
      },
      get modelProgress() {
        return voice.modelProgress;
      },
      get blocked() {
        return voice.phase !== "idle" && !own();
      },
      onStart: () =>
        voice.onStart({
          seatKey: id,
          draft: () => state.drafts[id] ?? "",
          setDraft: (text) =>
            setState((draft) => {
              draft.drafts[id] = text;
            }),
          send: (text) => void send(id, text),
          showError: (message) =>
            setState((draft) => {
              draft.errors[id] = message;
            }),
          focus: () => {
            if (state.open === id)
              setState((draft) => {
                draft.focus += 1;
              });
          },
        }),
      onCancel: () => voice.onCancel(),
      onFinish: () => voice.onFinish(),
      onSend: () => voice.onSend(),
    };
  }

  function openWindowFor(id: string): (() => void) | undefined {
    const open = props.onOpenWindow;
    const seat = refOfKey(id);
    if (!open || seat.kind !== "agent") return undefined;
    return () => {
      closeChat(false);
      open(seat.id);
    };
  }

  function closeChat(returnFocus = true) {
    const id = state.open;
    if (!id) return;
    finishRecording();
    originY.jump(seatY(id));
    if (panelOpen.value > 0.98) closing.jump(1);
    else closing.to(1);
    panelOpen.to(0, () => neckSize.jump(0), LIQUID_CLOSE);
    motion.kick();
    setState((draft) => {
      draft.open = null;
      draft.pinned = false;
    });
    props.onOpenChange?.(null);
    if (returnFocus) seatElements.get(id)?.querySelector("button")?.focus({ preventScroll: true });
  }

  function toggleSeat(id: string) {
    if (state.open === id) closeChat();
    else openChat(id);
  }

  function placeAgent(id: string) {
    if (state.seats.includes(id)) return;
    const index = state.seats.length;
    const seats = [...state.seats, id];
    const targetY = seatCenterY(index, seats.length);
    const springs = seatSprings(id, targetY);
    springs.y.jump(targetY);
    setState((draft) => {
      draft.seats.push(id);
    });
    const scroll = maxScroll(seats.length);
    listH.jump(SEAT_VIEW_INSET + seatsHeight(seats.length));
    seatList.style.height = `${listH.value}px`;
    scrollSeats(scroll);
    dropX.jump(DOCK_LEFT - 120);
    dropY.jump(addCenterY(index));
    dropR.jump(0);
    dropR.to(SEAT / 2);
    dropX.to(SEAT_CENTER_X, () => dropR.to(0));
    dropY.to(targetY - scroll);
    springs.scale.jump(0);
    window.setTimeout(() => {
      springs.scale.to(1);
      motion.kick();
    }, 260);
    layout(seats);
  }

  function forgetSeat(id: string) {
    const springs = seatMotion.get(id);
    seatElements.delete(id);
    seatMotion.delete(id);
    if (!springs) return;
    motion.drop(springs.y);
    motion.drop(springs.scale);
  }

  function takeAgent(id: string) {
    if (!state.seats.includes(id) || leaving.has(id)) return;
    if (state.open === id) closeChat(false);
    const springs = seatSprings(id);
    const finish = () => {
      leaving.delete(id);
      const seats = state.seats.filter((seat) => seat !== id);
      setState((draft) => {
        draft.seats.splice(draft.seats.indexOf(id), 1);
      });
      forgetSeat(id);
      layout(seats);
    };
    leaving.add(id);
    dropX.jump(SEAT_CENTER_X);
    dropY.jump(springs.y.value - seatScroll.scrollTop);
    dropR.jump(SEAT / 2);
    dropX.to(DOCK_LEFT - 110);
    dropR.to(0);
    springs.scale.to(0, finish);
    motion.kick();
  }

  function setSeats(seats: readonly string[]) {
    for (const id of state.seats) {
      if (seats.includes(id)) continue;
      if (state.open === id) closeChat(false);
      leaving.delete(id);
      forgetSeat(id);
    }
    seats.forEach((id, index) => {
      const springs = seatSprings(id, seatCenterY(index, seats.length));
      springs.scale.jump(1);
    });
    setState((draft) => {
      draft.seats = [...seats];
    });
    layout(seats, true);
  }

  const [draggedSeat, setDraggedSeat] = createSignal<string | null>(null);
  let draggedClick: string | null = null;
  let endSeatDrag: ((keep: boolean, released?: boolean) => void) | undefined;
  onCleanup(() => endSeatDrag?.(false));

  function pressSeat(id: string, event: PointerEvent & { currentTarget: HTMLElement }) {
    if (!props.onMove || event.button !== 0 || endSeatDrag || leaving.has(id) || !state.seats.includes(id)) return;
    const element = event.currentTarget;
    const pointerId = event.pointerId;
    const startY = event.clientY;
    const springs = seatSprings(id);
    const initial = [...state.seats];
    let order = initial;
    let pointerY = startY;
    let startScroll = 0;
    let startSeatY = 0;
    let frame = 0;
    let started = false;

    const follow = () => {
      const count = order.length;
      const first = seatCenterY(0, count);
      const last = seatCenterY(count - 1, count);
      const y = Math.min(last, Math.max(first, startSeatY + pointerY - startY + seatScroll.scrollTop - startScroll));
      const index = Math.round((y - first) / SEAT_PITCH);
      if (order[index] !== id) {
        order = order.filter((seat) => seat !== id);
        order.splice(index, 0, id);
        layout(order);
      }
      springs.y.jump(y);
      motion.kick();
    };
    const scroll = () => {
      const view = seatScroll.getBoundingClientRect();
      const above = view.top + SEAT_FADE - pointerY;
      const below = pointerY - (view.bottom - SEAT_FADE);
      const step = above > 0 ? -above : below > 0 ? below : 0;
      const before = seatScroll.scrollTop;
      if (step !== 0) seatScroll.scrollTop = before + step * SEAT_DRAG_SCROLL;
      if (seatScroll.scrollTop !== before) follow();
      frame = requestAnimationFrame(scroll);
    };
    const start = () => {
      started = true;
      if (state.open) closeChat(false);
      startScroll = seatScroll.scrollTop;
      startSeatY = springs.y.value;
      element.setPointerCapture(pointerId);
      setDraggedSeat(id);
      frame = requestAnimationFrame(scroll);
    };
    const move = (moved: PointerEvent) => {
      if (moved.pointerId !== pointerId) return;
      pointerY = moved.clientY;
      if (!started && Math.abs(pointerY - startY) < SEAT_DRAG_START) return;
      if (!started) start();
      follow();
    };
    const finish = (keep: boolean, released = false) => {
      endSeatDrag = undefined;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", cancelOnEscape, true);
      cancelAnimationFrame(frame);
      if (!started) return;
      if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
      setDraggedSeat(null);
      draggedClick = id;
      const endGuard = () =>
        window.setTimeout(() => {
          if (draggedClick === id) draggedClick = null;
        });
      if (released) endGuard();
      else window.addEventListener("pointerup", endGuard, { capture: true, once: true });
      const sameSeats = order.length === state.seats.length && order.every((seat) => state.seats.includes(seat));
      const changed = order.some((seat, index) => seat !== initial[index]);
      if (keep && sameSeats && changed) {
        const next = order;
        setState((draft) => {
          draft.seats = [...next];
        });
        const before = next[next.indexOf(id) + 1];
        const moved = props.onMove?.(refOfKey(id), before ? refOfKey(before) : null);
        layout(next);
        void moved?.catch(() => {
          endSeatDrag?.(false);
          setSeats(props.seats.map((seat) => agentDockSeatKey(seatRef(seat))));
        });
        return;
      }
      layout(state.seats);
    };
    const release = (released: PointerEvent) => {
      if (released.pointerId === pointerId) finish(true, true);
    };
    const cancel = (cancelled: PointerEvent) => {
      if (cancelled.pointerId === pointerId) finish(false, true);
    };
    const cancelOnEscape = (pressed: KeyboardEvent) => {
      if (pressed.key !== "Escape" || !started) return;
      pressed.preventDefault();
      pressed.stopPropagation();
      finish(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", cancelOnEscape, true);
    endSeatDrag = finish;
  }

  createEffect(
    () => props.seats.map((seat) => agentDockSeatKey(seatRef(seat))),
    (ids) =>
      untrack(() => {
        const removed = state.seats.filter((id) => !leaving.has(id) && !ids.includes(id));
        const added = ids.filter((id) => !state.seats.includes(id));
        const moved = [...state.seats.filter((id) => !leaving.has(id) && !removed.includes(id)), ...added];
        const inOrder = moved.length === ids.length && moved.every((id, index) => id === ids[index]);
        if (inOrder && removed.length + added.length === 0) return;
        endSeatDrag?.(false);
        if (!inOrder || removed.length + added.length > 1) {
          setSeats(ids);
          return;
        }
        for (const id of removed) takeAgent(id);
        for (const id of added) placeAgent(id);
      }),
  );

  async function send(id = state.open, draft?: string) {
    if (!id || state.sending[id]) return;
    const text = (draft ?? state.drafts[id] ?? "").trim();
    if (!text) return;
    const key = ++pendingKey;
    const seat = refOfKey(id);
    const after = props.chat(seat).messages.at(-1)?.id ?? null;
    setState((draft) => {
      draft.drafts[id] = "";
      draft.errors[id] = null;
      draft.sending[id] = true;
      draft.pending[id] = [...(draft.pending[id] ?? []), { key, text, messageId: null, after }];
    });
    const result = await props.onSend(seat, text);
    setState((draft) => {
      draft.sending[id] = false;
      const pending = draft.pending[id] ?? [];
      const index = pending.findIndex((message) => message.key === key);
      if ("error" in result) {
        if (index >= 0) pending.splice(index, 1);
        draft.errors[id] = result.error;
        if (!draft.drafts[id]) draft.drafts[id] = text;
        return;
      }
      const sent = pending[index];
      if (sent) sent.messageId = result.messageId;
    });
  }

  const shownSeat = () => (state.shown ? seatFor(state.shown) : undefined);

  createEffect(
    () =>
      Object.entries(state.pending).flatMap(([id, messages]) => {
        const stored = messages.filter((message) => message.messageId !== null);
        if (stored.length === 0) return [];
        if (id !== state.open) return stored.map((message) => message.key);
        const loaded = props.chat(refOfKey(id)).messages;
        return stored.filter((message) => pendingMessageDelivered(message, loaded)).map((message) => message.key);
      }),
    (keys) => {
      if (keys.length === 0) return;
      const settled = new Set(keys);
      setState((draft) => {
        for (const [id, messages] of Object.entries(draft.pending))
          if (messages.some((message) => settled.has(message.key)))
            draft.pending[id] = messages.filter((message) => !settled.has(message.key));
      });
    },
  );

  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !state.open || event.defaultPrevented) return;
    event.preventDefault();
    closeChat();
  };

  createEffect(
    () => props.closeRequest,
    (request, previous) => {
      if (request !== previous && previous !== undefined) untrack(() => closeChat(false));
    },
  );

  createEffect(
    () => props.blurRequest,
    (request, previous) => {
      if (request !== previous && previous !== undefined && !untrack(() => state.pinned))
        untrack(() => closeChat(false));
    },
  );

  createEffect(
    () => props.tucked ?? false,
    (tucked) => {
      tuck.to(tucked ? TUCK_DISTANCE : 0);
      motion.kick();
    },
  );

  createEffect(
    () => props.side,
    () => reportShape(),
  );

  onSettled(() => {
    render();
    reportShape();
    const resized = new ResizeObserver(() => {
      measureShelf();
      placeShelf();
      reportShape();
    });
    if (shelf) resized.observe(shelf);
    window.addEventListener("resize", reportShape);
    return () => {
      motion.stop();
      resized.disconnect();
      window.removeEventListener("resize", reportShape);
    };
  });

  return (
    <div
      class="agent-dock"
      ref={(element) => (stage = element)}
      data-side={props.side ?? "right"}
      data-draggable={props.onDrag ? "" : undefined}
      data-dragging={dragging() ? "" : undefined}
      data-ambient-motion={ambientMotion() ? undefined : "paused"}
      style={{ width: `${STAGE_WIDTH}px`, height: `${PANEL_HEIGHT}px` }}
      onPointerOver={() => setPointerOn(true)}
      onPointerOut={(event) => {
        if (!(event.relatedTarget instanceof Node && stage.contains(event.relatedTarget))) setPointerOn(false);
      }}
    >
      <AmbientMotion when={ambientMotion()}>
        <GooFilter id={filterId} class="agent-dock-filter" />

        <div
          class="agent-dock-liquid"
          aria-hidden="true"
          style={{ filter: `url(#${filterId})` }}
          ref={(element) => (liquid = element)}
        >
          <svg class="agent-dock-shapes" width={LIQUID_WIDTH} height={LIQUID_HEIGHT} aria-hidden="true">
            <path ref={(element) => (dockBody = element)} />
            <path ref={(element) => (neck = element)} />
          </svg>
          <div class="agent-dock-panel-body" ref={(element) => (panelBody = element)} />
          <div class="agent-dock-drop" ref={(element) => (drop = element)} />
        </div>
        <svg class="agent-dock-edge" width={LIQUID_WIDTH} height={LIQUID_HEIGHT} aria-hidden="true">
          <path ref={(element) => (dockEdge = element)} />
          <rect ref={(element) => (panelEdge = element)} />
        </svg>

        <svg class="agent-dock-handle" width={LIQUID_WIDTH} height={LIQUID_HEIGHT} aria-hidden="true">
          <path class="agent-dock-handle-arc" stroke-width={HANDLE_STROKE} ref={(element) => (handleArc = element)} />
          <path
            class="agent-dock-handle-hit"
            stroke-width={HANDLE_STROKE * 5}
            ref={(element) => (handleHit = element)}
            onPointerDown={startDrag}
          />
        </svg>

        <ContextMenu.Root modal={false}>
          <ContextMenu.Trigger
            as="div"
            class="agent-dock-hit"
            aria-hidden="true"
            disabled={!props.onOpenSettings && !props.onHide}
            ref={(element) => (hitArea = element)}
            style={{ left: `${DOCK_LEFT}px`, width: `${DOCK_WIDTH}px` }}
          />
          <ContextMenu.Portal>
            <ContextMenu.Content aria-label={t("agent.dock.label")}>
              <Show when={props.onOpenSettings}>
                {(open) => (
                  <ContextMenu.Item onSelectAfterClose={() => open()()}>
                    <Settings aria-hidden="true" />
                    {t("agent.dock.settings")}
                  </ContextMenu.Item>
                )}
              </Show>
              <Show when={props.onHide}>
                {(hide) => (
                  <ContextMenu.Item onSelectAfterClose={() => hide()()}>
                    <EyeOff aria-hidden="true" />
                    {t("agent.dock.hide")}
                  </ContextMenu.Item>
                )}
              </Show>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>

        <nav class="agent-dock-seats" aria-label={t("agent.dock.label")}>
          <div
            class={["agent-dock-seat-scroll", seatFades.classes()]}
            ref={(element) => {
              seatScroll = element;
              seatFades.bind(element);
            }}
            style={{ left: `${DOCK_LEFT}px`, width: `${DOCK_WIDTH}px`, "--agent-dock-seat-fade": `${SEAT_FADE}px` }}
            onScroll={followScroll}
          >
            <div
              class="agent-dock-seat-list"
              ref={(element) => {
                seatList = element;
                seatFades.watch(element);
              }}
            >
              <For each={state.seats}>
                {(id) => (
                  <div
                    class="agent-dock-seat"
                    ref={(element) => {
                      seatElements.set(id, element);
                      placeSeat(element, seatSprings(id));
                    }}
                    style={{ left: `${DOCK_PAD}px` }}
                    data-dragging={draggedSeat() === id ? "" : undefined}
                  >
                    <Show when={seatFor(id)}>
                      {(seat) => (
                        <ContextMenu.Root modal={false}>
                          <ContextMenu.Trigger
                            as="button"
                            type="button"
                            class="agent-dock-seat-button"
                            aria-label={t("agent.dock.chatWith", { name: seatName(seat()) })}
                            aria-pressed={state.open === id ? "true" : "false"}
                            data-open={state.open === id ? "" : undefined}
                            onPointerDown={(event: PointerEvent & { currentTarget: HTMLElement }) =>
                              pressSeat(id, event)
                            }
                            onClick={() => {
                              if (draggedClick === id) {
                                draggedClick = null;
                                return;
                              }
                              toggleSeat(id);
                            }}
                            onKeyDown={closeOnEscape}
                          >
                            <SeatAvatar seat={seat()} agents={props.agents} />
                          </ContextMenu.Trigger>
                          <ContextMenu.Portal>
                            <ContextMenu.Content>
                              <ContextMenu.Item
                                onSelectAfterClose={() => {
                                  if (state.open === id) closeChat(false);
                                  props.onOpenInMain(refOfKey(id));
                                }}
                              >
                                <Maximize2 aria-hidden="true" />
                                {t("agent.dock.openInMain")}
                              </ContextMenu.Item>
                              <Show when={seat().kind === "agent" ? props.onOpenWindow : undefined}>
                                {(open) => (
                                  <ContextMenu.Item
                                    onSelectAfterClose={() => {
                                      if (state.open === id) closeChat(false);
                                      open()(refOfKey(id).id);
                                    }}
                                  >
                                    <AppWindow aria-hidden="true" />
                                    {t("agent.dock.openWindow")}
                                  </ContextMenu.Item>
                                )}
                              </Show>
                              <ContextMenu.Separator />
                              <Show
                                when={seat().temporary}
                                fallback={
                                  <ContextMenu.Item onSelectAfterClose={() => props.onRemove(refOfKey(id))}>
                                    <PanelRight aria-hidden="true" />
                                    {t("agent.dock.remove")}
                                  </ContextMenu.Item>
                                }
                              >
                                <ContextMenu.Item onSelectAfterClose={() => props.onAdd(refOfKey(id))}>
                                  <Plus aria-hidden="true" />
                                  {t("agent.dock.add")}
                                </ContextMenu.Item>
                              </Show>
                              <Show when={props.onHide}>
                                {(hide) => (
                                  <ContextMenu.Item
                                    onSelectAfterClose={() => {
                                      if (state.open === id) closeChat(false);
                                      hide()();
                                    }}
                                  >
                                    <EyeOff aria-hidden="true" />
                                    {t("agent.dock.hide")}
                                  </ContextMenu.Item>
                                )}
                              </Show>
                            </ContextMenu.Content>
                          </ContextMenu.Portal>
                        </ContextMenu.Root>
                      )}
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </div>
          <div
            class="agent-dock-seat"
            ref={(element) => (addSeat = element)}
            style={{ left: `${DOCK_LEFT + DOCK_PAD}px` }}
          >
            <Show when={menuPlacement()} keyed>
              {(placement) => (
                <DropdownMenu.Root
                  placement={placement}
                  gutter={12}
                  onOpenChange={(open) => {
                    if (open) setAddQuery("");
                  }}
                >
                  <DropdownMenu.Trigger class="agent-dock-seat-button agent-dock-add" aria-label={t("agent.dock.add")}>
                    <Plus aria-hidden="true" />
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      class={addMenuClass()}
                      onOpenAutoFocus={addMenu.onOpenAutoFocus}
                      onFocusIn={addMenu.onFocusIn}
                    >
                      <Show when={addSearch()}>
                        <div class="ui-search-select-search agent-dock-add-search">
                          <Search aria-hidden="true" />
                          <Input
                            ref={addMenu.bindField}
                            class="ui-search-select-input agent-dock-add-search-input"
                            aria-label={t("agent.dock.search")}
                            placeholder={t("agent.dock.searchPlaceholder")}
                            autocomplete="off"
                            spellcheck={false}
                            value={addQuery()}
                            onValueChange={searchAdd}
                            onKeyDown={addMenu.onFieldKey}
                          />
                        </div>
                      </Show>
                      <div
                        class={["agent-dock-add-list", addFades.classes()]}
                        ref={bindAddList}
                        onScroll={addFades.measure}
                      >
                        <Show when={addEmpty()}>
                          <DropdownMenu.Item class="agent-dock-add-empty" disabled>
                            {addEmptyText()}
                          </DropdownMenu.Item>
                        </Show>
                        <For each={addMatches()}>
                          {(agent) => (
                            <DropdownMenu.Item onSelectAfterClose={() => props.onAdd({ kind: "agent", id: agent.id })}>
                              <AgentAvatar agent={agent} motion="idle" class="agent-dock-menu-avatar" />
                              {agent.name}
                            </DropdownMenu.Item>
                          )}
                        </For>
                        <Show when={addMatches().length > 0 && addChannelMatches().length > 0}>
                          <DropdownMenu.Separator />
                        </Show>
                        <For each={addChannelMatches()}>
                          {(channel) => (
                            <DropdownMenu.Item
                              onSelectAfterClose={() => props.onAdd({ kind: "channel", id: channel.id })}
                            >
                              <span class="agent-dock-menu-avatar agent-dock-menu-channel">
                                <ChannelAvatar
                                  members={channel.members}
                                  agents={props.agents}
                                  layout="cluster"
                                  icon={channel.icon}
                                  imageUrl={channel.imageUrl}
                                />
                              </span>
                              {channel.name}
                            </DropdownMenu.Item>
                          )}
                        </For>
                      </div>
                      <Show when={props.onOpenSettings}>
                        {(open) => (
                          <>
                            <DropdownMenu.Separator />
                            <DropdownMenu.Item onSelectAfterClose={() => open()()}>
                              <Settings aria-hidden="true" />
                              {t("agent.dock.settings")}
                            </DropdownMenu.Item>
                          </>
                        )}
                      </Show>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              )}
            </Show>
          </div>
        </nav>

        <AgentDockShelf
          results={props.results ?? []}
          agent={(id) => seatAgent(id) ?? props.agents.find((agent) => agent.id === id)}
          hidden={state.open !== null}
          stage={() => stage}
          onOpen={(agentId) => openChat(agentDockSeatKey({ kind: "agent", id: agentId }))}
          onShownChange={(shown) => {
            shelfShown = shown;
            if (shown) {
              measureShelf();
              shelfOffset.jump(shelfTarget());
              drawShelf();
            }
            props.onShelfChange?.(shown);
          }}
          onAgentChange={(agentId) => {
            shelfAgent = agentId;
            placeShelf();
          }}
          ref={(element) => {
            shelf = element;
            element.style.right = `${STAGE_WIDTH - DOCK_LEFT + SHELF_GAP}px`;
            motion.kick();
          }}
        />

        <section
          class="agent-dock-panel"
          ref={(element) => (panelContent = element)}
          aria-label={(() => {
            const seat = shownSeat();
            return seat ? t("agent.dock.chatWith", { name: seatName(seat) }) : undefined;
          })()}
          data-open={state.open ? "" : undefined}
          inert={state.open ? undefined : true}
          onKeyDown={closeOnEscape}
          style={{
            left: `${DOCK_LEFT - PANEL_GAP - PANEL_WIDTH}px`,
            width: `${PANEL_WIDTH}px`,
            height: `${PANEL_HEIGHT}px`,
          }}
        >
          <Show when={state.shown} keyed>
            {(id) => (
              <Show when={seatFor(id)}>
                {(seat) => (
                  <AgentDockChat
                    seat={seat()}
                    chat={props.chat(refOfKey(id))}
                    draft={state.drafts[id] ?? ""}
                    pending={state.pending[id] ?? []}
                    error={state.errors[id] ?? null}
                    sending={state.sending[id] ?? false}
                    focusRequest={state.focus}
                    onDraftChange={(value) =>
                      setState((draft) => {
                        draft.drafts[id] = value;
                      })
                    }
                    onSend={() => void send()}
                    onClose={() => closeChat()}
                    pinned={state.pinned}
                    onPinChange={
                      props.blurRequest === undefined
                        ? undefined
                        : (pinned) =>
                            setState((draft) => {
                              draft.pinned = pinned;
                            })
                    }
                    onRemove={() => props.onRemove(refOfKey(id))}
                    onAdd={() => props.onAdd(refOfKey(id))}
                    onOpenInMain={() => {
                      closeChat(false);
                      props.onOpenInMain(refOfKey(id));
                    }}
                    onOpenWindow={openWindowFor(id)}
                    voice={chatVoice(id)}
                    agents={props.agents}
                    onSelectAgent={(agentId) => {
                      closeChat(false);
                      props.onSelectAgent?.(agentId);
                    }}
                    onOpenLink={(url) => props.onOpenLink?.(url)}
                    answers={props.answers}
                  />
                )}
              </Show>
            )}
          </Show>
        </section>
      </AmbientMotion>
    </div>
  );
}

function SeatAvatar(props: { seat: AgentDockSeat; agents: readonly ComposerAgent[] }) {
  return (
    <Show
      when={props.seat.kind === "channel" ? props.seat.channel : undefined}
      fallback={
        <Show when={props.seat.kind === "agent" ? props.seat : undefined}>
          {(seat) => <SidebarPinnedAvatar agent={seat().agent} mood={seat().mood} agentState={() => seat().state} />}
        </Show>
      }
    >
      {(channel) => (
        <span class="agent-row-avatar sidebar-pinned-avatar">
          <ChannelAvatar
            members={channel().members}
            agents={props.agents}
            layout="cluster"
            icon={channel().icon}
            imageUrl={channel().imageUrl}
          />
          <SidebarAgentIndicator state={() => props.seat.state} />
        </span>
      )}
    </Show>
  );
}
