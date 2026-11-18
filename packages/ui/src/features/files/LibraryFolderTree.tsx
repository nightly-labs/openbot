import { LIBRARY_FOLDER_LIMITS, type LibraryFolder } from "@openbot/contracts/ipc";
import {
  Archive,
  Button,
  buttonVariants,
  ChevronDown,
  ChevronRight,
  Clock3,
  DropdownMenu,
  Ellipsis,
  Folder,
  FolderOpen,
  FolderPlus,
  GalleryVerticalEnd,
  Inbox,
  Input,
  Pencil,
  Plus,
  Search,
  Star,
  StarOff,
  Trash2,
  UsersRound,
} from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, For, Show, untrack } from "solid-js";
import { AgentAvatar } from "../agents/AgentAvatar";
import { AgentPicker } from "../agents/AgentPicker";
import type { LibraryDropMark } from "./library-folder-drag";
import {
  AGENTS_SECTION,
  ALL_FILES,
  agentKey,
  branchId,
  canHoldFolder,
  FAVORITES_SECTION,
  type LibraryLocation,
  RECENT_FILES,
  REMOVED_AGENTS,
  sameLocation,
  UNSORTED_FILES,
} from "./library-folders-view";

/** The number of files that each row of the side panel shows. */
export interface LibraryCounts {
  all: number;
  recent: number;
  unsorted: number;
  removed: number;
  /** The files of an agent. */
  agent: ReadonlyMap<string, number>;
  /** The files in a folder and in the folders in it. */
  folder: ReadonlyMap<string, number>;
}

/** A favorite that still exists: a folder, or an agent of the server. */
export type LibraryFavorite =
  | { kind: "folder"; key: string; folder: LibraryFolder }
  | { kind: "agent"; key: string; agent: AgentProfile };

/** With this many agents or fewer, the Agents section shows all of them and has no agent list. */
const AGENTS_SHOWN = 6;

interface LibraryFolderTreeProps {
  agents: readonly AgentProfile[];
  /** The agents with files or folders, the agent with the newest file first. */
  activeAgents: readonly AgentProfile[];
  folders: readonly LibraryFolder[];
  counts: LibraryCounts;
  /** The favorites that still exist, in the sequence that the viewer added them. */
  favorites: readonly LibraryFavorite[];
  /** The place that the page shows. Its row is the current one. */
  place: LibraryLocation;
  search: string;
  /** The search looks in the current place, so its field names that place. */
  searchLabel: string;
  /** The folder whose row in the side panel shows the name field. */
  renaming: string | null;
  /** The folder list under an agent (`agentKey`) or a folder (its id), or a section, does not show. */
  isCollapsed: (key: string) => boolean;
  /** How the row of an agent (`folderId` null) or of a folder shows a drop. */
  dropMark: (agentId: string, folderId: string | null) => LibraryDropMark | undefined;
  /** `""` for the folder that the pointer drags. */
  draggedFolder: (folderId: string) => "" | undefined;
  /** `""` for a row that cannot take the drag that is on: see `dropOff` of the drag. */
  dropOff: (agentId: string | undefined, folderId?: string) => "" | undefined;
  /** `""` for a short time after a drop on the row of an agent (`folderId` null) or a folder. */
  landed: (agentId: string, folderId: string | null) => "" | undefined;
  /** How "Not in a folder" shows the drag: it takes files of one agent out of their folders. */
  outMark: () => "into" | undefined;
  outOff: () => "" | undefined;
  landedOut: () => "" | undefined;
  /** The agent of the dragged files or folder. Its row shows while the drag is on. */
  dragAgent: string | null;
  /** The server can hold one more folder. Without it, no row offers a new folder. */
  canCreate: boolean;
  /** The viewer can change the folders of the agent. Without it, its rows offer no change. */
  canOrganize: (agentId: string) => boolean;
  /** Files of deleted agents exist. They get a row after the agents. */
  removedFiles: boolean;
  onSearch: (search: string) => void;
  onGo: (place: LibraryLocation) => void;
  onOpenChange: (key: string, open: boolean) => void;
  /** Makes a folder at the top level of the agent, or in the folder `parentId`. */
  onNewFolder: (agentId: string, parentId?: string) => void;
  onRename: (folderId: string) => void;
  onCommitName: (folderId: string, name: string) => void;
  onCancelName: (folderId: string) => void;
  onDelete: (folder: LibraryFolder) => void;
  /** Adds a folder id or an agent key to the favorites, or removes it. */
  onToggleFavorite: (key: string) => void;
}

