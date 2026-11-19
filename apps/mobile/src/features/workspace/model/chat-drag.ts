import {
  SIDEBAR_UNASSIGNED_SECTION_ID,
  type SidebarLayoutAction,
  type SidebarLayoutSnapshot,
  type SidebarPin,
  sidebarPinKey,
} from "@openbot/contracts/ipc";
import { samePinList } from "./agent-pins";
import { moveSidebarChat } from "./sidebar-layout";

export interface DraggedChat {
  chat: SidebarPin;
  pinned: boolean;
}

export interface DragRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ChatDropTarget =
  | { area: "pins"; beforeKey: string | null }
  | { area: "list"; sectionId: string; beforeChatId: string | null };

export interface DropMark {
  shape: "line" | "bar" | "zone";
  rect: DragRect;
}

export interface PinnedTileFrame {
  chat: SidebarPin;
  rect: DragRect;
}

export type ListFrame =
  | { kind: "section"; id: string; rect: DragRect; open: boolean }
  | { kind: "chat"; chat: SidebarPin; sectionId: string | null; rect: DragRect };

export interface DropFrames {
  pinArea: DragRect | null;
  pins: readonly PinnedTileFrame[];
  list: readonly ListFrame[];
}

export interface DropChange {
  pins?: SidebarPin[];
  move?: Extract<SidebarLayoutAction, { type: "move-agent" }>;
}

const PIN_AREA_SLOP = 12;
const LINE_HEIGHT = 3;

function contains(rect: DragRect, x: number, y: number, slop = 0): boolean {
  return (
    x >= rect.x - slop && x <= rect.x + rect.width + slop && y >= rect.y - slop && y <= rect.y + rect.height + slop
  );
}

function line(rect: DragRect, y: number): DropMark {
  return { shape: "line", rect: { x: rect.x, y: y - LINE_HEIGHT / 2, width: rect.width, height: LINE_HEIGHT } };
}

export function chatDropTarget(
  frames: DropFrames,
  dragged: DraggedChat,
  x: number,
  y: number,
  options: { canPin: boolean; sections: boolean },
): { target: ChatDropTarget; mark: DropMark } | null {
  if (frames.pinArea && contains(frames.pinArea, x, y, PIN_AREA_SLOP)) {
    if (!dragged.pinned && !options.canPin) return null;
    return pinTarget(frames, dragged, x, y);
  }
  if (!options.sections) return dragged.pinned ? unpinTarget(frames.list, y) : null;
  return listTarget(frames.list, dragged, y);
}

function unpinTarget(list: readonly ListFrame[], y: number): { target: ChatDropTarget; mark: DropMark } | null {
  const entry = list.find((candidate) => y >= candidate.rect.y && y < candidate.rect.y + candidate.rect.height);
  const last = list.at(-1);
  const mark = entry
    ? line(entry.rect, entry.rect.y)
    : last && y >= last.rect.y
      ? line(last.rect, last.rect.y + last.rect.height)
      : null;
  return mark ? { target: { area: "list", sectionId: SIDEBAR_UNASSIGNED_SECTION_ID, beforeChatId: null }, mark } : null;
}

function pinTarget(
  frames: DropFrames,
  dragged: DraggedChat,
  x: number,
  y: number,
): { target: ChatDropTarget; mark: DropMark } | null {
  const draggedKey = sidebarPinKey(dragged.chat);
  const group = frames.pins.filter(
    (tile) => tile.chat.kind === dragged.chat.kind && sidebarPinKey(tile.chat) !== draggedKey,
  );
  if (group.length === 0 || !frames.pinArea) {
    return frames.pinArea
      ? { target: { area: "pins", beforeKey: null }, mark: { shape: "zone", rect: frames.pinArea } }
      : null;
  }
  let nearest = group[0];
  let best = Number.POSITIVE_INFINITY;
  for (const tile of group) {
    const dx = x - (tile.rect.x + tile.rect.width / 2);
    const dy = y - (tile.rect.y + tile.rect.height / 2);
    const distance = dx * dx + 4 * dy * dy;
    if (distance < best) {
      best = distance;
      nearest = tile;
    }
  }
  if (!nearest) return null;
  const before = x < nearest.rect.x + nearest.rect.width / 2;
  const index = group.indexOf(nearest);
  const next = before ? nearest : group[index + 1];
  const edge = before ? nearest.rect.x : nearest.rect.x + nearest.rect.width;
  return {
    target: { area: "pins", beforeKey: next ? sidebarPinKey(next.chat) : null },
    mark: {
      shape: "bar",
      rect: { x: edge - LINE_HEIGHT / 2, y: nearest.rect.y, width: LINE_HEIGHT, height: nearest.rect.height },
    },
  };
}

