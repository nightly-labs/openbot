import type { LibraryFolder } from "@openbot/contracts/ipc";
import { Button, buttonVariants, DropdownMenu, Ellipsis, FolderPlus, Pencil, Trash2 } from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import { AgentAvatar } from "../agents/AgentAvatar";
import { fileBadge } from "../conversation/AttachmentCards";
import { attachmentReferenceBadge, attachmentReferenceTone } from "../conversation/AttachmentReference";
import { fileTypeOf, type StoredFileRow } from "./files-view";
import { FavoriteMenuItem, FolderNameField } from "./LibraryFolderTree";
import type { LibraryDropMark } from "./library-folder-drag";
import { canHoldFolder } from "./library-folders-view";

export interface LibraryNewFolderTarget {
  agentId: string;
  parentId: string | undefined;
}

interface LibraryFolderTilesProps {
  folders: readonly LibraryFolder[];
  allFolders: readonly LibraryFolder[];
  owners: readonly AgentProfile[] | null;
  fileCount: (folderId: string) => number;
  folderCount: (folderId: string) => number;
  peek: (folderId: string) => readonly StoredFileRow[];
  newTarget: LibraryNewFolderTarget | null;
  newMark: (agentId: string, parentId: string | undefined) => "into" | undefined;
  dropMark: (agentId: string, folderId: string | null) => LibraryDropMark | undefined;
  draggedFolder: (folderId: string) => "" | undefined;
  dropOff: (agentId: string, folderId: string) => "" | undefined;
  landed: (agentId: string, folderId: string) => "" | undefined;
  renaming: string | null;
  isFavorite: (key: string) => boolean;
  canCreate: boolean;
  canOrganize: (agentId: string) => boolean;
  onGo: (folder: LibraryFolder) => void;
  onNewFolder: (folder: LibraryFolder) => void;
  onRename: (folderId: string) => void;
  onCommitName: (folderId: string, name: string) => void;
  onCancelName: (folderId: string) => void;
  onDelete: (folder: LibraryFolder) => void;
  onToggleFavorite: (key: string) => void;
}

const PEEK = 3;

function PeekFile(props: { file: StoredFileRow }) {
  const picture = () => (fileTypeOf(props.file) === "images" ? props.file.previewUrl : undefined);
  return (
    <span
      class="library-folder-card-sheet"
      data-picture-id={props.file.previewKind === "image" && !props.file.previewUrl ? props.file.id : undefined}
    >
      <Show
        when={picture()}
        fallback={
          <span
            class="files-file-visual library-folder-card-badge"
            data-file-tone={attachmentReferenceTone(props.file.name)}
          >
            {attachmentReferenceBadge(props.file.name) ?? fileBadge(props.file)}
          </span>
        }
      >
        {(url) => <img src={url()} alt="" loading="lazy" draggable="false" />}
      </Show>
    </span>
  );
}

