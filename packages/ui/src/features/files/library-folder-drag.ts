import { type LibraryFolder, libraryFolderBranch } from "@openbot/contracts/ipc";
import { createEffect, createMemo, createStore } from "solid-js";
import { agentKey, canHoldFolder, childFolders } from "./library-folders-view";

const LANDED_MS = 900;
const DRAG_START_PX = 6;
const DRAG_OPEN_MS = 700;
const LINE_ZONE = 0.28;
const DRAGGING_CLASS = "library-dragging";
const FILE_SOURCE = ".library-folder-tile-main, .library-picture, .library-file-card, .file-row-main";
const FOLDER_SOURCE = ".library-row-main, .library-folder-card-main";
const SCROLL_EDGE_PX = 48;
const SCROLL_STEP_PX = 14;

export type LibraryDragItem =
  | { kind: "files"; agentId: string | null; anyAgent: boolean; ids: string[]; label: string }
  | { kind: "folder"; agentId: string; folderId: string; label: string };

export type LibraryDropTarget =
  | { kind: "into"; agentId: string; folderId: string | null; goes: boolean }
  | { kind: "new"; agentId: string; parentId: string | undefined }
  | { kind: "out"; agentId: string }
  | {
      kind: "line";
      agentId: string;
      parentId: string | undefined;
      beforeId: string | null;
      rowId: string;
      edge: "before" | "after";
    };

export type LibraryDropMark = "into" | "before" | "after";

type LibraryDropBlock = "agent" | "mixed";

interface LibraryFolderDragOptions {
  enabled: () => boolean;
  folders: () => readonly LibraryFolder[];
  organizes: (agentId: string) => boolean;
  folderIdOfFile: (fileId: string) => string | undefined;
  isCollapsed: (key: string) => boolean;
  fileItem: (fileId: string) => LibraryDragItem | null;
  onDrop: (item: LibraryDragItem, target: LibraryDropTarget) => void;
  onOpen: (key: string) => void;
  onGo: (agentId: string, folderId: string | null) => void;
}

interface DragState {
  item: LibraryDragItem | null;
  target: LibraryDropTarget | null;
  blocked: LibraryDropBlock | null;
  spring: string | null;
  landed: string | null;
  x: number;
  y: number;
}

interface DragProbe {
  target: LibraryDropTarget | null;
  blocked: LibraryDropBlock | null;
  spring: string | null;
}

const NO_PROBE: DragProbe = { target: null, blocked: null, spring: null };

function landedKey(agentId: string | null, folderId: string | null): string {
  return agentId === null ? "out" : `${agentId}\n${folderId ?? ""}`;
}

function dropKey(target: LibraryDropTarget | null): string {
  if (!target) return "";
  if (target.kind === "into") return `into ${target.agentId} ${target.folderId ?? ""} ${target.goes}`;
  if (target.kind === "new") return `new ${target.agentId} ${target.parentId ?? ""}`;
  if (target.kind === "out") return `out ${target.agentId}`;
  return `line ${target.rowId} ${target.edge}`;
}

function probeKey(probe: DragProbe): string {
  return `${dropKey(probe.target)}|${probe.blocked ?? ""}|${probe.spring ?? ""}`;
}

