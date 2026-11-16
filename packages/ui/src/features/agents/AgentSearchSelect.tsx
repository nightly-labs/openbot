import { ActiveCurrentRow, buttonVariants, Check, ChevronDown, Combobox, Popover, Search } from "@openbot/ui";
import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import { SwapLabel, type SwapMotion } from "@openbot/ui/components/SwapLabel";
import type { AgentProfile } from "@openbot/ui/data";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { ContentExitMotion } from "@openbot/ui/menu-motion";
import { useText } from "@openbot/ui/text";
import { createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";

/** What the select shows of an agent: its name and its face. */
export type AgentSearchSelectAgent = Pick<AgentProfile, "id" | "name" | "avatarSeed" | "avatarHue" | "avatarUrl">;

export const agentOf = <Agent extends AgentSearchSelectAgent>(agents: readonly Agent[], agentId: string) =>
  agents.find((agent) => agent.id === agentId);

/** The trigger motion of the header model switcher: mostly a blur, so the old and new name cross in place. */
const AGENT_SWAP: SwapMotion = {
  distance: 6,
  blur: 6,
  enter: { duration: 320, easing: "cubic-bezier(0.33, 1, 0.68, 1)" },
  leave: { duration: 180, easing: "ease" },
};

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
function matchAgents(agents: readonly AgentSearchSelectAgent[], query: string): AgentSearchSelectAgent[] {
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
    <span class="tasks-page-agent-name">
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
const agentKey = (id: string) => encodeURIComponent(id);

/**
 * True when the window has space under the trigger for the search field and three rows. The menu
 * opens down, and opens up only when it would show no row there.
 */
function roomBelow(trigger: HTMLElement | undefined): boolean {
  if (!trigger) return true;
  const row = Number.parseFloat(getComputedStyle(trigger).getPropertyValue("--openbot-control-md")) || 32;
  return window.innerHeight - trigger.getBoundingClientRect().bottom >= 5 * row;
}

/**
 * An agent picker: a menu with the agent's face and a search field. A server can have many agents:
 * typing filters the rows, the arrows move through them, and Enter takes the active row or the first
 * match. The menu marks only the chosen agent. The Tasks page and the routine calendar use it; its
 * styles are in `tasks.css`.
 */
export function AgentSearchSelect(props: {
  agents: readonly AgentSearchSelectAgent[];
  agentId: string;
  /** The name of the trigger, with the chosen agent in it. */
  label: string;
  /** Ghost in a toolbar, outline in a form. */
  variant?: "ghost" | "outline";
  class?: string;
  onChange: (agentId: string) => void;
}) {
  const { t } = useText();
  const agent = () => agentOf(props.agents, props.agentId);
  let shownId = untrack(() => props.agentId);
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
  const choose = (option: AgentSearchSelectAgent) => {
    setOpen(false);
    if (option.id !== props.agentId) props.onChange(option.id);
  };
  const toggle = (next: boolean) => {
    if (next) {
      setQuery("");
      setPlacement(roomBelow(trigger) ? "bottom-start" : "top-start");
    }
    setOpen(next);
  };
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
        class={[buttonVariants({ variant: props.variant ?? "ghost", size: "sm" }), "tasks-page-agent", props.class]}
        aria-label={props.label}
        onKeyDown={(event: KeyboardEvent) => {
          // The arrow keys open the menu, as on a select.
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          toggle(true);
        }}
      >
        {/* Keyed by agent, so the face of a newly chosen agent springs in, as the model mark does. */}
        <For each={[props.agentId]} keyed={(id) => id}>
          {(id) => {
            const entering = untrack(id) !== shownId;
            shownId = untrack(id);
            return (
              <span class="tasks-page-agent-face" data-entering={entering ? "" : undefined}>
                <AgentAvatar agent={agentOf(props.agents, id())} class="tasks-page-avatar" />
              </span>
            );
          }}
        </For>
        <SwapLabel text={agent()?.name ?? props.agentId} motion={AGENT_SWAP} />
        <ChevronDown class="tasks-page-agent-chevron" aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          ref={(element: HTMLElement) => {
            panel = element;
          }}
          class="ui-action-menu tasks-page-agent-menu"
          aria-label={t("conversation.tasks.page.agents")}
        >
          <ContentExitMotion panel={() => panel} />
          <Combobox.Root<AgentSearchSelectAgent>
            class="tasks-page-agent-picker"
            options={matches()}
            optionValue={(option) => agentKey(option.id)}
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
                class="tasks-page-agent-option"
                // The combobox has no selection, so the row says that it is the current agent.
                aria-selected={item.item.rawValue.id === props.agentId ? "true" : "false"}
              >
                <AgentAvatar agent={item.item.rawValue} class="tasks-page-avatar" />
                <MatchedAgentName name={item.item.rawValue.name} query={query()} />
                <Show when={item.item.rawValue.id === props.agentId}>
                  <Check aria-hidden="true" class="tasks-page-agent-check" />
                </Show>
              </Combobox.Item>
            )}
          >
            <Combobox.Control class="tasks-page-agent-search">
              <Search aria-hidden="true" />
              <Combobox.Input
                ref={(element: HTMLInputElement) => {
                  input = element;
                }}
                class="tasks-page-agent-search-input"
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
            <ActiveCurrentRow key={agentKey(props.agentId)} />
            <Combobox.Listbox
              ref={(element: HTMLElement) => {
                list = element;
                fades.bind(element);
                resize?.disconnect();
                resize = new ResizeObserver(keepActiveRow);
                resize.observe(element);
              }}
              class={["tasks-page-agent-list", fades.classes()]}
              style={{ "--tasks-agent-rows": String(matches().length) }}
              onScroll={fades.measure}
              aria-label={t("conversation.tasks.page.agents")}
            />
            <Show when={matches().length === 0}>
              <p class="tasks-page-agent-empty" role="status">
                {t("conversation.tasks.page.noAgent", { query: query().trim() })}
              </p>
            </Show>
          </Combobox.Root>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
