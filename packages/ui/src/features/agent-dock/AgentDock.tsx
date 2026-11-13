/**
 * A liquid agent dock on the right or left edge of the window. The user adds agents and channels to it
 * and talks with each one in a panel that grows out of its seat. The dock, the panel, the neck between them
 * and the drop that carries an agent in or out are one shape under an SVG "goo" filter, so they flow
 * into each other. Text and controls sit on a layer above the filter and stay sharp.
 *
 * The seats come from props. When one seat is added or removed, it flows in or pinches off; a larger
 * change, such as the first load, places the seats at once.
 */

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
import { useText } from "../../text";
import { prefersReducedMotion } from "../../utils";
import { AgentAvatar } from "../agents/AgentAvatar";
import { ChannelAvatar } from "../channels/ChannelAvatar";
import type { VoicePhase } from "../conversation/VoiceRecordingMorph";
import { SidebarAgentIndicator, SidebarPinnedAvatar } from "../sidebar/SidebarAgentIndicator";
import type { SidebarAgentState } from "../sidebar/sidebar-types";
import {
  AgentDockChat,
  type AgentDockChatModel,
  type AgentDockChatVoice,
  type AgentDockPendingMessage,
} from "./AgentDockChat";
import { AgentDockShelf, type AgentDockShelfResult } from "./AgentDockShelf";
import {
  addCenterY,
  createMotion,
  DOCK_LEFT,
  DOCK_PAD,
  DOCK_WIDTH,
  dockBand,
  dockHandlePath,
  dockHeight,
  dockPath,
  HANDLE_STROKE,
  LIQUID_HEIGHT,
  LIQUID_PAD,
  LIQUID_WIDTH,
  MAX_STRETCH,
  neckPath,
  PANEL_CLOSE,
  PANEL_GAP,
  PANEL_HEIGHT,
  PANEL_OPEN,
  PANEL_RADIUS,
  PANEL_WIDTH,
  SEAT,
  SEAT_CENTER_X,
  SEAT_PITCH,
  SEAT_VIEW_INSET,
  SLIDE_END,
  SNAPPY,
  SOFT,
  type Spring,
  STAGE_WIDTH,
  STRETCH_FOLLOW,
  STRETCH_PER_SPEED,
  seatCenterY,
  seatsHeight,
  seatView,
  seatViewTop,
  stagedCurve,
  TUCK,
  TUCK_DISTANCE,
  WOBBLY,
} from "./agent-dock-motion";

export type { AgentDockChatModel } from "./AgentDockChat";
export type { AgentDockShelfResult } from "./AgentDockShelf";

/** A seat of the dock: an agent or a channel. The ids of the two kinds can be equal. */
export interface AgentDockSeatRef {
  kind: "agent" | "channel";
  id: string;
}

/** The channel fields that a channel seat and its chat show. */
export interface AgentDockChannel {
  id: string;
  name: string;
  title: string;
  members: ChannelMember[];
  icon: ChannelIcon | null;
  imageUrl: string | null;
}

/**
 * `state` is the badge on the seat: the same state as the agent's or channel's badge in the sidebar.
 * A `temporary` seat is not on the dock: it shows while it has a new message or waits for the user. Its
 * menus add it to the dock in place of removing it.
 */
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

/**
 * The dock body in the document: the part between and around the seats that takes the pointer. It has the
 * height of the dock and is at its place on the screen.
 */
export function agentDockBody(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".agent-dock .agent-dock-hit");
}

/** The key of a seat in the dock state, unique across the two kinds. */
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

/** The chat that a recording is for. The words go into its draft. */
export interface AgentDockVoiceTarget {
  /** The `agentDockSeatKey` of the chat. */
  seatKey: string;
  draft: () => string;
  setDraft: (text: string) => void;
  /** Sends this text, as the send button sends the draft. The draft keeps it until the send starts. */
  send: (text: string) => void;
  /** Shows a failure of the recording in the chat. */
  showError: (message: string) => void;
  /** Puts the caret in the composer. */
  focus: () => void;
}

