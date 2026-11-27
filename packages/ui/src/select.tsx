import { useComboboxContext } from "@kobalte/core/combobox";
import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import type { PopoverRootProps } from "@kobalte/core/popover";
import * as SelectPrimitive from "@kobalte/core/select";
import type { ComponentProps, JSX, ValidComponent } from "@solidjs/web";
import Check from "lucide-solid/icons/check";
import ChevronsUpDown from "lucide-solid/icons/chevrons-up-down";
import Search from "lucide-solid/icons/search";
import { children, createMemo, createSignal, createUniqueId, omit, onSettled, Show } from "solid-js";
import { Combobox, Popover } from "./complex";
import { Input } from "./form";
import { useText } from "./text";
import { createPressedPopupCue, cx } from "./utils";

export type SelectProps<Option, OptGroup = never, T extends ValidComponent = "div"> = PolymorphicProps<
  T,
  SelectPrimitive.SelectRootProps<Option, OptGroup, T>
> &
  Pick<ComponentProps<T>, "class" | "children">;

export function Select<Option, OptGroup = never, T extends ValidComponent = "div">(
  props: SelectProps<Option, OptGroup, T>,
): JSX.Element {
  const others = omit(props, "class");
  return (
    <SelectPrimitive.Root<Option, OptGroup, T>
      {...others}
      class={cx("ui-select", props.class)}
      gutter={props.gutter ?? 4}
      placement={props.placement ?? "bottom"}
      sameWidth={props.sameWidth ?? true}
    />
  );
}

export type SelectTriggerProps = PolymorphicProps<"button", SelectPrimitive.SelectTriggerProps<"button">> &
  Pick<ComponentProps<"button">, "class" | "children"> & {
    size?: "sm" | "md" | undefined;
  };