/** The parts of the panel that each row uses. */
interface TreeRows {
  props: LibraryFolderTreeProps;
  children: (agentId: string, parentId: string | undefined) => readonly LibraryFolder[];
  isFavorite: (key: string) => boolean;
  current: (place: LibraryLocation) => boolean;
  /** A click on a row: the current row shows or hides its folders, another row shows its place. */
  go: (place: LibraryLocation, branch?: string) => void;
}

const NO_FOLDERS: readonly LibraryFolder[] = [];

function childrenKey(agentId: string, parentId: string | undefined): string {
  return `${agentId}\n${parentId ?? ""}`;
}

function folderPlace(folder: LibraryFolder) {
  return { kind: "folder", agentId: folder.agentId, folderId: folder.id } satisfies LibraryLocation;
}

function agentPlace(agentId: string) {
  return { kind: "agent", agentId } satisfies LibraryLocation;
}

/** The name field of a folder. Enter or a click outside saves the name; Escape keeps the name before. */
export function FolderNameField(props: {
  name: string;
  class: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const { t } = useText();
  const [name, setName] = createSignal(untrack(() => props.name));
  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    if (save) props.onCommit(name());
    else props.onCancel();
  };
  return (
    <Input
      size="sm"
      class={props.class}
      aria-label={t("files.folder.name")}
      maxlength={LIBRARY_FOLDER_LIMITS.name}
      value={name()}
      onValueChange={setName}
      // The menu that started the rename gives the focus back to its button first.
      ref={(element) =>
        requestAnimationFrame(() => {
          element.focus();
          element.select();
        })
      }
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter") finish(true);
        else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        }
      }}
    />
  );
}

/**
 * One row of the side panel. The count is at its end; the pointer or the focus shows the actions in its
 * place and the arrow that shows and hides the folders of the row.
 */
function SideRow(props: {
  depth?: number;
  icon: JSX.Element;
  label: string;
  count?: number | undefined;
  current: boolean;
  /** The key of the folders under the row. Undefined: the row has no folders under it. */
  branch?: string | undefined;
  onGo: () => void;
  onOpenChange?: ((open: boolean) => void) | undefined;
  collapsed?: boolean;
  actions?: JSX.Element | undefined;
  agentId?: string | undefined;
  folderId?: string | undefined;
  drop?: LibraryDropMark | undefined;
  /** `into`: the row takes a dragged folder only into it, not on a line beside it. */
  dropKind?: "into" | undefined;
  dragging?: "" | undefined;
  /** `""`: the row cannot take the drag that is on. */
  off?: "" | undefined;
  /** `""`: the row took a drop a moment ago. */
  landed?: "" | undefined;
  /** The row takes files out of their folders. */
  out?: boolean | undefined;
  /** The name field instead of the button. */
  editing?: JSX.Element | undefined;
}) {
  const { t } = useText();
  const branched = () => props.branch !== undefined;
  const expanded = () => (props.collapsed ? "false" : "true");
  return (
    <div
      class="library-row"
      style={{ "--library-depth": String(props.depth ?? 0) }}
      data-library-agent={props.agentId}
      data-library-folder={props.folderId}
      data-library-drop={props.dropKind}
      data-drop={props.drop}
      data-dragging={props.dragging}
      data-drop-off={props.off}
      data-landed={props.landed}
      data-library-out={props.out ? "" : undefined}
      data-count={props.count ? "" : undefined}
      data-actions={props.actions ? "" : undefined}
    >
      <Show
        when={!props.editing}
        fallback={
          <div class="library-row-edit">
            <span class="library-row-icon">{props.icon}</span>
            {props.editing}
          </div>
        }
      >
        <Button
          type="button"
          variant="ghost"
          class="library-row-main"
          aria-current={props.current ? "page" : undefined}
          onClick={() => props.onGo()}
          onKeyDown={(event) => {
            // ArrowRight shows the folders of a row and ArrowLeft hides them, as in a file tree.
            if (!branched() || (event.key !== "ArrowRight" && event.key !== "ArrowLeft")) return;
            event.preventDefault();
            props.onOpenChange?.(event.key === "ArrowRight");
          }}
        >
          <span class="library-row-icon">{props.icon}</span>
          <span class="library-truncate" dir="auto">
            {props.label}
          </span>
        </Button>
        <Show when={props.branch}>
          {(branch) => (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              class="library-row-toggle"
              aria-label={t("files.folder.listOf", { name: props.label })}
              aria-expanded={expanded()}
              aria-controls={branchId(branch())}
              onClick={() => props.onOpenChange?.(props.collapsed === true)}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          )}
        </Show>
        <Show when={props.count}>
          {(count) => (
            <span class="library-row-count" aria-hidden="true">
              {count()}
            </span>
          )}
        </Show>
        <Show when={props.actions}>
          <span class="library-row-actions">{props.actions}</span>
        </Show>
      </Show>
    </div>
  );
}

