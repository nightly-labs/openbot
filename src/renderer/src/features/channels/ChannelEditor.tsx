import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { Channel, ChannelDraft } from "@openbot/contracts/ipc";
import {
  Button,
  buttonVariants,
  Crown,
  Input,
  ItemActions,
  ItemGroup,
  Listbox,
  Plus,
  Popover,
  Search,
  Textarea,
  Tooltip,
} from "@openbot/ui";
import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import { SettingsField, SettingsLinkGroup, SettingsLinkRow } from "@openbot/ui/components/SettingsPanel";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { ChannelMemberRow } from "@openbot/ui/features/channels/ChannelMemberRow";
import { ContentExitMotion } from "@openbot/ui/menu-motion";
import { useText } from "@openbot/ui/text";
import { createEffect, createStore, For, onSettled, Show } from "solid-js";
import { useChannels } from "./channels-context";
import { matchesAgentSearch, toggleChannelMember } from "./channels-draft";

interface ChannelEditorProps {
  memoryCount: number;
  routineCount: number;
  onOpenMemories: () => void;
  onOpenRoutines: () => void;
}

/**
 * Channel settings save themselves, the way agent settings do: the two text fields commit when
 * they are left and every member action commits at once, so there is nothing to confirm or
 * discard.
 *
 * That is why there is no draft of the channel here. Members and the lead are read live from the
 * open page, and only the text fields hold state, because a field must not be overwritten while
 * someone is typing in it - the `dirty` flags below are what protect an unsaved edit from the
 * refresh that follows every save.
 *
 * The two nav rows below the fields carry no state of their own: the host owns the counts and the
 * open flags, because the routines overlay covers the whole panel, not only this editor.
 */
