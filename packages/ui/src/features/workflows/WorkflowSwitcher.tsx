import { Check, ChevronRight, CopyPlus, DropdownMenu, History, Pencil, Plus, Trash2 } from "@openbot/ui";
import { For, Show } from "solid-js";
import { useText } from "../../text";

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
  label: string;
  meta: string;
}

export function WorkflowSwitcher(props: {
  workflows: readonly SwitcherWorkflow[];
  current: string;
  versions: readonly SwitcherVersion[];
  viewing: string | undefined;
  versionsDisabled: boolean;
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
