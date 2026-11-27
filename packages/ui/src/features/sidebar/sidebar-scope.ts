import { createContext, createEffect, createSignal, onCleanup, useContext } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import { createSidebarDragEngine } from "./createSidebarDragEngine";
import { SIDEBAR_NO_LIST_FILTER } from "./sidebar-list-filter";
import { type SidebarProps, sidebarChatOrderSortsSections } from "./sidebar-types";
import { createSidebarAnnouncementStore } from "./stores/announcement-store";
import { createSidebarDataStore } from "./stores/data-store";
import { createSidebarDragStateStore } from "./stores/drag-state-store";
import { createSidebarLayoutActions } from "./stores/layout-actions";
import { createSidebarPendingStore } from "./stores/pending-store";
import { createSidebarTabStore } from "./stores/tab-store";

export function createSidebarScope(props: SidebarProps) {
  const layoutMutable = () => props.layoutMutable !== false;
  const scrollFades = createScrollFades({ stuck: ".sidebar-folder > header" });

  const { announce, announceError, reorderAnnouncement } = createSidebarAnnouncementStore();
  let dragActive = () => false;
  const [pointerInList, setPointerInList] = createSignal(false);
  const [threadsOpenIds, setThreadsOpenIds] = createSignal<ReadonlySet<string>>(new Set());
  const agentThreadsOpen = (agentId: string) => threadsOpenIds().has(agentId);
  const toggleAgentThreads = (agentId: string) =>
    setThreadsOpenIds((current) => {
      const next = new Set(current);
      if (!next.delete(agentId)) next.add(agentId);
      return next;
    });
  const {
    assignedSectionId,
    chatIsUnread,
    chatKind,
    chatName,
    chatPinnedItems,
    customSectionById,
    directThreadByMember,
    filterFolders,
    filteredAgents,
    filteredChats,
    filteredChatsBySection,
    listFilter,
    listFilterCount,
    listFiltered,
    orderedPeople,
    personById,
    resolvedPinnedItems,
    sectionAcceptsChat,
    sectionCanNest,
    sectionChatCount,
    sectionChildren,
    sectionIsCollapsed,
    sectionIsInside,
    sectionLabel,
    sectionParent,
    sectionPosition,
    sectionUnreadCount,
    setListFilter,
    shownPeople,
    unreadChats,
    userHiddenAgentList,
    userHiddenSince,
    visiblePinnedKeys,
    visibleSectionIds,
    waitingChats,
  } = createSidebarDataStore({ props, dragActive: () => dragActive(), pointerInList });
  const sidebarTabs = createSidebarTabStore({
    props,
    filterFolders,
    listFilter,
    listFilterCount,
    setListFilter,
  });
  const layoutDraggable = () => layoutMutable() && !listFiltered();
  const chatsDraggable = () => layoutDraggable() && !sidebarChatOrderSortsSections(props.chatOrder);
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
    startCreateSection: startCreateSectionEditor,
    startRenameSection,
    updateSectionEditorName,
  } = createSidebarPendingStore({ customSectionById, props });
  const startCreateSection = (agentId?: string, parentId?: string) => {
    setListFilter(SIDEBAR_NO_LIST_FILTER);
    startCreateSectionEditor(agentId, parentId);
  };
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

  const trackListPointer = (event: PointerEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target === null) {
      setPointerInList(false);
      return;
    }
    if (agentList?.contains(target) === true) setPointerInList(true);
    else if (target.closest("[data-popper-positioner], .agent-context-menu") === null) setPointerInList(false);
  };
  const releaseListPointer = (event: PointerEvent) => {
    if (event.pointerType !== "touch" && event.relatedTarget === null) setPointerInList(false);
  };
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

  const setAgentListElement = (element: HTMLElement) => {
    agentList = element;
    scrollFades.bind(element);
  };

  return {
    agentThreadsOpen,
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
    filterFolders,
    filteredAgents,
    filteredChats,
    filteredChatsBySection,
    foldersSupported,
    handleListDragLeave,
    layoutDraggable,
    layoutMutable,
    listFilter,
    listFilterCount,
    listFiltered,
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
    sectionChatCount,
    sectionChildren,
    sectionDragClasses: dragState.sectionDragClasses,
    sectionIsCollapsed,
    sectionLabel,
    sectionParent,
    sectionPosition,
    sectionSiblingIndex,
    sectionUnreadCount,
    setAgentListElement,
    setListFilter,
    setSectionNameInput,
    shownPeople,
    sidebarClickIsSuppressed,
    sidebarTabs,
    startChatDragging,
    startCreateSection,
    startNativeItemDragging,
    startPersonDragging,
    startRenameSection,
    startSectionDragging,
    stopSidebarDragging,
    toggleAgentThreads,
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
