import { CUSTOM_PROVIDER_LIMITS } from "@openbot/contracts/ipc";
import { Check, ChevronsUpDown, DropdownMenu, Input, Search } from "@openbot/ui";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { createMenuSearch } from "../../components/createMenuSearch";
import { createScrollFades } from "../../components/createScrollFades";
import { ScrollEdgeBlur } from "../../components/ScrollEdgeBlur";
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

export function FoundModelPicker(props: {
  models: readonly DiscoveredModel[];
  listed: (id: string) => boolean;
  full: boolean;
  busy: boolean;
  open: boolean;
  mount: HTMLElement | undefined;
  onOpenChange: (open: boolean) => void;
  onToggle: (model: DiscoveredModel, checked: boolean) => void;
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
  const menu = createMenuSearch({ row: '[role="menuitemcheckbox"]:not([data-disabled])' });

  const search = (value: string) => {
    setQuery(value);
    const list = menu.list();
    if (list) list.scrollTop = 0;
    fades.remeasure();
  };
  const bindList = (element: HTMLDivElement) => {
    menu.bindList(element);
    fades.bind(element);
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
      <DropdownMenu.Portal mount={props.mount ?? document.body}>
        <DropdownMenu.Content
          class="custom-provider-found-menu"
          onOpenAutoFocus={menu.onOpenAutoFocus}
          onFocusIn={menu.onFocusIn}
        >
          <div class="ui-search-select-search custom-provider-found-search">
            <Search aria-hidden="true" />
            <Input
              ref={menu.bindField}
              class="ui-search-select-input custom-provider-found-search-input"
              aria-label={t("customProvider.discovery.search")}
              placeholder={t("customProvider.discovery.search")}
              autocomplete="off"
              spellcheck={false}
              value={query()}
              onValueChange={search}
              onKeyDown={menu.onFieldKey}
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
          <ScrollEdgeBlur fades={fades} />
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
