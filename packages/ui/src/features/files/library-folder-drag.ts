import { type LibraryFolder, libraryFolderBranch } from "@openbot/contracts/ipc";
import { createEffect, createMemo, createStore } from "solid-js";
import { agentKey, canHoldFolder, childFolders } from "./library-folders-view";

/** How long the place that took a drop shows that it did. */
const LANDED_MS = 900;
/** How far the pointer moves before a press becomes a drag. A shorter move stays a click. */
const DRAG_START_PX = 6;
/**
 * How long a drag stays on a collapsed row before the row shows its folders, and on a folder tile or
 * a step of the path before the page goes there.
 */
const DRAG_OPEN_MS = 700;
/** The part of a folder row, at its top and at its bottom, that puts a dragged folder before or after it. */
const LINE_ZONE = 0.28;
/** The class on `<html>` while a drag is on. */
const DRAGGING_CLASS = "library-dragging";
const FILE_SOURCE = ".library-folder-tile-main, .library-picture, .library-file-card, .file-row-main";
const FOLDER_SOURCE = ".library-row-main, .library-folder-card-main";
/** The band at the top and the bottom of a list that scrolls it while a drag is in it. */
const SCROLL_EDGE_PX = 48;
/** The most pixels that a list scrolls in one frame, at its edge. */
const SCROLL_STEP_PX = 14;

/** What the pointer drags. Files of more than one agent have no agent, so no row takes them. */
export type LibraryDragItem =
  | { kind: "files"; agentId: string | null; ids: string[]; label: string }
  | { kind: "folder"; agentId: string; folderId: string; label: string };

/**
 * Where a drop goes: into a folder (or to the top level of the agent), on a line between two folders,
 * into a new folder, or out of the folders of the files ("Not in a folder"). `goes`: the target is a
 * folder tile or a step of the path, and a drag that stays on it shows that place.
 */
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

/**
 * Why the place under the pointer does not take the drop. `agent`: it is a place of another agent.
 * `mixed`: the files are of more than one agent, so no place takes them.
 */
type LibraryDropBlock = "agent" | "mixed";

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
  /** A drag stayed on a folder tile or a step of the path: the page shows that place. */
  onGo: (agentId: string, folderId: string | null) => void;
}

interface DragState {
  item: LibraryDragItem | null;
  target: LibraryDropTarget | null;
  blocked: LibraryDropBlock | null;
  /** The closed section or row under the pointer (`data-library-spring`). */
  spring: string | null;
  /** The place that took the last drop, for a short time: `landedKey`. */
  landed: string | null;
  x: number;
  y: number;
}

/** What is under the pointer. */
interface DragProbe {
  target: LibraryDropTarget | null;
  blocked: LibraryDropBlock | null;
  spring: string | null;
}

const NO_PROBE: DragProbe = { target: null, blocked: null, spring: null };

/** The key of a place that took a drop: an agent (`folderId` null) or a folder, or "Not in a folder". */
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

/** The pointer goes up on the element that it went down on, so the browser sends a click. A drag is not a click. */
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

