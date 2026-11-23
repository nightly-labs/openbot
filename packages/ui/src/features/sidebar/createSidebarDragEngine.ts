import type { TeamPresenceMember } from "@openbot/contracts/ipc";
import { createBoundedDragPreview } from "../../components/createBoundedDragPreview";
import type { createScrollFades } from "../../components/createScrollFades";

import { clearSidebarDragDecorations, createSidebarChatDragCard, measureSidebarDragSlots } from "./sidebar-drag-dom";
import {
  type ChatDragSlot,
  type DragOffset,
  type DragSlot,
  type PersonDragSlot,
  placementForSwap,
  pointInRect,
  reorderOffsets,
  type SectionDragSlot,
  type SidebarDragFolders,
  type SidebarDragGeometry,
  type SidebarDragPoint,
  type SidebarDragSession,
  type SidebarDragSource,
  type SidebarDragWorld,
  type SidebarDropTarget,
  type SidebarNativeDragStart,
  sidebarDropTargetAt,
  sidebarDropTargetsEqual,
} from "./sidebar-drag-model";
import type { SidebarPinnedItem } from "./sidebar-pins";
import type { SidebarChatItem, SidebarProps } from "./sidebar-types";
import type { SidebarDragWriters } from "./stores/drag-state-store";

export interface SidebarDragEngineDeps {
  chatPinnedItems: () => SidebarPinnedItem[];
  assignedSectionId: (chatId: string) => string;
  commitSidebarDrop: (source: SidebarDragSource, target: SidebarDropTarget | null) => void;
  canPinDraggedItem: () => boolean;
  dragState: SidebarDragWriters;
  filteredChatsBySection: () => Map<string, SidebarChatItem[]>;
  orderedPeople: () => TeamPresenceMember[];
  getAgentList: () => HTMLElement | undefined;
  chatKind: (chatId: string) => "agent" | "channel" | null;
  props: SidebarProps;
  scrollFades: ReturnType<typeof createScrollFades>;
  sectionAcceptsChat: (sectionId: string) => boolean;
  folders: () => SidebarDragFolders | null;
  sectionIsCollapsed: (sectionId: string) => boolean;
  visiblePinnedKeys: () => string[];
  visibleSectionIds: () => string[];
}

const SPRING_OPEN_MS = 700;

const DRAG_AIM_DISTANCE_PX = 6;