export function SelectTrigger(rawProps: SelectTriggerProps): JSX.Element {
  const others = omit(rawProps, "class", "children", "size");
  const press = createPressedPopupCue();
  return (
    <SelectPrimitive.Trigger
      class={cx("ui-select-trigger", rawProps.class)}
      data-size={rawProps.size ?? "md"}
      data-slot="select-trigger"
      data-cuelume-open={press.cue()}
      data-cuelume-emphasis="subtle"
      {...others}
      ref={[rawProps.ref, press.ref]}
    >
      {rawProps.children}
      <SelectPrimitive.Icon class="ui-select-trigger-icon">
        <ChevronsUpDown aria-hidden="true" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export type SelectValueProps<Option> = PolymorphicProps<"span", SelectPrimitive.SelectValueProps<Option, "span">> &
  Pick<ComponentProps<"span">, "class">;

export function SelectValue<Option>(props: SelectValueProps<Option>): JSX.Element {
  const others = omit(props, "class");
  return (
    <SelectPrimitive.Value<Option, "span">
      class={cx("ui-select-value", props.class)}
      data-slot="select-value"
      {...others}
    />
  );
}

export type SelectContentProps = PolymorphicProps<"div", SelectPrimitive.SelectContentProps<"div">> &
  Pick<ComponentProps<"div">, "class"> & {
    mount?: Element | undefined;
    footer?: JSX.Element;
  };

export function SelectContent(props: SelectContentProps): JSX.Element {
  const others = omit(props, "class", "mount", "footer");
  const footer = children(() => props.footer);
  let contentElement: HTMLElement | undefined;
  return (
    <SelectPrimitive.Portal mount={props.mount ?? document.body}>
      <SelectPrimitive.Content
        ref={(element) => {
          contentElement = element;
        }}
        class={cx("ui-select-content", props.class)}
        data-slot="select-content"
        {...others}
      >
        <SelectPrimitive.Listbox class="ui-select-listbox" scrollRef={() => contentElement} />
        <Show when={footer.toArray().length > 0}>
          <div class="ui-select-footer">{footer()}</div>
        </Show>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export type SelectItemProps = PolymorphicProps<"li", SelectPrimitive.SelectItemProps<"li">> &
  Pick<ComponentProps<"li">, "class" | "children">;

export function SelectItem(props: SelectItemProps): JSX.Element {
  const others = omit(props, "class", "children");
  return (
    <SelectPrimitive.Item
      class={cx("ui-select-item", props.class)}
      data-slot="select-item"
      data-cuelume-select=""
      {...others}
    >
      <SelectPrimitive.ItemLabel class="ui-select-item-label">{props.children}</SelectPrimitive.ItemLabel>
      <SelectPrimitive.ItemIndicator class="ui-select-item-indicator">
        <Check aria-hidden="true" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

export type SelectSectionProps = PolymorphicProps<"li", SelectPrimitive.SelectSectionProps<"li">> &
  Pick<ComponentProps<"li">, "class" | "children">;

export function SelectSection(props: SelectSectionProps): JSX.Element {
  const others = omit(props, "class");
  return <SelectPrimitive.Section class={cx("ui-select-section", props.class)} {...others} />;
}

const searchText = (text: string) =>
  text
    .toLowerCase()
    .replace(/[\s_/-]+/g, " ")
    .trim();

export function ActiveCurrentRow(props: { key: string }) {
  const context = useComboboxContext();
  onSettled(() => context.listState().selectionManager().setFocusedKey(props.key));
  return null;
}

export interface SearchSelectProps<Option> {
  options: Option[];
  value: Option | null;
  onChange: (option: Option) => void;
  label: (option: Option) => string;
  optionValue?: (option: Option) => string;
  optionTextValue?: (option: Option) => string;
  itemContent?: (option: Option) => JSX.Element;
  children?: JSX.Element;
  class?: string | undefined;
  disabled?: boolean | undefined;
  placement?: PopoverRootProps["placement"];
  mount?: Element | undefined;
  size?: "sm" | "md" | undefined;
  "aria-labelledby"?: string | undefined;
  "aria-label"?: string | undefined;
}

export function SearchSelect<Option>(props: SearchSelectProps<Option>): JSX.Element {
  const { t } = useText();
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const valueId = `ui-search-select-value-${createUniqueId()}`;
  let input: HTMLInputElement | undefined;
  const press = createPressedPopupCue();
  const key = (option: Option) => encodeURIComponent(props.optionValue?.(option) ?? String(option));
  const isCurrent = (option: Option) => props.value !== null && key(option) === key(props.value);
  const matches = createMemo(() => {
    const text = searchText(query());
    if (!text) return props.options;
    const read = props.optionTextValue ?? props.label;
    return props.options.filter((option) => searchText(read(option)).includes(text));
  });
  const rows = createMemo(() => matches().map((option) => ({ option })));
  const choose = (option: Option) => {
    setOpen(false);
    props.onChange(option);
  };
  const toggle = (next: boolean) => {
    if (next) setQuery("");
    setOpen(next);
  };
  return (
    <Popover.Root open={open()} onOpenChange={toggle} placement={props.placement ?? "bottom"} gutter={4} modal>
      <div class="ui-select">
        <Popover.Trigger
          class={cx("ui-select-trigger", props.class)}
          data-size={props.size ?? "md"}
          data-slot="select-trigger"
          data-cuelume-open={press.cue()}
          data-cuelume-emphasis="subtle"
          ref={press.ref}
          aria-label={props["aria-label"]}
          aria-labelledby={
            props["aria-label"]
              ? undefined
              : [props["aria-labelledby"], props.children ? undefined : valueId].filter(Boolean).join(" ") || undefined
          }
          disabled={props.disabled}
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            toggle(true);
          }}
        >
          {props.children ?? (
            <span id={valueId} class="ui-select-value" data-slot="select-value">
              {props.value === null ? "" : props.label(props.value)}
            </span>
          )}
          <span class="ui-select-trigger-icon">
            <ChevronsUpDown aria-hidden="true" />
          </span>
        </Popover.Trigger>
      </div>
      <Popover.Portal mount={props.mount ?? document.body}>
        <Popover.Content
          class="ui-select-content ui-search-select-content"
          data-slot="select-content"
          aria-label={props["aria-label"]}
          aria-labelledby={props["aria-labelledby"]}
        >
          <Combobox.Root<{ option: Option }>
            class="ui-search-select-root"
            options={rows()}
            optionValue={(row) => key(row.option)}
            optionTextValue={(row) => props.label(row.option)}
            optionLabel={(row) => props.label(row.option)}
            open={true}
            modal={false}
            triggerMode="manual"
            allowsEmptyCollection={true}
            shouldFocusWrap={true}
            defaultFilter={() => true}
            onInputChange={setQuery}
            onOpenChange={(next) => {
              if (!next) setOpen(false);
            }}
            onChange={(row) => {
              if (row !== null) choose(row.option);
            }}
            itemComponent={(item) => (
              <Combobox.Item
                item={item.item}
                class="ui-select-item"
                data-slot="select-item"
                data-cuelume-select=""
                data-checked={isCurrent(item.item.rawValue.option) ? "" : undefined}
                aria-selected={isCurrent(item.item.rawValue.option) ? "true" : "false"}
              >
                <Combobox.ItemLabel class="ui-select-item-label">
                  {(props.itemContent ?? props.label)(item.item.rawValue.option)}
                </Combobox.ItemLabel>
                <Show when={isCurrent(item.item.rawValue.option)}>
                  <span class="ui-select-item-indicator">
                    <Check aria-hidden="true" />
                  </span>
                </Show>
              </Combobox.Item>
            )}
          >
            <Combobox.Control class="ui-search-select-search">
              <Search aria-hidden="true" />
              <Combobox.Input
                as={Input}
                ref={(element: HTMLInputElement) => {
                  input = element;
                }}
                class="ui-search-select-input"
                aria-label={t("common.search")}
                placeholder={t("common.search")}
                autocomplete="off"
                autocapitalize="none"
                spellcheck={false}
                onKeyDown={(event: KeyboardEvent) => {
                  if (event.key !== "Enter" || event.isComposing || !searchText(query())) return;
                  if (input?.getAttribute("aria-activedescendant")) return;
                  const [first] = matches();
                  if (first === undefined) return;
                  event.preventDefault();
                  choose(first);
                }}
              />
            </Combobox.Control>
            {props.value !== null && <ActiveCurrentRow key={key(props.value)} />}
            <Combobox.Listbox
              class="ui-select-listbox"
              aria-label={props["aria-label"]}
              aria-labelledby={props["aria-labelledby"]}
            />
            <Show when={matches().length === 0}>
              <p class="ui-search-select-empty" role="status">
                {t("common.noMatches")}
              </p>
            </Show>
          </Combobox.Root>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
