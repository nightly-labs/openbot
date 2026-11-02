/**
 * The one list style of every menu on the workflow canvas, as the Higgsfield model picker has it: an
 * optional search field, groups with a heading, and rows with an icon tile, the name, and small chips
 * with facts about the row. A choice list has a check on the chosen row; an action list does a thing.
 * Each trigger keeps its own root and puts this list in its `DropdownMenu.Portal`.
 */

import { Check, DropdownMenu, Input, Search } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, For, Show } from "solid-js";
import { useText } from "../../text";

export interface PickerChip {
  icon?: () => JSX.Element;
  text: string;
}

export interface PickerOption<T extends string> {
  value: T;
  label: string;
  /** A list that names its group elsewhere, such as the model list beside its provider rail, has no tiles. */
  tile?: () => JSX.Element;
  /** A node kind gives the tile the colour of that kind. */
  kind?: string;
  chips?: readonly PickerChip[];
  /** An action that removes something, such as Delete. */
  danger?: boolean;
  /** An action that moves the focus, such as Rename, runs after the menu closes. */
  afterClose?: boolean;
}

export interface PickerGroup<T extends string> {
  /** A list with one group has no heading. */
  label?: string;
  icon?: () => JSX.Element;
  options: readonly PickerOption<T>[];
}

/** True when the name or a chip of the option holds the query, which is lower case. */
export const pickerMatches = (option: PickerOption<string>, query: string) =>
  [option.label, ...(option.chips ?? []).map((chip) => chip.text)].some((text) => text.toLowerCase().includes(query));

/** The heading of a group. The group has its own label, so screen readers skip this one. */
export function PickerHeading(props: { group: Pick<PickerGroup<string>, "label" | "icon"> }) {
  return (
    <Show when={props.group.label}>
      <div class="wfn-picker-heading" aria-hidden="true">
        {props.group.icon?.()}
        <span>{props.group.label}</span>
      </div>
    </Show>
  );
}

/** The tile, the name and the chips of a row, and a check when the row is the choice. */
export function PickerRow(props: { option: PickerOption<string>; checked?: boolean }) {
  return (
    <>
      <Show when={props.option.tile}>
        <span class="wfn-picker-tile" data-kind={props.option.kind}>
          {props.option.tile?.()}
        </span>
      </Show>
      <span class="wfn-picker-body">
        <span class="wfn-picker-name">{props.option.label}</span>
        <Show when={props.option.chips?.length}>
          <span class="wfn-picker-chips">
            <For each={props.option.chips}>
              {(chip) => (
                <span class="wfn-picker-chip">
                  {chip.icon?.()}
                  {chip.text}
                </span>
              )}
            </For>
          </span>
        </Show>
      </span>
      <Show when={props.checked}>
        <Check class="wfn-picker-check" aria-hidden="true" />
      </Show>
    </>
  );
}

/**
 * The panel, the search field and the filter. With `search`, the field takes focus when the menu
 * opens, typing filters the rows by name and chip text, and the down arrow moves to the first row.
 * With `loading`, a line under the rows tells that more rows come.
 */
