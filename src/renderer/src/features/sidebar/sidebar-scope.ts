/**
 * Everything `Sidebar` is, minus the markup. The component builds this once and reads it, and the
 * regions read it through the scope context.
 *
 * The body here is composition: each store under `stores/` owns one concern and is built in
 * dependency order, because a store can only be handed what already exists. The drag&drop pipeline
 * is the one part that needs a closure of its own, and `createSidebarDragEngine` is it.
 */

import { createContext, createEffect, onCleanup, useContext } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import { createSidebarDragEngine } from "./createSidebarDragEngine";
import type { SidebarProps } from "./sidebar-types";
import { createSidebarAnnouncementStore } from "./stores/announcement-store";
import { createSidebarDataStore } from "./stores/data-store";
import { createSidebarDragStateStore } from "./stores/drag-state-store";
import { createSidebarLayoutActions } from "./stores/layout-actions";
import { createSidebarPendingStore } from "./stores/pending-store";
import { createSidebarSearchStore } from "./stores/search-store";

export function createSidebarScope(props: SidebarProps) {
  const layoutMutable = () => props.layoutMutable !== false;
  const scrollFades = createScrollFades();

  const { announce, announceError, reorderAnnouncement } = createSidebarAnnouncementStore();
  const { expandToSearch, normalizedQuery, query, setQuery, setSearchInputElement } = createSidebarSearchStore({
    props,
  });
  const {
    assignedSectionId,
    chatKind,
    chatName,
    chatPinnedItems,
    customSectionById,
    directThreadByMember,
    filteredAgents,
    filteredChats,
    filteredChatsBySection,
    filteredPeople,
    orderedPeople,
    personById,
    resolvedPinnedItems,
    sectionAcceptsChat,
    sectionIsCollapsed,
    sectionLabel,
    sectionPosition,
    visiblePinnedKeys,
    visibleSectionIds,
  } = createSidebarDataStore({ normalizedQuery, props });
  const {
    cancelSectionEditor,
    closeDelete,
    confirmDelete,
    confirmSectionDelete,
    deleteError,
    deleteTarget,
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

  const dragState = createSidebarDragStateStore({ chatKind, sectionAcceptsChat });
  const { assignChatSection, commitSidebarDrop, movePersonByKeyboard, movePinnedItem, moveSection } =
    createSidebarLayoutActions({
      announce,
      announceError,
      assignedSectionId,
      canPinDraggedSidebarItem: dragState.canPinDraggedSidebarItem,
      chatName,
      chatPinnedItems,
      draggedSidebarItem: dragState.draggedSidebarItem,
      filteredChatsBySection,
      filteredPeople,
      layoutMutable,
      orderedPeople,
      personById,
      props,
      sectionLabel,
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
    filteredPeople,
    getAgentList: () => agentList,
    props,
    scrollFades,
    sectionAcceptsChat,
    visiblePinnedKeys,
    visibleSectionIds,
  });

  onCleanup(() => {
    stopSidebarDragging();
    scrollFades.stop();
  });

  createEffect(
    () => [resolvedPinnedItems(), filteredChats(), filteredPeople()],
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
    deleting,
    chatPinnedItems,
    directThreadByMember,
    dragOffset: dragState.dragOffset,
    dragOverPinnedKey: dragState.dragOverPinnedKey,
    draggedChatId: dragState.draggedChatId,
    draggedPinnedKey: dragState.draggedPinnedKey,
    draggingKind: dragState.draggingKind,
    dropSidebarNativeDrag,
    emptyPinnedDropVisible: dragState.emptyPinnedDropVisible,
    endChatDragging,
    expandToSearch,
    filteredAgents,
    filteredChats,
    filteredChatsBySection,
    filteredPeople,
    handleListDragLeave,
    layoutMutable,
    movePersonByKeyboard,
    movePinnedItem,
    moveSection,
    normalizedQuery,
    openDelete,
    pending,
    pinnedDropActive: dragState.pinnedDropActive,
    props,
    query,
    releaseSectionNameInput,
    reorderAnnouncement,
    resolvedPinnedItems,
    saveSectionEditor,
    scrollFades,
    sectionDeleteTarget,
    sectionDragClasses: dragState.sectionDragClasses,
    sectionIsCollapsed,
    sectionPosition,
    setAgentListElement,
    setQuery,
    setSearchInputElement,
    setSectionNameInput,
    sidebarClickIsSuppressed,
    startChatDragging,
    startCreateSection,
    startNativeItemDragging,
    startPersonDragging,
    startRenameSection,
    startSectionDragging,
    stopSidebarDragging,
    updateSectionEditorName,
    updateSidebarNativeDrag,
    visibleSectionIds,
  };
}

export type SidebarScope = ReturnType<typeof createSidebarScope>;

export const SidebarScopeContext = createContext<SidebarScope>();

export function useSidebarScope(): SidebarScope {
  const scope = useContext(SidebarScopeContext);
  if (!scope) throw new Error("Sidebar scope is unavailable outside Sidebar.");
  return scope;
}