/** A section of the side panel: a name that shows and hides its rows, and an action. */
function SideSection(props: {
  rows: TreeRows;
  key: string;
  title: string;
  action?: JSX.Element | undefined;
  children: JSX.Element;
}) {
  const collapsed = () => props.rows.props.isCollapsed(props.key);
  return (
    <section class="library-section" aria-label={props.title}>
      <header class="library-section-head" data-library-spring={props.key}>
        <Button
          type="button"
          variant="ghost"
          class="library-section-toggle"
          aria-expanded={collapsed() ? "false" : "true"}
          aria-controls={branchId(props.key)}
          onClick={() => props.rows.props.onOpenChange(props.key, collapsed())}
        >
          {props.title}
          <ChevronDown class="library-section-chevron" aria-hidden="true" />
        </Button>
        {props.action}
      </header>
      <div
        class="library-collapse"
        id={branchId(props.key)}
        data-collapsed={collapsed() ? "" : undefined}
        inert={collapsed()}
      >
        <div class="library-collapse-body">{props.children}</div>
      </div>
    </section>
  );
}

/** The "+" of a row: a new folder in the agent, or in the folder `parentId`. */
function NewFolderButton(props: { rows: TreeRows; agentId: string; parentId?: string | undefined; label: string }) {
  const tree = () => props.rows.props;
  return (
    <Show when={tree().canCreate && canHoldFolder(tree().folders, props.parentId)}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        class="library-row-action"
        aria-label={props.label}
        title={props.label}
        onClick={() => tree().onNewFolder(props.agentId, props.parentId)}
      >
        <Plus aria-hidden="true" />
      </Button>
    </Show>
  );
}

/** The favorite item of the folder menus. */
export function FavoriteMenuItem(props: { favorite: boolean; onSelect: () => void }) {
  const { t } = useText();
  return (
    <DropdownMenu.Item onSelect={() => props.onSelect()}>
      <Show when={props.favorite} fallback={<Star aria-hidden="true" />}>
        <StarOff aria-hidden="true" />
      </Show>
      {props.favorite ? t("files.folder.removeFavorite") : t("files.folder.addFavorite")}
    </DropdownMenu.Item>
  );
}

