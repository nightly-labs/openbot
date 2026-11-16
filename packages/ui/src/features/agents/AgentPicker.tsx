import { ActiveCurrentRow, Check, Combobox, Popover, Search } from "@openbot/ui";
import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import type { AgentProfile } from "@openbot/ui/data";
import { ContentExitMotion } from "@openbot/ui/menu-motion";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, onCleanup, Show } from "solid-js";
import { AgentAvatar } from "./AgentAvatar";

/** What the menu shows of an agent: its name and its face. */
export type AgentPickerAgent = Pick<
  AgentProfile,
  "id" | "name" | "avatarSeed" | "avatarHue" | "avatarColor" | "avatarUrl"
>;

/** Lower case, no accents, and `_`, `/` and `-` as spaces: "cafe" finds "Café Orders". */
const foldChar = (char: string) =>
  char
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[\s_/-]/g, " ");

/**
 * The folded text, and for each of its code units the index of the character in `text` that made
 * it. Folding can change the length, so this map finds the matched part in the original name.
 * A run of spaces and separators becomes one space: "Sales - EU" is "sales eu".
 */
function foldName(text: string) {
  let folded = "";
  const source: number[] = [];
  let index = 0;
  for (const char of text) {
    const raw = foldChar(char);
    const part = raw === " " && folded.endsWith(" ") ? "" : raw;
    folded += part;
    for (let unit = 0; unit < part.length; unit++) source.push(index);
    index += char.length;
  }
  return { folded, source };
}

/** Where `query` is in `name`, and its rank: 0 at the start, 1 at the start of a word, 2 in a word. */
function findMatch(name: string, query: string): { at: number; rank: number } | undefined {
  if (name.startsWith(query)) return { at: 0, rank: 0 };
  const first = name.indexOf(query);
  for (let at = first; at > 0; at = name.indexOf(query, at + 1)) {
    if (name[at - 1] === " ") return { at, rank: 1 };
  }
  return first < 0 ? undefined : { at: first, rank: 2 };
}

/** Names that start with the query, or have a word that does, come before names that only contain it. */
function matchAgents(agents: readonly AgentPickerAgent[], query: string): AgentPickerAgent[] {
  const text = foldName(query.trim()).folded;
  if (!text) return [...agents];
  return agents
    .flatMap((agent) => {
      const match = findMatch(foldName(agent.name).folded, text);
      return match ? [{ agent, rank: match.rank }] : [];
    })
    .sort((a, b) => a.rank - b.rank)
    .map((row) => row.agent);
}

/** The agent name with the matched part in bold, so the eye finds why a row is in the list. */
function MatchedAgentName(props: { name: string; query: string }) {
  const parts = createMemo(() => {
    const text = foldName(props.query.trim()).folded;
    const name = foldName(props.name);
    const match = text ? findMatch(name.folded, text) : undefined;
    if (!match) return { before: props.name, match: "", after: "" };
    const start = name.source[match.at] ?? 0;
    const end = name.source[match.at + text.length] ?? props.name.length;
    return {
      before: props.name.slice(0, start),
      match: props.name.slice(start, end),
      after: props.name.slice(end),
    };
  });
  return (
    <span class="agent-picker-name">
      {parts().before}
      <Show when={parts().match}>
        <b>{parts().match}</b>
      </Show>
      {parts().after}
    </span>
  );
}

/**
 * Kobalte finds a row with an unescaped `[data-key="…"]` selector, to scroll it into view and to
 * name the active row. A key with `"`, `\` or U+0000 matches no row, so the key is encoded.
 */
const optionKey = (id: string) => encodeURIComponent(id);

/**
 * True when the window has space under the trigger for the search field and three rows. The menu
 * opens down, and opens up only when it would show no row there.
 */
function roomBelow(trigger: HTMLElement | undefined): boolean {
  if (!trigger) return true;
  const row = Number.parseFloat(getComputedStyle(trigger).getPropertyValue("--openbot-control-md")) || 32;
  return window.innerHeight - trigger.getBoundingClientRect().bottom >= 5 * row;
}

export interface AgentPickerProps {
  agents: readonly AgentPickerAgent[];
  /** The agent that the menu marks as the current one. A pick of that agent changes nothing. */
  value?: string | null | undefined;
  onChange: (agentId: string) => void;
  /** The name of the menu and of its list. */
  label: string;
  triggerClass: string;
  /** The name of the trigger. Its content can be only an icon. */
  triggerLabel: string;
  /** A number at the end of each row, such as the files of the agent. Zero shows nothing. */
  count?: ((agentId: string) => number) | undefined;
  /** The content of the trigger. */
  children: JSX.Element;
}

/**
 * A button that opens a menu of agents with a search field. A server can have many agents: typing
 * filters the rows, the arrows move through them, and Enter takes the active row or the first match.
 * The arrow keys on the trigger open the menu, as on a select.
 */
export function AgentPicker(props: AgentPickerProps) {
  const { t } = useText();
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const matches = createMemo(() => matchAgents(props.agents, query()));
  const fades = createScrollFades();
  // Kobalte scrolls the current row into view before the list has its final height. So when the
  // list resizes, the active row comes back into view.
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
    <Popover.Root
      open={open()}
      onOpenChange={toggle}
      placement={placement()}
      gutter={4}
      // The list shrinks to the space next to the trigger, so it does not flip when a search adds rows.
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
              // A new search starts at the best match.
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
                // The combobox has no selection, so the row says that it is the current agent.
                aria-selected={item.item.rawValue.id === props.value ? "true" : "false"}
              >
                <AgentAvatar agent={item.item.rawValue} class="agent-picker-avatar" />
                <MatchedAgentName name={item.item.rawValue.name} query={query()} />
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
                  // After typing, no row is active: then Enter takes the first match.
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