/** The microphone of the dock chats. The dock shows it; the app records and transcribes. */
export interface AgentDockVoice {
  phase: VoicePhase;
  /** The `agentDockSeatKey` of the recording's chat, or null when the microphone is idle. */
  seatKey: string | null;
  levels: readonly number[];
  elapsedSeconds: number;
  /** The words the recording heard so far. */
  liveText: string;
  /** The download progress of the speech model, in percent, while it is prepared. */
  modelProgress: number | null;
  onStart: (target: AgentDockVoiceTarget) => void;
  onCancel: () => void;
  /** Stops the recording. The words go into the draft. */
  onFinish: () => void;
  /** Stops the recording and sends the draft with the words. */
  onSend: () => void;
}

/** A drag of the dock handle: the window that holds the dock moves with the pointer. */
export type AgentDockDragPhase = "start" | "move" | "end";

/** A part of the window that the dock covers, in window px. */
export interface AgentDockShapeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AgentDockProps {
  seats: readonly AgentDockSeat[];
  /** The agents that the add menu offers. */
  available: readonly ComposerAgent[];
  /** The channels that the add menu offers. */
  availableChannels: readonly AgentDockChannel[];
  /** The chat of a seat on the dock. */
  chat: (seat: AgentDockSeatRef) => AgentDockChatModel;
  /** Called with the seat whose chat the panel shows, and with null when the panel closes. */
  onOpenChange?: ((seat: AgentDockSeatRef | null) => void) | undefined;
  onAdd: (seat: AgentDockSeatRef) => void;
  onRemove: (seat: AgentDockSeatRef) => void;
  onSend: (seat: AgentDockSeatRef, text: string) => Promise<AgentDockSendResult>;
  onOpenInMain: (seat: AgentDockSeatRef) => void;
  /** Opens an agent in its own chat window. The agent menus show the item only when it is set. */
  onOpenWindow?: ((agentId: string) => void) | undefined;
  /** All agents of the server, so that mentions in a chat show as chips. */
  agents: ComposerAgent[];
  onSelectAgent?: ((agentId: string) => void) | undefined;
  onOpenLink?: ((url: string) => void) | undefined;
  /** Opens the dock settings. The add menu shows the item only when it is set. */
  onOpenSettings?: (() => void) | undefined;
  /** Turns the dock off. The right-click menus of the dock show the item only when it is set. */
  onHide?: (() => void) | undefined;
  /**
   * Moves a seat before another seat, or to the end when `before` is null. When it is set, the user
   * drags a seat to a new place. When the promise fails, the seats go back to the order of `seats`.
   */
  onMove?: ((seat: AgentDockSeatRef, before: AgentDockSeatRef | null) => Promise<void> | void) | undefined;
  /** A change closes the chat, for example when the dock window loses the focus. */
  closeRequest?: number | undefined;
  /** The window edge that holds the dock. The dock and the panel are mirrored on the left edge. */
  side?: "left" | "right" | undefined;
  /** The dock slides into the window edge. */
  tucked?: boolean | undefined;
  /** When set, the user drags the handle below the dock to move the dock along the edge. */
  onDrag?: ((phase: AgentDockDragPhase) => void) | undefined;
  /** The unread results of the seated agents, oldest first. The shelf beside the dock shows the newest. */
  results?: readonly AgentDockShelfResult[] | undefined;
  /** Called when the shelf shows results and when it becomes empty. */
  onShelfChange?: ((shown: boolean) => void) | undefined;
  /** The composer shows a microphone only when it is set. */
  voice?: AgentDockVoice | undefined;
  /**
   * For a window that takes the pointer and shows only where the dock is. Called with the parts that
   * the dock covers when it rests, and with null when it starts to move: then the whole stage counts.
   */
  onShapeChange?: ((parts: readonly AgentDockShapeRect[] | null) => void) | undefined;
}