function FolderCard(props: { tiles: LibraryFolderTilesProps; folder: LibraryFolder }) {
  const { t } = useText();
  const tiles = () => props.tiles;
  const peek = () => tiles().peek(props.folder.id).slice(0, PEEK);
  const owner = () => tiles().owners?.find((agent) => agent.id === props.folder.agentId);
  const detail = () => {
    const files = tiles().fileCount(props.folder.id);
    const folders = tiles().folderCount(props.folder.id);
    const parts: string[] = [];
    if (files > 0) parts.push(t("files.count", { count: files }));
    if (folders > 0) parts.push(t("files.folder.count", { count: folders }));
    return parts.length > 0 ? parts.join(" · ") : t("files.folder.empty");
  };
  const organizes = () => tiles().canOrganize(props.folder.agentId);
  const front = (name: () => JSX.Element) => (
    <>
      <span class="library-folder-card-art" aria-hidden="true">
        <For each={peek()} keyed={(file) => file.id}>
          {(file) => <PeekFile file={file()} />}
        </For>
      </span>
      <span class="library-folder-card-front">
        <span class="library-folder-card-text">
          {name()}
          <span class="library-truncate library-folder-card-detail">{detail()}</span>
        </span>
        <Show when={owner()}>{(agent) => <AgentAvatar agent={agent()} class="library-folder-card-owner" />}</Show>
      </span>
    </>
  );
  return (
    <li
      class="library-folder-card"
      data-library-agent={props.folder.agentId}
      data-library-folder={props.folder.id}
      data-library-drop="go"
      data-drop={tiles().dropMark(props.folder.agentId, props.folder.id) === "into" ? "into" : undefined}
      data-dragging={tiles().draggedFolder(props.folder.id)}
      data-drop-off={tiles().dropOff(props.folder.agentId, props.folder.id)}
      data-landed={tiles().landed(props.folder.agentId, props.folder.id)}
    >
      <Show
        when={tiles().renaming === props.folder.id}
        fallback={
          <>
            <Button
              type="button"
              variant="ghost"
              class="library-folder-card-main"
              onClick={() => tiles().onGo(props.folder)}
            >
              {front(() => (
                <span class="library-truncate library-folder-card-name" dir="auto">
                  {props.folder.name}
                </span>
              ))}
            </Button>
            <DropdownMenu.Root placement="bottom-end" gutter={4}>
              <DropdownMenu.Trigger
                class={`${buttonVariants({ variant: "ghost", size: "icon-sm" })} library-folder-card-menu`}
                aria-label={t("files.action.moreActions", { name: props.folder.name })}
              >
                <Ellipsis aria-hidden="true" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content>
                  <FavoriteMenuItem
                    favorite={tiles().isFavorite(props.folder.id)}
                    onSelect={() => tiles().onToggleFavorite(props.folder.id)}
                  />
                  <Show when={organizes()}>
                    <Show when={tiles().canCreate && canHoldFolder(tiles().allFolders, props.folder.id)}>
                      <DropdownMenu.Item onSelect={() => tiles().onNewFolder(props.folder)}>
                        <FolderPlus aria-hidden="true" />
                        {t("files.folder.new")}
                      </DropdownMenu.Item>
                    </Show>
                    <DropdownMenu.Item onSelect={() => tiles().onRename(props.folder.id)}>
                      <Pencil aria-hidden="true" />
                      {t("common.rename")}
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item class="ui-action-menu-danger" onSelect={() => tiles().onDelete(props.folder)}>
                      <Trash2 aria-hidden="true" />
                      {t("files.folder.delete")}
                    </DropdownMenu.Item>
                  </Show>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </>
        }
      >
        <div class="library-folder-card-edit">
          {front(() => (
            <FolderNameField
              class="library-folder-card-input"
              name={props.folder.name}
              onCommit={(name) => tiles().onCommitName(props.folder.id, name)}
              onCancel={() => tiles().onCancelName(props.folder.id)}
            />
          ))}
        </div>
      </Show>
    </li>
  );
}

export function LibraryFolderTiles(props: LibraryFolderTilesProps) {
  const { t } = useText();
  return (
    <Show when={props.folders.length > 0 || props.newTarget}>
      <ul class="library-folder-cards" aria-label={t("files.library.folders")}>
        <For each={props.folders} keyed={(folder) => folder.id}>
          {(folder) => <FolderCard tiles={props} folder={folder()} />}
        </For>
        <Show when={props.newTarget}>
          {(target) => (
            <li
              class="library-folder-card library-folder-card-new"
              aria-hidden="true"
              data-library-agent={target().agentId}
              data-library-new={target().parentId ?? ""}
              data-drop={props.newMark(target().agentId, target().parentId)}
            >
              <span class="library-folder-card-edit">
                <span class="library-folder-card-art">
                  <FolderPlus class="library-folder-card-new-icon" />
                </span>
                <span class="library-folder-card-front">
                  <span class="library-truncate library-folder-card-name">{t("files.folder.new")}</span>
                </span>
              </span>
            </li>
          )}
        </Show>
      </ul>
    </Show>
  );
}
