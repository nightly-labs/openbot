import { CUSTOM_PROVIDER_LIMITS } from "@openbot/contracts/ipc";
import { Check, ChevronsUpDown, DropdownMenu, Input, Search } from "@openbot/ui";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import { useText } from "../../text";
import type { DiscoveredModel } from "./custom-provider-form";

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
 * The models that an endpoint lists, in a menu with a search field, as the add menu of the agent
 * dock. The menu stays open while the user checks models, and only the model rows scroll.
 */
export function FoundModelPicker(props: {
  models: readonly DiscoveredModel[];
  /** The model is a row of the form. */
  listed: (id: string) => boolean;
  /** The form holds as many models as one endpoint can have. */
  full: boolean;
  busy: boolean;
  open: boolean;
  /** The dialog element that the menu portals into. */
  mount: HTMLElement | undefined;
  onOpenChange: (open: boolean) => void;
  onToggle: (model: DiscoveredModel, checked: boolean) => void;
  /** Adds or removes each model that the search shows. */
  onToggleAll: (models: readonly DiscoveredModel[], checked: boolean) => void;
}) {
  const { t } = useText();
  const [query, setQuery] = createSignal("");
  const matches = createMemo(() => {
    const needle = query().trim().toLowerCase();
    if (!needle) return props.models;
    return props.models.filter((model) => `${model.name ?? ""} ${model.id}`.toLowerCase().includes(needle));
  });
  const allListed = () => matches().length > 0 && matches().every((model) => props.listed(model.id));
  const fades = createScrollFades();
  onCleanup(() => fades.stop());
  let field: HTMLInputElement | undefined;
  let list: HTMLDivElement | undefined;

  const search = (value: string) => {
    setQuery(value);
    if (list) list.scrollTop = 0;
    fades.remeasure();
  };
  const onSearchKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" || event.key === "Tab") return;
    // The menu reads a letter as a jump to a row. In the field, letters are the search.
    event.stopPropagation();
    if (event.isComposing || event.key !== "ArrowDown") return;
    const row = list?.querySelector<HTMLElement>('[role="menuitemcheckbox"]:not([data-disabled])');
    if (!row) return;
    event.preventDefault();
    row.focus();
  };
  const bindList = (element: HTMLDivElement) => {
    list = element;
    fades.bind(element);
    // A letter or Backspace typed on a row goes to the field, so typing always edits the search.
    element.addEventListener(
      "keydown",
      (event) => {
        if (!field) return;
        const text = event.key !== " " && Array.from(event.key).length === 1;
        if (!text && event.key !== "Backspace") return;
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        event.stopPropagation();
        field.focus();
      },
      true,
    );
  };

  return (
    <DropdownMenu.Root
      open={props.open}
      placement="bottom-start"
      gutter={4}
      onOpenChange={(open) => {
        if (open) setQuery("");
        props.onOpenChange(open);
      }}
    >
      <DropdownMenu.Trigger class="ui-select-trigger" data-size="md" disabled={props.busy}>
        <span>{t("customProvider.discovery.choose")}</span>
        <span class="ui-select-trigger-icon">
          <ChevronsUpDown aria-hidden="true" />
        </span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal mount={props.mount}>
        <DropdownMenu.Content
          class="custom-provider-found-menu"
          onOpenAutoFocus={(event: Event) => {
            event.preventDefault();
            field?.focus();
          }}
          onFocusIn={(event: FocusEvent) => {
            // The menu takes the focus itself when the pointer leaves a row. The focus goes on to the
            // field, so typing searches and does not jump to a row.
            if (event.target === event.currentTarget) field?.focus();
          }}
        >
          <div class="ui-search-select-search custom-provider-found-search">
            <Search aria-hidden="true" />
            <Input
              ref={(element: HTMLInputElement) => {
                field = element;
              }}
              class="ui-search-select-input custom-provider-found-search-input"
              aria-label={t("customProvider.discovery.search")}
              placeholder={t("customProvider.discovery.search")}
              autocomplete="off"
              spellcheck={false}
              value={query()}
              onValueChange={search}
              onKeyDown={onSearchKey}
            />
          </div>
          <div class={["custom-provider-found-list", fades.classes()]} ref={bindList} onScroll={fades.measure}>
            <Show when={matches().length === 0}>
              <DropdownMenu.Item disabled>{t("customProvider.discovery.noMatch")}</DropdownMenu.Item>
            </Show>
            <For each={matches()}>
              {(model) => (
                <DropdownMenu.CheckboxItem
                  checked={props.listed(model.id)}
                  closeOnSelect={false}
                  disabled={props.busy || (props.full && !props.listed(model.id))}
                  onChange={(on: boolean) => props.onToggle(model, on)}
                >
                  <MenuMark on={props.listed(model.id)} />
                  <span class="custom-provider-found-id">{model.id}</span>
                </DropdownMenu.CheckboxItem>
              )}
            </For>
          </div>
          <DropdownMenu.Separator />
          <DropdownMenu.Item
            closeOnSelect={false}
            disabled={props.busy || matches().length === 0 || (props.full && !allListed())}
            onSelect={() => props.onToggleAll(matches(), !allListed())}
          >
            {allListed() ? t("customProvider.discovery.deselectAll") : t("customProvider.discovery.selectAll")}
          </DropdownMenu.Item>
          <Show when={props.full}>
            <p class="custom-provider-found-limit" role="status">
              {t("customProvider.error.modelsLimit", { max: CUSTOM_PROVIDER_LIMITS.models })}
            </p>
          </Show>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
