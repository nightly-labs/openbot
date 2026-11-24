import { createMemo, createStore } from "solid-js";
import {
  type DragOffset,
  type SidebarDrag,
  type SidebarDragSource,
  type SidebarDropTarget,
  ZERO_DRAG_OFFSET,
} from "../sidebar-drag-model";
import type { SidebarPinnedItem } from "../sidebar-pins";

export interface SidebarDragWriters {
  beginDrag: (source: SidebarDragSource) => void;
  emptyPinnedDropVisible: () => boolean;
  resetDrag: () => void;
  setDragOffsets: (next: Record<string, DragOffset>) => void;
  setDragTarget: (target: SidebarDropTarget | null) => void;
  setEmptyPinnedDropVisible: (visible: boolean) => void;
}

export function createSidebarDragStateStore(deps: {
  chatKind: (chatId: string) => "agent" | "channel" | null;
  sectionAcceptsChat: (sectionId: string) => boolean;
}) {
  const { chatKind, sectionAcceptsChat } = deps;

  const [drag, setDrag] = createStore<SidebarDrag>({
    emptyPinnedDropVisible: false,
    offsets: {},
    source: null,
    target: null,
  });

  const draggedPinnedKey = createMemo(() => {
    const source = drag.source;
    return source?.kind === "pinned" ? source.key : null;
  });

  const draggedChatId = createMemo(() => {
    const source = drag.source;
    return source?.kind === "chat" ? source.id : null;
  });

  const draggedSectionId = createMemo(() => {
    const source = drag.source;
    return source?.kind === "section" ? source.id : null;
  });

  const draggingKind = createMemo(() => drag.source?.kind);

  const dragOverPinnedKey = createMemo(() => {
    const target = drag.target;
    return target?.kind === "pinned" ? target.key : null;
  });

  const chatDropSectionId = createMemo(() => {
    const target = drag.target;
    if (target?.kind === "chat") return target.target.sectionId;
    if (target?.kind === "section" && drag.source?.kind === "chat") return target.sectionId;
    return null;
  });

  const sectionDropTarget = createMemo(() => {
    const target = drag.target;
    return target?.kind === "section-order" ? target.target : null;
  });

  const sectionIntoId = createMemo(() => {
    const target = drag.target;
    return target?.kind === "section-into" ? target.sectionId : null;
  });

  function draggedSidebarItem(): SidebarPinnedItem | null {
    const chatId = draggedChatId();
    const kind = chatId ? chatKind(chatId) : null;
    return chatId && kind ? { kind, id: chatId } : null;
  }

  function canPinDraggedSidebarItem(): boolean {
    return draggedSidebarItem() !== null;
  }

  const pinnedDropActive = createMemo(() => {
    const source = drag.source;
    const pinningFromSidebar = Boolean(source && "origin" in source && source.origin !== "pinned");
    return drag.target?.kind === "pinned" && pinningFromSidebar && canPinDraggedSidebarItem();
  });

  function dragOffset(id: string): DragOffset {
    return drag.offsets[id] ?? ZERO_DRAG_OFFSET;
  }

  function sectionDragClasses(sectionId: string) {
    const target = sectionDropTarget();
    return {
      "sidebar-section-agent-drop-target":
        (chatDropSectionId() === sectionId && sectionAcceptsChat(sectionId)) || sectionIntoId() === sectionId,
      "sidebar-section-dragging": draggedSectionId() === sectionId,
      "sidebar-drag-shifting": dragOffset(sectionId).y !== 0,
      "sidebar-section-drop-before":
        draggedSectionId() !== null && target?.sectionId === sectionId && target.placement === "before",
      "sidebar-section-drop-after":
        draggedSectionId() !== null && target?.sectionId === sectionId && target.placement === "after",
    };
  }

  const emptyPinnedDropVisible = () => drag.emptyPinnedDropVisible;

  function beginDrag(source: SidebarDragSource): void {
    setDrag((state) => {
      state.offsets = {};
      state.source = source;
      state.target = null;
    });
  }

  function resetDrag(): void {
    setDrag((state) => {
      state.emptyPinnedDropVisible = false;
      state.offsets = {};
      state.source = null;
      state.target = null;
    });
  }

  function setDragTarget(target: SidebarDropTarget | null): void {
    setDrag((state) => {
      state.target = target;
    });
  }

  function setDragOffsets(next: Record<string, DragOffset>): void {
    setDrag((state) => {
      for (const id of Object.keys(state.offsets)) {
        if (!next[id]) delete state.offsets[id];
      }
      for (const [id, offset] of Object.entries(next)) {
        const current = state.offsets[id];
        if (current?.x !== offset.x || current.y !== offset.y) state.offsets[id] = offset;
      }
    });
  }

  function setEmptyPinnedDropVisible(visible: boolean): void {
    setDrag((state) => {
      state.emptyPinnedDropVisible = visible;
    });
  }

  return {
    beginDrag,
    canPinDraggedSidebarItem,
    dragOffset,
    dragOverPinnedKey,
    draggedChatId,
    draggedPinnedKey,
    draggedSidebarItem,
    draggingKind,
    emptyPinnedDropVisible,
    pinnedDropActive,
    resetDrag,
    sectionDragClasses,
    setDragOffsets,
    setDragTarget,
    setEmptyPinnedDropVisible,
  };
}