/**
 * Drags files to a folder or an agent row, and drags a folder to a new position or into a folder of
 * the same agent. A file tile or a list row is a file source; a folder row or a folder tile is a
 * folder source and a target. Targets carry `data-library-agent` and, for a folder,
 * `data-library-folder`. A target with `data-library-drop="into"` takes a folder only into it, not on
 * a line beside it; with `data-library-drop="go"` it also shows its place when the drag stays on it.
 * `data-library-new` (the parent folder id, or empty) makes a new folder for dropped files, and
 * `data-library-out` takes dropped files out of their folders. A list with `data-library-autoscroll`
 * scrolls while the drag is at its top or bottom edge, and a closed part with `data-library-spring`
 * (its collapse key) opens when the drag stays on it. After a drag opened a place, the part of the page
 * with `data-library-here` takes the drop into that place. A place of another agent tells why it does not
 * take the drop. Touch scrolls, so only a mouse or a pen drags. Escape stops the drag.
 */
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
  /** The place that this drag opened, when it stayed on a folder tile or a step of the path. */
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
      if (item.agentId === null) return { target: null, blocked: "mixed", spring: null };
      const inFolder = item.ids.some((id) => options.folderIdOfFile(id) !== undefined);
      return { target: inFolder ? { kind: "out", agentId: item.agentId } : null, blocked: null, spring: null };
    }
    const row = under?.closest("[data-library-agent]");
    const agentId = row?.getAttribute("data-library-agent");
    if (!row || !agentId) {
      // The page that the drag opened takes the drop, so the drag does not need a tile in it.
      if (opened && under?.closest("[data-library-here]"))
        return { target: openedTarget(item, opened), blocked: null, spring: null };
      return { target: null, blocked: null, spring: spring && options.isCollapsed(spring) ? spring : null };
    }
    if (agentId !== item.agentId)
      return { target: null, blocked: item.agentId === null ? "mixed" : "agent", spring: null };
    return { target: dropTargetIn(item, row, agentId, y), blocked: null, spring: null };
  }

  /** The drop into the place that the drag opened. The drag only opens a place of the agent of the item. */
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
    // The agent row: the folder goes to the top level.
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
    return { kind: "into", agentId, folderId: folder.id, goes: false };
  }

  /** Shows what is under the pointer, when it changed. */
  function showProbe(next: DragProbe): boolean {
    if (probeKey(next) === probeKey(probed)) return false;
    probed = next;
    return true;
  }

  /** Finds the target under the pointer again, after the content under it moved or changed. */
  function retarget(): void {
    if (!dragging || !showProbe(probeAt(dragging, state.x, state.y))) return;
    setState((draft) => {
      draft.target = probed.target;
      draft.blocked = probed.blocked;
      draft.spring = probed.spring;
    });
  }

  /** Scrolls the list under the pointer while the pointer is near its top or bottom edge. */
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

  /** The place that took the drop shows it for a short time. A new folder opens its name field instead. */
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
    // The page's Escape would end the selection too; this Escape only stops the drag.
    event.preventDefault();
    event.stopPropagation();
    endDrag();
    window.addEventListener("pointerup", swallowNextClick, { once: true });
  }

  // A collapsed row shows its folders when a drag stays on it. A folder tile or a step of the path
  // shows its place, so the drag can go on into the folders in it.
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
        // The new place has other tiles under the pointer.
        requestAnimationFrame(retarget);
      }, DRAG_OPEN_MS);
      return () => clearTimeout(timer);
    },
  );

  // A closed section opens when a drag stays on its name.
  createEffect(
    () => state.spring,
    (key) => {
      if (key === null) return;
      const timer = setTimeout(() => options.onOpen(key), DRAG_OPEN_MS);
      return () => clearTimeout(timer);
    },
  );

  /** The folders that a dragged folder cannot go into: the folder and the folders in it. */
  const draggedBranch = createMemo((): ReadonlySet<string> => {
    const item = state.item;
    return item?.kind === "folder" ? libraryFolderBranch(options.folders(), item.folderId) : new Set();
  });

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
        clearTimeout(landedTimer);
        endDrag();
      };
    },
    /** The last press was on a file or a folder that can be dragged. */
    pressOnItem: () => pressOnItem,
    /** How the row of an agent (`folderId` null) or of a folder shows the drop. */
    dropMark(agentId: string, folderId: string | null): LibraryDropMark | undefined {
      const target = state.target;
      if (!target || target.kind === "new" || target.kind === "out") return undefined;
      if (target.kind === "line") return target.rowId === folderId ? target.edge : undefined;
      return target.agentId === agentId && target.folderId === folderId ? "into" : undefined;
    },
    /** The new folder target of the agent, in the folder `parentId`, takes the drop. */
    newMark(agentId: string, parentId: string | undefined): "into" | undefined {
      const target = state.target;
      return target?.kind === "new" && target.agentId === agentId && target.parentId === parentId ? "into" : undefined;
    },
    /** "Not in a folder" takes the drop. */
    outMark: (): "into" | undefined => (state.target?.kind === "out" ? "into" : undefined),
    /**
     * `""` while a drag is on that "Not in a folder" cannot take: a folder, files of more than one
     * agent, or files that are in no folder.
     */
    outOff: (): "" | undefined => {
      const item = state.item;
      if (!item) return undefined;
      if (item.kind !== "files" || item.agentId === null) return "";
      return item.ids.some((id) => options.folderIdOfFile(id) !== undefined) ? undefined : "";
    },
    /**
     * `""` while a drag is on and the place cannot take it: a place of another agent (`agentId`), a
     * place of no agent (undefined), or the dragged folder and the folders in it.
     */
    dropOff(agentId: string | undefined, folderId?: string): "" | undefined {
      const item = state.item;
      if (!item) return undefined;
      if (agentId === undefined || agentId !== item.agentId) return "";
      return folderId !== undefined && draggedBranch().has(folderId) ? "" : undefined;
    },
    /** `""` for a short time after a drop on the place: an agent (`folderId` null) or a folder. */
    landed: (agentId: string, folderId: string | null): "" | undefined =>
      state.landed === landedKey(agentId, folderId) ? "" : undefined,
    /** `""` for a short time after a drop on "Not in a folder". */
    landedOut: (): "" | undefined => (state.landed === landedKey(null, null) ? "" : undefined),
    draggedFolder: (folderId: string) =>
      state.item?.kind === "folder" && state.item.folderId === folderId ? "" : undefined,
    draggedFile: (fileId: string) => (state.item?.kind === "files" && state.item.ids.includes(fileId) ? "" : undefined),
  };
}
