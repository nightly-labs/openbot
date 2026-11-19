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

export function ModelChoiceMenu<T extends string>(props: {
  label: string;
  empty: string;
  none?: string;
  noneChosen?: boolean;
  onNone?: (on: boolean) => void;
  choices: readonly T[];
  name: (choice: T) => string;
  chosen: readonly T[];
  busy: boolean;
  mount: HTMLElement | undefined;
  onToggle: (choice: T, on: boolean) => void;
}) {
  const { t } = useText();
  const valueId = createUniqueId();
  const names = () => props.choices.filter((choice) => props.chosen.includes(choice)).map(props.name);
  const text = () => {
    if (names().length > 0) return names().join(t("format.list.separator"));
    return props.noneChosen && props.none !== undefined ? props.none : props.empty;
  };
  const unset = () => names().length === 0 && !props.noneChosen;

  return (
    <DropdownMenu.Root placement="bottom-start" gutter={4}>
      <DropdownMenu.Trigger
        class="ui-select-trigger custom-provider-choice"
        data-size="md"
        aria-label={props.label}
        aria-describedby={valueId}
        disabled={props.busy}
      >
        <span id={valueId} class="custom-provider-choice-text" data-empty={unset() ? "" : undefined}>
          {text()}
        </span>
        <span class="ui-select-trigger-icon">
          <ChevronsUpDown aria-hidden="true" />
        </span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal mount={props.mount ?? document.body}>
        <DropdownMenu.Content>
          <Show when={props.none}>
            {(none) => (
              <>
                <DropdownMenu.CheckboxItem
                  checked={props.noneChosen === true}
                  closeOnSelect={false}
                  onChange={(on: boolean) => props.onNone?.(on)}
                >
                  <MenuMark on={props.noneChosen === true} />
                  <span>{none()}</span>
                </DropdownMenu.CheckboxItem>
                <DropdownMenu.Separator />
              </>
            )}
          </Show>
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
