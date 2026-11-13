import { LIBRARY_FOLDER_LIMITS, type LibraryFolder } from "@openbot/contracts/ipc";
import {
  Archive,
  Button,
  buttonVariants,
  ChevronRight,
  DropdownMenu,
  Ellipsis,
  Folder,
  FolderPlus,
  GalleryVerticalEnd,
  Input,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import { useText } from "@openbot/ui/text";
import { createMemo, createSignal, For, Show, untrack } from "solid-js";
import { AgentAvatar } from "../agents/AgentAvatar";
import type { LibraryDropMark } from "./library-folder-drag";
import {
  ALL_FILES,
  agentKey,
  branchId,
  canHoldFolder,
  type LibraryLocation,
  REMOVED_AGENTS,
  sameLocation,
} from "./library-folders-view";

interface LibraryFolderTreeProps {
  agents: readonly AgentProfile[];
  folders: readonly LibraryFolder[];
  /** The place that the page shows. Its row is the current one. */
  place: LibraryLocation;
  search: string;
  /** The search looks in the current place, so its field names that place. */
  searchLabel: string;
  /** The folder whose row shows the name field. */
  renaming: string | null;
  /** The folder list under an agent (`agentKey`) or a folder (its id) does not show. */
  isCollapsed: (key: string) => boolean;
  /** How the row of an agent (`folderId` null) or of a folder shows a drop. */
  dropMark: (agentId: string, folderId: string | null) => LibraryDropMark | undefined;
  /** `""` for the folder that the pointer drags. */
  draggedFolder: (folderId: string) => "" | undefined;
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
}

/** The parts of the tree that each row uses. */
interface TreeRows {
  props: LibraryFolderTreeProps;
  children: (agentId: string, parentId: string | undefined) => readonly LibraryFolder[];
}

const NO_FOLDERS: readonly LibraryFolder[] = [];

function childrenKey(agentId: string, parentId: string | undefined): string {
  return `${agentId}\n${parentId ?? ""}`;
}

function folderPlace(folder: LibraryFolder) {
  return { kind: "folder", agentId: folder.agentId, folderId: folder.id } satisfies LibraryLocation;
}

/** The name field of a folder row. Enter or a click outside saves the name; Escape keeps the name before. */
function FolderNameField(props: { name: string; onCommit: (name: string) => void; onCancel: () => void }) {
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
      class="library-row-input"
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

/** The button that shows and hides the folders of a row. */
function BranchToggle(props: { rows: TreeRows; branch: string; name: string }) {
  const { t } = useText();
  const collapsed = () => props.rows.props.isCollapsed(props.branch);
  const expanded = () => (collapsed() ? "false" : "true");
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      class="library-row-toggle"
      aria-label={t("files.folder.listOf", { name: props.name })}
      aria-expanded={expanded()}
      aria-controls={branchId(props.branch)}
      onClick={() => props.rows.props.onOpenChange(props.branch, collapsed())}
    >
      <ChevronRight aria-hidden="true" />
    </Button>
  );
}

/** The folders of one parent, and below each folder the folders that are in it. */
function FolderBranch(props: { rows: TreeRows; agent: AgentProfile; parentId: string | undefined; depth: number }) {
  const { t } = useText();
  const tree = () => props.rows.props;
  const key = () => props.parentId ?? agentKey(props.agent.id);
  const folders = () => props.rows.children(props.agent.id, props.parentId);
  const owner = () => tree().folders.find((folder) => folder.id === props.parentId)?.name ?? props.agent.name;
  const collapsed = () => tree().isCollapsed(key());
  const hidden = () => (collapsed() ? "" : undefined);
  const ariaHidden = () => (collapsed() ? "true" : undefined);
  const current = (folder: LibraryFolder) => (sameLocation(tree().place, folderPlace(folder)) ? "page" : undefined);

  /** ArrowRight shows the folders of a row and ArrowLeft hides them, as in a file tree. */
  function onRowKey(event: KeyboardEvent, branch: string): void {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    tree().onOpenChange(branch, event.key === "ArrowRight");
  }

  return (
    <Show when={folders().length > 0}>
      <div
        class="library-branch"
        id={branchId(key())}
        data-collapsed={hidden()}
        aria-hidden={ariaHidden()}
        inert={collapsed()}
      >
        <ul class="library-tree-folders" aria-label={t("files.folder.listOf", { name: owner() })}>
          <For each={folders()} keyed={(folder) => folder.id}>
            {(folder) => (
              <li>
                <div
                  class="library-row"
                  style={{ "--library-depth": String(props.depth) }}
                  data-library-agent={folder().agentId}
                  data-library-folder={folder().id}
                  data-drop={tree().dropMark(folder().agentId, folder().id)}
                  data-dragging={tree().draggedFolder(folder().id)}
                >
                  <Show
                    when={tree().renaming === folder().id}
                    fallback={
                      <>
                        <Show when={props.rows.children(folder().agentId, folder().id).length > 0}>
                          <BranchToggle rows={props.rows} branch={folder().id} name={folder().name} />
                        </Show>
                        <Button
                          type="button"
                          variant="ghost"
                          class="library-row-main"
                          aria-current={current(folder())}
                          onClick={() => tree().onGo(folderPlace(folder()))}
                          onKeyDown={(event) => onRowKey(event, folder().id)}
                        >
                          <Folder aria-hidden="true" />
                          <span class="library-truncate" dir="auto">
                            {folder().name}
                          </span>
                        </Button>
                        <Show when={tree().canOrganize(folder().agentId)}>
                          <DropdownMenu.Root placement="bottom-end" gutter={4}>
                            <DropdownMenu.Trigger
                              class={`${buttonVariants({ variant: "ghost", size: "icon-sm" })} library-row-action`}
                              aria-label={t("files.action.moreActions", { name: folder().name })}
                            >
                              <Ellipsis aria-hidden="true" />
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Portal>
                              <DropdownMenu.Content>
                                <Show when={tree().canCreate && canHoldFolder(tree().folders, folder().id)}>
                                  <DropdownMenu.Item onSelect={() => tree().onNewFolder(folder().agentId, folder().id)}>
                                    <FolderPlus aria-hidden="true" />
                                    {t("files.folder.new")}
                                  </DropdownMenu.Item>
                                </Show>
                                <DropdownMenu.Item onSelect={() => tree().onRename(folder().id)}>
                                  <Pencil aria-hidden="true" />
                                  {t("common.rename")}
                                </DropdownMenu.Item>
                                <DropdownMenu.Separator />
                                <DropdownMenu.Item
                                  class="ui-action-menu-danger"
                                  onSelect={() => tree().onDelete(folder())}
                                >
                                  <Trash2 aria-hidden="true" />
                                  {t("files.folder.delete")}
                                </DropdownMenu.Item>
                              </DropdownMenu.Content>
                            </DropdownMenu.Portal>
                          </DropdownMenu.Root>
                        </Show>
                      </>
                    }
                  >
                    <div class="library-row-edit">
                      <Folder aria-hidden="true" />
                      <FolderNameField
                        name={folder().name}
                        onCommit={(name) => tree().onCommitName(folder().id, name)}
                        onCancel={() => tree().onCancelName(folder().id)}
                      />
                    </div>
                  </Show>
                </div>
                <FolderBranch rows={props.rows} agent={props.agent} parentId={folder().id} depth={props.depth + 1} />
              </li>
            )}
          </For>
        </ul>
      </div>
    </Show>
  );
}

/**
 * The side panel of the Library: a search field, "All files", each agent with its folders, and the
 * files of deleted agents when there are some. A row shows the files of its place. An agent row makes
 * a folder; a folder row has a menu. Both need the viewer to be able to change the folders of the agent.
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
  const rows: TreeRows = {
    props,
    children: (agentId, parentId) => byParent().get(childrenKey(agentId, parentId)) ?? NO_FOLDERS,
  };
  const current = (place: LibraryLocation) => (sameLocation(props.place, place) ? "page" : undefined);

  function onAgentKey(event: KeyboardEvent, agentId: string): void {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    props.onOpenChange(agentKey(agentId), event.key === "ArrowRight");
  }

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
      <ul class="library-tree">
        <li class="library-row">
          <Button
            type="button"
            variant="ghost"
            class="library-row-main"
            aria-current={current(ALL_FILES)}
            onClick={() => props.onGo(ALL_FILES)}
          >
            <GalleryVerticalEnd aria-hidden="true" />
            <span class="library-truncate">{t("files.library.allFiles")}</span>
          </Button>
        </li>
        <For each={props.agents} keyed={(agent) => agent.id}>
          {(agent) => (
            <li>
              <div class="library-row" data-library-agent={agent().id} data-drop={props.dropMark(agent().id, null)}>
                <Show when={rows.children(agent().id, undefined).length > 0}>
                  <BranchToggle rows={rows} branch={agentKey(agent().id)} name={agent().name} />
                </Show>
                <Button
                  type="button"
                  variant="ghost"
                  class="library-row-main"
                  aria-current={current({ kind: "agent", agentId: agent().id })}
                  onClick={() => props.onGo({ kind: "agent", agentId: agent().id })}
                  onKeyDown={(event) => onAgentKey(event, agent().id)}
                >
                  <AgentAvatar agent={agent()} class="library-row-avatar" />
                  <span class="library-truncate" dir="auto">
                    {agent().name}
                  </span>
                </Button>
                <Show when={props.canCreate && props.canOrganize(agent().id)}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    class="library-row-action"
                    aria-label={t("files.folder.newIn", { name: agent().name })}
                    title={t("files.folder.new")}
                    onClick={() => props.onNewFolder(agent().id)}
                  >
                    <Plus aria-hidden="true" />
                  </Button>
                </Show>
              </div>
              <FolderBranch rows={rows} agent={agent()} parentId={undefined} depth={1} />
            </li>
          )}
        </For>
        <Show when={props.removedFiles}>
          <li class="library-row">
            <Button
              type="button"
              variant="ghost"
              class="library-row-main"
              aria-current={current(REMOVED_AGENTS)}
              onClick={() => props.onGo(REMOVED_AGENTS)}
            >
              <Archive aria-hidden="true" />
              <span class="library-truncate">{t("files.library.removedAgents")}</span>
            </Button>
          </li>
        </Show>
      </ul>
    </nav>
  );
}
