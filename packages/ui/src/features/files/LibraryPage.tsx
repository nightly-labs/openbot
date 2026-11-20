import {
  LIBRARY_FOLDER_LIMITS,
  type LibraryFolder,
  type LibraryFolderAction,
  type LibraryFoldersSnapshot,
  libraryFolderBranch,
  libraryFolderPath,
  libraryFolderTree,
} from "@openbot/contracts/ipc";
import {
  ArrowRight,
  Ban,
  Button,
  buttonVariants,
  DropdownMenu,
  File,
  Folder,
  FolderInput,
  FolderPlus,
  LayoutDashboard,
  LayoutGrid,
  List,
  toast,
} from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import { useText } from "@openbot/ui/text";
import { type JSX, Portal } from "@solidjs/web";
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import { AgentPicker } from "../agents/AgentPicker";
import { type AttachmentMediaSource, fileBadge } from "../conversation/AttachmentCards";
import { attachmentReferenceBadge, attachmentReferenceTone } from "../conversation/AttachmentReference";
import { ImageLightbox, type ImageLightboxOpening, isLightboxImage } from "../conversation/ImageLightbox";
import {
  FileDeleteDialog,
  FileList,
  FileListStatus,
  FileNoMatches,
  FileRowMenu,
  FileSearch,
  type FileSelection,
  FileSelectionMark,
  FileTypeFilters,
  isSelectClick,
} from "./FileList";
import {
  type FileTypeFilter,
  fileCountLabel,
  fileTypeCounts,
  queryFiles,
  type StoredFileAction,
  type StoredFileRow,
} from "./files-view";
import { LibraryFolderTiles, type LibraryNewFolderTarget } from "./LibraryFolderTiles";
import { type LibraryCounts, type LibraryFavorite, LibraryFolderTree } from "./LibraryFolderTree";
import { LibraryMoveItems, LibraryMoveSubmenu } from "./LibraryMoveItems";
import { LibraryPathHead } from "./LibraryPathHead";
import { type LibraryBatchAction, type LibraryPillStep, LibrarySelectionPill } from "./LibrarySelectionPill";
import { createLibraryFolderDrag, type LibraryDragItem, type LibraryDropTarget } from "./library-folder-drag";
import {
  AGENTS_SECTION,
  ALL_FILES,
  agentKey,
  canHoldFolder,
  childFolders,
  fileIdGroups,
  freeFolderName,
  isRecentFile,
  type LibraryLocation,
} from "./library-folders-view";
import { createLibraryPictureLoader } from "./library-picture-loader";
import { createMarqueeSelection } from "./marquee-selection";

export type { LibraryLocation } from "./library-folders-view";

export interface LibraryPageProps {
  files: readonly StoredFileRow[];
  agents?: readonly AgentProfile[] | undefined;
  loading?: boolean | undefined;
  error?: string | null | undefined;
  onRetry?: (() => void) | undefined;
  canDelete?: boolean | undefined;
  now?: Date | undefined;
  macWindowControls?: boolean | undefined;
  onOpen: (file: StoredFileRow, origin: HTMLElement | undefined) => void;
  onAction: (file: StoredFileRow, action: StoredFileAction) => void | Promise<void>;
  onDeleteFiles?: BatchFileAction | undefined;
  onSaveFiles?: BatchFileAction | undefined;
  folders?: LibraryFoldersSnapshot | null | undefined;
  onFolderAction?: ((action: LibraryFolderAction) => void) | undefined;
  canOrganize?: ((agentId: string) => boolean) | undefined;
  initialLocation?: LibraryLocation | undefined;
  initialCollapsed?: readonly string[] | undefined;
  onCollapsedChange?: ((keys: readonly string[]) => void) | undefined;
  initialFavorites?: readonly string[] | undefined;
  onFavoritesChange?: ((keys: readonly string[]) => void) | undefined;
  mediaSource?: AttachmentMediaSource | undefined;
  pictureUrl?: ((file: StoredFileRow) => string | null) | undefined;
  opensFiles?: boolean | undefined;
}

export type BatchFileAction = (files: readonly StoredFileRow[], onProgress: (done: number) => void) => Promise<number>;

type LibraryView = "mosaic" | "grid" | "list";

type FileOrigins = ReadonlyMap<string | null, readonly string[]>;

type RenameField = "side" | "tile";

const TILES_AT_ALL = 12;

interface LibrarySelection {
  ids: ReadonlySet<string>;
  anchor: string | null;
}

const NO_AGENTS: readonly AgentProfile[] = [];
const NO_FOLDERS: readonly LibraryFolder[] = [];
const NO_FILES: readonly StoredFileRow[] = [];

function isPicture(file: StoredFileRow): boolean {
  return isLightboxImage(file) && file.status !== "failed";
}

