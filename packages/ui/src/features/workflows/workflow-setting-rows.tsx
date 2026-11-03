/**
 * The settings of a trigger or an output card, one full-width row each: a name, a value and an arrow.
 * The whole row opens its menu, so the target is the width of the card. The type or target is the first
 * row, and the settings of that type follow it, so a card keeps its layout when the type changes.
 */

import { Bot, ChevronDown, DropdownMenu, Hash, Input } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { For, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { type PickerGroup, PickerHeading, PickerMenu, PickerRow } from "./WorkflowPicker";
import { useBoard, type WfnFieldValue } from "./workflow-board";
import { type Choice, placeKey, useField, usePlace } from "./workflow-node-parts";

/** The settings of a card, on the field colour. */
export function SettingRows(props: { head: JSX.Element; children?: JSX.Element }) {
  return (
    <div class="wfn-settings">
      <div class="wfn-settings-head">{props.head}</div>
      {props.children}
    </div>
  );
}

/** A setting with one value. With groups, the menu shows a heading for each. */
export function SettingRow<T extends string>(props: {
  name: string;
  value: T;
  choices: readonly Choice<T>[];
  groups?: readonly { label: string; choices: readonly Choice<T>[] }[] | undefined;
  placeholder?: string | undefined;
  /** The placeholder of a search field, for a long list. */
  search?: string | undefined;
  /** More choices come, such as the people of a repository that the host still reads. */
  loading?: boolean | undefined;
  disabled?: boolean | undefined;
  onChange: (value: T) => void;
}) {
  const { t } = useText();
  const current = () => props.choices.find((choice) => choice.value === props.value);
  const shown = () => current()?.label ?? props.placeholder ?? props.value;
  const option = (choice: Choice<T>) => ({ value: choice.value, label: choice.label, tile: choice.icon });
  const groups = (): readonly PickerGroup<T>[] =>
    props.groups?.map((group) => ({ label: group.label, options: group.choices.map(option) })) ?? [
      { options: props.choices.map(option) },
    ];
  return (
    <DropdownMenu.Root placement="bottom-start" gutter={6} sameWidth>
      <DropdownMenu.Trigger
        class="wfn-row"
        aria-label={t("workflow.node.choice", { name: props.name, value: shown() })}
        disabled={props.disabled}
      >
        <span class="wfn-row-name">{props.name}</span>
        <span class="wfn-row-value" data-empty={current() ? undefined : ""}>
          {current()?.icon()}
          <span class="wfn-row-text">{shown()}</span>
        </span>
        <ChevronDown class="wfn-row-arrow" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <PickerMenu
          label={props.name}
          groups={groups()}
          value={props.value}
          search={props.search}
          loading={props.loading}
          onSelect={props.onChange}
        />
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * A setting with many values, such as labels. The menu stays open, and each row in it turns one value
 * on or off. With `agent`, the agent can choose the values; the list is then what it chooses from.
 */
export function SettingListRow(props: {
  name: string;
  /** The value text when the list is empty. */
  empty: string;
  options: readonly string[];
  values: readonly string[];
  /** The name of an option in the menu, and its text as a tag. Both are the option itself when absent. */
  optionLabel?: ((value: string) => string) | undefined;
  tagLabel?: ((value: string) => string) | undefined;
  /** The colour of an option, such as the colour of a GitHub label. */
  tone?: ((value: string) => string | undefined) | undefined;
  /** More options come, such as the labels of a repository that the host still reads. */
  loading?: boolean | undefined;
  disabled?: boolean | undefined;
  onChange: (values: readonly string[]) => void;
  agent?: { on: boolean; onChange: (on: boolean) => void } | undefined;
}) {
  const { t } = useText();
  const byAgent = () => props.agent?.on === true;
  const agentText = () =>
    props.values.length > 0
      ? t("workflow.row.agentPicksFrom", { count: props.values.length })
      : t("workflow.row.agentChooses");
  const tag = (value: string) => props.tagLabel?.(value) ?? value;
  const shown = () => {
    if (byAgent()) return agentText();
    return props.values.length > 0 ? props.values.map(tag).join(", ") : props.empty;
  };
  const listHeading = () => (byAgent() ? { label: t("workflow.row.agentCanChoose") } : {});
  const toggle = (value: string, on: boolean) =>
    props.onChange(on ? [...props.values, value] : props.values.filter((other) => other !== value));
  const toneStyle = (value: string) => {
    const tone = props.tone?.(value);
    return tone ? { "--wfn-tone": tone } : undefined;
  };
  const optionTile = (value: string) =>
    props.tone?.(value) ? { tile: () => <span class="wfn-dot" style={toneStyle(value)} /> } : {};
  return (
    <DropdownMenu.Root placement="bottom-start" gutter={6} sameWidth>
      <DropdownMenu.Trigger
        class="wfn-row"
        aria-label={t("workflow.node.choice", { name: props.name, value: shown() })}
        disabled={props.disabled}
      >
        <span class="wfn-row-name">{props.name}</span>
        <Show
          when={!byAgent()}
          fallback={
            <span class="wfn-row-value">
              <Bot aria-hidden="true" />
              <span class="wfn-row-text">{agentText()}</span>
            </span>
          }
        >
          <Show
            when={props.values.length > 0}
            fallback={
              <span class="wfn-row-value" data-empty="">
                {props.empty}
              </span>
            }
          >
            <span class="wfn-row-value">
              <For each={props.values}>
                {(value) => (
                  <span class="wfn-tag" data-tone={props.tone?.(value) ? "" : undefined} style={toneStyle(value)}>
                    {tag(value)}
                  </span>
                )}
              </For>
            </span>
          </Show>
        </Show>
        <ChevronDown class="wfn-row-arrow" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="wfn-menu wfn-picker" data-wfn-portal="" aria-label={props.name}>
          <div class="wfn-picker-list">
            <Show when={props.agent}>
              {(agent) => (
                <fieldset class="wfn-picker-group" aria-label={t("workflow.row.whoChooses")}>
                  <DropdownMenu.CheckboxItem
                    class="wfn-picker-row"
                    checked={agent().on}
                    closeOnSelect={false}
                    onChange={(on: boolean) => agent().onChange(on)}
                  >
                    <PickerRow
                      option={{
                        value: "agent",
                        label: t("workflow.row.agentChooses"),
                        tile: () => <Bot aria-hidden="true" />,
                      }}
                      checked={agent().on}
                    />
                  </DropdownMenu.CheckboxItem>
                </fieldset>
              )}
            </Show>
            <fieldset class="wfn-picker-group" aria-label={props.name}>
              <PickerHeading group={listHeading()} />
              <For each={props.options}>
                {(option) => (
                  <DropdownMenu.CheckboxItem
                    class="wfn-picker-row"
                    checked={props.values.includes(option)}
                    closeOnSelect={false}
                    onChange={(on: boolean) => toggle(option, on)}
                  >
                    <PickerRow
                      option={{ value: option, label: props.optionLabel?.(option) ?? option, ...optionTile(option) }}
                      checked={props.values.includes(option)}
                    />
                  </DropdownMenu.CheckboxItem>
                )}
              </For>
            </fieldset>
            <Show when={props.loading}>
              <p class="wfn-picker-empty">{t("common.loading")}</p>
            </Show>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** A setting that the user types, such as a path. */
export function InputRow(props: {
  name: string;
  value: string;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <div class="wfn-row" data-static="" data-input="">
      <span class="wfn-row-name">{props.name}</span>
      <Input
        class="wfn-input wfn-row-input"
        aria-label={props.name}
        placeholder={props.placeholder}
        readonly={props.disabled}
        value={props.value}
        onValueChange={props.onChange}
      />
    </div>
  );
}

/** A row that only shows a value. */
export function StaticRow(props: { name: string; empty?: boolean; children: JSX.Element }) {
  return (
    <div class="wfn-row" data-static="">
      <span class="wfn-row-name">{props.name}</span>
      <span class="wfn-row-value" data-empty={props.empty ? "" : undefined}>
        {props.children}
      </span>
    </div>
  );
}

/** The end of the settings, under a hairline, such as the next run of a schedule. */
export function SettingsFoot(props: { children: JSX.Element }) {
  return <div class="wfn-settings-foot">{props.children}</div>;
}

/** The channel of a message trigger or of an output, with the places of the catalog. */
export function PlaceRow(props: {
  id: string;
  connectionId?: string | undefined;
  placeId?: string | undefined;
  disabled: boolean;
}) {
  const board = useBoard();
  const { t } = useText();
  const place = usePlace(
    () => props.id,
    untrack(() => ({ connectionId: props.connectionId, placeId: props.placeId })),
  );
  const choices = () =>
    board.catalogs().places.map((entry) => ({
      value: placeKey(entry.connectionId, entry.placeId),
      label: entry.label,
      icon: () => <Hash aria-hidden="true" />,
    }));
  const choose = (key: string) => {
    const entry = board
      .catalogs()
      .places.find((candidate) => placeKey(candidate.connectionId, candidate.placeId) === key);
    if (entry) place.set(entry);
  };
  return (
    <SettingRow
      name={t("workflow.node.place.channel")}
      value={placeKey(place.connectionId(), place.placeId())}
      choices={choices()}
      placeholder={t("workflow.node.place.choose")}
      disabled={props.disabled}
      onChange={choose}
    />
  );
}

const asList = (value: WfnFieldValue) => (typeof value === "string" ? value : undefined);

/** A list of strings on the board, one per line, so undo and copy keep it. */
export function useListField(
  id: () => string,
  key: string,
  initial: readonly string[],
): [() => string[], (values: readonly string[]) => void] {
  const [value, setValue] = useField<string>(id, key, initial.join("\n"), asList);
  return [() => value().split("\n").filter(Boolean), (values) => setValue(values.join("\n"))];
}
