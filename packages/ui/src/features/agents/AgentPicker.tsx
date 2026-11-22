import { ActiveCurrentRow, Check, Combobox, Popover, Search } from "@openbot/ui";
import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import type { AgentProfile } from "@openbot/ui/data";
import { ContentExitMotion } from "@openbot/ui/menu-motion";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, onCleanup, Show } from "solid-js";
import { MatchedName, matchByName } from "../../components/name-match";
import { AgentAvatar } from "./AgentAvatar";

export type AgentPickerAgent = Pick<
  AgentProfile,
  "id" | "name" | "avatarSeed" | "avatarHue" | "avatarColor" | "avatarUrl"
>;

const optionKey = (id: string) => encodeURIComponent(id);

function roomBelow(trigger: HTMLElement | undefined): boolean {
  if (!trigger) return true;
  const row = Number.parseFloat(getComputedStyle(trigger).getPropertyValue("--openbot-control-md")) || 32;
  return window.innerHeight - trigger.getBoundingClientRect().bottom >= 5 * row;
}

export interface AgentPickerProps {
  agents: readonly AgentPickerAgent[];
  value?: string | null | undefined;
  onChange: (agentId: string) => void;
  label: string;
  triggerClass: string;
  triggerLabel: string;
  count?: ((agentId: string) => number) | undefined;
  children: JSX.Element;
}

export function AgentPicker(props: AgentPickerProps) {
  const { t } = useText();
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const matches = createMemo(() => matchByName(props.agents, (agent) => agent.name, query()));
  const fades = createScrollFades();
  let resize: ResizeObserver | undefined;
  const keepActiveRow = () => {
    const id = input?.getAttribute("aria-activedescendant");
    if (id) document.getElementById(id)?.scrollIntoView({ block: "nearest" });
  };
  onCleanup(() => {
    fades.stop();
    resize?.disconnect();
  });
  const [placement, setPlacement] = createSignal<"bottom-start" | "top-start">("bottom-start");
  let trigger: HTMLElement | undefined;
  let input: HTMLInputElement | undefined;
  let panel: HTMLElement | undefined;
  let list: HTMLElement | undefined;
  const choose = (option: AgentPickerAgent) => {
    setOpen(false);
    if (option.id !== props.value) props.onChange(option.id);
  };
  const toggle = (next: boolean) => {
    if (next) {
      setQuery("");
      setPlacement(roomBelow(trigger) ? "bottom-start" : "top-start");
    }
    setOpen(next);
  };
  const countOf = (agentId: string) => props.count?.(agentId) ?? 0;
  return (
    <Popover.Root open={open()} onOpenChange={toggle} placement={placement()} gutter={4} flip={false} modal>
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
          class="ui-action-menu agent-picker-menu"
          aria-label={props.label}
        >
          <ContentExitMotion panel={() => panel} />
          <Combobox.Root<AgentPickerAgent>
            class="agent-picker"
            options={matches()}
            optionValue={(option) => optionKey(option.id)}
            optionTextValue="name"
            optionLabel="name"
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
                class="agent-picker-option"
                aria-selected={item.item.rawValue.id === props.value ? "true" : "false"}
              >
                <AgentAvatar agent={item.item.rawValue} class="agent-picker-avatar" />
                <MatchedName class="agent-picker-name" name={item.item.rawValue.name} query={query()} />
                <Show when={countOf(item.item.rawValue.id) > 0}>
                  <span class="agent-picker-count">{countOf(item.item.rawValue.id)}</span>
                </Show>
                <Show when={item.item.rawValue.id === props.value}>
                  <Check aria-hidden="true" class="agent-picker-check" />
                </Show>
              </Combobox.Item>
            )}
          >
            <Combobox.Control class="agent-picker-search">
              <Search aria-hidden="true" />
              <Combobox.Input
                ref={(element: HTMLInputElement) => {
                  input = element;
                }}
                class="agent-picker-search-input"
                aria-label={t("conversation.tasks.page.searchAgents")}
                placeholder={t("conversation.tasks.page.searchAgents")}
                autocomplete="off"
                spellcheck={false}
                onKeyDown={(event: KeyboardEvent) => {
                  if (event.key !== "Enter" || event.isComposing || !query().trim()) return;
                  if (input?.getAttribute("aria-activedescendant")) return;
                  const [first] = matches();
                  if (!first) return;
                  event.preventDefault();
                  choose(first);
                }}
              />
            </Combobox.Control>
            <Show when={props.value}>{(value) => <ActiveCurrentRow key={optionKey(value())} />}</Show>
            <Combobox.Listbox
              ref={(element: HTMLElement) => {
                list = element;
                fades.bind(element);
                resize?.disconnect();
                resize = new ResizeObserver(keepActiveRow);
                resize.observe(element);
              }}
              class={["agent-picker-list", fades.classes()]}
              style={{ "--agent-picker-rows": String(matches().length) }}
              onScroll={fades.measure}
              aria-label={props.label}
            />
            <Show when={matches().length === 0}>
              <p class="agent-picker-empty" role="status">
                {t("conversation.tasks.page.noAgent", { query: query().trim() })}
              </p>
            </Show>
          </Combobox.Root>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