export function ChannelEditor(props: ChannelEditorProps) {
  const channels = useChannels();
  const { t } = useText();
  const agentList = channels.agents;
  const channel = () => channels.state.page?.channel;
  const [fields, setFields] = createStore({ name: "", title: "", instructions: "" });
  const [dirty, setDirty] = createStore({ name: false, title: false, instructions: false });
  let lastSignature = "";
  let lastChannelId = "";

  createEffect(
    () => {
      const current = channel();
      return (
        current && {
          id: current.id,
          name: current.name,
          title: current.title,
          instructions: current.instructions,
          revision: current.revision,
        }
      );
    },
    (next) => {
      if (!next) return;
      const signature = JSON.stringify([next.id, next.revision, next.name, next.title, next.instructions]);
      if (signature === lastSignature) return;
      // Read the flags before writing them, so a different channel clears them here and replaces
      // every field, while the same channel keeps whatever is still uncommitted.
      const changed = next.id !== lastChannelId;
      const keep = {
        name: !changed && dirty.name,
        title: !changed && dirty.title,
        instructions: !changed && dirty.instructions,
      };
      lastSignature = signature;
      lastChannelId = next.id;
      if (changed)
        setDirty((state) => {
          state.name = false;
          state.title = false;
          state.instructions = false;
        });
      setFields((state) => {
        if (!keep.name) state.name = next.name;
        if (!keep.title) state.title = next.title;
        if (!keep.instructions) state.instructions = next.instructions;
      });
    },
  );

  const members = () =>
    (channel()?.members ?? []).map((member) => ({
      agentId: member.agentId,
      agent: agentList().find((agent) => agent.id === member.agentId),
    }));
  const available = () =>
    agentList().filter((agent) => !channel()?.members.some((member) => member.agentId === agent.id));

  /**
   * The Add member picker. A team can hold more agents than the window has rows, so the picker
   * filters by the search field the way the New channel dialog does, and its list scrolls.
   */
  const [picker, setPicker] = createStore<{ open: boolean; search: string; placement: "bottom-start" | "top-start" }>({
    open: false,
    search: "",
    placement: "bottom-start",
  });
  const matching = () => available().filter((agent) => matchesAgentSearch(agent, picker.search));
  let pickerPanel: HTMLElement | undefined;
  const pickerFades = createScrollFades();
  onSettled(() => pickerFades.stop);
  // A filter changes what overflows without always changing the list's own height.
  createEffect(
    () => matching(),
    () => pickerFades.remeasure(),
  );
  let pickerSearch: HTMLInputElement | undefined;
  let pickerTrigger: HTMLButtonElement | undefined;
  /**
   * Typing while an option has focus goes on in the search field. Kobalte's own typeahead cannot
   * take a name with a space: the focused option takes Space as its select key before the
   * typeahead sees it, so typing "Scale 9" would add whichever agent "Scale" had reached.
   */
  function typeIntoSearch(event: KeyboardEvent) {
    const erase = event.key === "Backspace";
    if ((event.key.length !== 1 && !erase) || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    setPicker((state) => {
      state.search = erase ? state.search.slice(0, -1) : state.search + event.key;
    });
    pickerSearch?.focus();
  }
  /**
   * ArrowDown from the search field focuses the first option itself. Focusing the list would let
   * Kobalte go back to the option it last focused, which a search may have taken off the list.
   */
  function focusFirstOption(): boolean {
    const option = pickerPanel?.querySelector<HTMLElement>(".channel-member-option");
    option?.focus();
    return option !== null && option !== undefined;
  }
  function addMember(agentId: string) {
    setPickerOpen(false);
    // Kobalte gives focus back only when it closes the popover itself. The focus waits a frame: the
    // Enter that picked would otherwise press the trigger too and open the popover again.
    requestAnimationFrame(() => pickerTrigger?.focus());
    void commit((draft) => toggleChannelMember(draft, agentId, true));
  }
  function setPickerOpen(open: boolean) {
    // The side is chosen once, where the window has more room. The menu stops at the room it has,
    // so it never overflows and Kobalte would never flip it back: a search that shrinks the list
    // would move it below the trigger, and clearing the search would leave it there, a few rows tall.
    const trigger = pickerTrigger?.getBoundingClientRect();
    setPicker((state) => {
      state.open = open;
      if (!open) state.search = "";
      if (open && trigger)
        state.placement = window.innerHeight - trigger.bottom >= trigger.top ? "bottom-start" : "top-start";
    });
    // A popover that is not modal does not move focus, so the search field takes it once it is on
    // the page.
    if (open) requestAnimationFrame(() => pickerSearch?.focus({ preventScroll: true }));
    else pickerFades.stop();
  }

  /**
   * The command carries a whole draft, so every save sends the fields as they are on screen. That
   * is deliberate: removing a member commits the instructions the user can see, rather than
   * reviving the stored ones.
   */
  function draftFrom(current: Channel): ChannelDraft {
    return {
      name: fields.name.trim() || current.name,
      title: fields.title,
      instructions: fields.instructions,
      members: current.members.map((member) => ({ agentId: member.agentId })),
      leadAgentId: current.leadAgentId,
    };
  }

  /**
   * One save at a time, and each draft built after the one before it has landed.
   *
   * The member controls stay enabled while a save is in flight, and a draft carries the whole
   * member list. Two removals started together would both read the list as it was before either
   * of them, so the second save would put the first member back.
   */
  let saving: Promise<unknown> = Promise.resolve();
  /** The draft the save before this one sent, for the channel it was sent to. */
  let sent: { channelId: string; draft: ChannelDraft } | null = null;
  function commit(patch?: (draft: ChannelDraft) => void): Promise<boolean> {
    const target = channel();
    if (!target) return Promise.resolve(false);
    // The edit belongs to the channel that is open now, and the panel is open in the workspace the
    // sidebar shares: the reader can leave for another channel while this save waits for the one
    // before it. A queued save therefore keeps the channel and the fields it was made in, or it
    // would send this channel's members and text to the one the reader went to.
    const targetId = target.id;
    const captured = draftFrom(target);
    const next = saving
      .catch(() => undefined)
      .then(() => {
        const current = channel();
        // The live page first, because the save before this one landed in it: two removals in a
        // row build on each other. Away from the channel, the members come from the save before
        // this one and the text from this one, because each save carries the fields as they were
        // when the reader left them.
        const previous = sent?.channelId === targetId ? sent.draft : captured;
        const draft =
          current?.id === targetId
            ? draftFrom(current)
            : {
                ...captured,
                members: previous.members.map((member) => ({ ...member })),
                leadAgentId: previous.leadAgentId,
              };
        patch?.(draft);
        sent = { channelId: targetId, draft };
        return channels.command({
          type: "save",
          operationId: crypto.randomUUID(),
          channelId: targetId,
          draft,
          update: true,
        });
      });
    saving = next;
    return next;
  }

  /** An empty name is not a name the service accepts, so leaving the field blank restores it. */
  function saveName(): void {
    const current = channel();
    if (!current) return;
    const value = fields.name.trim() || current.name;
    setFields((state) => {
      state.name = value;
    });
    void commit().then((saved) => {
      if (saved && channel()?.id === current.id && fields.name === value)
        setDirty((state) => {
          state.name = false;
        });
    });
  }

  /** One saver for both free-text fields: the dirty flag clears only if that field still matches. */
  function saveText(key: "title" | "instructions"): () => void {
    return () => {
      const current = channel();
      if (!current) return;
      const value = fields[key];
      void commit().then((saved) => {
        if (saved && channel()?.id === current.id && fields[key] === value)
          setDirty((state) => {
            state[key] = false;
          });
      });
    };
  }

  return (
    <div class="channel-editor">
      <SettingsField label={t("channel.form.nameShort")}>
        <Input
          aria-label={t("channel.form.name")}
          placeholder={t("channel.form.namePlaceholder")}
          maxlength={INPUT_LIMITS.agentName}
          value={fields.name}
          onValueChange={(name) => {
            setFields((state) => {
              state.name = name;
            });
            setDirty((state) => {
              state.name = true;
            });
          }}
          onBlur={saveName}
        />
      </SettingsField>
      <SettingsField label={t("channel.form.title")}>
        <Input
          aria-label={t("channel.form.titleLabel")}
          placeholder={t("channel.form.titlePlaceholder")}
          maxlength={INPUT_LIMITS.agentTitle}
          value={fields.title}
          onValueChange={(title) => {
            setFields((state) => {
              state.title = title;
            });
            setDirty((state) => {
              state.title = true;
            });
          }}
          onBlur={saveText("title")}
        />
      </SettingsField>
      <SettingsField label={t("channel.form.instructions")}>
        <Textarea
          rows="4"
          aria-label={t("channel.form.instructionsLabel")}
          placeholder={t("channel.form.instructionsPlaceholder")}
          maxlength={INPUT_LIMITS.agentDescription}
          value={fields.instructions}
          onValueChange={(instructions) => {
            setFields((state) => {
              state.instructions = instructions;
            });
            setDirty((state) => {
              state.instructions = true;
            });
          }}
          onBlur={saveText("instructions")}
        />
      </SettingsField>
      <SettingsLinkGroup>
        <SettingsLinkRow
          label={t("channel.settings.memories")}
          value={t("channel.settings.memoryCount", { count: props.memoryCount })}
          onClick={props.onOpenMemories}
        />
        <SettingsLinkRow
          label={t("channel.settings.routines")}
          value={t("channel.settings.routineCount", { count: props.routineCount })}
          onClick={props.onOpenRoutines}
        />
      </SettingsLinkGroup>
      <section class="channel-members" aria-label={t("channel.members.title")}>
        <h3 class="channel-members-title">{t("channel.members.title")}</h3>
        <ItemGroup class="channel-member-list">
          <For each={members()}>
            {(entry) => (
              <ChannelMemberRow
                agent={entry.agent}
                fallbackName={t("channel.members.unavailable", { id: entry.agentId })}
                actions={
                  <ItemActions>
                    <Show when={entry.agent}>
                      {(agent) => (
                        <Tooltip.Root openDelay={250} closeDelay={75} placement="top" gutter={8}>
                          {/* The trigger is the button itself, the way `ServerRail` does it: an
                            `IconButton` inside a trigger would carry a `title` as well, and the
                            crown would answer twice, once styled and once by the platform. */}
                          <Tooltip.Trigger
                            type="button"
                            class={buttonVariants({
                              variant: "ghost",
                              size: "icon-xs",
                              class: "ui-icon-button channel-lead-toggle",
                            })}
                            aria-pressed={channel()?.leadAgentId === entry.agentId ? "true" : "false"}
                            aria-label={
                              channel()?.leadAgentId === entry.agentId
                                ? t("channel.members.isLead", { name: agent().name })
                                : t("channel.members.makeLeadLabel", { name: agent().name })
                            }
                            onClick={() =>
                              void commit((draft) => {
                                draft.leadAgentId = entry.agentId;
                              })
                            }
                          >
                            <Crown aria-hidden="true" />
                          </Tooltip.Trigger>
                          <Tooltip.Portal>
                            <Tooltip.Content class="ui-tooltip">
                              {channel()?.leadAgentId === entry.agentId
                                ? t("channel.members.lead")
                                : t("channel.members.makeLead")}
                            </Tooltip.Content>
                          </Tooltip.Portal>
                        </Tooltip.Root>
                      )}
                    </Show>
                    <Button
                      size="xs"
                      variant="destructive"
                      class="channel-member-remove"
                      aria-label={
                        entry.agent
                          ? t("channel.members.remove", { name: entry.agent.name })
                          : t("channel.members.removeUnavailable", { id: entry.agentId })
                      }
                      onClick={() => void commit((draft) => toggleChannelMember(draft, entry.agentId, false))}
                    >
                      {t("common.remove")}
                    </Button>
                  </ItemActions>
                }
              />
            )}
          </For>
          <Popover.Root
            open={picker.open}
            onOpenChange={setPickerOpen}
            placement={picker.placement}
            flip={false}
            modal={false}
          >
            <Popover.Trigger
              ref={pickerTrigger}
              class={buttonVariants({ variant: "ghost", class: "channel-member-add" })}
              disabled={!available().length}
            >
              <Plus aria-hidden="true" />
              {t("channel.members.add")}
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content ref={(element) => (pickerPanel = element)} class="ui-action-menu channel-member-menu">
                <ContentExitMotion panel={() => pickerPanel} />
                <Popover.Title class="sr-only">{t("channel.members.add")}</Popover.Title>
                <label class="search-field channel-member-search">
                  <Search class="channel-search-icon" aria-hidden="true" />
                  <Input
                    ref={(element: HTMLInputElement) => (pickerSearch = element)}
                    type="search"
                    aria-label={t("channel.create.searchAgents")}
                    placeholder={t("channel.create.searchAgents")}
                    value={picker.search}
                    onValueChange={(search) =>
                      setPicker((state) => {
                        state.search = search;
                      })
                    }
                    onKeyDown={(event: KeyboardEvent) => {
                      if (event.key === "ArrowDown" && focusFirstOption()) event.preventDefault();
                    }}
                  />
                </label>
                <Show
                  when={matching().length}
                  fallback={
                    <p class="channel-member-menu-empty" role="status">
                      {t("channel.create.noMatches")}
                    </p>
                  }
                >
                  <Listbox.Root
                    as="div"
                    ref={(element: HTMLElement) => {
                      pickerFades.bind(element);
                      element.addEventListener("keydown", typeIntoSearch, { capture: true });
                    }}
                    class={["channel-member-options", pickerFades.classes()]}
                    onScroll={pickerFades.measure}
                    aria-label={t("channel.members.add")}
                    options={matching()}
                    optionValue="id"
                    optionTextValue="name"
                    selectionMode="single"
                    shouldFocusWrap
                    // A pick on pointerdown would close the popover under the pointer, and the click
                    // would land on whatever was below it, such as a member's Remove button.
                    shouldSelectOnPressUp
                    onChange={(keys) => {
                      const agentId = keys.values().next().value;
                      if (agentId) addMember(agentId);
                    }}
                    renderItem={(item) => (
                      <Listbox.Item item={item} class="channel-member-option">
                        <AgentAvatar agent={item.rawValue} />
                        {item.rawValue.name}
                      </Listbox.Item>
                    )}
                  />
                </Show>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </ItemGroup>
        <Show when={!members().length}>
          <p class="channel-members-note">{t("channel.members.empty")}</p>
        </Show>
      </section>
    </div>
  );
}
