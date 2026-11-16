import { type LibraryFolder, libraryFolderBranch } from "@openbot/contracts/ipc";
import { createEffect, createStore } from "solid-js";
import { agentKey, canHoldFolder, childFolders } from "./library-folders-view";

/** How far the pointer moves before a press becomes a drag. A shorter move stays a click. */
const DRAG_START_PX = 6;
/** How long a drag stays on a collapsed row before the row shows its folders. */
const DRAG_OPEN_MS = 600;
/** The part of a folder row, at its top and at its bottom, that puts a dragged folder before or after it. */
const LINE_ZONE = 0.28;
/** The class on `<html>` while a drag is on. */
const DRAGGING_CLASS = "library-dragging";
const FILE_SOURCE = ".library-folder-tile-main, .library-picture, .library-file-card, .file-row-main";
const FOLDER_SOURCE = ".library-row-main";

/** What the pointer drags. Files of more than one agent have no agent, so no row takes them. */
export type LibraryDragItem =
  | { kind: "files"; agentId: string | null; ids: string[]; label: string }
  | { kind: "folder"; agentId: string; folderId: string; label: string };

/** Where a drop goes: into a folder (or to the top level of the agent), or on a line between two folders. */
export type LibraryDropTarget =
  | { kind: "into"; agentId: string; folderId: string | null }
  | {
      kind: "line";
      agentId: string;
      parentId: string | undefined;
      beforeId: string | null;
      rowId: string;
      edge: "before" | "after";
    };

export type LibraryDropMark = "into" | "before" | "after";

interface LibraryFolderDragOptions {
  /** A press can start a drag now. */
  enabled: () => boolean;
  folders: () => readonly LibraryFolder[];
  /** The viewer can change the folders of the agent. A folder of another agent does not move. */
  organizes: (agentId: string) => boolean;
  /** The id of the folder that shows a file, if it is in one. */
  folderIdOfFile: (fileId: string) => string | undefined;
  /** The folder list under an agent (`agentKey`) or a folder (its id) does not show. */
  isCollapsed: (key: string) => boolean;
  /** The files that a press on this file drags: the file, or the selection that it is part of. */
  fileItem: (fileId: string) => LibraryDragItem | null;
  onDrop: (item: LibraryDragItem, target: LibraryDropTarget) => void;
  /** A drag stayed on a collapsed row. */
  onOpen: (key: string) => void;
}

interface DragState {
  item: LibraryDragItem | null;
  target: LibraryDropTarget | null;
  x: number;
  y: number;
}

function dropKey(target: LibraryDropTarget | null): string {
  if (!target) return "";
  if (target.kind === "into") return `into ${target.agentId} ${target.folderId ?? ""}`;
  return `line ${target.rowId} ${target.edge}`;
}

/** The pointer goes up on the element that it went down on, so the browser sends a click. A drag is not a click. */
function swallowNextClick(): void {
  const stop = (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener("click", stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", stop, true), 0);
}

/**
 * Drags files to a folder or an agent row, and drags a folder to a new position or into a folder of
 * the same agent. A file tile or a list row is a file source; a folder row is a folder source and a
 * target. Rows carry `data-library-agent` and, for a folder, `data-library-folder`. Touch scrolls,
 * so only a mouse or a pen drags. Escape stops the drag.
 */
export function createLibraryFolderDrag(options: LibraryFolderDragOptions) {
  const [state, setState] = createStore<DragState>({ item: null, target: null, x: 0, y: 0 });
  let press: { item: LibraryDragItem; x: number; y: number } | null = null;
  let dragging: LibraryDragItem | null = null;
  let dropAt: LibraryDropTarget | null = null;
  let pressOnItem = false;

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

  function dropTargetAt(item: LibraryDragItem, x: number, y: number): LibraryDropTarget | null {
    const row = document.elementFromPoint(x, y)?.closest("[data-library-agent]");
    const agentId = row?.getAttribute("data-library-agent");
    if (!row || !agentId || agentId !== item.agentId) return null;
    const folders = options.folders();
    const folder = folderById(row.getAttribute("data-library-folder"));
    if (item.kind === "files") {
      const moves = item.ids.some((id) => options.folderIdOfFile(id) !== folder?.id);
      return moves ? { kind: "into", agentId, folderId: folder?.id ?? null } : null;
    }
    const moved = folderById(item.folderId);
    if (!moved) return null;
    // The agent row: the folder goes to the top level.
    if (!folder) return moved.parentId === undefined ? null : { kind: "into", agentId, folderId: null };
    if (libraryFolderBranch(folders, moved.id).has(folder.id)) return null;
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
    // Below an open folder come its own folders, so a line there would not show where the folder goes.
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
    return { kind: "into", agentId, folderId: folder.id };
  }

  function endDrag(): void {
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
    window.removeEventListener("pointercancel", endDrag);
    window.removeEventListener("blur", endDrag);
    window.removeEventListener("keydown", onDragKey, true);
    document.documentElement.classList.remove(DRAGGING_CLASS);
    const shown = dragging !== null;
    press = null;
    dragging = null;
    dropAt = null;
    if (!shown) return;
    setState((draft) => {
      draft.item = null;
      draft.target = null;
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
    }
    const next = dropTargetAt(item, event.clientX, event.clientY);
    const moved = dropKey(next) !== dropKey(dropAt);
    dropAt = next;
    setState((draft) => {
      if (starts) draft.item = item;
      if (moved) draft.target = next;
      draft.x = event.clientX;
      draft.y = event.clientY;
    });
  }

  function onDragEnd(): void {
    const item = dragging;
    const target = dropAt;
    endDrag();
    if (!item) return;
    swallowNextClick();
    if (target) options.onDrop(item, target);
  }

  function onDragKey(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    // The page's Escape would end the selection too; this Escape only stops the drag.
    event.preventDefault();
    event.stopPropagation();
    endDrag();
    window.addEventListener("pointerup", swallowNextClick, { once: true });
  }

  // A collapsed row shows its folders when a drag stays on it.
  createEffect(
    () => {
      const target = state.target;
      if (target?.kind !== "into") return null;
      const key = target.folderId ?? agentKey(target.agentId);
      return options.isCollapsed(key) ? key : null;
    },
    (key) => {
      if (key === null) return;
      const timer = setTimeout(() => options.onOpen(key), DRAG_OPEN_MS);
      return () => clearTimeout(timer);
    },
  );

  return {
    /** The dragged item, its target and the pointer position while a drag is on. */
    state,
    /**
     * Listens on the element that holds the sources. The capture phase runs before the listener of the
     * marquee, which asks `pressOnItem`. Returns the cleanup.
     */
    attach(root: HTMLElement): () => void {
      root.addEventListener("pointerdown", onPress, true);
      return () => {
        root.removeEventListener("pointerdown", onPress, true);
        endDrag();
      };
    },
    /** The last press was on a file or a folder that can be dragged. */
    pressOnItem: () => pressOnItem,
    /** How the row of an agent (`folderId` null) or of a folder shows the drop. */
    dropMark(agentId: string, folderId: string | null): LibraryDropMark | undefined {
      const target = state.target;
      if (!target) return undefined;
      if (target.kind === "line") return target.rowId === folderId ? target.edge : undefined;
      return target.agentId === agentId && target.folderId === folderId ? "into" : undefined;
    },
    draggedFolder: (folderId: string) =>
      state.item?.kind === "folder" && state.item.folderId === folderId ? "" : undefined,
    draggedFile: (fileId: string) => (state.item?.kind === "files" && state.item.ids.includes(fileId) ? "" : undefined),
  };
}