function PickerShell<T extends string>(props: {
  label: string;
  groups: readonly PickerGroup<T>[];
  search: string | undefined;
  loading?: boolean | undefined;
  children: (group: PickerGroup<T>) => JSX.Element;
}) {
  const { t } = useText();
  const [query, setQuery] = createSignal("");
  let field: HTMLInputElement | undefined;
  let list: HTMLDivElement | undefined;
  let opening = true;
  const shown = createMemo(() => {
    const text = query().trim().toLowerCase();
    if (!text) return props.groups;
    return props.groups
      .map((group) => ({ ...group, options: group.options.filter((option) => pickerMatches(option, text)) }))
      .filter((group) => group.options.length > 0);
  });
  const firstRow = () => list?.querySelector<HTMLElement>('[role^="menuitem"]:not([data-disabled])');
  return (
    <DropdownMenu.Content
      class="wfn-menu wfn-picker"
      data-wfn-portal=""
      aria-label={props.label}
      onFocusIn={(event: FocusEvent) => {
        // The menu focuses its panel once it opens. Then the chosen row scrolls into view, and the
        // search field takes the focus.
        if (!opening || event.target !== event.currentTarget) return;
        opening = false;
        list?.querySelector("[data-checked]")?.scrollIntoView({ block: "nearest" });
        field?.focus();
      }}
    >
      <Show when={props.search}>
        {(placeholder) => (
          <div class="wfn-picker-search">
            <Search aria-hidden="true" />
            <Input
              ref={(element: HTMLInputElement) => {
                field = element;
              }}
              class="wfn-picker-field"
              aria-label={placeholder()}
              placeholder={placeholder()}
              value={query()}
              onValueChange={setQuery}
              onKeyDown={(event: KeyboardEvent) => {
                if (event.key === "Escape" || event.key === "Tab") return;
                // The menu reads letters as a jump to a row; here they belong to the field.
                event.stopPropagation();
                if (event.key !== "ArrowDown" && event.key !== "Enter") return;
                event.preventDefault();
                const row = firstRow();
                row?.focus();
                // Enter takes the first match, as in the menu that a dropped connection opens.
                if (event.key === "Enter")
                  row?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
              }}
            />
          </div>
        )}
      </Show>
      <div
        ref={(element: HTMLDivElement) => {
          list = element;
          // A letter typed while a row has focus goes back to the field, so typing always searches.
          element.addEventListener(
            "keydown",
            (event) => {
              if (!field || event.target === field) return;
              if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
              event.stopPropagation();
              field.focus();
            },
            true,
          );
        }}
        class="wfn-picker-list"
      >
        <For each={shown()} fallback={<p class="wfn-picker-empty">{t("workflow.picker.noMatches")}</p>}>
          {(group) => props.children(group)}
        </For>
        <Show when={props.loading}>
          <p class="wfn-picker-empty">{t("common.loading")}</p>
        </Show>
      </div>
    </DropdownMenu.Content>
  );
}

/** A choice menu: one row is the value, and it has a check. */
export function PickerMenu<T extends string>(props: {
  label: string;
  groups: readonly PickerGroup<T>[];
  value: T | undefined;
  onSelect: (value: T) => void;
  /** The placeholder of the search field. Without it, the list has no search. */
  search?: string | undefined;
  /** More rows come, such as the labels of a repository that the host still reads. */
  loading?: boolean | undefined;
}) {
  const choose = (value: string) => {
    for (const group of props.groups) {
      const option = group.options.find((candidate) => candidate.value === value);
      if (option) return props.onSelect(option.value);
    }
  };
  return (
    <PickerShell label={props.label} groups={props.groups} search={props.search} loading={props.loading}>
      {(group) => (
        <DropdownMenu.RadioGroup
          class="wfn-picker-group"
          aria-label={group.label ?? props.label}
          value={props.value ?? ""}
          onChange={choose}
        >
          <PickerHeading group={group} />
          <For each={group.options}>
            {(option) => (
              <DropdownMenu.RadioItem class="wfn-picker-row" value={option.value} closeOnSelect>
                <PickerRow option={option} checked={option.value === props.value} />
              </DropdownMenu.RadioItem>
            )}
          </For>
        </DropdownMenu.RadioGroup>
      )}
    </PickerShell>
  );
}

/**
 * An action menu: each row does a thing. With `current`, one row is the thing on view, such as the open
 * workflow in the workflow switcher, and it has a check.
 */
export function PickerActions<T extends string>(props: {
  label: string;
  groups: readonly PickerGroup<T>[];
  onSelect: (value: T) => void;
  search?: string;
  current?: T;
}) {
  return (
    <PickerShell label={props.label} groups={props.groups} search={props.search}>
      {(group) => (
        <fieldset class="wfn-picker-group" aria-label={group.label ?? props.label}>
          <PickerHeading group={group} />
          <For each={group.options}>
            {(option) => (
              <DropdownMenu.Item
                class={option.danger ? "wfn-picker-row ui-action-menu-danger" : "wfn-picker-row"}
                data-checked={option.value === props.current ? "" : undefined}
                {...(option.afterClose
                  ? { onSelectAfterClose: () => props.onSelect(option.value) }
                  : { onSelect: () => props.onSelect(option.value) })}
              >
                <PickerRow option={option} checked={option.value === props.current} />
              </DropdownMenu.Item>
            )}
          </For>
        </fieldset>
      )}
    </PickerShell>
  );
}
