import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { assignedSkillCount } from "@openbot/contracts/ipc";
import { Button, Checkbox, Dialog, IconButton, Input, Plus, Search, Text, X } from "@openbot/ui";
import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createSignal, createStore, createUniqueId, For, onCleanup, onSettled, Show, untrack } from "solid-js";
import { SkillMark } from "./MarketplaceParts";
import type { MarketplaceAgent, MarketplaceModel, MarketplaceSkillRef } from "./marketplace-model";
import { agentsWith, matches, useSkillWords } from "./marketplace-skill-state";

/** The skill that the dialog acts on. A skill made on this computer has no mark. */
export type DialogSkill = MarketplaceSkillRef & { iconUrl?: string | null | undefined };

/** A drag over the rows of a check box list, as in a file list. */
interface DragCheck {
  /** The rows from the first row of the drag to the row under the pointer. */
  from: number;
  to: number;
  /** The state the first row changes to. Each row in the range gets it. */
  on: boolean;
  /** The state of each row before the drag, so a row that leaves the range gets it back. */
  before: ReadonlyMap<string, boolean>;
  pointerId: number;
  y: number;
}

/** Near this distance from the top or the bottom edge, a drag scrolls the list. */
const DRAG_EDGE = 32;

/**
 * Press on a row and drag: each row from that row to the pointer gets the new state of the first
 * one. Shift+click sets the rows from the last click to this one. Near the top or the bottom edge,
 * the list scrolls. Touch keeps its scroll; the keyboard keeps one check box at a time.
 */
function createDragCheck(props: {
  shown: () => readonly MarketplaceAgent[];
  checked: (agentId: string) => boolean;
  set: (agents: readonly MarketplaceAgent[], on: boolean) => void;
}) {
  let list: HTMLUListElement | undefined;
  let anchor: number | undefined;
  let drag: DragCheck | undefined;
  let frame = 0;
  let swallowClick = false;
  const [dragging, setDragging] = createSignal(false);
  onCleanup(() => cancelAnimationFrame(frame));

  const rowAt = (y: number) => {
    if (!list) return undefined;
    const rect = list.getBoundingClientRect();
    const inside = Math.min(Math.max(y, rect.top + 1), rect.bottom - 1);
    const row = document.elementFromPoint(rect.left + rect.width / 2, inside)?.closest("li");
    if (!row || row.parentElement !== list) return undefined;
    return [...list.children].indexOf(row);
  };
  const paint = (state: DragCheck) => {
    const low = Math.min(state.from, state.to);
    const high = Math.max(state.from, state.to);
    const on: MarketplaceAgent[] = [];
    const off: MarketplaceAgent[] = [];
    props.shown().forEach((agent, index) => {
      const value = index >= low && index <= high ? state.on : state.before.get(agent.id) === true;
      if (value !== props.checked(agent.id)) (value ? on : off).push(agent);
    });
    if (on.length > 0) props.set(on, true);
    if (off.length > 0) props.set(off, false);
  };
  const follow = (state: DragCheck) => {
    const index = rowAt(state.y);
    if (index === undefined || index === state.to) return;
    state.to = index;
    paint(state);
  };
  const scroll = () => {
    frame = 0;
    if (!drag || !list) return;
    const rect = list.getBoundingClientRect();
    const above = rect.top + DRAG_EDGE - drag.y;
    const below = drag.y - (rect.bottom - DRAG_EDGE);
    const step = above > 0 ? -above : Math.max(below, 0);
    if (step === 0) return;
    list.scrollTop += step / 2;
    follow(drag);
    frame = requestAnimationFrame(scroll);
  };
  const end = () => {
    drag = undefined;
    setDragging(false);
    cancelAnimationFrame(frame);
    frame = 0;
    // The click of this press comes after pointerup, in the same task.
    setTimeout(() => {
      swallowClick = false;
    });
  };

  return {
    dragging,
    attach: (element: HTMLUListElement) => {
      list = element;
      // The press already set the row. The click of the label must not change it back.
      element.addEventListener(
        "click",
        (event) => {
          if (!swallowClick) return;
          event.preventDefault();
          swallowClick = false;
        },
        true,
      );
    },
    start: (event: PointerEvent) => {
      if (event.button !== 0 || event.pointerType === "touch" || !list) return;
      const index = rowAt(event.clientY);
      const agent = index === undefined ? undefined : props.shown()[index];
      if (index === undefined || !agent) return;
      event.preventDefault();
      swallowClick = true;
      drag = {
        from: event.shiftKey && anchor !== undefined ? anchor : index,
        to: index,
        on: !props.checked(agent.id),
        before: new Map(props.shown().map((one) => [one.id, props.checked(one.id)])),
        pointerId: event.pointerId,
        y: event.clientY,
      };
      if (!event.shiftKey) anchor = index;
      list.setPointerCapture(event.pointerId);
      setDragging(true);
      paint(drag);
      list.children[index]?.querySelector("input")?.focus({ preventScroll: true });
    },
    move: (event: PointerEvent) => {
      if (drag?.pointerId !== event.pointerId) return;
      drag.y = event.clientY;
      follow(drag);
      if (frame === 0) frame = requestAnimationFrame(scroll);
    },
    end,
  };
}