function listTarget(
  list: readonly ListFrame[],
  dragged: DraggedChat,
  y: number,
): { target: ChatDropTarget; mark: DropMark } | null {
  const draggedKey = sidebarPinKey(dragged.chat);
  const index = list.findIndex((entry) => y >= entry.rect.y && y < entry.rect.y + entry.rect.height);
  if (index < 0) {
    const last = list.at(-1);
    if (!last || y < last.rect.y) return null;
    const sectionId = last.kind === "section" ? last.id : last.sectionId;
    if (sectionId === null) return null;
    return {
      target: { area: "list", sectionId, beforeChatId: null },
      mark: line(last.rect, last.rect.y + last.rect.height),
    };
  }
  const entry = list[index];
  if (!entry) return null;
  if (entry.kind === "section") {
    const first = list[index + 1];
    const firstChat =
      entry.open && first?.kind === "chat" && first.sectionId === entry.id && sidebarPinKey(first.chat) !== draggedKey
        ? first.chat.id
        : null;
    return {
      target: { area: "list", sectionId: entry.id, beforeChatId: firstChat },
      mark: line(entry.rect, entry.rect.y + entry.rect.height),
    };
  }
  if (entry.sectionId === null) return null;
  const before = y < entry.rect.y + entry.rect.height / 2;
  const self = sidebarPinKey(entry.chat) === draggedKey;
  let beforeChatId: string | null = entry.chat.id;
  if (!before || self) {
    const next = list
      .slice(index + 1)
      .find((candidate) => candidate.kind !== "chat" || sidebarPinKey(candidate.chat) !== draggedKey);
    beforeChatId = next?.kind === "chat" && next.sectionId === entry.sectionId ? next.chat.id : null;
  }
  return {
    target: { area: "list", sectionId: entry.sectionId, beforeChatId },
    mark: line(entry.rect, before ? entry.rect.y : entry.rect.y + entry.rect.height),
  };
}

function placePin(pins: readonly SidebarPin[], chat: SidebarPin, beforeKey: string | null): SidebarPin[] {
  const key = sidebarPinKey(chat);
  const rest = pins.filter((pin) => sidebarPinKey(pin) !== key);
  let index = beforeKey === null ? -1 : rest.findIndex((pin) => sidebarPinKey(pin) === beforeKey);
  if (index < 0) {
    const last = rest.findLastIndex((pin) => pin.kind === chat.kind);
    index = last < 0 ? rest.length : last + 1;
  }
  rest.splice(index, 0, { kind: chat.kind, id: chat.id });
  return rest;
}

function sameLayoutPlace(left: SidebarLayoutSnapshot, right: SidebarLayoutSnapshot, chatId: string): boolean {
  return (
    left.agentAssignments[chatId] === right.agentAssignments[chatId] &&
    left.agentOrder.length === right.agentOrder.length &&
    left.agentOrder.every((id, index) => right.agentOrder[index] === id)
  );
}

export function chatDropChange(
  dragged: DraggedChat,
  target: ChatDropTarget,
  pins: readonly SidebarPin[],
  layout: SidebarLayoutSnapshot | null,
): DropChange {
  if (target.area === "pins") {
    const next = placePin(pins, dragged.chat, target.beforeKey);
    return dragged.pinned && samePinList(next, pins) ? {} : { pins: next };
  }
  const key = sidebarPinKey(dragged.chat);
  const change: DropChange = dragged.pinned ? { pins: pins.filter((pin) => sidebarPinKey(pin) !== key) } : {};
  if (layout) {
    const move = {
      type: "move-agent" as const,
      agentId: dragged.chat.id,
      sectionId: target.sectionId === SIDEBAR_UNASSIGNED_SECTION_ID ? null : target.sectionId,
      beforeAgentId: target.beforeChatId,
    };
    if (!sameLayoutPlace(layout, moveSidebarChat(layout, move), dragged.chat.id)) change.move = move;
  }
  return change;
}
