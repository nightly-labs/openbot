import type { LibraryFolder } from "@openbot/contracts/ipc";
import { Bot, Check, ChevronRight, DropdownMenu, Folder, FolderInput, FolderPlus, X } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { For, Show } from "solid-js";

interface LibraryMoveEntry {
  folder: LibraryFolder;
  depth: number;
}

interface LibraryMoveGroup {
  id: string;
  name: string;
  folders: readonly LibraryMoveEntry[];
}

interface LibraryMoveItemsProps {
  folders: readonly LibraryMoveEntry[];
  groups?: readonly LibraryMoveGroup[] | undefined;
  current?: string | undefined;
  canRemove: boolean;
  onMove: (folder: LibraryFolder | null) => void;
  onNewFolder: (() => void) | undefined;
  onNewFolderIn?: ((groupId: string) => void) | undefined;
}

function LibraryMoveFolders(props: Pick<LibraryMoveItemsProps, "folders" | "current" | "onMove">) {
  return (
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
  );
}

interface LibraryMoveGroupsProps extends Pick<LibraryMoveItemsProps, "current" | "onMove" | "onNewFolderIn"> {
  groups: readonly LibraryMoveGroup[];
}

function LibraryMoveGroups(props: LibraryMoveGroupsProps) {
  const { t } = useText();
  return (
    <For each={props.groups} keyed={(group) => group.id}>
      {(group) => (
        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger>
            <Bot aria-hidden="true" />
            <span dir="auto">{group().name}</span>
            <ChevronRight class="library-menu-end" aria-hidden="true" />
          </DropdownMenu.SubTrigger>
          <DropdownMenu.Portal>
            <DropdownMenu.SubContent class="ui-action-menu" aria-label={group().name}>
              <LibraryMoveFolders folders={group().folders} current={props.current} onMove={props.onMove} />
              <Show when={props.onNewFolderIn} keyed>
                {(onNewFolderIn) => (
                  <>
                    <Show when={group().folders.length > 0}>
                      <DropdownMenu.Separator />
                    </Show>
                    <DropdownMenu.Item onSelect={() => onNewFolderIn(group().id)}>
                      <FolderPlus aria-hidden="true" />
                      {t("files.folder.new")}
                    </DropdownMenu.Item>
                  </>
                )}
              </Show>
            </DropdownMenu.SubContent>
          </DropdownMenu.Portal>
        </DropdownMenu.Sub>
      )}
    </For>
  );
}

export function LibraryMoveItems(props: LibraryMoveItemsProps) {
  const { t } = useText();
  const listed = () => (props.groups ? props.groups.length > 0 : props.folders.length > 0);
  return (
    <>
      <Show
        when={props.groups}
        keyed
        fallback={<LibraryMoveFolders folders={props.folders} current={props.current} onMove={props.onMove} />}
      >
        {(groups) => (
          <LibraryMoveGroups
            groups={groups}
            current={props.current}
            onMove={props.onMove}
            onNewFolderIn={props.onNewFolderIn}
          />
        )}
      </Show>
      <Show when={props.canRemove}>
        <DropdownMenu.Item onSelect={() => props.onMove(null)}>
          <X aria-hidden="true" />
          {t("files.folder.remove")}
        </DropdownMenu.Item>
      </Show>
      <Show when={props.onNewFolder} keyed>
        {(onNewFolder) => (
          <>
            <Show when={listed() || props.canRemove}>
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
            groups={props.groups}
            current={props.current}
            canRemove={props.canRemove}
            onMove={props.onMove}
            onNewFolder={props.onNewFolder}
            onNewFolderIn={props.onNewFolderIn}
          />
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}
