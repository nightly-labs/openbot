import { SIDEBAR_PEOPLE_SECTION_ID } from "@openbot/contracts/ipc";

export interface DragSlot {
  bottom: number;
  key: string;
  left: number;
  right: number;
  top: number;
  centerX: number;
  centerY: number;
}

export interface DragOffset {
  x: number;
  y: number;
}

export const ZERO_DRAG_OFFSET: DragOffset = { x: 0, y: 0 };

export interface ReorderSlot {
  left?: number;
  top: number;
}

export interface SectionDropTarget {
  sectionId: string;
  placement: "before" | "after";
}

export interface ChatDropTarget {
  chatId: string;
  placement: "before" | "after";
  sectionId: string;
}

export interface PersonDropTarget {
  memberId: string;
  placement: "before" | "after";
}

export interface ChatDragSlot {
  chatId: string;
  bottom: number;
  centerY: number;
  element: HTMLElement;
  height: number;
  sectionId: string;
  top: number;
}

export interface SectionDragSlot {
  bottom: number;
  centerY: number;
  header: { height: number; stickTop: number | null } | null;
  sectionId: string;
  top: number;
}

function sectionHeaderBand(slot: SectionDragSlot, scrollDelta: number): { top: number; bottom: number } | null {
  if (!slot.header || slot.header.height <= 0) return null;
  const natural = slot.top - scrollDelta;
  const top =
    slot.header.stickTop === null
      ? natural
      : Math.max(natural, Math.min(slot.header.stickTop, slot.bottom - scrollDelta - slot.header.height));
  return { top, bottom: top + slot.header.height };
}

export interface PersonDragSlot {
  bottom: number;
  centerY: number;
  element: HTMLElement;
  memberId: string;
  top: number;
}

export type SidebarDragSource =
  | { kind: "chat"; id: string; origin: "section" }
  | { kind: "pinned"; id: string; key: string; origin: "pinned" }
  | { kind: "person"; id: string; origin: "people" }
  | { kind: "section"; id: string };

export type SidebarDropTarget =
  | { kind: "pinned"; key: string | null }
  | { kind: "chat"; target: ChatDropTarget }
  | { kind: "section"; sectionId: string }
  | { kind: "person"; target: PersonDropTarget }
  | { kind: "section-order"; target: SectionDropTarget }
  | { kind: "section-into"; sectionId: string };

export interface SidebarDragPoint {
  clientX: number;
  clientY: number;
}

export interface SidebarDragSession {
  source: SidebarDragSource;
  startScrollTop: number;
}

export interface SidebarDragGeometry {
  list: DOMRect | null;
  pinned: DOMRect | null;
}

export interface SidebarNativeDragStart {
  className: string;
  createPreview?: (source: HTMLElement) => HTMLElement;
  data: string;
  horizontal?: boolean;
  previewSize?: { height: number; width: number };
  source: SidebarDragSource;
}

export interface SidebarDrag {
  emptyPinnedDropVisible: boolean;
  offsets: Record<string, DragOffset>;
  source: SidebarDragSource | null;
  target: SidebarDropTarget | null;
}

export interface SidebarDragWorld {
  chatScrollDelta: number;
  chatSlots: Map<string, ChatDragSlot>;
  canPinDraggedItem: () => boolean;
  geometry: SidebarDragGeometry;
  personSlots: Map<string, PersonDragSlot>;
  pinnedSlots: DragSlot[];
  sectionAcceptsChat: (sectionId: string) => boolean;
  sectionScrollDelta: number;
  sectionSlots: Map<string, SectionDragSlot>;
  folders: SidebarDragFolders | null;
  session: SidebarDragSession;
  sessionScrollDelta: number;
}

export interface SidebarDragFolders {
  canNest: (sectionId: string, parentId: string | null) => boolean;
  isInside: (sectionId: string, ancestorId: string) => boolean;
  parent: (sectionId: string) => string | null;
}

export function sidebarDropTargetsEqual(left: SidebarDropTarget | null, right: SidebarDropTarget | null): boolean {
  if (left === right) return true;
  if (!left || !right || left.kind !== right.kind) return false;
  if (left.kind === "pinned" && right.kind === "pinned") return left.key === right.key;
  if (left.kind === "section" && right.kind === "section") return left.sectionId === right.sectionId;
  if (left.kind === "section-into" && right.kind === "section-into") return left.sectionId === right.sectionId;
  if (left.kind === "chat" && right.kind === "chat") {
    return (
      left.target.chatId === right.target.chatId &&
      left.target.placement === right.target.placement &&
      left.target.sectionId === right.target.sectionId
    );
  }
  if (left.kind === "person" && right.kind === "person") {
    return left.target.memberId === right.target.memberId && left.target.placement === right.target.placement;
  }
  if (left.kind === "section-order" && right.kind === "section-order") {
    return left.target.sectionId === right.target.sectionId && left.target.placement === right.target.placement;
  }
  return false;
}