/** One agent in a picker row: avatar, name, and a short note at the end. */
function PickerAgent(props: { agent: MarketplaceAgent; note: string | undefined }) {
  return (
    <>
      <span class="marketplace-avatar" data-size="xs">
        <AgentAvatar agent={props.agent} motion="idle" />
      </span>
      <span class="marketplace-skill-picker-name">{props.agent.name}</span>
      <Show when={props.note}>
        {(note) => (
          <Text as="span" variant="caption" tone="muted">
            {note()}
          </Text>
        )}
      </Show>
    </>
  );
}

/**
 * The agents with a search field and a check box each: a long list must not be a long menu. "All"
 * checks each agent that the search shows. A row that cannot change has its check box off.
 */
function AgentSearchList(props: {
  agents: readonly MarketplaceAgent[];
  label: string;
  checked: (agentId: string) => boolean;
  /** Changes the rows. An agent that cannot change is not in the list. */
  set: (agents: readonly MarketplaceAgent[], on: boolean) => void;
  blocked: (agent: MarketplaceAgent) => boolean;
  note: (agent: MarketplaceAgent) => string | undefined;
}) {
  const { t } = useText();
  const [search, setSearch] = createSignal("");
  const id = `marketplace-skill-picker-${createUniqueId()}`;
  const shown = () => props.agents.filter((agent) => matches(search(), `${agent.name} ${agent.title ?? ""}`));
  const open = () => shown().filter((agent) => !props.blocked(agent));
  const allOn = () => open().length > 0 && open().every((agent) => props.checked(agent.id));
  const checkedCount = () => props.agents.filter((agent) => props.checked(agent.id)).length;
  const allLabel = () =>
    search().trim()
      ? t("marketplace.skills.dialog.allMatches", { count: shown().length })
      : t("marketplace.skills.dialog.all", { count: props.agents.length });
  const set = (agents: readonly MarketplaceAgent[], on: boolean) =>
    props.set(
      agents.filter((agent) => !props.blocked(agent)),
      on,
    );
  const drag = createDragCheck({ shown, checked: (agentId) => props.checked(agentId), set });
  const dragState = () => (drag.dragging() ? "" : undefined);
  const fades = createScrollFades();
  onCleanup(() => fades.stop());
  return (
    <div class="marketplace-skill-picker">
      <label class="search-field marketplace-skill-picker-search">
        <Search aria-hidden="true" />
        <Input
          type="search"
          aria-label={t("marketplace.skills.agents.search")}
          placeholder={t("marketplace.skills.dialog.search", { count: props.agents.length })}
          value={search()}
          onInput={(event) => {
            setSearch(event.currentTarget.value);
            fades.remeasure();
          }}
        />
      </label>
      <Show when={shown().length > 1}>
        <label class="marketplace-skill-picker-row marketplace-skill-picker-all" for={`${id}-all`}>
          <Checkbox
            id={`${id}-all`}
            checked={allOn()}
            disabled={open().length === 0}
            onChange={(event) => set(shown(), event.currentTarget.checked)}
          />
          <span class="marketplace-skill-picker-name">{allLabel()}</span>
          <Text as="span" variant="caption" tone="muted">
            {t("marketplace.skills.dialog.checked", { checked: checkedCount(), total: props.agents.length })}
          </Text>
        </label>
      </Show>
      <Show
        when={shown().length > 0}
        fallback={
          <Text as="p" variant="body-sm" tone="muted" class="marketplace-skill-picker-none">
            {t("marketplace.skills.agents.noMatch", { query: search().trim() })}
          </Text>
        }
      >
        <ul
          class={["marketplace-skill-picker-list", fades.classes()]}
          aria-label={props.label}
          data-dragging={dragState()}
          ref={(element) => {
            fades.bind(element);
            drag.attach(element);
          }}
          onScroll={fades.measure}
          onPointerDown={drag.start}
          onPointerMove={drag.move}
          onPointerUp={drag.end}
          onPointerCancel={drag.end}
        >
          <For each={shown()} keyed={(agent) => agent.id}>
            {(agent) => (
              <li>
                <label class="marketplace-skill-picker-row" for={`${id}-${agent().id}`}>
                  <Checkbox
                    id={`${id}-${agent().id}`}
                    checked={props.checked(agent().id)}
                    disabled={props.blocked(agent())}
                    onChange={(event) => set([agent()], event.currentTarget.checked)}
                  />
                  <PickerAgent agent={agent()} note={props.note(agent())} />
                </label>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

/**
 * Chooses the agents of one skill in a dialog, with a search. Changes wait for the button, which
 * says what it does: "Add to 12 agents", "Remove from Chief", "Save: add 3, remove 1".
 */
export function AgentsDialog(props: { model: MarketplaceModel; skill: DialogSkill; onClose: () => void }) {
  const { t } = useText();
  const words = useSkillWords(() => props.model);
  const skillId = untrack(() => props.skill.id);
  /* Only the user's choices. An agent with no choice follows its read, which can load after the dialog opens. */
  const [draft, setDraft] = createStore<{ on: Record<string, boolean> }>({ on: {} });
  const agents = () => props.model.agents();
  const installed = (agentId: string) => props.model.installedSkill(agentId, skillId);
  const has = (agentId: string) => installed(agentId) !== undefined;
  const checked = (agentId: string) => draft.on[agentId] ?? has(agentId);
  /** The agent has its most skills. Without the list of each agent's skills, no agent counts as full. */
  const full = (agentId: string) => {
    const skills = props.model.installedSkills?.(agentId);
    return skills !== undefined && assignedSkillCount(skills) >= INPUT_LIMITS.agentSkills;
  };
  /* An agent whose list did not load may have the skill already, changed by the user: leave it alone. */
  const known = (agentId: string) => props.model.skillRead(agentId) === "loaded";
  const blocked = (agent: MarketplaceAgent) => !has(agent.id) && (!known(agent.id) || full(agent.id));
  const note = (agent: MarketplaceAgent) => {
    const skill = installed(agent.id);
    if (skill) return words.plainState(skill);
    if (!known(agent.id))
      return props.model.skillRead(agent.id) === "failed" ? t("marketplace.skills.dialog.unread") : t("skill.loading");
    return full(agent.id) ? t("marketplace.skills.dialog.full") : undefined;
  };
  const adds = () => agents().filter((agent) => draft.on[agent.id] === true && !has(agent.id));
  const removes = () => agents().filter((agent) => draft.on[agent.id] === false && has(agent.id));
  const action = () => {
    const added = adds();
    const removed = removes();
    if (added.length > 0 && removed.length > 0)
      return t("marketplace.skills.dialog.saveBoth", { added: added.length, removed: removed.length });
    if (added.length > 0) return t("marketplace.skills.dialog.addTo", { agents: words.agentNames(added) });
    if (removed.length > 0) return t("marketplace.skills.dialog.removeFrom", { agents: words.agentNames(removed) });
    return t("marketplace.skills.dialog.save");
  };
  const unchanged = () => adds().length === 0 && removes().length === 0;
  const mark = () => ({ iconUrl: props.skill.iconUrl ?? null });
  const save = () => {
    void props.model.changeSkill(
      { id: skillId, name: props.skill.name },
      { add: adds().map((agent) => agent.id), remove: removes().map((agent) => agent.id) },
    );
    props.onClose();
  };
  // The answers can be older than the dialog, so it reads each agent that has no fresh answer.
  onSettled(() => props.model.readSkills());
  let content: HTMLElement | undefined;
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="integration-dialog-backdrop" data-nested="" />
        <Dialog.Content
          class="integration-wizard integration-wizard-dialog marketplace-skill-agents-dialog"
          data-nested=""
          as="section"
          ref={(element) => {
            content = element;
          }}
          // The dialog opens on the agent search, not on Close.
          onOpenAutoFocus={(event) => {
            const search = content?.querySelector<HTMLElement>("input[type=search]");
            if (!search) return;
            event.preventDefault();
            search.focus({ preventScroll: true });
          }}
        >
          <header class="marketplace-skill-dialog-head">
            <SkillMark skill={mark()} size="row" />
            <Dialog.Title as="h2" class="ui-heading" data-size="md" data-tone="primary">
              {props.skill.name}
            </Dialog.Title>
            <IconButton label={t("common.close")} variant="ghost" data-cuelume-tap="close" onClick={props.onClose}>
              <X />
            </IconButton>
          </header>
          <form
            class="integration-wizard-form"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <div class="integration-wizard-body">
              <AgentSearchList
                agents={agents()}
                label={t("marketplace.skills.dialog.list", { name: props.skill.name })}
                checked={checked}
                set={(chosen, on) =>
                  setDraft((state) => {
                    for (const agent of chosen) state.on[agent.id] = on;
                  })
                }
                blocked={blocked}
                note={note}
              />
            </div>
            <div class="integration-wizard-foot">
              <Button type="button" variant="ghost" onClick={props.onClose}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" class="marketplace-skill-dialog-submit" title={action()} disabled={unchanged()}>
                <span>{action()}</span>
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A button that opens the agents dialog of one skill. No button for a user with no agents. */
function DialogButton(props: {
  model: MarketplaceModel;
  skill: DialogSkill;
  label: string;
  variant: "outline" | "ghost";
  children: JSX.Element;
}) {
  const [open, setOpen] = createSignal(false);
  return (
    <Show when={props.model.agents().length > 0}>
      <Button
        type="button"
        size="sm"
        variant={props.variant}
        class="marketplace-skill-agents-trigger"
        aria-label={props.label}
        disabled={props.model.skillBusy(props.skill.id)}
        onClick={() => setOpen(true)}
      >
        {props.children}
      </Button>
      <Show when={open()}>
        <AgentsDialog model={props.model} skill={props.skill} onClose={() => setOpen(false)} />
      </Show>
    </Show>
  );
}

/** Small avatars of the first agents, one over the next. The text beside it gives the count. */
function AgentStack(props: { agents: readonly MarketplaceAgent[] }) {
  return (
    <span class="marketplace-skill-stack" aria-hidden="true">
      <For each={props.agents.slice(0, 3)} keyed={(agent) => agent.id}>
        {(agent) => (
          <span class="marketplace-avatar" data-size="xs">
            <AgentAvatar agent={agent()} motion="idle" />
          </span>
        )}
      </For>
    </span>
  );
}

/** "Add to agents" on a skill page. */
export function AddToAgents(props: { model: MarketplaceModel; skill: DialogSkill }) {
  const { t } = useText();
  return (
    <DialogButton
      model={props.model}
      skill={props.skill}
      label={t("marketplace.skills.addName", { name: props.skill.name })}
      variant="outline"
    >
      <Plus aria-hidden="true" />
      {t("marketplace.skills.addToAgents")}
    </DialogButton>
  );
}

/** The agents that have the skill, "On 12 of 50", or "Add" when no agent has it. Each opens the dialog. */
export function DialogAgents(props: { model: MarketplaceModel; skill: DialogSkill }) {
  const { t } = useText();
  const words = useSkillWords(() => props.model);
  const have = () => agentsWith(props.model, props.skill.id);
  return (
    <Show
      when={have().length > 0}
      fallback={
        <DialogButton
          model={props.model}
          skill={props.skill}
          label={t("marketplace.skills.addName", { name: props.skill.name })}
          variant="outline"
        >
          <Plus aria-hidden="true" />
          {t("marketplace.skills.add")}
        </DialogButton>
      }
    >
      <DialogButton
        model={props.model}
        skill={props.skill}
        label={t("marketplace.skills.chooseAgents", { name: props.skill.name, agents: words.agentNames(have()) })}
        variant="ghost"
      >
        <AgentStack agents={have()} />
        {t("marketplace.skills.onOf", { have: have().length, total: props.model.agents().length })}
      </DialogButton>
    </Show>
  );
}
