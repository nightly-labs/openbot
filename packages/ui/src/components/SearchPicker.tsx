import { ActiveCurrentRow, Check, Combobox, Popover, Search } from "@openbot/ui";
import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import { ContentExitMotion } from "@openbot/ui/menu-motion";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, onCleanup, Show } from "solid-js";
import { cx } from "../utils";
import { MatchedName, matchByName } from "./name-match";

type PickerSide = "bottom" | "top";
type PickerAlign = "start" | "end";

function roomBelow(trigger: HTMLElement | undefined): boolean {
  if (!trigger) return true;
  const row = Number.parseFloat(getComputedStyle(trigger).getPropertyValue("--openbot-control-md")) || 32;
  return window.innerHeight - trigger.getBoundingClientRect().bottom >= 5 * row;
}

export interface SearchPickerProps<Option> {
  options: readonly Option[];
  optionKey: (option: Option) => string;
  optionName: (option: Option) => string;
  value?: string | null | undefined;
  onChange: (option: Option) => void;
  label: string;
  searchLabel: string;
  emptyText: (query: string) => string;
  leading: (option: Option) => JSX.Element;
  trailing?: ((option: Option) => JSX.Element) | undefined;
  align?: PickerAlign | undefined;
  menuClass?: string | undefined;
  triggerClass: string;
  triggerLabel: string;
  children: JSX.Element;
}

export function SearchPicker<Option>(props: SearchPickerProps<Option>) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [side, setSide] = createSignal<PickerSide>("bottom");
  const matches = createMemo(() => matchByName(props.options, props.optionName, query()));
  const encodedKey = (key: string) => encodeURIComponent(key);
  const isCurrent = (option: Option) => props.optionKey(option) === props.value;
  const fades = createScrollFades();
  let resize: ResizeObserver | undefined;
  let trigger: HTMLElement | undefined;
  let input: HTMLInputElement | undefined;
  let panel: HTMLElement | undefined;
  let list: HTMLElement | undefined;
  const keepActiveRow = () => {
    const id = input?.getAttribute("aria-activedescendant");
    if (id) document.getElementById(id)?.scrollIntoView({ block: "nearest" });
  };
  onCleanup(() => {
    fades.stop();
    resize?.disconnect();
  });
  const choose = (option: Option) => {
    setOpen(false);
    if (!isCurrent(option)) props.onChange(option);
  };
  const toggle = (next: boolean) => {
    if (next) {
      setQuery("");
      setSide(roomBelow(trigger) ? "bottom" : "top");
    }
    setOpen(next);
  };
  return (
    <Popover.Root
      open={open()}
      onOpenChange={toggle}
      placement={`${side()}-${props.align ?? "start"}`}
      gutter={4}
      flip={false}
      modal
    >
      <Popover.Trigger
        ref={(element: HTMLElement) => {
          trigger = element;
        }}
        class={props.triggerClass}
        aria-label={props.triggerLabel}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          toggle(true);
        }}
      >
        {props.children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          ref={(element: HTMLElement) => {
            panel = element;
          }}
          class={cx("ui-action-menu search-picker-menu", props.menuClass)}
          aria-label={props.label}
        >
          <ContentExitMotion panel={() => panel} />
          <Combobox.Root<Option>
            class="search-picker"
            options={matches()}
            optionValue={(option) => encodedKey(props.optionKey(option))}
            optionTextValue={props.optionName}
            optionLabel={props.optionName}
            open={true}
            modal={false}
            triggerMode="manual"
            allowsEmptyCollection={true}
            shouldFocusWrap={true}
            defaultFilter={() => true}
            onInputChange={(value) => {
              setQuery(value);
              if (list) list.scrollTop = 0;
            }}
            onOpenChange={(next) => {
              if (!next) setOpen(false);
            }}
            onChange={(option) => {
              if (option) choose(option);
            }}
            itemComponent={(item) => (
              <Combobox.Item
                item={item.item}
                class="search-picker-option"
                aria-selected={isCurrent(item.item.rawValue) ? "true" : "false"}
              >
                {props.leading(item.item.rawValue)}
                <MatchedName class="search-picker-name" name={props.optionName(item.item.rawValue)} query={query()} />
                {props.trailing?.(item.item.rawValue)}
                <Show when={isCurrent(item.item.rawValue)}>
                  <Check aria-hidden="true" class="search-picker-check" />
                </Show>
              </Combobox.Item>
            )}
          >
            <Combobox.Control class="search-picker-search">
              <Search aria-hidden="true" />
              <Combobox.Input
                ref={(element: HTMLInputElement) => {
                  input = element;
                }}
                class="search-picker-search-input"
                aria-label={props.searchLabel}
                placeholder={props.searchLabel}
                autocomplete="off"
                spellcheck={false}
                onKeyDown={(event: KeyboardEvent) => {
                  if (event.key !== "Enter" || event.isComposing || !query().trim()) return;
                  if (input?.getAttribute("aria-activedescendant")) return;
                  const [first] = matches();
                  if (first === undefined) return;
                  event.preventDefault();
                  choose(first);
                }}
              />
            </Combobox.Control>
            <Show when={props.value}>{(value) => <ActiveCurrentRow key={encodedKey(value())} />}</Show>
            <Combobox.Listbox
              ref={(element: HTMLElement) => {
                list = element;
                fades.bind(element);
                resize?.disconnect();
                resize = new ResizeObserver(keepActiveRow);
                resize.observe(element);
              }}
              class={["search-picker-list", fades.classes()]}
              style={{ "--search-picker-rows": String(matches().length) }}
              onScroll={fades.measure}
              aria-label={props.label}
            />
            <Show when={matches().length === 0}>
              <p class="search-picker-empty" role="status">
                {props.emptyText(query().trim())}
              </p>
            </Show>
          </Combobox.Root>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