export function pointInRect(point: SidebarDragPoint, rect: DOMRect | null, scrollDelta = 0): boolean {
  if (!rect) return false;
  return (
    point.clientX >= rect.left &&
    point.clientX <= rect.right &&
    point.clientY >= rect.top - scrollDelta &&
    point.clientY <= rect.bottom - scrollDelta
  );
}

export function closestVerticalSlot<T extends { bottom: number; top: number }>(
  slots: Iterable<T>,
  clientY: number,
  scrollDelta: number,
  accepts: (slot: T) => boolean = () => true,
): T | null {
  let closest: T | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  let extentTop = Number.POSITIVE_INFINITY;
  let extentBottom = Number.NEGATIVE_INFINITY;
  for (const slot of slots) {
    if (!accepts(slot)) continue;
    const top = slot.top - scrollDelta;
    const bottom = slot.bottom - scrollDelta;
    extentTop = Math.min(extentTop, top);
    extentBottom = Math.max(extentBottom, bottom);
    const distance = Math.max(top - clientY, clientY - bottom, 0);
    if (distance <= closestDistance) {
      closest = slot;
      closestDistance = distance;
    }
  }
  return clientY >= extentTop && clientY <= extentBottom ? closest : null;
}

function targetChatAt(
  world: SidebarDragWorld,
  sourceChatId: string,
  chatId: string,
  clientY: number,
): ChatDropTarget | null {
  if (sourceChatId === chatId) return null;
  const sourceSlot = world.chatSlots.get(sourceChatId);
  const slot = world.chatSlots.get(chatId);
  if (!slot) return null;
  const scrollDelta = world.chatScrollDelta;
  const placement =
    sourceSlot?.sectionId === slot.sectionId
      ? sourceSlot.top < slot.top
        ? "after"
        : "before"
      : clientY < slot.centerY - scrollDelta
        ? "before"
        : "after";
  const nextTarget: ChatDropTarget = {
    chatId,
    placement,
    sectionId: slot.sectionId,
  };
  return nextTarget;
}

function sectionAtPoint(world: SidebarDragWorld, point: SidebarDragPoint): SectionDragSlot | null {
  return closestVerticalSlot(world.sectionSlots.values(), point.clientY, world.sectionScrollDelta);
}

function chatAtPoint(world: SidebarDragWorld, point: SidebarDragPoint, sectionId: string): ChatDragSlot | null {
  return closestVerticalSlot(
    world.chatSlots.values(),
    point.clientY,
    world.chatScrollDelta,
    (slot) => slot.sectionId === sectionId,
  );
}

function ownSectionTopTarget(
  world: SidebarDragWorld,
  point: SidebarDragPoint,
  sourceChatId: string,
  sectionId: string,
): SidebarDropTarget | null | undefined {
  if (world.chatSlots.get(sourceChatId)?.sectionId !== sectionId) return undefined;
  let first: ChatDragSlot | null = null;
  for (const slot of world.chatSlots.values()) {
    if (slot.sectionId === sectionId && (!first || slot.top < first.top)) first = slot;
  }
  if (!first || point.clientY >= first.top - world.chatScrollDelta) return undefined;
  if (first.chatId === sourceChatId) return null;
  return { kind: "chat", target: { chatId: first.chatId, placement: "before", sectionId } };
}

function personAtPoint(world: SidebarDragWorld, point: SidebarDragPoint): PersonDragSlot | null {
  return closestVerticalSlot(world.personSlots.values(), point.clientY, world.sessionScrollDelta);
}

function pinnedTargetAtPoint(world: SidebarDragWorld, point: SidebarDragPoint): SidebarDropTarget | null {
  const scrollDelta = world.sessionScrollDelta;
  if (!pointInRect(point, world.geometry.pinned, scrollDelta)) return null;
  const source = world.session.source;
  if (!("origin" in source) || source.origin !== "pinned") {
    return world.canPinDraggedItem() ? { kind: "pinned", key: null } : null;
  }
  if (world.pinnedSlots.length === 0) return { kind: "pinned", key: null };
  const target = world.pinnedSlots.reduce((closest, slot) =>
    Math.hypot(slot.centerX - point.clientX, slot.centerY - scrollDelta - point.clientY) <
    Math.hypot(closest.centerX - point.clientX, closest.centerY - scrollDelta - point.clientY)
      ? slot
      : closest,
  );
  return { kind: "pinned", key: target.key };
}

