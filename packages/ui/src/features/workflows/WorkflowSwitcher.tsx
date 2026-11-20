import type { WorkflowFolder } from "@openbot/contracts/ipc";
import {
  buttonVariants,
  Check,
  ChevronDown,
  ChevronRight,
  CopyPlus,
  DropdownMenu,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  History,
  Input,
  LayoutGrid,
  Pencil,
  PencilLine,
  Plus,
  Trash2,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import { useText } from "../../text";
import { hudBarRect } from "./WorkflowCanvasHud";

export type SwitcherAction =
  | "new"
  | "rename"
  | "duplicate"
  | "delete"
  | "live"
  | `open:${string}`
  | `version:${string}`;

export type FolderMenuAction =
  | { type: "place"; folderId: string | null }
  | { type: "new" }
  | { type: "rename"; folderId: string }
  | { type: "delete"; folderId: string };

export interface SwitcherWorkflow {
  id: string;
  title: string;
  steps: number;
}

export interface SwitcherVersion {
  id: string;
  label: string;
  meta: string;
}

export interface SwitcherFolders {
  folders: readonly WorkflowFolder[];
  placement: Readonly<Record<string, string>>;
}

function CheckMark(props: { checked: boolean }) {
  return (
    <span class="ui-menu-check" data-checked={props.checked ? "" : undefined} aria-hidden="true">
      <Show when={props.checked}>
        <Check />
      </Show>
    </span>
  );
}

function WorkflowItem(props: {
  workflow: SwitcherWorkflow;
  current: string;
  onAction: (action: SwitcherAction) => void;
}) {
  const { t } = useText();
  const current = () => props.workflow.id === props.current;
  return (
    <DropdownMenu.Item
      aria-current={current() ? "true" : undefined}
      onSelect={() => props.onAction(`open:${props.workflow.id}`)}
    >
      <CheckMark checked={current()} />
      <span class="wfs-name">{props.workflow.title}</span>
      <span class="ui-menu-trailing">{t("workflow.canvas.switcher.steps", { count: props.workflow.steps })}</span>
    </DropdownMenu.Item>
  );
}

export function WorkflowSwitcher(props: {
  workflows: readonly SwitcherWorkflow[];
  current: string;
  versions: readonly SwitcherVersion[];
  viewing: string | undefined;
  versionsDisabled: boolean;
  readOnly: boolean;
  folders: SwitcherFolders | undefined;
  onAction: (action: SwitcherAction) => void;
  onFolder: (action: FolderMenuAction) => void;
}) {
  const { t, format } = useText();
  const folderIds = () => new Set(props.folders?.folders.map((folder) => folder.id));
  const folderOf = (workflowId: string) => {
    const folderId = props.folders?.placement[workflowId];
    return folderId !== undefined && folderIds().has(folderId) ? folderId : null;
  };
  const inFolder = (folderId: string | null) =>
    props.workflows.filter((workflow) => folderOf(workflow.id) === folderId);
  const currentFolder = () => folderOf(props.current);
  return (
    <DropdownMenu.Content class="wfs-menu" aria-label={t("workflow.canvas.switcher.label")}>
      <div class="ui-menu-label" aria-hidden="true">
        {t("workflow.canvas.switcher.label")}
      </div>
      <For each={props.folders?.folders ?? []} keyed={(folder) => folder.id}>
        {(folder) => (
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger>
              <Show
                when={currentFolder() === folder().id}
                fallback={<Folder class="agent-context-icon" aria-hidden="true" />}
              >
                <FolderOpen class="agent-context-icon" aria-hidden="true" />
              </Show>
              <span class="wfs-name">{folder().name}</span>
              <span class="ui-menu-trailing">{format.number(inFolder(folder().id).length)}</span>
              <ChevronRight class="agent-context-submenu-chevron" aria-hidden="true" />
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent class="ui-action-menu wfs-menu" aria-label={folder().name}>
                <For
                  each={inFolder(folder().id)}
                  keyed={(workflow) => workflow.id}
                  fallback={
                    <div class="ui-menu-label" aria-hidden="true">
                      {t("workflow.canvas.folder.empty")}
                    </div>
                  }
                >
                  {(workflow) => (
                    <WorkflowItem workflow={workflow()} current={props.current} onAction={props.onAction} />
                  )}
                </For>
                <Show when={!props.readOnly}>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item
                    onSelectAfterClose={() => props.onFolder({ type: "rename", folderId: folder().id })}
                  >
                    <PencilLine class="agent-context-icon" aria-hidden="true" />
                    <span>{t("workflow.canvas.folder.rename")}</span>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    class="ui-action-menu-danger"
                    onSelect={() => props.onFolder({ type: "delete", folderId: folder().id })}
                  >
                    <Trash2 aria-hidden="true" />
                    <span>{t("workflow.canvas.folder.delete")}</span>
                  </DropdownMenu.Item>
                </Show>
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
        )}
      </For>
      <For each={inFolder(null)} keyed={(item) => item.id}>
        {(workflow) => <WorkflowItem workflow={workflow()} current={props.current} onAction={props.onAction} />}
      </For>
      <Show when={!props.readOnly}>
        <DropdownMenu.Item class="server-menu-add" onSelect={() => props.onAction("new")}>
          <span class="server-menu-add-circle" aria-hidden="true">
            <Plus />
          </span>
          <span>{t("workflow.canvas.switcher.new")}</span>
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
        <Show when={props.versions.length > 0}>
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger disabled={props.versionsDisabled}>
              <History class="agent-context-icon" aria-hidden="true" />
              <span>{t("workflow.canvas.switcher.versions")}</span>
              <ChevronRight class="agent-context-submenu-chevron" aria-hidden="true" />
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent
                class="ui-action-menu wfs-menu"
                aria-label={t("workflow.canvas.switcher.versions")}
              >
                <VersionItem
                  label={t("workflow.canvas.switcher.current")}
                  meta={t("workflow.canvas.switcher.live")}
                  checked={props.viewing === undefined}
                  onSelect={() => props.onAction("live")}
                />
                <DropdownMenu.Separator />
                <For each={props.versions} keyed={(item) => item.id}>
                  {(version) => (
                    <VersionItem
                      label={version().label}
                      meta={version().meta}
                      checked={props.viewing === version().id}
                      onSelect={() => props.onAction(`version:${version().id}`)}
                    />
                  )}
                </For>
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
        </Show>
        <DropdownMenu.Item onSelectAfterClose={() => props.onAction("rename")}>
          <Pencil class="agent-context-icon" aria-hidden="true" />
          <span>{t("workflow.canvas.switcher.rename")}</span>
        </DropdownMenu.Item>
        <Show when={props.folders}>
          {(folders) => (
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger>
                <FolderInput class="agent-context-icon" aria-hidden="true" />
                <span>{t("workflow.canvas.folder.move")}</span>
                <ChevronRight class="agent-context-submenu-chevron" aria-hidden="true" />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent class="ui-action-menu wfs-menu" aria-label={t("workflow.canvas.folder.move")}>
                  <For each={folders().folders} keyed={(folder) => folder.id}>
                    {(folder) => (
                      <PlaceItem
                        label={folder().name}
                        checked={currentFolder() === folder().id}
                        onSelect={() => props.onFolder({ type: "place", folderId: folder().id })}
                      />
                    )}
                  </For>
                  <PlaceItem
                    label={t("workflow.canvas.folder.none")}
                    checked={currentFolder() === null}
                    onSelect={() => props.onFolder({ type: "place", folderId: null })}
                  />
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item onSelectAfterClose={() => props.onFolder({ type: "new" })}>
                    <FolderPlus class="agent-context-icon" aria-hidden="true" />
                    <span>{t("workflow.canvas.folder.new")}</span>
                  </DropdownMenu.Item>
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
          )}
        </Show>
        <DropdownMenu.Item onSelect={() => props.onAction("duplicate")}>
          <CopyPlus class="agent-context-icon" aria-hidden="true" />
          <span>{t("workflow.canvas.switcher.duplicate")}</span>
        </DropdownMenu.Item>
        <DropdownMenu.Item class="ui-action-menu-danger" onSelect={() => props.onAction("delete")}>
          <Trash2 aria-hidden="true" />
          <span>{t("workflow.canvas.switcher.delete")}</span>
        </DropdownMenu.Item>
      </Show>
    </DropdownMenu.Content>
  );
}

function PlaceItem(props: { label: string; checked: boolean; onSelect: () => void }) {
  return (
    <DropdownMenu.Item aria-current={props.checked ? "true" : undefined} onSelect={() => props.onSelect()}>
      <Show when={props.checked} fallback={<Folder class="agent-context-icon" aria-hidden="true" />}>
        <Check class="agent-context-icon" aria-hidden="true" />
      </Show>
      <span class="wfs-name">{props.label}</span>
    </DropdownMenu.Item>
  );
}

function VersionItem(props: { label: string; meta: string; checked: boolean; onSelect: () => void }) {
  return (
    <DropdownMenu.Item aria-current={props.checked ? "true" : undefined} onSelect={() => props.onSelect()}>
      <CheckMark checked={props.checked} />
      <span class="wfs-name">{props.label}</span>
      <span class="ui-menu-trailing">{props.meta}</span>
    </DropdownMenu.Item>
  );
}

export interface CornerEdit {
  label: string;
  value: string;
}

export function WorkflowCorner(props: {
  count: number;
  edit: CornerEdit | undefined;
  menuRef: (element: HTMLButtonElement) => void;
  menu: JSX.Element;
  onEdit: (value: string) => void;
  onEndEdit: (keep: boolean) => void;
}) {
  const { t, format } = useText();
  return (
    <div class="wfn-hud wfn-hud-title wfn-corner">
      <DropdownMenu.Root placement="bottom-start" gutter={8} getAnchorRect={hudBarRect} modal={false}>
        <DropdownMenu.Trigger
          ref={props.menuRef}
          class={`${buttonVariants({ variant: "ghost", size: "sm" })} wfn-hud-button wfn-hud-switcher wfn-corner-trigger`}
          hidden={props.edit !== undefined}
        >
          <LayoutGrid class="wfn-corner-icon" aria-hidden="true" />
          <span class="wfn-hud-switcher-name">{t("workflow.canvas.switcher.all")}</span>
          <span class="wfn-corner-count">{format.number(props.count)}</span>
          <ChevronDown class="wfn-hud-chevron" aria-hidden="true" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>{props.menu}</DropdownMenu.Portal>
      </DropdownMenu.Root>
      <Show when={props.edit}>
        {(edit) => (
          <Input
            ref={(element: HTMLInputElement) => {
              queueMicrotask(() => {
                element.focus();
                element.select();
              });
            }}
            class="wfn-hud-name"
            aria-label={edit().label}
            spellcheck={false}
            value={edit().value}
            onValueChange={props.onEdit}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== "Escape") return;
              event.preventDefault();
              props.onEndEdit(event.key === "Enter");
            }}
            onBlur={() => props.onEndEdit(true)}
          />
        )}
      </Show>
    </div>
  );
}
