import { Check, DropdownMenu, Input, Search } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import { useText } from "../../text";

export interface PickerChip {
  icon?: () => JSX.Element;
  text: string;
}

export interface PickerOption<T extends string> {
  value: T;
  label: string;
  tile?: () => JSX.Element;
  kind?: string;
  chips?: readonly PickerChip[];
  searchText?: string;
  danger?: boolean;
  afterClose?: boolean;
}

export interface PickerGroup<T extends string> {
  label?: string;
  icon?: () => JSX.Element;
  options: readonly PickerOption<T>[];
}

export const pickerMatches = (option: PickerOption<string>, query: string) =>
  [option.label, option.searchText ?? "", ...(option.chips ?? []).map((chip) => chip.text)].some((text) =>
    text.toLowerCase().includes(query),
  );

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

export function createPickerFades() {
  const fades = createScrollFades();
  let rows: MutationObserver | undefined;
  onCleanup(() => {
    fades.stop();
    rows?.disconnect();
  });
  return {
    bind(element: HTMLElement) {
      fades.bind(element);
      rows?.disconnect();
      rows = new MutationObserver(fades.remeasure);
      rows.observe(element, { childList: true, subtree: true });
    },
    classes: fades.classes,
    measure: fades.measure,
  };
}

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
  const fades = createPickerFades();
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
                event.stopPropagation();
                if (event.key !== "ArrowDown" && event.key !== "Enter") return;
                event.preventDefault();
                const row = firstRow();
                row?.focus();
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
          fades.bind(element);
          element.addEventListener(
            "keydown",
            (event) => {
              if (!field || event.target === field) return;
              if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
              const checkRow = event.target instanceof HTMLElement && event.target.role === "menuitemcheckbox";
              if (event.key === " " && checkRow) return;
              event.stopPropagation();
              field.focus();
            },
            true,
          );
        }}
        class={["wfn-picker-list", fades.classes()]}
        onScroll={fades.measure}
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

export function PickerMenu<T extends string>(props: {
  label: string;
  groups: readonly PickerGroup<T>[];
  value: T | undefined;
  onSelect: (value: T) => void;
  search?: string | undefined;
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

export function PickerChecks<T extends string>(props: {
  label: string;
  groups: readonly PickerGroup<T>[];
  values: readonly T[];
  onChange: (values: readonly T[]) => void;
  search?: string | undefined;
}) {
  const checked = (value: T) => props.values.includes(value);
  const toggle = (value: T, on: boolean) =>
    props.onChange(on ? [...props.values, value] : props.values.filter((other) => other !== value));
  return (
    <PickerShell label={props.label} groups={props.groups} search={props.search}>
      {(group) => (
        <fieldset class="wfn-picker-group" aria-label={group.label ?? props.label}>
          <PickerHeading group={group} />
          <For each={group.options}>
            {(option) => (
              <DropdownMenu.CheckboxItem
                class="wfn-picker-row"
                checked={checked(option.value)}
                closeOnSelect={false}
                onChange={(on: boolean) => toggle(option.value, on)}
              >
                <PickerRow option={option} checked={checked(option.value)} />
              </DropdownMenu.CheckboxItem>
            )}
          </For>
        </fieldset>
      )}
    </PickerShell>
  );
}

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