/** The menu of a folder row: favorite, rename and delete. Rename and delete need the agent to be organizable. */
function FolderMenu(props: { rows: TreeRows; folder: LibraryFolder }) {
  const { t } = useText();
  const tree = () => props.rows.props;
  return (
    <DropdownMenu.Root placement="bottom-end" gutter={4}>
      <DropdownMenu.Trigger
        class={`${buttonVariants({ variant: "ghost", size: "icon-sm" })} library-row-action`}
        aria-label={t("files.action.moreActions", { name: props.folder.name })}
      >
        <Ellipsis aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content>
          <FavoriteMenuItem
            favorite={props.rows.isFavorite(props.folder.id)}
            onSelect={() => tree().onToggleFavorite(props.folder.id)}
          />
          <Show when={tree().canOrganize(props.folder.agentId)}>
            <DropdownMenu.Item onSelect={() => tree().onRename(props.folder.id)}>
              <Pencil aria-hidden="true" />
              {t("common.rename")}
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item class="ui-action-menu-danger" onSelect={() => tree().onDelete(props.folder)}>
              <Trash2 aria-hidden="true" />
              {t("files.folder.delete")}
            </DropdownMenu.Item>
          </Show>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** The folders of one parent, with a line along them, and below each folder the folders that are in it. */
function FolderBranch(props: { rows: TreeRows; agent: AgentProfile; parentId: string | undefined; depth: number }) {
  const { t } = useText();
  const tree = () => props.rows.props;
  const key = () => props.parentId ?? agentKey(props.agent.id);
  const folders = () => props.rows.children(props.agent.id, props.parentId);
  const owner = () => tree().folders.find((folder) => folder.id === props.parentId)?.name ?? props.agent.name;
  const collapsed = () => tree().isCollapsed(key());

  return (
    <Show when={folders().length > 0}>
      <div
        class="library-collapse"
        id={branchId(key())}
        data-collapsed={collapsed() ? "" : undefined}
        aria-hidden={collapsed() ? "true" : undefined}
        inert={collapsed()}
      >
        <ul
          class="library-branch"
          style={{ "--library-depth": String(props.depth) }}
          aria-label={t("files.folder.listOf", { name: owner() })}
        >
          <For each={folders()} keyed={(folder) => folder.id}>
            {(folder) => {
              const place = () => folderPlace(folder());
              const nested = () => props.rows.children(folder().agentId, folder().id).length > 0;
              const current = () => props.rows.current(place());
              /* The folder opens while it is the current place, or while a drag is on it. */
              const open = () => current() || tree().dropMark(folder().agentId, folder().id) === "into";
              return (
                <li>
                  <SideRow
                    depth={props.depth}
                    agentId={folder().agentId}
                    folderId={folder().id}
                    drop={tree().dropMark(folder().agentId, folder().id)}
                    dragging={tree().draggedFolder(folder().id)}
                    off={tree().dropOff(folder().agentId, folder().id)}
                    landed={tree().landed(folder().agentId, folder().id)}
                    icon={open() ? <FolderOpen aria-hidden="true" /> : <Folder aria-hidden="true" />}
                    label={folder().name}
                    count={tree().counts.folder.get(folder().id)}
                    current={current()}
                    branch={nested() ? folder().id : undefined}
                    collapsed={tree().isCollapsed(folder().id)}
                    onOpenChange={(open) => tree().onOpenChange(folder().id, open)}
                    onGo={() => props.rows.go(place(), nested() ? folder().id : undefined)}
                    editing={
                      tree().renaming === folder().id ? (
                        <FolderNameField
                          class="library-row-input"
                          name={folder().name}
                          onCommit={(name) => tree().onCommitName(folder().id, name)}
                          onCancel={() => tree().onCancelName(folder().id)}
                        />
                      ) : undefined
                    }
                    actions={
                      <>
                        <FolderMenu rows={props.rows} folder={folder()} />
                        <Show when={tree().canOrganize(folder().agentId)}>
                          <NewFolderButton
                            rows={props.rows}
                            agentId={folder().agentId}
                            parentId={folder().id}
                            label={t("files.folder.newInside", { name: folder().name })}
                          />
                        </Show>
                      </>
                    }
                  />
                  <FolderBranch rows={props.rows} agent={props.agent} parentId={folder().id} depth={props.depth + 1} />
                </li>
              );
            }}
          </For>
        </ul>
      </div>
    </Show>
  );
}

/** An agent row with its folders under it. */
function AgentBranch(props: { rows: TreeRows; agent: AgentProfile }) {
  const { t } = useText();
  const tree = () => props.rows.props;
  const key = () => agentKey(props.agent.id);
  const hasFolders = () => props.rows.children(props.agent.id, undefined).length > 0;
  const favorite = () => props.rows.isFavorite(key());
  return (
    <li>
      <SideRow
        agentId={props.agent.id}
        drop={tree().dropMark(props.agent.id, null)}
        off={tree().dropOff(props.agent.id)}
        landed={tree().landed(props.agent.id, null)}
        icon={<AgentAvatar agent={props.agent} class="library-row-avatar" />}
        label={props.agent.name}
        count={tree().counts.agent.get(props.agent.id)}
        current={props.rows.current(agentPlace(props.agent.id))}
        branch={hasFolders() ? key() : undefined}
        collapsed={tree().isCollapsed(key())}
        onOpenChange={(open) => tree().onOpenChange(key(), open)}
        onGo={() => props.rows.go(agentPlace(props.agent.id), hasFolders() ? key() : undefined)}
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              class="library-row-action"
              aria-label={t("files.library.favorite", { name: props.agent.name })}
              aria-pressed={favorite() ? "true" : "false"}
              onClick={() => tree().onToggleFavorite(key())}
            >
              <Star aria-hidden="true" />
            </Button>
            <Show when={tree().canOrganize(props.agent.id)}>
              <NewFolderButton
                rows={props.rows}
                agentId={props.agent.id}
                label={t("files.folder.newIn", { name: props.agent.name })}
              />
            </Show>
          </>
        }
      />
      <FolderBranch rows={props.rows} agent={props.agent} parentId={undefined} depth={1} />
    </li>
  );
}

/** A row of the Favorites section. It takes a drop into it, and has no folders under it. */
function FavoriteRow(props: { rows: TreeRows; favorite: LibraryFavorite }) {
  const tree = () => props.rows.props;
  return (
    <li>
      <Show
        when={props.favorite.kind === "folder" ? props.favorite.folder : undefined}
        fallback={
          <Show when={props.favorite.kind === "agent" ? props.favorite.agent : undefined}>
            {(agent) => (
              <SideRow
                agentId={agent().id}
                dropKind="into"
                drop={tree().dropMark(agent().id, null) === "into" ? "into" : undefined}
                off={tree().dropOff(agent().id)}
                landed={tree().landed(agent().id, null)}
                icon={<AgentAvatar agent={agent()} class="library-row-avatar" />}
                label={agent().name}
                count={tree().counts.agent.get(agent().id)}
                current={props.rows.current(agentPlace(agent().id))}
                onGo={() => tree().onGo(agentPlace(agent().id))}
              />
            )}
          </Show>
        }
      >
        {(folder) => {
          const owner = () => tree().agents.find((agent) => agent.id === folder().agentId);
          return (
            <SideRow
              agentId={folder().agentId}
              folderId={folder().id}
              dropKind="into"
              drop={tree().dropMark(folder().agentId, folder().id) === "into" ? "into" : undefined}
              off={tree().dropOff(folder().agentId, folder().id)}
              landed={tree().landed(folder().agentId, folder().id)}
              icon={<Star aria-hidden="true" class="library-row-star" />}
              label={folder().name}
              count={tree().counts.folder.get(folder().id)}
              current={props.rows.current(folderPlace(folder()))}
              onGo={() => tree().onGo(folderPlace(folder()))}
              actions={
                <Show when={owner()}>
                  {(agent) => <AgentAvatar agent={agent()} class="library-row-avatar library-row-owner" />}
                </Show>
              }
            />
          );
        }}
      </Show>
    </li>
  );
}

/**
 * The side panel of the Library: a search field; All files, Recent and the files in no folder; the
 * favorite folders and agents; the agents with their folders; and the files of deleted agents when
 * there are some. A server can have many agents: the Agents section shows the agents with the newest
 * files, and a searchable list finds the others. Rows that change folders need the viewer to be able to
 * change the folders of the agent.
 */
export function LibraryFolderTree(props: LibraryFolderTreeProps) {
  const { t } = useText();
  const byParent = createMemo(() => {
    const map = new Map<string, LibraryFolder[]>();
    for (const folder of props.folders) {
      const key = childrenKey(folder.agentId, folder.parentId);
      const list = map.get(key);
      if (list) list.push(folder);
      else map.set(key, [folder]);
    }
    return map;
  });
  const favoriteKeys = createMemo(() => new Set(props.favorites.map((favorite) => favorite.key)));
  const current = (place: LibraryLocation) => sameLocation(props.place, place);
  const rows: TreeRows = {
    props,
    children: (agentId, parentId) => byParent().get(childrenKey(agentId, parentId)) ?? NO_FOLDERS,
    isFavorite: (key) => favoriteKeys().has(key),
    current,
    go: (place, branch) => {
      if (branch !== undefined && current(place)) props.onOpenChange(branch, props.isCollapsed(branch));
      else props.onGo(place);
    },
  };

  /** Agents that the viewer picked from the list of all agents in this visit. */
  const [picked, setPicked] = createSignal<readonly string[]>([]);
  const many = () => props.agents.length > AGENTS_SHOWN;
  /**
   * The agents of the section: all of them on a small server. On a large server, the agents with the
   * newest files, the picked agents, the agent of the place, the agent of the folder being renamed and
   * the agent of a drag, so its rows can take the drop, in the sequence of the server.
   */
  const shownAgents = createMemo((): readonly AgentProfile[] => {
    if (!many()) return props.agents;
    const ids = new Set(props.activeAgents.slice(0, AGENTS_SHOWN).map((agent) => agent.id));
    for (const id of picked()) ids.add(id);
    if (props.place.kind === "agent" || props.place.kind === "folder") ids.add(props.place.agentId);
    const renamed = props.renaming && props.folders.find((folder) => folder.id === props.renaming);
    if (renamed) ids.add(renamed.agentId);
    if (props.dragAgent) ids.add(props.dragAgent);
    return props.agents.filter((agent) => ids.has(agent.id));
  });
  /** The agents with files first, so the list of all agents starts with the agents that the viewer uses. */
  const pickerAgents = createMemo(() => {
    const active = new Set(props.activeAgents.map((agent) => agent.id));
    return [...props.activeAgents, ...props.agents.filter((agent) => !active.has(agent.id))];
  });
  const organizable = createMemo(() => pickerAgents().filter((agent) => props.canOrganize(agent.id)));
  const agentCount = (agentId: string) => props.counts.agent.get(agentId) ?? 0;
  const keep = (agentId: string) => setPicked((list) => (list.includes(agentId) ? list : [...list, agentId]));

  return (
    <nav class="library-side" aria-label={t("files.library.title")}>
      <div class="library-side-search">
        <label class="library-side-field">
          <Search aria-hidden="true" />
          <Input
            type="search"
            aria-label={props.searchLabel}
            placeholder={props.searchLabel}
            value={props.search}
            onValueChange={props.onSearch}
          />
        </label>
      </div>
      <div class="library-side-scroll" data-library-autoscroll="">
        <ul class="library-side-list">
          <li>
            <SideRow
              icon={<GalleryVerticalEnd aria-hidden="true" />}
              label={t("files.library.allFiles")}
              count={props.counts.all}
              off={props.dropOff(undefined)}
              current={current(ALL_FILES)}
              onGo={() => props.onGo(ALL_FILES)}
            />
          </li>
          <li>
            <SideRow
              icon={<Clock3 aria-hidden="true" />}
              label={t("files.library.recent")}
              count={props.counts.recent}
              off={props.dropOff(undefined)}
              current={current(RECENT_FILES)}
              onGo={() => props.onGo(RECENT_FILES)}
            />
          </li>
          <li>
            <SideRow
              icon={<Inbox aria-hidden="true" />}
              label={t("files.library.unsorted")}
              count={props.counts.unsorted}
              out={true}
              drop={props.outMark()}
              off={props.outOff()}
              landed={props.landedOut()}
              current={current(UNSORTED_FILES)}
              onGo={() => props.onGo(UNSORTED_FILES)}
            />
          </li>
        </ul>
        <Show when={props.favorites.length > 0}>
          <SideSection rows={rows} key={FAVORITES_SECTION} title={t("files.library.favorites")}>
            <ul class="library-side-list">
              <For each={props.favorites} keyed={(favorite) => favorite.key}>
                {(favorite) => <FavoriteRow rows={rows} favorite={favorite()} />}
              </For>
            </ul>
          </SideSection>
        </Show>
        <Show when={props.agents.length > 0}>
          <SideSection
            rows={rows}
            key={AGENTS_SECTION}
            title={t("files.library.agents")}
            action={
              <Show when={props.canCreate && organizable().length > 0}>
                <AgentPicker
                  agents={organizable()}
                  label={t("files.folder.newForAgent")}
                  triggerClass={`${buttonVariants({ variant: "ghost", size: "icon-sm" })} library-section-action`}
                  triggerLabel={t("files.folder.newForAgent")}
                  onChange={(agentId) => {
                    keep(agentId);
                    props.onNewFolder(agentId);
                  }}
                >
                  <FolderPlus aria-hidden="true" />
                </AgentPicker>
              </Show>
            }
          >
            <ul class="library-side-list">
              <For each={shownAgents()} keyed={(agent) => agent.id}>
                {(agent) => <AgentBranch rows={rows} agent={agent()} />}
              </For>
            </ul>
            <Show when={many()}>
              <AgentPicker
                agents={pickerAgents()}
                value={props.place.kind === "agent" || props.place.kind === "folder" ? props.place.agentId : null}
                count={agentCount}
                label={t("files.library.agents")}
                triggerClass={`${buttonVariants({ variant: "ghost" })} library-side-more`}
                triggerLabel={t("files.library.allAgents", { count: props.agents.length })}
                onChange={(agentId) => {
                  keep(agentId);
                  props.onGo(agentPlace(agentId));
                }}
              >
                <UsersRound aria-hidden="true" />
                <span class="library-truncate">{t("files.library.allAgents", { count: props.agents.length })}</span>
              </AgentPicker>
            </Show>
          </SideSection>
        </Show>
        <Show when={props.removedFiles}>
          <ul class="library-side-list">
            <li>
              <SideRow
                icon={<Archive aria-hidden="true" />}
                label={t("files.library.removedAgents")}
                count={props.counts.removed}
                off={props.dropOff(undefined)}
                current={current(REMOVED_AGENTS)}
                onGo={() => props.onGo(REMOVED_AGENTS)}
              />
            </li>
          </ul>
        </Show>
      </div>
    </nav>
  );
}