export function LibraryPage(props: LibraryPageProps) {
  const { t } = useText();
  const [search, setSearch] = createSignal("");
  const [type, setType] = createSignal<FileTypeFilter>("all");
  const [view, setView] = createSignal<LibraryView>("mosaic");
  const [pendingDelete, setPendingDelete] = createSignal<StoredFileRow | null>(null);
  const [lightbox, setLightbox] = createSignal<ImageLightboxOpening | null>(null);
  const thumbnails = new Map<string, HTMLElement>();
  const files = createMemo(() => {
    const source = props.mediaSource;
    return props.files.flatMap((file) => {
      if (file.status === "missing") return [];
      if (!source || file.previewUrl || file.previewKind !== "image") return [file];
      const previewUrl = source.url(file.id);
      return [previewUrl ? { ...file, previewUrl } : file];
    });
  });
  const fileById = createMemo(() => new Map(files().map((file) => [file.id, file])));
  const pictureUrl = (file: StoredFileRow) => props.pictureUrl?.(file) ?? file.previewUrl ?? "";
  const pictures = createLibraryPictureLoader({
    source: untrack(() => props.mediaSource),
    file: (fileId) => untrack(fileById).get(fileId),
  });
  const agents = () => props.agents ?? NO_AGENTS;
  const agentById = createMemo(() => new Map(agents().map((agent) => [agent.id, agent])));
  const agentOf = (agentId: string | null) => (agentId ? agentById().get(agentId) : undefined);
  const agentName = (agentId: string | null) => agentOf(agentId)?.name;
  const fromRemovedAgent = (file: StoredFileRow) =>
    props.agents !== undefined && file.agentId !== null && agentOf(file.agentId) === undefined;

  const snapshot = createMemo(() => (props.onFolderAction ? (props.folders ?? null) : null));
  const folderMode = () => snapshot() !== null;
  const folderList = () => snapshot()?.folders ?? NO_FOLDERS;
  const folderById = createMemo(() => new Map(folderList().map((folder) => [folder.id, folder])));
  const canCreateFolder = () => folderList().length < LIBRARY_FOLDER_LIMITS.folders;
  const organizes = (agentId: string | null): agentId is string =>
    agentId !== null && agentOf(agentId) !== undefined && (props.canOrganize?.(agentId) ?? true);
  const removedFilesExist = createMemo(() => files().some(fromRemovedAgent));
  function folderOf(file: StoredFileRow): LibraryFolder | undefined {
    const folderId = file.agentId === null ? undefined : snapshot()?.placement[file.id];
    const folder = folderId === undefined ? undefined : folderById().get(folderId);
    return folder?.agentId === file.agentId ? folder : undefined;
  }
  const [location, setLocation] = createSignal<LibraryLocation>(untrack(() => props.initialLocation) ?? ALL_FILES);
  const place = createMemo<LibraryLocation>(() => {
    const at = location();
    if (!folderMode() || at.kind === "all") return ALL_FILES;
    if (at.kind === "recent" || at.kind === "unsorted") return at;
    if (at.kind === "removed") return removedFilesExist() ? at : ALL_FILES;
    if (!agentOf(at.agentId)) return ALL_FILES;
    if (at.kind === "agent") return at;
    return folderById().get(at.folderId)?.agentId === at.agentId ? at : { kind: "agent", agentId: at.agentId };
  });
  const [renaming, setRenaming] = createSignal<{ id: string; field: RenameField } | null>(null);
  const renamingId = createMemo(() => {
    const folderId = renaming()?.id;
    return folderId !== undefined && folderById().has(folderId) ? folderId : null;
  });
  const renamingIn = (field: RenameField) => (renaming()?.field === field ? renamingId() : null);
  const [unnamed, setUnnamed] = createSignal<string | null>(null);
  const [filled, setFilled] = createSignal<{ id: string; name: string; count: number; from: FileOrigins } | null>(null);
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set(untrack(() => props.initialCollapsed)));
  const isCollapsed = (key: string) => collapsed().has(key);
  createEffect(
    () => ({ keys: collapsed(), notify: props.onCollapsedChange }),
    ({ keys, notify }) => notify?.([...keys]),
  );
  const [shell, setShell] = createSignal<HTMLElement | null>(null);

  const [favoriteKeys, setFavoriteKeys] = createSignal<readonly string[]>(untrack(() => props.initialFavorites) ?? []);
  const isFavorite = (key: string) => favoriteKeys().includes(key);
  function toggleFavorite(key: string): void {
    const next = isFavorite(key) ? favoriteKeys().filter((candidate) => candidate !== key) : [...favoriteKeys(), key];
    setFavoriteKeys(next);
    props.onFavoritesChange?.(next);
  }
  const favorites = createMemo(() =>
    favoriteKeys().flatMap((key): LibraryFavorite[] => {
      const folder = folderById().get(key);
      if (folder) return agentOf(folder.agentId) ? [{ kind: "folder", key, folder }] : [];
      const agent = agents().find((candidate) => agentKey(candidate.id) === key);
      return agent ? [{ kind: "agent", key, agent }] : [];
    }),
  );

  const latestOfAgent = createMemo(() => {
    const latest = new Map<string, number>();
    for (const file of files()) {
      if (file.agentId === null) continue;
      const time = Date.parse(file.createdAt);
      if (time > (latest.get(file.agentId) ?? Number.NEGATIVE_INFINITY)) latest.set(file.agentId, time);
    }
    return latest;
  });
  const activeAgents = createMemo(() => {
    const latest = latestOfAgent();
    const withFolders = new Set(folderList().map((folder) => folder.agentId));
    return agents()
      .filter((agent) => latest.has(agent.id) || withFolders.has(agent.id))
      .sort((a, b) => (latest.get(b.id) ?? 0) - (latest.get(a.id) ?? 0));
  });
  const organizableAgents = createMemo(() => {
    const active = activeAgents();
    const shown = new Set(active.map((agent) => agent.id));
    return [...active, ...agents().filter((agent) => !shown.has(agent.id))].filter((agent) => organizes(agent.id));
  });

  const libraryCounts = createMemo<LibraryCounts>(() => {
    const now = props.now ?? new Date();
    const byId = folderById();
    const agent = new Map<string, number>();
    const folder = new Map<string, number>();
    let recent = 0;
    let unsorted = 0;
    let removed = 0;
    for (const file of files()) {
      if (fromRemovedAgent(file)) removed += 1;
      if (!agentOf(file.agentId) || file.agentId === null) continue;
      agent.set(file.agentId, (agent.get(file.agentId) ?? 0) + 1);
      if (isRecentFile(file.createdAt, now)) recent += 1;
      let at = folderOf(file);
      if (!at) unsorted += 1;
      while (at) {
        folder.set(at.id, (folder.get(at.id) ?? 0) + 1);
        at = at.parentId === undefined ? undefined : byId.get(at.parentId);
      }
    }
    return { all: files().length, recent, unsorted, removed, agent, folder };
  });
  const childCounts = createMemo(() => {
    const count = new Map<string, number>();
    for (const folder of folderList()) {
      if (folder.parentId !== undefined) count.set(folder.parentId, (count.get(folder.parentId) ?? 0) + 1);
    }
    return count;
  });
  const peeks = createMemo(() => {
    const peek = new Map<string, StoredFileRow[]>();
    const byId = folderById();
    const newest = files()
      .flatMap((file) => {
        const folder = folderOf(file);
        return folder ? [{ file, folder, time: Date.parse(file.createdAt) }] : [];
      })
      .sort((a, b) => b.time - a.time);
    for (const { file, folder } of newest) {
      for (let at: LibraryFolder | undefined = folder; at; at = at.parentId ? byId.get(at.parentId) : undefined) {
        const list = peek.get(at.id) ?? [];
        if (list.length < 3) list.push(file);
        peek.set(at.id, list);
      }
    }
    return peek;
  });

  const scope = createMemo(() => {
    const at = place();
    if (at.kind === "all") return files();
    if (at.kind === "removed") return files().filter(fromRemovedAgent);
    if (at.kind === "recent") {
      const now = props.now ?? new Date();
      return files().filter((file) => agentOf(file.agentId) !== undefined && isRecentFile(file.createdAt, now));
    }
    if (at.kind === "unsorted") {
      return files().filter((file) => agentOf(file.agentId) !== undefined && folderOf(file) === undefined);
    }
    if (at.kind === "agent") return files().filter((file) => file.agentId === at.agentId);
    const branch = libraryFolderBranch(folderList(), at.folderId);
    return files().filter((file) => {
      const folder = folderOf(file);
      return folder !== undefined && branch.has(folder.id);
    });
  });
  const searched = createMemo(() => queryFiles(scope(), { search: search(), type: "all", sort: "newest" }));
  const shown = createMemo(() => queryFiles(scope(), { search: search(), type: type(), sort: "newest" }));
  const typeCounts = createMemo(() => fileTypeCounts(searched()));
  const filtered = () => search().trim() !== "" || type() !== "all";
  const emptyHere = () => folderMode() && !filtered() && scope().length === 0;
  const [selection, setSelection] = createSignal<LibrarySelection | null>(null);
  const [step, setStep] = createSignal<LibraryPillStep>({ kind: "actions" });
  const canSave = (file: StoredFileRow) =>
    props.onSaveFiles !== undefined && (file.status === "available" || file.status === "remote");
  const canDeleteFile = (file: StoredFileRow) =>
    props.canDelete === true && file.deletable && props.onDeleteFiles !== undefined;
  const canMove = (file: StoredFileRow) => folderMode() && organizes(file.agentId);
  const canSelect = (file: StoredFileRow) => canSave(file) || canDeleteFile(file) || canMove(file);
  const selecting = () => selection() !== null;
  const busy = () => step().kind === "working";
  const selectable = createMemo(() => shown().filter(canSelect));
  const selected = createMemo(() => {
    const ids = selection()?.ids;
    return ids ? selectable().filter((file) => ids.has(file.id)) : [];
  });
  const savable = createMemo(() => selected().filter(canSave));
  const deletable = createMemo(() => selected().filter(canDeleteFile));
  const allSelected = () => selectable().length > 0 && selected().length === selectable().length;
  const isSelected = (file: StoredFileRow) => selection()?.ids.has(file.id) === true;
  const selectableFilesExist = () => scope().some(canSelect);
  const pressed = (file: StoredFileRow) => (selecting() ? (isSelected(file) ? "true" : "false") : undefined);
  const pillOpen = () => selected().length > 0 || step().kind !== "actions";
  const pillCanDelete = () => props.canDelete === true && props.onDeleteFiles !== undefined;
  const moveAgent = createMemo(() => {
    const ids = new Set(selected().map((file) => file.agentId));
    const [only = null] = ids;
    return folderMode() && ids.size === 1 && organizes(only) ? agentOf(only) : undefined;
  });
  const moveFolders = createMemo(() => {
    const agent = moveAgent();
    return agent ? libraryFolderTree(folderList(), agent.id) : [];
  });
  const selectionInFolder = () => selected().some((file) => folderOf(file) !== undefined);
  const canMoveSelection = () =>
    moveAgent() !== undefined && (moveFolders().length > 0 || selectionInFolder() || canCreateFolder());

  function folderLine(file: StoredFileRow): string | undefined {
    const folder = folderOf(file);
    if (!folder) return undefined;
    const path = libraryFolderPath(folderList(), folder.id);
    const at = place();
    const below = at.kind === "folder" ? path.slice(path.findIndex((step) => step.id === at.folderId) + 1) : path;
    return below.length > 0 ? below.map((step) => step.name).join(" \u203a ") : undefined;
  }

  const title = () => {
    const at = place();
    if (at.kind === "all") return t("files.library.allFiles");
    if (at.kind === "removed") return t("files.library.removedAgents");
    if (at.kind === "recent") return t("files.library.recent");
    if (at.kind === "unsorted") return t("files.library.unsorted");
    if (at.kind === "folder") return folderById().get(at.folderId)?.name ?? "";
    return agentName(at.agentId) ?? "";
  };
  const placeAgent = () => {
    const at = place();
    return at.kind === "agent" || at.kind === "folder" ? agentOf(at.agentId) : undefined;
  };
  const parentFolders = createMemo(() => {
    const at = place();
    return at.kind === "folder" ? libraryFolderPath(folderList(), at.folderId).slice(0, -1) : NO_FOLDERS;
  });
  const searchLabel = () =>
    place().kind === "all" ? t("files.library.search") : t("files.library.searchIn", { name: title() });
  const listLabel = () => (folderMode() ? title() : t("files.library.title"));

  function send(action: LibraryFolderAction): void {
    props.onFolderAction?.(action);
  }

  function setOpen(key: string, open: boolean): void {
    setCollapsed((current) => {
      if (current.has(key) !== open) return current;
      const next = new Set(current);
      if (open) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function reveal(agentId: string, folderId: string | undefined): void {
    const keys = new Set([
      AGENTS_SECTION,
      agentKey(agentId),
      ...libraryFolderPath(folderList(), folderId).map((folder) => folder.id),
    ]);
    setCollapsed((current) => {
      const next = new Set([...current].filter((key) => !keys.has(key)));
      return next.size === current.size ? current : next;
    });
  }

  function go(next: LibraryLocation): void {
    if (busy()) return;
    if (next.kind === "agent" || next.kind === "folder")
      reveal(next.agentId, next.kind === "folder" ? next.folderId : undefined);
    setLocation(next);
    clearFilters();
    setStep({ kind: "actions" });
    setSelection(null);
    setRenaming(null);
    announceFilled();
  }

  function createFolder(agentId: string, parentId: string | undefined, targets: readonly StoredFileRow[]): string {
    const id = crypto.randomUUID();
    const name = freeFolderName(t("files.folder.new"), childFolders(folderList(), agentId, parentId));
    const [first, ...rest] = fileIdGroups(targets.map((file) => file.id));
    send({
      type: "create",
      id,
      agentId,
      name,
      ...(parentId === undefined ? {} : { parentId }),
      ...(first ? { fileIds: first } : {}),
    });
    for (const fileIds of rest) send({ type: "place", fileIds, folderId: id });
    reveal(agentId, parentId);
    announceFilled();
    if (targets.length > 0) setFilled({ id, name, count: targets.length, from: fileOrigins(targets) });
    return id;
  }

  function tilesHold(agentId: string, parentId: string | undefined, at = place()): boolean {
    if (at.kind === "folder") return at.folderId === parentId;
    if (at.kind === "agent") return at.agentId === agentId && parentId === undefined;
    return at.kind === "all" && parentId === undefined;
  }

  function newFolder(agentId: string, parentId: string | undefined, field: RenameField, at = place()): void {
    if (busy() || !canCreateFolder()) return;
    const id = createFolder(agentId, parentId, []);
    setUnnamed(id);
    setRenaming({ id, field: field === "tile" && tilesHold(agentId, parentId, at) ? "tile" : "side" });
  }

  function newFolderHere(): void {
    const at = place();
    if (at.kind === "agent" || at.kind === "folder")
      newFolder(at.agentId, at.kind === "folder" ? at.folderId : undefined, "tile");
  }

  function newFolderIn(folder: LibraryFolder): void {
    const next: LibraryLocation = { kind: "folder", agentId: folder.agentId, folderId: folder.id };
    go(next);
    newFolder(folder.agentId, folder.id, "tile", next);
  }

  function newFolderForAgent(agentId: string): void {
    const next: LibraryLocation = { kind: "agent", agentId };
    go(next);
    newFolder(agentId, undefined, "tile", next);
  }

  function announceFilled(name?: string): void {
    const done = filled();
    if (!done) return;
    setFilled(null);
    const folderName = name ?? folderById().get(done.id)?.name ?? done.name;
    toast.success(t("files.folder.filesMoved", { count: done.count, name: folderName }), {
      action: {
        label: t("files.folder.undo"),
        onClick: () => {
          putBack(done.from);
          send({ type: "delete", folderId: done.id });
        },
      },
    });
  }

  function renameFolder(folderId: string, name: string): void {
    const next = name.trim();
    const renamed = next !== "" && next !== folderById().get(folderId)?.name;
    if (renamed) send({ type: "rename", folderId, name: next });
    setRenaming(null);
    setUnnamed(null);
    if (filled()?.id === folderId) announceFilled(renamed ? next : undefined);
  }

  function startRename(folderId: string, field: RenameField): void {
    announceFilled();
    setUnnamed(null);
    setRenaming({ id: folderId, field });
  }

  function cancelName(folderId: string): void {
    if (unnamed() === folderId) send({ type: "delete", folderId });
    setRenaming(null);
    setUnnamed(null);
    if (filled()?.id === folderId) announceFilled();
  }

  function deleteFolder(folder: LibraryFolder): void {
    const current = snapshot();
    if (!current) return;
    const gone = libraryFolderBranch(current.folders, folder.id);
    const at = place();
    if (at.kind === "folder" && gone.has(at.folderId)) go({ kind: "agent", agentId: folder.agentId });
    const folders = current.folders.flatMap((candidate, index) =>
      gone.has(candidate.id) ? [{ index, folder: { ...candidate } }] : [],
    );
    const placement = Object.fromEntries(
      Object.entries(current.placement).filter(([, folderId]) => gone.has(folderId)),
    );
    send({ type: "delete", folderId: folder.id });
    toast.success(t("files.folder.deleted", { name: agentName(folder.agentId) ?? "" }), {
      action: { label: t("files.folder.undo"), onClick: () => send({ type: "restore", folders, placement }) },
    });
  }

  function fileOrigins(targets: readonly StoredFileRow[]): FileOrigins {
    const origins = new Map<string | null, string[]>();
    for (const file of targets) {
      const from = folderOf(file)?.id ?? null;
      const ids = origins.get(from);
      if (ids) ids.push(file.id);
      else origins.set(from, [file.id]);
    }
    return origins;
  }

  function putBack(origins: FileOrigins): void {
    for (const [from, ids] of origins) {
      const folderId = from !== null && folderById().has(from) ? from : null;
      for (const fileIds of fileIdGroups(ids)) send({ type: "place", fileIds, folderId });
    }
  }

  function placeFiles(targets: readonly StoredFileRow[], folder: LibraryFolder | null): void {
    if (targets.length === 0) return;
    const origins = fileOrigins(targets);
    for (const fileIds of fileIdGroups(targets.map((file) => file.id))) {
      send({ type: "place", fileIds, folderId: folder?.id ?? null });
    }
    const count = targets.length;
    toast.success(
      folder ? t("files.folder.filesMoved", { count, name: folder.name }) : t("files.folder.filesRemoved", { count }),
      { action: { label: t("files.folder.undo"), onClick: () => putBack(origins) } },
    );
  }

  function moveTo(folder: LibraryFolder | null): void {
    placeFiles(selected(), folder);
    setSelection(null);
  }

  function placeInNewFolder(agentId: string, targets: readonly StoredFileRow[]): void {
    setRenaming({ id: createFolder(agentId, undefined, targets), field: "side" });
  }

  function moveToNewFolder(): void {
    const agent = moveAgent();
    if (!agent) return;
    placeInNewFolder(agent.id, selected());
    setSelection(null);
  }

  function moveFolder(folderId: string, parentId: string | undefined, beforeFolderId: string | null): void {
    send({ type: "move", folderId, parentId: parentId ?? null, beforeFolderId });
  }

  function onDrop(item: LibraryDragItem, target: LibraryDropTarget): void {
    if (item.kind === "files") {
      const moved = item.ids.flatMap((id) => fileById().get(id) ?? []);
      const wasSelected = moved.some(isSelected);
      if (target.kind === "new") {
        if (busy() || !canCreateFolder()) return;
        const id = createFolder(target.agentId, target.parentId, moved);
        setRenaming({ id, field: tilesHold(target.agentId, target.parentId) ? "tile" : "side" });
      } else if (target.kind === "into") {
        placeFiles(moved, (target.folderId === null ? undefined : folderById().get(target.folderId)) ?? null);
      } else if (target.kind === "out") {
        placeFiles(
          moved.filter((file) => folderOf(file) !== undefined),
          null,
        );
      } else return;
      if (wasSelected) setSelection(null);
      return;
    }
    if (target.kind === "new" || target.kind === "out") return;
    if (target.kind === "line") {
      moveFolder(item.folderId, target.parentId, target.beforeId);
      return;
    }
    const parent = target.folderId === null ? undefined : folderById().get(target.folderId);
    const folder = folderById().get(item.folderId);
    if (!folder) return;
    const siblings = childFolders(folderList(), folder.agentId, folder.parentId);
    const nextId = siblings[siblings.findIndex((candidate) => candidate.id === folder.id) + 1]?.id ?? null;
    moveFolder(folder.id, parent?.id, null);
    reveal(item.agentId, parent?.id);
    toast.success(
      t("files.folder.folderMoved", { folder: item.label, name: parent?.name ?? agentName(item.agentId) ?? "" }),
      {
        action: {
          label: t("files.folder.undo"),
          onClick: () => {
            const before = nextId !== null && folderById().has(nextId) ? nextId : null;
            const from =
              folder.parentId !== undefined && folderById().has(folder.parentId) ? folder.parentId : undefined;
            moveFolder(folder.id, from, before);
          },
        },
      },
    );
  }

  function dropName(): string | undefined {
    const target = drag.state.target;
    if (!target) return undefined;
    if (target.kind === "out") return t("files.library.unsorted");
    if (target.kind === "new") return t("files.folder.new");
    let folderId = target.kind === "into" ? target.folderId : (target.parentId ?? null);
    if (target.kind === "line") {
      const item = drag.state.item;
      const moved = item?.kind === "folder" ? folderById().get(item.folderId) : undefined;
      if ((moved?.parentId ?? null) === folderId) return undefined;
    }
    if (folderId !== null && !folderById().has(folderId)) folderId = null;
    return folderId === null ? agentName(target.agentId) : folderById().get(folderId)?.name;
  }

  function dropBlock(): string | undefined {
    const blocked = drag.state.blocked;
    const item = drag.state.item;
    if (!blocked || !item) return undefined;
    if (blocked === "mixed") return t("files.drag.mixedAgents");
    return t("files.drag.onlyAgent", { name: agentName(item.agentId) ?? "" });
  }

  function dragFileItem(fileId: string): LibraryDragItem | null {
    const file = shown().find((candidate) => candidate.id === fileId);
    if (!file) return null;
    const moved = isSelected(file) ? selected() : [file];
    if (!moved.some(canMove)) return null;
    const owners = new Set(moved.map((candidate) => candidate.agentId));
    const [only = null] = owners;
    return {
      kind: "files",
      agentId: owners.size === 1 && organizes(only) ? only : null,
      ids: moved.map((candidate) => candidate.id),
      label: moved.length === 1 ? file.name : fileCountLabel(moved.length, t),
    };
  }

  const drag = createLibraryFolderDrag({
    enabled: () => folderMode() && !busy() && renamingId() === null,
    folders: folderList,
    organizes,
    folderIdOfFile: (fileId) => {
      const file = fileById().get(fileId);
      return file ? folderOf(file)?.id : undefined;
    },
    isCollapsed,
    fileItem: dragFileItem,
    onDrop,
    onOpen: (key) => setOpen(key, true),
    onGo: (agentId, folderId) =>
      go(folderId === null ? { kind: "agent", agentId } : { kind: "folder", agentId, folderId }),
  });

  const tileFolders = createMemo(() => {
    if (!folderMode()) return NO_FOLDERS;
    const at = place();
    const editing = renamingIn("tile");
    let list: readonly LibraryFolder[];
    if (at.kind === "folder") list = childFolders(folderList(), at.agentId, at.folderId);
    else if (at.kind === "agent") list = childFolders(folderList(), at.agentId, undefined);
    else if (at.kind === "all") {
      const newest = (folder: LibraryFolder) => {
        const [file] = peeks().get(folder.id) ?? NO_FILES;
        return file ? Date.parse(file.createdAt) : 0;
      };
      list = folderList()
        .filter((folder) => folder.parentId === undefined && agentOf(folder.agentId) !== undefined)
        .map((folder) => ({ folder, time: newest(folder) }))
        .sort((a, b) => b.time - a.time)
        .slice(0, TILES_AT_ALL)
        .map((row) => row.folder);
      const extra = editing === null ? undefined : folderById().get(editing);
      if (extra && !list.includes(extra)) list = [...list, extra];
    } else return NO_FOLDERS;
    const query = search().trim().toLocaleLowerCase();
    if (query === "") return list;
    return list.filter((folder) => folder.id === editing || folder.name.toLocaleLowerCase().includes(query));
  });
  const newTarget = createMemo<LibraryNewFolderTarget | null>(() => {
    const item = drag.state.item;
    if (item?.kind !== "files" || item.agentId === null || !canCreateFolder() || !organizes(item.agentId)) return null;
    const at = place();
    if (at.kind === "removed") return null;
    if (at.kind === "folder") {
      return at.agentId === item.agentId && canHoldFolder(folderList(), at.folderId)
        ? { agentId: item.agentId, parentId: at.folderId }
        : null;
    }
    if (at.kind === "agent" && at.agentId !== item.agentId) return null;
    return { agentId: item.agentId, parentId: undefined };
  });
  const newFolderPlace = () => {
    const at = place();
    if (!canCreateFolder() || selecting()) return null;
    if (at.kind === "removed") return null;
    if (at.kind === "agent" || at.kind === "folder") {
      const parentId = at.kind === "folder" ? at.folderId : undefined;
      return organizes(at.agentId) && canHoldFolder(folderList(), parentId) ? "here" : null;
    }
    return organizableAgents().length > 0 ? "pick" : null;
  };
  createEffect(shell, (element) => (element ? drag.attach(element) : undefined));

  function leaveConfirm(): void {
    if (step().kind === "confirm") setStep({ kind: "actions" });
  }

  function toggle(file: StoredFileRow, event: MouseEvent): void {
    if (!canSelect(file) || busy()) return;
    leaveConfirm();
    const current = selection() ?? { ids: new Set<string>(), anchor: null };
    const ids = new Set(current.ids);
    const list = shown();
    const from = current.anchor ? list.findIndex((candidate) => candidate.id === current.anchor) : -1;
    const to = list.indexOf(file);
    if (event.shiftKey && from >= 0 && to >= 0) {
      for (const candidate of list.slice(Math.min(from, to), Math.max(from, to) + 1)) {
        if (canSelect(candidate)) ids.add(candidate.id);
      }
      setSelection({ ids, anchor: current.anchor });
      return;
    }
    if (ids.has(file.id)) ids.delete(file.id);
    else ids.add(file.id);
    setSelection({ ids, anchor: file.id });
  }

  function toggleAll(): void {
    leaveConfirm();
    const ids = new Set(selection()?.ids);
    const clear = allSelected();
    for (const file of selectable()) {
      if (clear) ids.delete(file.id);
      else ids.add(file.id);
    }
    setSelection({ ids, anchor: null });
  }

  function stopSelecting(): void {
    if (busy()) return;
    setStep({ kind: "actions" });
    setSelection(null);
  }

  async function run(action: LibraryBatchAction, targets: readonly StoredFileRow[]): Promise<void> {
    const handler = action === "delete" ? props.onDeleteFiles : props.onSaveFiles;
    const total = targets.length;
    if (!handler || total === 0) return;
    setStep({ kind: "working", action, done: 0, total });
    let failed = total;
    try {
      failed = await handler(targets, (done) => setStep({ kind: "working", action, done, total }));
    } catch {}
    setStep({ kind: "actions" });
    if (failed > 0) {
      toast.error(t(action === "delete" ? "files.delete.someFailed" : "files.library.saveFailed", { count: failed }));
      return;
    }
    toast.success(t(action === "delete" ? "files.library.deleted" : "files.library.saved", { count: total }));
    if (action === "delete") setSelection(null);
  }

  let beforeDrag: LibrarySelection | null = null;
  let dragBase: ReadonlySet<string> = new Set();
  const marquee = createMarqueeSelection({
    enabled: () =>
      !busy() &&
      lightbox() === null &&
      selectableFilesExist() &&
      !(folderMode() && (drag.pressOnItem() || renamingId() !== null)),
    onStart: (additive) => {
      beforeDrag = selection();
      dragBase = additive ? (beforeDrag?.ids ?? new Set()) : new Set();
      leaveConfirm();
    },
    onChange: (hits) => {
      const ids = new Set(dragBase);
      for (const file of selectable()) if (hits.has(file.id)) ids.add(file.id);
      const current = selection()?.ids;
      if (current && current.size === ids.size && [...ids].every((id) => current.has(id))) return;
      setSelection(ids.size === 0 && beforeDrag === null ? null : { ids, anchor: beforeDrag?.anchor ?? null });
    },
    onCancel: () => setSelection(beforeDrag),
  });

  const listSelection: FileSelection = {
    get active() {
      return selecting();
    },
    isSelected,
    canSelect,
    onToggle: toggle,
  };

  createEffect(selecting, (on) => {
    if (!on) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || pendingDelete() !== null) return;
      if (step().kind === "confirm") setStep({ kind: "actions" });
      else stopSelecting();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  function activate(file: StoredFileRow, event: MouseEvent & { currentTarget: HTMLElement }): void {
    if (canSelect(file) && (selecting() || isSelectClick(event))) toggle(file, event);
    else if (!selecting()) open(file, thumbnails.get(file.id) ?? event.currentTarget);
  }

  function open(file: StoredFileRow, origin: HTMLElement | undefined): void {
    if (!isPicture(file)) {
      props.onOpen(file, origin);
      return;
    }
    const images = shown().filter(isPicture);
    setLightbox({ images, index: Math.max(0, images.indexOf(file)), origin });
  }

  function act(file: StoredFileRow, action: StoredFileAction): void {
    if (action === "delete") setPendingDelete(file);
    else void props.onAction(file, action);
  }

  function downloadImage(id: string): void {
    const file = files().find((candidate) => candidate.id === id);
    if (file) void props.onAction(file, "download");
  }

  function clearFilters(): void {
    setSearch("");
    setType("all");
  }

  const viewPressed = (name: LibraryView) => (view() === name ? "true" : "false");
  const viewButtons = () => (
    <fieldset class="library-views" aria-label={t("files.library.view")} hidden={selecting()}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("files.library.mosaic")}
        aria-pressed={viewPressed("mosaic")}
        onClick={() => setView("mosaic")}
      >
        <LayoutDashboard aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("files.library.grid")}
        aria-pressed={viewPressed("grid")}
        onClick={() => setView("grid")}
      >
        <LayoutGrid aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("files.library.list")}
        aria-pressed={viewPressed("list")}
        onClick={() => setView("list")}
      >
        <List aria-hidden="true" />
      </Button>
    </fieldset>
  );

  const selectButtons = () => (
    <Show
      when={selecting()}
      fallback={
        <Show when={selectableFilesExist()}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSelection({ ids: new Set(), anchor: null })}
          >
            {t("files.library.select")}
          </Button>
        </Show>
      }
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={selectable().length === 0 || busy()}
        onClick={toggleAll}
      >
        {allSelected() ? t("files.library.deselectAll") : t("files.library.selectAll")}
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={busy()} onClick={stopSelecting}>
        {t("common.done")}
      </Button>
    </Show>
  );

  const moveSubmenu = (file: () => StoredFileRow): JSX.Element => {
    const folders = () => {
      const agentId = file().agentId;
      return agentId ? libraryFolderTree(folderList(), agentId) : [];
    };
    const newFolderFor = () => {
      const agentId = file().agentId;
      return agentId && canCreateFolder() ? () => placeInNewFolder(agentId, [file()]) : undefined;
    };
    const offered = () =>
      canMove(file()) && (folders().length > 0 || folderOf(file()) !== undefined || canCreateFolder());
    return (
      <Show when={offered()}>
        <LibraryMoveSubmenu
          folders={folders()}
          current={folderOf(file())?.id}
          canRemove={folderOf(file()) !== undefined}
          onMove={(folder) => placeFiles([file()], folder)}
          onNewFolder={newFolderFor()}
        />
      </Show>
    );
  };
  const listRowMenu = () => (folderMode() ? (file: StoredFileRow) => moveSubmenu(() => file) : undefined);
  const listFolderLabel = () => (folderMode() ? folderLine : undefined);
  const selectionNewFolder = () => (canCreateFolder() ? moveToNewFolder : undefined);

  const pillMove = (): JSX.Element => (
    <Show when={folderMode()}>
      <DropdownMenu.Root placement="top" gutter={12}>
        <DropdownMenu.Trigger
          class={`${buttonVariants({ variant: "ghost", size: "sm" })} library-pill-button`}
          disabled={!canMoveSelection()}
        >
          <FolderInput aria-hidden="true" />
          {t("files.folder.move")}
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <LibraryMoveItems
              folders={moveFolders()}
              canRemove={selectionInFolder()}
              onMove={moveTo}
              onNewFolder={selectionNewFolder()}
            />
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </Show>
  );

  const tileDisabled = (file: StoredFileRow) =>
    selecting() ? !canSelect(file) : !isPicture(file) && file.status !== "available";
  const tileSource = (file: StoredFileRow) => folderLine(file) ?? file.conversation?.title ?? agentName(file.agentId);

  const frame = (): JSX.Element => (
    <div class="library-frame" data-pill={pillOpen() ? "" : undefined}>
      <div
        class="library-page"
        data-library-autoscroll
        data-library-here
        ref={(element) => {
          marquee.attach(element);
          pictures.attach(element);
        }}
      >
        <Show when={!folderMode()}>
          <header class="library-head">
            <h2 class="library-title">{t("files.library.title")}</h2>
            <div class="library-tools">
              {viewButtons()}
              <FileSearch
                class="library-search"
                label={t("files.library.search")}
                value={search()}
                onChange={setSearch}
              />
              {selectButtons()}
            </div>
          </header>
        </Show>
        <FileListStatus
          loading={props.loading}
          error={props.error}
          onRetry={props.onRetry}
          empty={files().length === 0 && folderList().length === 0}
        >
          <LibraryFolderTiles
            folders={tileFolders()}
            allFolders={folderList()}
            owners={place().kind === "all" ? agents() : null}
            fileCount={(folderId) => libraryCounts().folder.get(folderId) ?? 0}
            folderCount={(folderId) => childCounts().get(folderId) ?? 0}
            peek={(folderId) => peeks().get(folderId) ?? NO_FILES}
            pictureUrl={pictureUrl}
            newTarget={newTarget()}
            newMark={drag.newMark}
            dropMark={drag.dropMark}
            draggedFolder={drag.draggedFolder}
            dropOff={drag.dropOff}
            landed={drag.landed}
            renaming={renamingIn("tile")}
            isFavorite={isFavorite}
            canCreate={canCreateFolder()}
            canOrganize={organizes}
            onGo={(folder) => go({ kind: "folder", agentId: folder.agentId, folderId: folder.id })}
            onNewFolder={newFolderIn}
            onRename={(folderId) => startRename(folderId, "tile")}
            onCommitName={renameFolder}
            onCancelName={cancelName}
            onDelete={deleteFolder}
            onToggleFavorite={toggleFavorite}
          />
          <Show when={scope().length > 0}>
            <FileTypeFilters counts={typeCounts()} value={type()} onChange={setType} />
          </Show>
          <Show
            when={shown().length > 0}
            fallback={
              <Show when={tileFolders().length === 0}>
                <Show when={emptyHere()} fallback={<FileNoMatches filtered={filtered()} onClear={clearFilters} />}>
                  <div class="file-list-message">
                    <p class="file-list-message-title">{t("files.library.empty")}</p>
                  </div>
                </Show>
              </Show>
            }
          >
            <Show
              when={view() !== "list"}
              fallback={
                <FileList
                  label={listLabel()}
                  files={scope()}
                  agents={props.agents}
                  query={{ search: search(), type: type(), sort: "newest" }}
                  showConversation
                  groupByDay
                  groupHeadingLevel={3}
                  now={props.now}
                  canDelete={props.canDelete}
                  selection={listSelection}
                  pictureUrl={props.pictureUrl}
                  folderLabel={listFolderLabel()}
                  rowMenu={listRowMenu()}
                  opensFiles={props.opensFiles}
                  onPreview={(file) => open(file, undefined)}
                  onAction={props.onAction}
                />
              }
            >
              <ul class="library-grid" data-layout={view()}>
                <For each={shown()} keyed={(file) => file.id}>
                  {(file) => {
                    const id = untrack(() => file().id);
                    onCleanup(() => thumbnails.delete(id));
                    return (
                      <li
                        class="library-tile"
                        data-kind={isPicture(file()) ? "image" : "file"}
                        data-selected={isSelected(file()) ? "true" : undefined}
                        data-file-id={id}
                        data-dragging={drag.draggedFile(id)}
                      >
                        <Show
                          when={view() === "grid"}
                          fallback={
                            <Show
                              when={isPicture(file())}
                              fallback={
                                <Button
                                  type="button"
                                  variant="ghost"
                                  class="library-file-card"
                                  disabled={selecting() ? !canSelect(file()) : file().status !== "available"}
                                  aria-pressed={pressed(file())}
                                  onClick={(event) => activate(file(), event)}
                                >
                                  <span class="library-file-name">
                                    <span
                                      class="files-file-visual"
                                      data-file-tone={attachmentReferenceTone(file().name)}
                                      aria-hidden="true"
                                    >
                                      {attachmentReferenceBadge(file().name) ?? fileBadge(file())}
                                    </span>
                                    <span class="library-truncate">{file().name}</span>
                                  </span>
                                  <Show when={tileSource(file())}>
                                    <span class="library-file-source">
                                      <Show when={folderLine(file())}>
                                        <Folder aria-hidden="true" />
                                      </Show>
                                      <span class="library-truncate">{tileSource(file())}</span>
                                    </span>
                                  </Show>
                                </Button>
                              }
                            >
                              <Button
                                type="button"
                                variant="ghost"
                                class="library-picture"
                                aria-label={file().name}
                                disabled={selecting() && !canSelect(file())}
                                aria-pressed={pressed(file())}
                                ref={(element) => thumbnails.set(id, element)}
                                onClick={(event) => activate(file(), event)}
                              >
                                <img src={pictureUrl(file())} alt="" loading="lazy" draggable="false" />
                              </Button>
                            </Show>
                          }
                        >
                          <Button
                            type="button"
                            variant="ghost"
                            class="library-folder-tile-main"
                            disabled={tileDisabled(file())}
                            aria-pressed={pressed(file())}
                            onClick={(event) => activate(file(), event)}
                          >
                            <span class="library-folder-tile-thumb" ref={(element) => thumbnails.set(id, element)}>
                              <Show
                                when={isPicture(file())}
                                fallback={
                                  <span
                                    class="files-file-visual"
                                    data-file-tone={attachmentReferenceTone(file().name)}
                                    aria-hidden="true"
                                  >
                                    {attachmentReferenceBadge(file().name) ?? fileBadge(file())}
                                  </span>
                                }
                              >
                                <img src={pictureUrl(file())} alt="" loading="lazy" draggable="false" />
                              </Show>
                            </span>
                            <span class="library-folder-tile-name library-truncate">{file().name}</span>
                            <span class="library-folder-tile-source">
                              <Show when={folderLine(file())}>
                                <Folder aria-hidden="true" />
                              </Show>
                              <span class="library-truncate">{tileSource(file())}</span>
                            </span>
                          </Button>
                        </Show>
                        <Show
                          when={selecting()}
                          fallback={
                            <FileRowMenu
                              file={file()}
                              canDelete={props.canDelete === true && file().deletable}
                              opensFiles={props.opensFiles}
                              class="library-tile-menu"
                              onAction={(action) => act(file(), action)}
                            >
                              {moveSubmenu(file)}
                            </FileRowMenu>
                          }
                        >
                          <Show when={canSelect(file())}>
                            <FileSelectionMark selected={isSelected(file())} class="library-tile-mark" />
                          </Show>
                        </Show>
                      </li>
                    );
                  }}
                </For>
              </ul>
            </Show>
          </Show>
        </FileListStatus>
        <Show when={marquee.box()}>
          {(box) => (
            <div
              class="library-marquee"
              style={{
                left: `${box().left}px`,
                top: `${box().top}px`,
                width: `${box().width}px`,
                height: `${box().height}px`,
              }}
              aria-hidden="true"
            />
          )}
        </Show>
      </div>
      <LibrarySelectionPill
        open={pillOpen()}
        step={step()}
        count={selected().length}
        saveCount={savable().length}
        deleteCount={deletable().length}
        canDelete={pillCanDelete()}
        move={pillMove()}
        onSave={() => void run("save", savable())}
        onAskDelete={() => setStep({ kind: "confirm" })}
        onCancelDelete={() => setStep({ kind: "actions" })}
        onConfirmDelete={() => void run("delete", deletable())}
      />
      <FileDeleteDialog
        file={pendingDelete()}
        onClose={() => setPendingDelete(null)}
        onDelete={(file) => props.onAction(file, "delete")}
      />
      <Show when={lightbox()} keyed>
        {(opening) => (
          <ImageLightbox
            opening={opening}
            thumbnail={(image) => thumbnails.get(image.id)}
            onDownload={(image) => downloadImage(image.id)}
            macWindowControls={props.macWindowControls}
            stripLabel={t("files.library.images")}
            onClose={() => setLightbox(null)}
          />
        )}
      </Show>
    </div>
  );

  return (
    <Show when={folderMode()} fallback={frame()}>
      <div class="library-shell" ref={setShell}>
        <LibraryPathHead
          place={place()}
          title={title()}
          agent={placeAgent()}
          parents={parentFolders()}
          dropMark={drag.dropMark}
          onGo={go}
        >
          <Show when={newFolderPlace() === "here"}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("files.folder.new")}
              onClick={newFolderHere}
            >
              <FolderPlus aria-hidden="true" />
            </Button>
          </Show>
          <Show when={newFolderPlace() === "pick"}>
            <AgentPicker
              agents={organizableAgents()}
              label={t("files.folder.newForAgent")}
              triggerClass={buttonVariants({ variant: "ghost", size: "icon-sm" })}
              triggerLabel={t("files.folder.newForAgent")}
              onChange={newFolderForAgent}
            >
              <FolderPlus aria-hidden="true" />
            </AgentPicker>
          </Show>
          {viewButtons()}
          {selectButtons()}
        </LibraryPathHead>
        <LibraryFolderTree
          agents={agents()}
          activeAgents={activeAgents()}
          folders={folderList()}
          counts={libraryCounts()}
          favorites={favorites()}
          place={place()}
          search={search()}
          searchLabel={searchLabel()}
          renaming={renamingIn("side")}
          isCollapsed={isCollapsed}
          dropMark={drag.dropMark}
          draggedFolder={drag.draggedFolder}
          dropOff={drag.dropOff}
          landed={drag.landed}
          outMark={drag.outMark}
          outOff={drag.outOff}
          landedOut={drag.landedOut}
          dragAgent={drag.state.item?.agentId ?? null}
          canCreate={canCreateFolder()}
          canOrganize={organizes}
          removedFiles={removedFilesExist()}
          onSearch={setSearch}
          onGo={go}
          onOpenChange={setOpen}
          onNewFolder={(agentId, parentId) => newFolder(agentId, parentId, "side")}
          onRename={(folderId) => startRename(folderId, "side")}
          onCommitName={renameFolder}
          onCancelName={cancelName}
          onDelete={deleteFolder}
          onToggleFavorite={toggleFavorite}
        />
        {frame()}
        <Show when={drag.state.item} keyed>
          {(item) => (
            <Portal>
              <div
                class="library-drag-chip"
                data-drop={drag.state.target ? "" : undefined}
                data-blocked={drag.state.blocked ? "" : undefined}
                style={{ transform: `translate(${drag.state.x + 12}px, ${drag.state.y + 14}px)` }}
                aria-hidden="true"
              >
                <span class="library-drag-chip-line">
                  <Show when={item.kind === "folder"} fallback={<File aria-hidden="true" />}>
                    <Folder aria-hidden="true" />
                  </Show>
                  <span class="library-truncate" dir="auto">
                    {item.label}
                  </span>
                </span>
                <Show when={dropBlock()}>
                  {(text) => (
                    <span class="library-drag-chip-line library-drag-chip-why">
                      <Ban aria-hidden="true" />
                      <span>{text()}</span>
                    </span>
                  )}
                </Show>
                <Show when={dropName()}>
                  {(name) => (
                    <span class="library-drag-chip-line library-drag-chip-to">
                      <ArrowRight aria-hidden="true" class="library-drag-chip-arrow" />
                      <span class="library-truncate" dir="auto">
                        {name()}
                      </span>
                    </span>
                  )}
                </Show>
              </div>
            </Portal>
          )}
        </Show>
      </div>
    </Show>
  );
}