/** The seats, drafts and other records are keyed by `agentDockSeatKey`. */
interface DockState {
  seats: string[];
  open: string | null;
  /** The seat whose chat the panel shows. It stays set while the panel closes, so the chat fades out. */
  shown: string | null;
  drafts: Record<string, string>;
  pending: Record<string, AgentDockPendingMessage[]>;
  errors: Record<string, string | null>;
  sending: Record<string, boolean>;
  /** Raised by one to put the caret in the composer. */
  focus: number;
}

let pendingKey = 0;

/** The part of a dock-end pull that the seats follow, so they lag a little behind the dock. */
const SEAT_LAG = 0.3;
/** The space between the shelf and the dock body. */
const SHELF_GAP = 12;
/** The faded edge of the seat view, where more seats are above or below. */
const SEAT_FADE = 24;
/** The add menu has a search field when this many agents and channels or more are not on the dock. */
const ADD_SEARCH_MIN = 9;
/** The morph of the add list when the search changes its rows. The same move as the menu panels. */
const ADD_MORPH_MS = 200;
const ADD_MORPH_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
/** The room around each part of the shape: the goo, the handle stroke and a hovered seat reach past the geometry. */
const SHAPE_MARGIN = 14;
/** The pointer moves this far, in px, before a press on a seat becomes a drag. A shorter move is a click. */
const SEAT_DRAG_START = 4;
/** The scroll of the seat view for each px that a dragged seat is in a faded edge, in px per frame. */
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
  });
  /* The last props of each seat, so a seat that leaves keeps its face while it shrinks away. */
  const seatProps = createMemo((previous?: Map<string, AgentDockSeat>) => {
    const next = new Map(previous);
    for (const seat of props.seats) next.set(agentDockSeatKey(seatRef(seat)), seat);
    return next;
  });
  const seatFor = (id: string) => seatProps().get(id);
  /** The agent of a seat. The list of all agents can be shorter than the seats. */
  const seatAgent = (agentId: string) => {
    const seat = seatFor(agentDockSeatKey({ kind: "agent", id: agentId }));
    return seat?.kind === "agent" ? seat.agent : undefined;
  };
  /* The seats that shrink away. They stay in `state.seats` until the shrink ends. */
  const leaving = new Set<string>();

  /* Elements that the motion loop writes. */
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
  /**
   * The scroll height of the seats. It shrinks on a spring, so the seats above a seat that goes move
   * down smoothly when the view is scrolled to the end.
   */
  const listH = motion.spring(SEAT_VIEW_INSET + seatsHeight(initialCount), SOFT);
  /** Open progress: 0 is the seat, 1 is the full panel. Width leads height for a liquid stretch. */
  const panelOpen = motion.spring(0, PANEL_OPEN);
  // 0 while the panel opens, 1 while it closes: a close goes back as a drop, not as a tall bar.
  const closing = motion.spring(0, SOFT);
  const neckY = motion.spring(PANEL_HEIGHT / 2, WOBBLY);
  const neckSize = motion.spring(0, SNAPPY);
  /** Where the panel grows from: the y of the seat it opened from. */
  const originY = motion.spring(PANEL_HEIGHT / 2, SNAPPY);
  const dropX = motion.spring(SEAT_CENTER_X, SOFT);
  const dropY = motion.spring(PANEL_HEIGHT / 2, SOFT);
  const dropR = motion.spring(0, SNAPPY);
  /** The pull of a dock end during a drag, in px: positive pulls the top end up, negative the bottom end down. */
  const stretch = motion.spring(0, STRETCH_FOLLOW);
  /** How far the dock is in the edge: 0 is out, TUCK_DISTANCE is hidden. */
  const tuck = motion.spring(untrack(() => props.tucked) ? TUCK_DISTANCE : 0, TUCK);
  const [dragging, setDragging] = createSignal(false);
  /** The pointer is on a part of the dock that takes it. The stage itself lets the pointer through. */
  const [pointerOn, setPointerOn] = createSignal(false);
  // The dock stays above the other apps. A working agent moves on it only while the user uses the dock.
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

  /** A seat moves in the seat view, and the view moves with the dock. */
  function placeSeat(element: HTMLElement, springs: { y: Spring; scale: Spring }) {
    const y = springs.y.value - SEAT / 2 - seatViewTop(dockH.value);
    element.style.transform = `translateY(${y}px) scale(${Math.max(0, springs.scale.value)})`;
  }

  /** The largest scroll of the seat view for this many seats. */
  function maxScroll(count: number) {
    return seatsHeight(count) - seatView(count);
  }

  /**
   * The centre y of a seat on the stage at a scroll of the seat view. A seat outside the view gives
   * the nearest place in the view, so the neck stays on the dock.
   */
  function seatY(id: string, seats: readonly string[] = state.seats, scroll = seatScroll.scrollTop) {
    const count = seats.length;
    const first = seatCenterY(0, count);
    const last = first + Math.max(0, seatView(count) - SEAT_PITCH);
    return Math.min(last, Math.max(first, seatCenterY(seats.indexOf(id), count) - scroll));
  }

  /** The scroll that shows the whole seat clear of the faded edges, with the least move. */
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

  /** The neck follows the open seat when the seats scroll. */
  function followScroll() {
    seatFades.measure();
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
    // The goo filter would blunt the tips, so it shows only beside the dock and in its band.
    // There it joins the neck and the drop; the sharp copy draws the tips.
    const { top: bandTop, bottom: bandBottom } = dockBand(height, pull);
    const cut = LIQUID_PAD + DOCK_LEFT - 2;
    liquid.style.clipPath = `polygon(0 0, ${cut}px 0, ${cut}px ${bandTop}px, 100% ${bandTop}px, 100% ${bandBottom}px, ${cut}px ${bandBottom}px, ${cut}px 100%, 0 100%)`;
    addSeat.style.transform = `translateY(${addY.value - SEAT / 2 - pull * SEAT_LAG}px)`;
    seatScroll.style.top = `${seatViewTop(height) - pull * SEAT_LAG}px`;
    seatScroll.style.height = `${Math.max(0, height - DOCK_PAD * 2 - SEAT + SEAT_VIEW_INSET)}px`;
    seatList.style.height = `${Math.max(0, listH.value)}px`;
    // The shelf stands on the line between the last agent and the add button.
    if (shelf) shelf.style.bottom = `${PANEL_HEIGHT - (addY.value - SEAT / 2 - pull * SEAT_LAG)}px`;
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

    // The panel is a rounded rect that grows from the seat circle to its full size.
    const px = Math.max(0, panelOpen.value);
    // One curve for each edge. Until SLIDE_END the blob slides out of the seat and swells to the
    // dock's height, so the clip beside the dock never cuts it; then it grows to the full panel.
    const slide = Math.min(1, px / SLIDE_END);
    const start = SEAT_CENTER_X + SEAT / 2;
    const end = DOCK_LEFT - PANEL_GAP;
    const rightEdge = start + (end - start) * (1 - (1 - slide) ** 2);
    const seatTop = originY.value - SEAT / 2;
    const roomTop = (PANEL_HEIGHT - height) / 2 + DOCK_PAD;
    const roomBottom = (PANEL_HEIGHT + height) / 2 - DOCK_PAD;
    // On close, the middle shape is a drop around the seat, so the blob goes back into the seat
    // and does not lie along the dock as a tall bar.
    const dropHalf = SEAT * 1.1;
    const dropTop = Math.max(roomTop, originY.value - dropHalf);
    const dropBottom = Math.min(roomBottom, originY.value + dropHalf);
    const mode = Math.min(1, Math.max(0, closing.value));
    const top = stagedCurve(px, seatTop, roomTop + (dropTop - roomTop) * mode, 0);
    const bottom = stagedCurve(px, seatTop + SEAT, roomBottom + (dropBottom - roomBottom) * mode, PANEL_HEIGHT);
    const panelHeight = bottom - top;
    // On close the width shrinks sooner, so the drop is round and not a long thin pill.
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
    // The goo rounds the corners more than the radius. The crisp copy keeps the radius exact, so the
    // corner is concentric with the composer's corner.
    panelEdge.setAttribute("x", `${LIQUID_PAD + rightEdge - width}`);
    panelEdge.setAttribute("y", `${LIQUID_PAD + top}`);
    panelEdge.setAttribute("width", `${Math.max(0, width)}`);
    panelEdge.setAttribute("height", `${Math.max(0, panelHeight)}`);
    panelEdge.setAttribute("rx", `${radius}`);
    panelEdge.style.opacity = `${Math.min(1, Math.max(0, (Math.min(px, py) - 0.5) / 0.3))}`;

    // The chat shows only when the panel is almost full, so no text sits outside the liquid.
    const reveal = Math.min(1, Math.max(0, (Math.min(px, py) - 0.86) / 0.14));
    panelContent.style.opacity = `${reveal}`;
    panelContent.style.transform = `scale(${0.96 + 0.04 * reveal})`;

    // While the blob is over the dock, it joins the dock itself; the neck grows once it is clear.
    neck.setAttribute("d", neckPath(neckY.value, Math.max(0, Math.min(neckSize.value, free))));

    const r = Math.max(0, dropR.value);
    drop.style.transform = `translate(${dropX.value}px, ${dropY.value}px) translate(-50%, -50%) scale(${r / (SEAT / 2)})`;
  }

  /** The parts that the dock covers at rest: the dock and its handle, the open panel and the shelf. */
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

  /** The add menu opens away from the screen edge. */
  const menuPlacement = (): "right-end" | "left-end" => (props.side === "left" ? "right-end" : "left-end");

  // A long add menu starts with a search field. A short one stays a plain list.
  const [addQuery, setAddQuery] = createSignal("");
  const addSearch = () => props.available.length + props.availableChannels.length >= ADD_SEARCH_MIN;
  const addMenuClass = () => (addSearch() ? "agent-dock-add-menu agent-dock-add-menu-search" : "agent-dock-add-menu");
  /** The search text, lower case. A list that becomes short while the menu is open drops the field, and with it the search. */
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
    // Enter adds the first match.
    enter: () => addQuery().trim() !== "",
  });
  /**
   * Applies a new search, and morphs the list to its new rows: the height follows them, rows that
   * stay slide to their new places, and new rows fade in. A row keeps its element while it matches.
   */
  /** The morph animations that run, so a new search stops them and no other animation in the list. */
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
    // Measured while an earlier morph still moves, so a fast typist sees one continuous move.
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

  /**
   * The pointer stays captured while the window moves under it. Main reads the pointer once a frame.
   * The trailing end of the dock stretches with the speed of the window, and settles with a wobble when
   * the window stops. The window speed, not the pointer speed: a dock held at the end of the edge does not
   * stretch.
   */
  /** Ends the drag that runs. A dock that goes during a drag gets no pointer up. */
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
        // When the window stops, the dock settles with a wobble, as a liquid does.
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

  /** Moves the seats, the add button and the dock body to the layout of `seats`. */
  function layout(seats: readonly string[], instant = false) {
    const count = seats.length;
    const move = (spring: Spring, value: number) => (instant ? spring.jump(value) : spring.to(value));
    move(dockH, dockHeight(count));
    move(addY, addCenterY(count));
    // New room for seats comes at once, so a new seat is never cut; the room of a seat that goes shrinks.
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
    // A seat at a faded edge scrolls into the view; the panel grows from where the seat stops.
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
      // From rest the path changes at once; during a close it blends, so the shape does not jump.
      if (panelOpen.value < 0.02) closing.jump(0);
      else closing.to(0);
      panelOpen.to(1, undefined, PANEL_OPEN);
    }
    motion.kick();
  }

  /**
   * A recording ends when its chat closes or another chat opens. Its words go into its draft, so a
   * click outside the dock does not lose what the user said.
   */
  function finishRecording(keepFor?: string) {
    const voice = props.voice;
    if (voice?.phase === "recording" && voice.seatKey !== keepFor) voice.onFinish();
  }

  /** The microphone of one chat. Only the chat of the recording shows its progress. */
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

  /** The chat menu's "Open in new window" action, or none for a channel or when the app cannot open one. */
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
    // The neck holds the blob until it is back in the dock, so no gap opens on the way in.
    panelOpen.to(0, () => neckSize.jump(0), PANEL_CLOSE);
    motion.kick();
    setState((draft) => {
      draft.open = null;
    });
    props.onOpenChange?.(null);
    if (returnFocus) seatElements.get(id)?.querySelector("button")?.focus({ preventScroll: true });
  }

  function toggleSeat(id: string) {
    if (state.open === id) closeChat();
    else openChat(id);
  }

  /** Puts a seat on the dock: a drop of the dock flows in and the seat grows out of it. */
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
    // The view scrolls to the end, so the new seat shows. The new room below the view needs no motion.
    const scroll = maxScroll(seats.length);
    listH.jump(SEAT_VIEW_INSET + seatsHeight(seats.length));
    seatList.style.height = `${listH.value}px`;
    scrollSeats(scroll);
    // A drop comes in from the left at the add button and flows into the new seat.
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

  /** Stops the motion of a seat that is off the dock. */
  function forgetSeat(id: string) {
    const springs = seatMotion.get(id);
    seatElements.delete(id);
    seatMotion.delete(id);
    if (!springs) return;
    motion.drop(springs.y);
    motion.drop(springs.scale);
  }

  /** Takes a seat off the dock: it pinches off as a drop and fades out to the left. */
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

  /**
   * Puts the dock at once into the layout of `seats`. The store writes only when the effect ends, so
   * the whole list is made here and not one seat at a time.
   */
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

  /** The seat that the user drags to a new place. */
  const [draggedSeat, setDraggedSeat] = createSignal<string | null>(null);
  /** A drag ended on this seat, so the click that the release makes does not open its chat. */
  let draggedClick: string | null = null;
  /** Ends the seat drag that runs. True keeps the new order. */
  let endSeatDrag: ((keep: boolean, released?: boolean) => void) | undefined;
  onCleanup(() => endSeatDrag?.(false));

  /**
   * A press on a seat that moves becomes a drag. The seat follows the pointer and the other seats make
   * room for it. The release keeps the new order, and Escape puts the seats back. In a faded edge of the
   * view, the seats scroll.
   */
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

    /** Puts the seat under the pointer, and the other seats around it. */
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
    /** `released` is false while the button can still be down, such as after Escape. */
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
      // The click comes after the release, so the guard ends on the next task after it.
      draggedClick = id;
      const endGuard = () =>
        window.setTimeout(() => {
          if (draggedClick === id) draggedClick = null;
        });
      if (released) endGuard();
      else window.addEventListener("pointerup", endGuard, { capture: true, once: true });
      // Seats that came or went during the drag make the order of the drag out of date.
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

  /* The seats follow the props, in their order. One change moves: an added seat comes in at the
     bottom. More at once, such as the first load, or a new order, jump. */
  createEffect(
    () => props.seats.map((seat) => agentDockSeatKey(seatRef(seat))),
    (ids) =>
      untrack(() => {
        const removed = state.seats.filter((id) => !leaving.has(id) && !ids.includes(id));
        const added = ids.filter((id) => !state.seats.includes(id));
        const moved = [...state.seats.filter((id) => !leaving.has(id) && !removed.includes(id)), ...added];
        const inOrder = moved.length === ids.length && moved.every((id, index) => id === ids[index]);
        if (inOrder && removed.length + added.length === 0) return;
        // The order of a drag that runs does not have the new seats.
        endSeatDrag?.(false);
        if (!inOrder || removed.length + added.length > 1) {
          setSeats(ids);
          return;
        }
        for (const id of removed) takeAgent(id);
        for (const id of added) placeAgent(id);
      }),
  );

  /**
   * Sends the draft of the open chat. A recording that ends with a send gives its chat and text: a store
   * write shows in a read only after the next flush, so the draft can still hold the old text.
   */
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
        // The text goes back to the composer, so the user can send it again.
        if (!draft.drafts[id]) draft.drafts[id] = text;
        return;
      }
      const sent = pending[index];
      if (sent) sent.messageId = result.messageId;
    });
  }

  const shownSeat = () => (state.shown ? seatFor(state.shown) : undefined);

  /** Escape in the chat or on a seat closes the chat. A menu that is open handles Escape first. */
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

  /* The dock slides into the edge and out of it on a spring. */
  createEffect(
    () => props.tucked ?? false,
    (tucked) => {
      tuck.to(tucked ? TUCK_DISTANCE : 0);
      motion.kick();
    },
  );

  /* The edge changes the place of the dock without a spring. */
  createEffect(
    () => props.side,
    () => reportShape(),
  );

  onSettled(() => {
    render();
    reportShape();
    // The shelf grows, shrinks and hides without a spring; the window can get another height.
    const resized = new ResizeObserver(() => reportShape());
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
        <svg class="agent-dock-filter" aria-hidden="true" width="0" height="0">
          <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation="9" result="blur" />
            <feColorMatrix in="blur" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -11" />
          </filter>
        </svg>

        {/* The liquid: the dock, the neck, the panel and the drop under the goo filter. */}
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
        {/* The dock and the panel again, without the filter, so the tips and corners stay sharp. */}
        <svg class="agent-dock-edge" width={LIQUID_WIDTH} height={LIQUID_HEIGHT} aria-hidden="true">
          <path ref={(element) => (dockEdge = element)} />
          <rect ref={(element) => (panelEdge = element)} />
        </svg>

        {/* The handle below the dock. Only the handle moves the dock. */}
        <svg class="agent-dock-handle" width={LIQUID_WIDTH} height={LIQUID_HEIGHT} aria-hidden="true">
          <path class="agent-dock-handle-arc" stroke-width={HANDLE_STROKE} ref={(element) => (handleArc = element)} />
          {/* A wider clear stroke, so the thin arc is easy to take. */}
          <path
            class="agent-dock-handle-hit"
            stroke-width={HANDLE_STROKE * 5}
            ref={(element) => (handleHit = element)}
            onPointerDown={startDrag}
          />
        </svg>

        {/* The dock body between and around the seats. It takes the pointer, so a click there does not go
          through to the app under the dock. */}
        {/* A right-click on the dock body opens the menu of the whole dock. The seats have their own menus. */}
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
          {/* The seats scroll when more agents are on the dock than the screen holds. */}
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
            {/* The menu reads its placement once, so a change of edge makes a new menu. */}
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
                          <DropdownMenu.Item disabled>{addEmptyText()}</DropdownMenu.Item>
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
          onShownChange={(shown) => props.onShelfChange?.(shown)}
          ref={(element) => {
            shelf = element;
            element.style.right = `${STAGE_WIDTH - DOCK_LEFT + SHELF_GAP}px`;
            motion.kick();
          }}
        />

        {/* The panel content, over the liquid panel. */}
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

/** The face of a seat with its sidebar badge. A channel shows the member cluster of its sidebar row. */
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