function swallowNextClick(): void {
  const stop = (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener("click", stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", stop, true), 0);
}

export function createLibraryFolderDrag(options: LibraryFolderDragOptions) {
  const [state, setState] = createStore<DragState>({
    item: null,
    target: null,
    blocked: null,
    spring: null,
    landed: null,
    x: 0,
    y: 0,
  });
  let press: { item: LibraryDragItem; x: number; y: number } | null = null;
  let dragging: LibraryDragItem | null = null;
  let opened: { agentId: string; folderId: string | null } | null = null;
  let probed: DragProbe = NO_PROBE;
  let pressOnItem = false;
  let scrollFrame = 0;
  let landedTimer: ReturnType<typeof setTimeout> | undefined;

  const folderById = (id: string | null | undefined) =>
    id ? options.folders().find((folder) => folder.id === id) : undefined;

  function dragItemAt(target: Element): LibraryDragItem | null {
    const fileId = target.closest(FILE_SOURCE)?.closest("[data-file-id]")?.getAttribute("data-file-id");
    if (fileId) return options.fileItem(fileId);
    const folder = folderById(
      target.closest(FOLDER_SOURCE)?.closest("[data-library-folder]")?.getAttribute("data-library-folder"),
    );
    if (!folder || !options.organizes(folder.agentId)) return null;
    return { kind: "folder", agentId: folder.agentId, folderId: folder.id, label: folder.name };
  }

  function probeAt(item: LibraryDragItem, x: number, y: number): DragProbe {
    const under = document.elementFromPoint(x, y);
    const spring = under?.closest("[data-library-spring]")?.getAttribute("data-library-spring") ?? null;
    if (under?.closest("[data-library-out]")) {
      if (item.kind !== "files") return NO_PROBE;
      if (item.agentId === null) return { target: null, blocked: item.anyAgent ? null : "mixed", spring: null };
      const inFolder = item.ids.some((id) => options.folderIdOfFile(id) !== undefined);
      return { target: inFolder ? { kind: "out", agentId: item.agentId } : null, blocked: null, spring: null };
    }
    const row = under?.closest("[data-library-agent]");
    const agentId = row?.getAttribute("data-library-agent");
    if (!row || !agentId) {
      if (opened && under?.closest("[data-library-here]"))
        return { target: openedTarget(item, opened), blocked: null, spring: null };
      return { target: null, blocked: null, spring: spring && options.isCollapsed(spring) ? spring : null };
    }
    const anyAgent = item.kind === "files" && item.anyAgent;
    if (anyAgent && !options.organizes(agentId)) return { target: null, blocked: null, spring: null };
    if (!anyAgent && agentId !== item.agentId)
      return { target: null, blocked: item.agentId === null ? "mixed" : "agent", spring: null };
    return { target: dropTargetIn(item, row, agentId, y), blocked: null, spring: null };
  }

  function openedTarget(
    item: LibraryDragItem,
    place: { agentId: string; folderId: string | null },
  ): LibraryDropTarget | null {
    const into: LibraryDropTarget = { kind: "into", agentId: place.agentId, folderId: place.folderId, goes: false };
    if (item.kind === "files") {
      const moves = item.ids.some((id) => options.folderIdOfFile(id) !== (place.folderId ?? undefined));
      return moves ? into : null;
    }
    const moved = folderById(item.folderId);
    if (!moved || (moved.parentId ?? null) === place.folderId) return null;
    if (place.folderId === null) return into;
    const folders = options.folders();
    if (libraryFolderBranch(folders, moved.id).has(place.folderId)) return null;
    return canHoldFolder(folders, place.folderId, moved.id) ? into : null;
  }

  function dropTargetIn(item: LibraryDragItem, row: Element, agentId: string, y: number): LibraryDropTarget | null {
    const newParent = row.getAttribute("data-library-new");
    if (newParent !== null) {
      return item.kind === "files" ? { kind: "new", agentId, parentId: newParent || undefined } : null;
    }
    const folders = options.folders();
    const folder = folderById(row.getAttribute("data-library-folder"));
    const only = row.getAttribute("data-library-drop");
    const goes = only === "go";
    if (item.kind === "files") {
      const moves = item.ids.some((id) => options.folderIdOfFile(id) !== folder?.id);
      return moves ? { kind: "into", agentId, folderId: folder?.id ?? null, goes } : null;
    }
    const moved = folderById(item.folderId);
    if (!moved) return null;
    if (!folder) return moved.parentId === undefined ? null : { kind: "into", agentId, folderId: null, goes };
    if (libraryFolderBranch(folders, moved.id).has(folder.id)) return null;
    if (only !== null) {
      if (folder.id === moved.parentId || !canHoldFolder(folders, folder.id, moved.id)) return null;
      return { kind: "into", agentId, folderId: folder.id, goes };
    }
    const box = row.getBoundingClientRect();
    const part = (y - box.top) / box.height;
    const siblings = childFolders(folders, agentId, folder.parentId);
    const at = siblings.findIndex((candidate) => candidate.id === folder.id);
    const fitsBeside = canHoldFolder(folders, folder.parentId, moved.id);
    if (part < LINE_ZONE && fitsBeside) {
      if (siblings[at - 1]?.id === moved.id) return null;
      return {
        kind: "line",
        agentId,
        parentId: folder.parentId,
        beforeId: folder.id,
        rowId: folder.id,
        edge: "before",
      };
    }
    const open =
      !options.isCollapsed(folder.id) &&
      childFolders(folders, agentId, folder.id).some((child) => child.id !== moved.id);
    if (part > 1 - LINE_ZONE && !open && fitsBeside) {
      if (siblings[at + 1]?.id === moved.id) return null;
      const after = siblings.slice(at + 1).find((candidate) => candidate.id !== moved.id);
      return {
        kind: "line",
        agentId,
        parentId: folder.parentId,
        beforeId: after?.id ?? null,
        rowId: folder.id,
        edge: "after",
      };
    }
    if (folder.id === moved.parentId || !canHoldFolder(folders, folder.id, moved.id)) return null;
    return { kind: "into", agentId, folderId: folder.id, goes: false };
  }

  function showProbe(next: DragProbe): boolean {
    if (probeKey(next) === probeKey(probed)) return false;
    probed = next;
    return true;
  }

  function retarget(): void {
    if (!dragging || !showProbe(probeAt(dragging, state.x, state.y))) return;
    setState((draft) => {
      draft.target = probed.target;
      draft.blocked = probed.blocked;
      draft.spring = probed.spring;
    });
  }

  function scrollStep(): void {
    scrollFrame = 0;
    if (!dragging) return;
    const list = document.elementFromPoint(state.x, state.y)?.closest<HTMLElement>("[data-library-autoscroll]");
    if (list) {
      const box = list.getBoundingClientRect();
      const top = state.y - box.top;
      const bottom = box.bottom - state.y;
      const depth = top < SCROLL_EDGE_PX ? top - SCROLL_EDGE_PX : bottom < SCROLL_EDGE_PX ? SCROLL_EDGE_PX - bottom : 0;
      const step = Math.round((depth / SCROLL_EDGE_PX) * SCROLL_STEP_PX);
      if (step !== 0) {
        const before = list.scrollTop;
        list.scrollTop = before + step;
        if (list.scrollTop !== before) retarget();
      }
    }
    scrollFrame = requestAnimationFrame(scrollStep);
  }

  function endDrag(): void {
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
    window.removeEventListener("pointercancel", endDrag);
    window.removeEventListener("blur", endDrag);
    window.removeEventListener("keydown", onDragKey, true);
    document.documentElement.classList.remove(DRAGGING_CLASS);
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    const shown = dragging !== null;
    press = null;
    dragging = null;
    opened = null;
    probed = NO_PROBE;
    if (!shown) return;
    setState((draft) => {
      draft.item = null;
      draft.target = null;
      draft.blocked = null;
      draft.spring = null;
    });
  }

  function onPress(event: PointerEvent): void {
    pressOnItem = false;
    if (press || event.button !== 0 || event.pointerType === "touch" || !options.enabled()) return;
    if (!(event.target instanceof Element)) return;
    const item = dragItemAt(event.target);
    if (!item) return;
    pressOnItem = true;
    press = { item, x: event.clientX, y: event.clientY };
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragEnd);
    window.addEventListener("pointercancel", endDrag);
    window.addEventListener("blur", endDrag);
  }

  function onDragMove(event: PointerEvent): void {
    if (!press) return;
    const item = press.item;
    const starts = dragging === null;
    if (starts) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_START_PX) return;
      dragging = item;
      document.documentElement.classList.add(DRAGGING_CLASS);
      window.addEventListener("keydown", onDragKey, true);
      scrollFrame = requestAnimationFrame(scrollStep);
    }
    const moved = showProbe(probeAt(item, event.clientX, event.clientY));
    setState((draft) => {
      if (starts) draft.item = item;
      if (moved) {
        draft.target = probed.target;
        draft.blocked = probed.blocked;
        draft.spring = probed.spring;
      }
      draft.x = event.clientX;
      draft.y = event.clientY;
    });
  }

  function land(item: LibraryDragItem, target: LibraryDropTarget): void {
    let key: string | null = null;
    if (target.kind === "into") key = landedKey(target.agentId, target.folderId);
    else if (target.kind === "out") key = landedKey(null, null);
    else if (target.kind === "line" && item.kind === "folder") key = landedKey(item.agentId, item.folderId);
    if (key === null) return;
    clearTimeout(landedTimer);
    setState((draft) => {
      draft.landed = key;
    });
    landedTimer = setTimeout(() => {
      setState((draft) => {
        draft.landed = null;
      });
    }, LANDED_MS);
  }

  function onDragEnd(): void {
    const item = dragging;
    const target = probed.target;
    endDrag();
    if (!item) return;
    swallowNextClick();
    if (!target) return;
    options.onDrop(item, target);
    land(item, target);
  }

  function onDragKey(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    endDrag();
    window.addEventListener("pointerup", swallowNextClick, { once: true });
  }

  createEffect(
    () => {
      const target = state.target;
      if (target?.kind !== "into") return null;
      if (target.goes) return { go: true, agentId: target.agentId, folderId: target.folderId, key: "" };
      const key = target.folderId ?? agentKey(target.agentId);
      return options.isCollapsed(key) ? { go: false, agentId: target.agentId, folderId: target.folderId, key } : null;
    },
    (wait) => {
      if (wait === null) return;
      const timer = setTimeout(() => {
        if (!wait.go) {
          options.onOpen(wait.key);
          return;
        }
        opened = { agentId: wait.agentId, folderId: wait.folderId };
        options.onGo(wait.agentId, wait.folderId);
        requestAnimationFrame(retarget);
      }, DRAG_OPEN_MS);
      return () => clearTimeout(timer);
    },
  );

  createEffect(
    () => state.spring,
    (key) => {
      if (key === null) return;
      const timer = setTimeout(() => options.onOpen(key), DRAG_OPEN_MS);
      return () => clearTimeout(timer);
    },
  );

  const draggedBranch = createMemo((): ReadonlySet<string> => {
    const item = state.item;
    return item?.kind === "folder" ? libraryFolderBranch(options.folders(), item.folderId) : new Set();
  });

  return {
    state,
    attach(root: HTMLElement): () => void {
      root.addEventListener("pointerdown", onPress, true);
      return () => {
        root.removeEventListener("pointerdown", onPress, true);
        clearTimeout(landedTimer);
        endDrag();
      };
    },
    pressOnItem: () => pressOnItem,
    dropMark(agentId: string, folderId: string | null): LibraryDropMark | undefined {
      const target = state.target;
      if (!target || target.kind === "new" || target.kind === "out") return undefined;
      if (target.kind === "line") return target.rowId === folderId ? target.edge : undefined;
      return target.agentId === agentId && target.folderId === folderId ? "into" : undefined;
    },
    newMark(agentId: string, parentId: string | undefined): "into" | undefined {
      const target = state.target;
      return target?.kind === "new" && target.agentId === agentId && target.parentId === parentId ? "into" : undefined;
    },
    outMark: (): "into" | undefined => (state.target?.kind === "out" ? "into" : undefined),
    outOff: (): "" | undefined => {
      const item = state.item;
      if (!item) return undefined;
      if (item.kind !== "files" || item.agentId === null) return "";
      return item.ids.some((id) => options.folderIdOfFile(id) !== undefined) ? undefined : "";
    },
    dropOff(agentId: string | undefined, folderId?: string): "" | undefined {
      const item = state.item;
      if (!item) return undefined;
      if (agentId === undefined || agentId !== item.agentId) return "";
      return folderId !== undefined && draggedBranch().has(folderId) ? "" : undefined;
    },
    landed: (agentId: string, folderId: string | null): "" | undefined =>
      state.landed === landedKey(agentId, folderId) ? "" : undefined,
    landedOut: (): "" | undefined => (state.landed === landedKey(null, null) ? "" : undefined),
    draggedFolder: (folderId: string) =>
      state.item?.kind === "folder" && state.item.folderId === folderId ? "" : undefined,
    draggedFile: (fileId: string) => (state.item?.kind === "files" && state.item.ids.includes(fileId) ? "" : undefined),
  };
}
