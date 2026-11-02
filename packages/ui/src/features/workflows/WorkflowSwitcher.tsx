/**
 * The workflow switcher in the top row. It uses the menu of the app, as the server and Help menus have
 * it: the opaque sheet, full-size rows, outline icons that fill on the highlighted row, and a check
 * circle on the open workflow. The panel has the 1px edge and no drop shadow.
 *
 * One list with the step count at the end of each row, then New workflow, then the actions on the open
 * workflow. Version history opens a saved version of the canvas to look at, read-only.
 */

import { Check, ChevronRight, CopyPlus, DropdownMenu, History, Pencil, Plus, Trash2 } from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";

/** Open a workflow, or act on the open one. */
export type SwitcherAction =
  | "new"
  | "rename"
  | "duplicate"
  | "delete"
  | "live"
  | `open:${string}`
  | `version:${string}`;

export interface SwitcherWorkflow {
  id: string;
  title: string;
  steps: number;
}

export interface SwitcherVersion {
  id: string;
  /** When the version was saved. */
  label: string;
  /** Why it was saved. */
  meta: string;
}

export function WorkflowSwitcher(props: {
  workflows: readonly SwitcherWorkflow[];
  /** The id of the open workflow. */
  current: string;
  /** The saved versions of the open workflow, newest first. */
  versions: readonly SwitcherVersion[];
  /** The version that the canvas shows, or undefined for the live canvas. */
  viewing: string | undefined;
  /** A run changes the canvas, so no version opens while it runs. */
  versionsDisabled: boolean;
  /** A read-only canvas shows the list only. */
  readOnly: boolean;
  onAction: (action: SwitcherAction) => void;
}) {
  const { t } = useText();
  return (
    <DropdownMenu.Content class="wfs-menu" aria-label={t("workflow.canvas.switcher.label")}>
      <div class="ui-menu-label" aria-hidden="true">
        {t("workflow.canvas.switcher.label")}
      </div>
      <For each={props.workflows} keyed={(item) => item.id}>
        {(workflow) => (
          <DropdownMenu.Item
            aria-current={workflow().id === props.current ? "true" : undefined}
            onSelect={() => props.onAction(`open:${workflow().id}`)}
          >
            {/* The check circle of the server menu: filled on the open workflow, an empty ring on the others. */}
            <span
              class="ui-menu-check"
              data-checked={workflow().id === props.current ? "" : undefined}
              aria-hidden="true"
            >
              <Show when={workflow().id === props.current}>
                <Check />
              </Show>
            </span>
            <span class="wfs-name">{workflow().title}</span>
            <span class="ui-menu-trailing">{t("workflow.canvas.switcher.steps", { count: workflow().steps })}</span>
          </DropdownMenu.Item>
        )}
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
        {/* Rename moves the focus to the name field, so it runs after the menu closes. */}
        <DropdownMenu.Item onSelectAfterClose={() => props.onAction("rename")}>
          <Pencil class="agent-context-icon" aria-hidden="true" />
          <span>{t("workflow.canvas.switcher.rename")}</span>
        </DropdownMenu.Item>
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

/** A row of the version list, with the check circle of the workflow list on the version that shows. */
function VersionItem(props: { label: string; meta: string; checked: boolean; onSelect: () => void }) {
  return (
    <DropdownMenu.Item aria-current={props.checked ? "true" : undefined} onSelect={() => props.onSelect()}>
      <span class="ui-menu-check" data-checked={props.checked ? "" : undefined} aria-hidden="true">
        <Show when={props.checked}>
          <Check />
        </Show>
      </span>
      <span class="wfs-name">{props.label}</span>
      <span class="ui-menu-trailing">{props.meta}</span>
    </DropdownMenu.Item>
  );
}
