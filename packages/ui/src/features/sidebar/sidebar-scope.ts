/**
 * Everything `Sidebar` is, minus the markup. The component builds this once and reads it, and the
 * regions read it through the scope context.
 *
 * The body here is composition: each store under `stores/` owns one concern and is built in
 * dependency order, because a store can only be handed what already exists. The drag&drop pipeline
 * is the one part that needs a closure of its own, and `createSidebarDragEngine` is it.
 */

import { createContext, createEffect, createSignal, onCleanup, useContext } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import { createSidebarDragEngine } from "./createSidebarDragEngine";
import type { SidebarProps } from "./sidebar-types";
import { createSidebarAnnouncementStore } from "./stores/announcement-store";
import { createSidebarDataStore } from "./stores/data-store";
import { createSidebarDragStateStore } from "./stores/drag-state-store";
import { createSidebarLayoutActions } from "./stores/layout-actions";
import { createSidebarPendingStore } from "./stores/pending-store";

export function createSidebarScope(props: SidebarProps) {
  const layoutMutable = () => props.layoutMutable !== false;
  /** A chat drags only in the manual orders. "Unread first" sorts each section itself. */
  const chatsDraggable = () => layoutMutable() && props.chatOrder !== "unread-first";
  const scrollFades = createScrollFades({ stuck: ".sidebar-folder > header" });

  const { announce, announceError, reorderAnnouncement } = createSidebarAnnouncementStore();
  // The drag state is built from the data store, so the data store reads it through this reference,
  // which is set once the drag state exists.
  let dragActive = () => false;
  /**
   * True while a mouse or pen is over the list, or over a menu that is open on it. The read open chat
   * keeps its place in an unread order only then. A touch is false: a finger leaves nothing under it
   * after a tap.
   */
  const [pointerInList, setPointerInList] = createSignal(false);
  const {
    assignedSectionId,
    chatIsUnread,
    chatKind,
    chatName,
    chatPinnedItems,
    customSectionById,
    directThreadByMember,
    filteredAgents,
    filteredChats,
    filteredChatsBySection,
    orderedPeople,
    personById,
    resolvedPinnedItems,
    sectionAcceptsChat,
    sectionCanNest,
    sectionChildren,
    sectionIsCollapsed,
    sectionIsInside,
    sectionLabel,
    sectionParent,
    sectionPosition,
    sectionUnreadCount,
    unreadChats,
    userHiddenAgentList,
    userHiddenSince,
    visiblePinnedKeys,
    visibleSectionIds,
    waitingChats,
  } = createSidebarDataStore({ props, dragActive: () => dragActive(), pointerInList });
  const {
    cancelSectionEditor,
    closeDelete,
    confirmDelete,
    confirmSectionDelete,
    deleteError,
    deleteTarget,
    channelDeleteTarget,
    deleting,
    openDelete,
    pending,
    releaseSectionNameInput,
    saveSectionEditor,
    sectionDeleteTarget,
    setSectionNameInput,
    startCreateSection,
    startRenameSection,
    updateSectionEditorName,
  } = createSidebarPendingStore({ customSectionById, props });
  let agentList: HTMLElement | undefined;
  const foldersSupported = () => props.foldersSupported === true && layoutMutable();
  const dragFolders = () =>
    foldersSupported() ? { canNest: sectionCanNest, isInside: sectionIsInside, parent: sectionParent } : null;

  const dragState = createSidebarDragStateStore({ chatKind, sectionAcceptsChat });
  dragActive = () => dragState.draggingKind() !== undefined;
  const {
    assignChatSection,
    commitSidebarDrop,
    duplicateSection,
    moveFolderTo,
    movePersonByKeyboard,
    movePinnedItem,
    moveSection,
    sectionSiblingIndex,
  } = createSidebarLayoutActions({
    announce,
    announceError,
    assignedSectionId,
    canPinDraggedSidebarItem: dragState.canPinDraggedSidebarItem,
    chatName,
    chatPinnedItems,
    draggedSidebarItem: dragState.draggedSidebarItem,
    filteredChatsBySection,
    foldersSupported,
    layoutMutable,
    orderedPeople,
    personById,
    props,
    sectionCanNest,
    sectionChildren,
    sectionLabel,
    sectionParent,
    visiblePinnedKeys,
    visibleSectionIds,
  });
  const {
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
  } = createSidebarDragEngine({
    assignedSectionId,
    canPinDraggedItem: dragState.canPinDraggedSidebarItem,
    chatKind,
    chatPinnedItems,
    commitSidebarDrop,
    dragState,
    filteredChatsBySection,
    getAgentList: () => agentList,
    orderedPeople,
    props,
    scrollFades,
    sectionAcceptsChat,
    folders: dragFolders,
    sectionIsCollapsed,
    visiblePinnedKeys,
    visibleSectionIds,
  });

  // `pointerover` also fires when a menu closes and the pointer moves on, which a `pointerleave` on
  // the list does not report. An overlay (a menu, a tooltip, a popover) keeps the current state: one
  // opened from the list holds the row, and one opened elsewhere does not start a hold.
  const trackListPointer = (event: PointerEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (event.pointerType === "touch" || target === null) {
      setPointerInList(false);
      return;
    }
    if (agentList?.contains(target) === true) setPointerInList(true);
    else if (target.closest("[data-popper-positioner], .agent-context-menu") === null) setPointerInList(false);
  };
  // The pointer left the window.
  const releaseListPointer = (event: PointerEvent) => {
    if (event.relatedTarget === null) setPointerInList(false);
  };
  // Another app or a keyboard shortcut took the focus while the pointer did not move.
  const releaseOnBlur = () => setPointerInList(false);
  document.addEventListener("pointerover", trackListPointer);
  document.addEventListener("pointerout", releaseListPointer);
  window.addEventListener("blur", releaseOnBlur);

  onCleanup(() => {
    document.removeEventListener("pointerover", trackListPointer);
    document.removeEventListener("pointerout", releaseListPointer);
    window.removeEventListener("blur", releaseOnBlur);
    stopSidebarDragging();
    scrollFades.stop();
  });

  createEffect(
    () => [
      resolvedPinnedItems(),
      waitingChats(),
      unreadChats(),
      filteredChats(),
      orderedPeople(),
      userHiddenAgentList(),
    ],
    () => {
      scrollFades.remeasure();
    },
  );

  /** The two statements the list's `ref` used to run inline, in the same order. */
  const setAgentListElement = (element: HTMLElement) => {
    agentList = element;
    scrollFades.bind(element);
  };

  /**
   * The scope's public surface, and the whole of what a region component may reach for. The drag
   * store's writers are deliberately absent: only the engine may move a drag along.
   */
  return {
    assignChatSection,
    cancelSectionEditor,
    closeDelete,
    confirmDelete,
    confirmSectionDelete,
    customSectionById,
    deleteError,
    deleteTarget,
    channelDeleteTarget,
    deleting,
    chatIsUnread,
    chatPinnedItems,
    chatsDraggable,
    directThreadByMember,
    dragOffset: dragState.dragOffset,
    dragOverPinnedKey: dragState.dragOverPinnedKey,
    draggedChatId: dragState.draggedChatId,
    draggedPinnedKey: dragState.draggedPinnedKey,
    draggingKind: dragState.draggingKind,
    dropSidebarNativeDrag,
    duplicateSection,
    emptyPinnedDropVisible: dragState.emptyPinnedDropVisible,
    endChatDragging,
    filteredAgents,
    filteredChats,
    filteredChatsBySection,
    foldersSupported,
    handleListDragLeave,
    layoutMutable,
    movePersonByKeyboard,
    movePinnedItem,
    moveFolderTo,
    moveSection,
    openDelete,
    orderedPeople,
    pending,
    pinnedDropActive: dragState.pinnedDropActive,
    props,
    releaseSectionNameInput,
    reorderAnnouncement,
    resolvedPinnedItems,
    saveSectionEditor,
    scrollFades,
    sectionDeleteTarget,
    sectionCanNest,
    sectionChildren,
    sectionDragClasses: dragState.sectionDragClasses,
    sectionIsCollapsed,
    sectionLabel,
    sectionParent,
    sectionPosition,
    sectionSiblingIndex,
    sectionUnreadCount,
    setAgentListElement,
    setSectionNameInput,
    sidebarClickIsSuppressed,
    startChatDragging,
    startCreateSection,
    startNativeItemDragging,
    startPersonDragging,
    startRenameSection,
    startSectionDragging,
    stopSidebarDragging,
    unreadChats,
    updateSectionEditorName,
    updateSidebarNativeDrag,
    userHiddenAgentList,
    userHiddenSince,
    visibleSectionIds,
    waitingChats,
  };
}

export type SidebarScope = ReturnType<typeof createSidebarScope>;

export const SidebarScopeContext = createContext<SidebarScope>();

export function useSidebarScope(): SidebarScope {
  const scope = useContext(SidebarScopeContext);
  if (!scope) throw new Error("Sidebar scope is unavailable outside Sidebar.");
  return scope;
}
