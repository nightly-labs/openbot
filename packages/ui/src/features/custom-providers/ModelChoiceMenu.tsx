import { Check, ChevronsUpDown, DropdownMenu } from "@openbot/ui";
import { createUniqueId, For, Show } from "solid-js";
import { useText } from "../../text";

function MenuMark(props: { on: boolean }) {
  return (
    <span class="ui-menu-check" data-checked={props.on ? "" : undefined}>
      <Show when={props.on}>
        <Check aria-hidden="true" />
      </Show>
    </span>
  );
}

/**
 * One cell of the model table that holds a set of choices, such as the efforts of a model. The field
 * shows the chosen names in one line, and its menu stays open while the user checks items.
 */
export function ModelChoiceMenu<T extends string>(props: {
  /** The accessible name of the field, as `Model 1 efforts`. */
  label: string;
  /** What the field shows when nothing is chosen. */
  empty: string;
  choices: readonly T[];
  name: (choice: T) => string;
  chosen: readonly T[];
  busy: boolean;
  /** The dialog element that the menu portals into. */
  mount: HTMLElement | undefined;
  onToggle: (choice: T, on: boolean) => void;
}) {
  const { t } = useText();
  // The label names the field, so the chosen names are its description for a screen reader.
  const valueId = createUniqueId();
  const names = () => props.choices.filter((choice) => props.chosen.includes(choice)).map(props.name);

  return (
    <DropdownMenu.Root placement="bottom-start" gutter={4}>
      <DropdownMenu.Trigger
        class="ui-select-trigger custom-provider-choice"
        data-size="md"
        aria-label={props.label}
        aria-describedby={valueId}
        disabled={props.busy}
      >
        <span id={valueId} class="custom-provider-choice-text" data-empty={names().length === 0 ? "" : undefined}>
          {names().length > 0 ? names().join(t("format.list.separator")) : props.empty}
        </span>
        <span class="ui-select-trigger-icon">
          <ChevronsUpDown aria-hidden="true" />
        </span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal mount={props.mount ?? document.body}>
        <DropdownMenu.Content>
          <For each={props.choices}>
            {(choice) => (
              <DropdownMenu.CheckboxItem
                checked={props.chosen.includes(choice)}
                closeOnSelect={false}
                onChange={(on: boolean) => props.onToggle(choice, on)}
              >
                <MenuMark on={props.chosen.includes(choice)} />
                <span>{props.name(choice)}</span>
              </DropdownMenu.CheckboxItem>
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