export function createSidebarDragEngine(deps: SidebarDragEngineDeps) {
  const {
    assignedSectionId,
    canPinDraggedItem,
    chatKind,
    chatPinnedItems,
    commitSidebarDrop,
    dragState,
    filteredChatsBySection,
    orderedPeople,
    scrollFades,
    sectionAcceptsChat,
    visiblePinnedKeys,
    visibleSectionIds,
  } = deps;

  let pinnedDragSlots: DragSlot[] = [];

  let chatDragSlots = new Map<string, ChatDragSlot>();

  let chatDragStartScrollTop = 0;

  let sectionDragSlots = new Map<string, SectionDragSlot>();

  let sectionDragStartScrollTop = 0;

  let dragSession: SidebarDragSession | null = null;

  let dragGeometry: SidebarDragGeometry = { list: null, pinned: null };

  let dragPoint: SidebarDragPoint | null = null;

  let dragOrigin: SidebarDragPoint | null = null;

  let dragTarget: SidebarDropTarget | null = null;

  let dragTargetFrame: number | null = null;

  let dragScrollFrame: number | null = null;

  let dragScrollSpeed = 0;

  let personDragSlots = new Map<string, PersonDragSlot>();

  let suppressSidebarClickUntil = 0;

  let springOpen: { sectionId: string; timer: number } | null = null;

  const dragPreview = createBoundedDragPreview();

  function stopSidebarDragging(): void {
    if (dragTargetFrame !== null) cancelAnimationFrame(dragTargetFrame);
    if (dragScrollFrame !== null) cancelAnimationFrame(dragScrollFrame);
    window.removeEventListener("blur", stopSidebarDragging);
    deps.getAgentList()?.removeEventListener("transitionend", remeasureAfterTransition);
    stopSpringOpen();
    dragSession = null;
    dragPoint = null;
    dragOrigin = null;
    dragTarget = null;
    dragTargetFrame = null;
    dragScrollFrame = null;
    dragScrollSpeed = 0;
    dragGeometry = { list: null, pinned: null };
    dragState.resetDrag();
    clearSidebarDragDecorations(deps.getAgentList());
    for (const slot of personDragSlots.values()) slot.element.classList.remove("sidebar-person-item-dragging");
    chatDragSlots.clear();
    personDragSlots.clear();
    sectionDragSlots.clear();
    pinnedDragSlots = [];
    dragPreview.stop();
  }

  function stopSpringOpen(): void {
    if (springOpen) clearTimeout(springOpen.timer);
    springOpen = null;
  }

  function updateSpringOpen(target: SidebarDropTarget | null): void {
    const sectionId = target?.kind === "section" || target?.kind === "section-into" ? target.sectionId : null;
    if (!sectionId || !deps.sectionIsCollapsed(sectionId)) {
      stopSpringOpen();
      return;
    }
    if (springOpen?.sectionId === sectionId) return;
    stopSpringOpen();
    springOpen = {
      sectionId,
      timer: window.setTimeout(() => {
        springOpen = null;
        if (dragSession && deps.sectionIsCollapsed(sectionId)) deps.props.onToggleSection(sectionId);
      }, SPRING_OPEN_MS),
    };
  }

  function remeasureAfterTransition(event: TransitionEvent): void {
    if (!dragSession || event.propertyName !== "grid-template-rows") return;
    measureSidebarDragTargets();
    if (dragPoint) scheduleSidebarDragTarget(dragPoint);
  }

  function sidebarClickIsSuppressed(event: MouseEvent): boolean {
    if (Date.now() >= suppressSidebarClickUntil) return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function measureSidebarDragTargets(): void {
    sectionDragSlots = new Map();
    chatDragSlots = new Map();
    personDragSlots = new Map();
    pinnedDragSlots = [];
    const list = deps.getAgentList();
    const startScrollTop = list?.scrollTop ?? 0;
    sectionDragStartScrollTop = startScrollTop;
    chatDragStartScrollTop = startScrollTop;
    if (!list) return;
    const measurement = measureSidebarDragSlots(list, assignedSectionId);
    sectionDragSlots = measurement.sections;
    chatDragSlots = measurement.chats;
    personDragSlots = measurement.people;
    pinnedDragSlots = measurement.pinned;
    dragGeometry = measurement.geometry;
  }

  function startNativeItemDragging(
    event: DragEvent & { currentTarget: HTMLElement },
    options: SidebarNativeDragStart,
  ): void {
    if (deps.props.compact) {
      event.preventDefault();
      return;
    }
    event.dataTransfer?.setData("text/plain", options.data);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    dragSession = { source: options.source, startScrollTop: deps.getAgentList()?.scrollTop ?? 0 };
    dragPoint = { clientX: event.clientX, clientY: event.clientY };
    dragTarget = null;
    dragState.beginDrag(options.source);
    measureSidebarDragTargets();
    const list = deps.getAgentList();
    if (!list) return;
    dragPreview.start({
      bounds: list,
      className: options.className,
      createPreview: options.createPreview,
      event,
      horizontal: options.horizontal,
      previewSize: options.previewSize,
      source: event.currentTarget,
    });
    list.addEventListener("transitionend", remeasureAfterTransition);
    window.addEventListener("blur", stopSidebarDragging, { once: true });
  }

  function startChatDragging(event: DragEvent & { currentTarget: HTMLElement }, chatId: string): void {
    if (deps.props.compact) return;
    startNativeItemDragging(event, {
      className: "sidebar-agent-drag-preview",
      createPreview: createSidebarChatDragCard,
      data: `openbot-chat:${chatId}`,
      previewSize: { height: 102, width: 72 },
      source: { kind: "chat", id: chatId, origin: "section" },
    });
  }

  function startPersonDragging(event: DragEvent & { currentTarget: HTMLElement }, member: TeamPresenceMember): void {
    startNativeItemDragging(event, {
      className: "sidebar-person-drag-preview",
      createPreview: createSidebarChatDragCard,
      data: `openbot-person:${member.id}`,
      previewSize: { height: 102, width: 72 },
      source: { kind: "person", id: member.id, origin: "people" },
    });
    personDragSlots.get(member.id)?.element.classList.add("sidebar-person-item-dragging");
  }

  function startSectionDragging(event: DragEvent & { currentTarget: HTMLElement }, sectionId: string): void {
    startNativeItemDragging(event, {
      className: "sidebar-section-drag-preview",
      data: `openbot-section:${sectionId}`,
      horizontal: false,
      source: { kind: "section", id: sectionId },
    });
  }

  function sidebarDragWorld(session: SidebarDragSession): SidebarDragWorld {
    const scrollTop = deps.getAgentList()?.scrollTop ?? 0;
    return {
      chatScrollDelta: scrollTop - chatDragStartScrollTop,
      chatSlots: chatDragSlots,
      canPinDraggedItem,
      geometry: dragGeometry,
      personSlots: personDragSlots,
      pinnedSlots: pinnedDragSlots,
      sectionAcceptsChat,
      sectionScrollDelta: scrollTop - sectionDragStartScrollTop,
      sectionSlots: sectionDragSlots,
      folders: deps.folders(),
      session,
      sessionScrollDelta: scrollTop - session.startScrollTop,
    };
  }

  function pointerIsAtDragOrigin(point: SidebarDragPoint): boolean {
    if (!dragOrigin) return false;
    return Math.hypot(point.clientX - dragOrigin.clientX, point.clientY - dragOrigin.clientY) < DRAG_AIM_DISTANCE_PX;
  }

  function resolveSidebarDropTarget(point: SidebarDragPoint): SidebarDropTarget | null {
    const session = dragSession;
    if (!session || pointerIsAtDragOrigin(point)) return null;
    return sidebarDropTargetAt(sidebarDragWorld(session), point);
  }

  function sidebarDragOffsets(target: SidebarDropTarget | null): Record<string, DragOffset> {
    const source = dragSession?.source;
    if (!source || !target) return {};
    switch (target.kind) {
      case "pinned": {
        if (source.kind !== "pinned" || !target.key) return {};
        const keys = visiblePinnedKeys();
        return reorderOffsets(
          keys,
          source.key,
          { id: target.key, placement: placementForSwap(keys, source.key, target.key) },
          (key) => pinnedDragSlots[keys.indexOf(key)],
          "x-and-y",
        );
      }
      case "chat": {
        if (source.kind !== "chat") return {};
        const sourceSlot = chatDragSlots.get(source.id);
        const targetSlot = chatDragSlots.get(target.target.chatId);
        if (!sourceSlot || !targetSlot || sourceSlot.sectionId !== targetSlot.sectionId) return {};
        const chatIds = (filteredChatsBySection().get(sourceSlot.sectionId) ?? []).map((item) => item.id);
        return reorderOffsets(
          chatIds,
          source.id,
          {
            id: target.target.chatId,
            placement: placementForSwap(chatIds, source.id, target.target.chatId),
          },
          (chatId) => chatDragSlots.get(chatId),
          "y",
        );
      }
      case "person": {
        if (source.kind !== "person") return {};
        return reorderOffsets(
          orderedPeople().map((member) => member.id),
          source.id,
          { id: target.target.memberId, placement: target.target.placement },
          (memberId) => personDragSlots.get(memberId),
          "y",
        );
      }
      case "section-order": {
        if (source.kind !== "section" || deps.folders()) return {};
        return reorderOffsets(
          visibleSectionIds(),
          source.id,
          { id: target.target.sectionId, placement: target.target.placement },
          (sectionId) => sectionDragSlots.get(sectionId),
          "y",
        );
      }
      default:
        return {};
    }
  }

  function applySidebarDropTarget(target: SidebarDropTarget | null): void {
    if (sidebarDropTargetsEqual(dragTarget, target)) return;
    dragTarget = target;
    updateSpringOpen(target);
    dragState.setDragTarget(target);
    dragState.setDragOffsets(sidebarDragOffsets(target));
  }

  function runSidebarDragTargetFrame(): void {
    dragTargetFrame = null;
    if (!dragPoint || !dragSession) return;
    applySidebarDropTarget(resolveSidebarDropTarget(dragPoint));
    updateSidebarDragAutoScroll(dragPoint.clientY);
  }

  function scheduleSidebarDragTarget(point: SidebarDragPoint): void {
    dragPoint = point;
    if (dragTargetFrame === null) dragTargetFrame = requestAnimationFrame(runSidebarDragTargetFrame);
  }

  function flushSidebarDragTarget(point: SidebarDragPoint): SidebarDropTarget | null {
    if (dragTargetFrame !== null) cancelAnimationFrame(dragTargetFrame);
    dragTargetFrame = null;
    dragPoint = point;
    const target = resolveSidebarDropTarget(point);
    applySidebarDropTarget(target);
    return target;
  }

  function runSidebarDragAutoScroll(): void {
    dragScrollFrame = null;
    const list = deps.getAgentList();
    if (!list || !dragSession || !dragPoint || dragScrollSpeed === 0) return;
    const previousScrollTop = list.scrollTop;
    list.scrollTop += dragScrollSpeed;
    if (list.scrollTop === previousScrollTop) {
      dragScrollSpeed = 0;
      return;
    }
    dragOrigin = null;
    applySidebarDropTarget(resolveSidebarDropTarget(dragPoint));
    scrollFades.measure();
    dragScrollFrame = requestAnimationFrame(runSidebarDragAutoScroll);
  }

  function updateSidebarDragAutoScroll(clientY: number): void {
    const bounds = dragGeometry.list;
    if (!bounds) return;
    const edgeSize = Math.min(40, bounds.height / 4);
    if (clientY < bounds.top + edgeSize) {
      dragScrollSpeed = -Math.min(12, Math.ceil(((bounds.top + edgeSize - clientY) / edgeSize) * 12));
    } else if (clientY > bounds.bottom - edgeSize) {
      dragScrollSpeed = Math.min(12, Math.ceil(((clientY - (bounds.bottom - edgeSize)) / edgeSize) * 12));
    } else dragScrollSpeed = 0;
    if (dragScrollSpeed !== 0 && dragScrollFrame === null) {
      dragScrollFrame = requestAnimationFrame(runSidebarDragAutoScroll);
    } else if (dragScrollSpeed === 0 && dragScrollFrame !== null) {
      cancelAnimationFrame(dragScrollFrame);
      dragScrollFrame = null;
    }
  }

  function updateSidebarNativeDrag(event: DragEvent): void {
    if (!dragSession) return;
    if (
      !dragState.emptyPinnedDropVisible() &&
      chatPinnedItems().length === 0 &&
      dragSession.source.kind === "chat" &&
      chatKind(dragSession.source.id) !== null
    ) {
      const activeSession = dragSession;
      dragOrigin = dragPoint;
      dragState.setEmptyPinnedDropVisible(true);
      queueMicrotask(() => {
        if (dragSession !== activeSession) return;
        measureSidebarDragTargets();
        if (dragPoint) scheduleSidebarDragTarget(dragPoint);
      });
    }
    const point = { clientX: event.clientX, clientY: event.clientY };
    if (!pointerIsAtDragOrigin(point)) dragOrigin = null;
    if (pointInRect(point, dragGeometry.list)) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    }
    dragPreview.move(event.clientX, event.clientY);
    scheduleSidebarDragTarget(point);
  }

  function dropSidebarNativeDrag(event: DragEvent): void {
    if (!dragSession) return;
    event.preventDefault();
    event.stopPropagation();
    const animatedPinnedTarget =
      dragState.emptyPinnedDropVisible() && dragTarget?.kind === "pinned" ? dragTarget : null;
    if (dragState.emptyPinnedDropVisible() && !animatedPinnedTarget) measureSidebarDragTargets();
    const target = animatedPinnedTarget ?? flushSidebarDragTarget({ clientX: event.clientX, clientY: event.clientY });
    commitSidebarDrop(dragSession.source, target);
    suppressSidebarClickUntil = Date.now() + 250;
    stopSidebarDragging();
  }

  function endChatDragging(event: DragEvent): void {
    const session = dragSession;
    const canCommitAnimatedPin =
      dragState.emptyPinnedDropVisible() &&
      session?.source.kind === "chat" &&
      dragTarget?.kind === "pinned" &&
      (event.clientX !== 0 || event.clientY !== 0) &&
      pointInRect({ clientX: event.clientX, clientY: event.clientY }, dragGeometry.list);
    if (session && canCommitAnimatedPin) {
      commitSidebarDrop(session.source, dragTarget);
      suppressSidebarClickUntil = Date.now() + 250;
    }
    stopSidebarDragging();
  }

  function handleListDragLeave(event: DragEvent): void {
    const point = { clientX: event.clientX, clientY: event.clientY };
    if (pointInRect(point, dragGeometry.list)) return;
    scheduleSidebarDragTarget(point);
  }

  return {
    dropSidebarNativeDrag,
    endChatDragging,
    handleListDragLeave,
    sidebarClickIsSuppressed,
    startChatDragging,
    startNativeItemDragging,
    startPersonDragging,
    startSectionDragging,
    stopSidebarDragging,
    updateSidebarNativeDrag,
  };
}