export function sidebarDropTargetAt(world: SidebarDragWorld, point: SidebarDragPoint): SidebarDropTarget | null {
  const session = world.session;
  if (!pointInRect(point, world.geometry.list)) return null;
  const pinnedTarget = pinnedTargetAtPoint(world, point);
  if (pinnedTarget) return pinnedTarget;
  if (session.source.kind === "section" && world.folders)
    return folderTargetAtPoint(world, world.folders, session.source.id, point);
  const section = sectionAtPoint(world, point);
  if (!section) return null;

  if (session.source.kind === "section") {
    if (section.sectionId === session.source.id) return null;
    const scrollDelta = world.sectionScrollDelta;
    return {
      kind: "section-order",
      target: {
        sectionId: section.sectionId,
        placement: point.clientY < section.centerY - scrollDelta ? "before" : "after",
      },
    };
  }

  if (session.source.kind === "person") {
    if (section.sectionId !== SIDEBAR_PEOPLE_SECTION_ID) return null;
    const person = personAtPoint(world, point);
    if (!person || person.memberId === session.source.id) return { kind: "section", sectionId: section.sectionId };
    const sourceSlot = world.personSlots.get(session.source.id);
    return {
      kind: "person",
      target: {
        memberId: person.memberId,
        placement:
          session.source.origin === "people" && sourceSlot
            ? sourceSlot.top < person.top
              ? "after"
              : "before"
            : point.clientY < person.centerY
              ? "before"
              : "after",
      },
    };
  }

  if (!world.sectionAcceptsChat(section.sectionId)) return null;
  const chat = chatAtPoint(world, point, section.sectionId);
  if (chat && chat.chatId !== session.source.id) {
    const target = targetChatAt(world, session.source.id, chat.chatId, point.clientY);
    if (target) return { kind: "chat", target };
  }
  if (!chat) {
    const top = ownSectionTopTarget(world, point, session.source.id, section.sectionId);
    if (top !== undefined) return top;
  }
  return { kind: "section", sectionId: section.sectionId };
}

function folderTargetAtPoint(
  world: SidebarDragWorld,
  folders: SidebarDragFolders,
  sourceId: string,
  point: SidebarDragPoint,
): SidebarDropTarget | null {
  const scrollDelta = world.sectionScrollDelta;
  const y = point.clientY + scrollDelta;
  const sourceSlot = world.sectionSlots.get(sourceId);
  if (sourceSlot && y >= sourceSlot.top && y <= sourceSlot.bottom) return null;
  const accepts = (candidate: SectionDragSlot) => !folders.isInside(candidate.sectionId, sourceId);
  let header: { slot: SectionDragSlot; top: number; bottom: number } | null = null;
  for (const candidate of world.sectionSlots.values()) {
    const band = accepts(candidate) ? sectionHeaderBand(candidate, scrollDelta) : null;
    if (band && point.clientY >= band.top && point.clientY <= band.bottom) header = { slot: candidate, ...band };
  }
  const slot = header?.slot ?? closestVerticalSlot(world.sectionSlots.values(), point.clientY, scrollDelta, accepts);
  if (!slot) return null;
  const parentId = folders.parent(slot.sectionId);
  const beside = (placement: "before" | "after"): SidebarDropTarget | null =>
    folders.canNest(sourceId, parentId)
      ? { kind: "section-order", target: { sectionId: slot.sectionId, placement } }
      : null;
  const into: SidebarDropTarget | null = folders.canNest(sourceId, slot.sectionId)
    ? { kind: "section-into", sectionId: slot.sectionId }
    : null;
  if (header) {
    const ratio = (point.clientY - header.top) / (header.bottom - header.top);
    if (ratio < 0.25) return beside("before") ?? into;
    if (ratio > 0.75) return beside("after") ?? into;
    return into ?? beside(ratio < 0.5 ? "before" : "after");
  }
  if (y < slot.top) return beside("before");
  if (y > slot.bottom) return beside("after");
  return into ?? beside(y < slot.centerY ? "before" : "after");
}

export function reorderOffsets(
  currentIds: readonly string[],
  sourceId: string,
  target: { id: string; placement: "before" | "after" },
  slotOf: (id: string) => ReorderSlot | undefined,
  axis: "x-and-y" | "y",
): Record<string, DragOffset> {
  const desiredIds = currentIds.filter((id) => id !== sourceId);
  const targetIndex = desiredIds.indexOf(target.id);
  if (targetIndex < 0) return {};
  desiredIds.splice(targetIndex + (target.placement === "after" ? 1 : 0), 0, sourceId);
  const desiredIndexById = new Map(desiredIds.map((id, index) => [id, index]));
  const offsets: Record<string, DragOffset> = {};
  for (const id of currentIds) {
    if (id === sourceId) continue;
    const desiredIndex = desiredIndexById.get(id);
    const destinationId = desiredIndex === undefined ? undefined : currentIds[desiredIndex];
    const currentSlot = slotOf(id);
    const destinationSlot = destinationId === undefined ? undefined : slotOf(destinationId);
    if (!currentSlot || !destinationSlot) continue;
    const x = axis === "x-and-y" ? (destinationSlot.left ?? 0) - (currentSlot.left ?? 0) : 0;
    const y = destinationSlot.top - currentSlot.top;
    if (x !== 0 || y !== 0) offsets[id] = { x, y };
  }
  return offsets;
}

export function placementForSwap(
  currentIds: readonly string[],
  sourceId: string,
  targetId: string,
): "before" | "after" {
  return currentIds.indexOf(sourceId) < currentIds.indexOf(targetId) ? "after" : "before";
}
