import type { LibraryFolder } from "@openbot/contracts/ipc";
import { Check, ChevronRight, DropdownMenu, Folder, FolderInput, FolderPlus, X } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { For, Show } from "solid-js";

/** A folder of an agent with its level in the tree: 0 at the top. */
interface LibraryMoveEntry {
  folder: LibraryFolder;
  depth: number;
}

interface LibraryMoveItemsProps {
  /** The folders of the agent that owns the files, parents before the folders in them. */
  folders: readonly LibraryMoveEntry[];
  /** The folder that holds the file now. It shows a check and cannot be picked. */
  current?: string | undefined;
  /** A file is in a folder, so the menu can take it out. */
  canRemove: boolean;
  /** `null` takes the files out of their folder. */
  onMove: (folder: LibraryFolder | null) => void;
  /** Makes a folder for the files. Without it, the menu offers no new folder. */
  onNewFolder: (() => void) | undefined;
}

/** The items that move files to a folder. They go in a menu of the caller. */
export function LibraryMoveItems(props: LibraryMoveItemsProps) {
  const { t } = useText();
  return (
    <>
      <For each={props.folders} keyed={(entry) => entry.folder.id}>
        {(entry) => (
          <DropdownMenu.Item
            class="library-move-item"
            style={{ "--library-depth": String(entry().depth) }}
            disabled={entry().folder.id === props.current}
            onSelect={() => props.onMove(entry().folder)}
          >
            <Folder aria-hidden="true" />
            <span dir="auto">{entry().folder.name}</span>
            <Show when={entry().folder.id === props.current}>
              <Check class="library-menu-end" aria-hidden="true" />
            </Show>
          </DropdownMenu.Item>
        )}
      </For>
      <Show when={props.canRemove}>
        <DropdownMenu.Item onSelect={() => props.onMove(null)}>
          <X aria-hidden="true" />
          {t("files.folder.remove")}
        </DropdownMenu.Item>
      </Show>
      <Show when={props.onNewFolder} keyed>
        {(onNewFolder) => (
          <>
            <Show when={props.folders.length > 0 || props.canRemove}>
              <DropdownMenu.Separator />
            </Show>
            <DropdownMenu.Item onSelect={() => onNewFolder()}>
              <FolderPlus aria-hidden="true" />
              {t("files.folder.new")}
            </DropdownMenu.Item>
          </>
        )}
      </Show>
    </>
  );
}

/** "Move to" with its folders, for the menu of one file. */
export function LibraryMoveSubmenu(props: LibraryMoveItemsProps) {
  const { t } = useText();
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger>
        <FolderInput aria-hidden="true" />
        <span>{t("files.folder.moveTo")}</span>
        <ChevronRight class="library-menu-end" aria-hidden="true" />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent class="ui-action-menu" aria-label={t("files.folder.moveTo")}>
          <LibraryMoveItems
            folders={props.folders}
            current={props.current}
            canRemove={props.canRemove}
            onMove={props.onMove}
            onNewFolder={props.onNewFolder}
          />
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}
