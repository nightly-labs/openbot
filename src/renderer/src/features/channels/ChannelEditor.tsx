import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { Channel, ChannelDraft } from "@openbot/contracts/ipc";
import { createEffect, createStore, For, Show } from "solid-js";
import {
  Button,
  buttonVariants,
  ChevronRight,
  Crown,
  DropdownMenu,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Plus,
  Textarea,
  Tooltip,
  UserRound,
} from "../../components/ui";
import { AgentAvatar } from "../agents/AgentAvatar";
import { useAgents } from "../agents/agents-context";
import { useChannels } from "./channels-context";
import { toggleChannelMember } from "./channels-draft";

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
  const { agentList } = useAgents();
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

  function commit(patch?: (draft: ChannelDraft) => void): Promise<boolean> {
    const current = channel();
    if (!current) return Promise.resolve(false);
    const draft = draftFrom(current);
    patch?.(draft);
    return channels.command({ type: "save", operationId: crypto.randomUUID(), channelId: current.id, draft });
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
      <label class="agent-settings-field">
        <span>Name</span>
        <Input
          aria-label="Channel name"
          placeholder="Ex: Project Falcon"
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
      </label>
      <label class="agent-settings-field">
        <span>Title</span>
        <Input
          aria-label="Channel title"
          placeholder="Describe what this channel does"
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
      </label>
      <label class="agent-settings-field agent-settings-description">
        <span>Instructions</span>
        <Textarea
          rows="4"
          aria-label="Channel instructions"
          placeholder="What will this channel work on?"
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
      </label>
      <div class="agent-settings-links">
        <Button variant="ghost" type="button" class="agent-settings-link" onClick={props.onOpenMemories}>
          <span class="agent-settings-link-label">Memories</span>
          <span class="agent-settings-link-value">
            {props.memoryCount} saved
            <ChevronRight />
          </span>
        </Button>
        <Button variant="ghost" type="button" class="agent-settings-link" onClick={props.onOpenRoutines}>
          <span class="agent-settings-link-label">Routines</span>
          <span class="agent-settings-link-value">
            {props.routineCount} configured
            <ChevronRight />
          </span>
        </Button>
      </div>
      <section class="channel-members" aria-label="Members">
        <h3 class="channel-members-title">Members</h3>
        <ItemGroup class="channel-member-list">
          <For each={members()}>
            {(entry) => (
              <Item size="compact" class="channel-member">
                <ItemMedia>
                  <Show when={entry.agent} fallback={<UserRound aria-hidden="true" />}>
                    {(agent) => <AgentAvatar agent={agent()} />}
                  </Show>
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{entry.agent?.name ?? `Unavailable member ${entry.agentId}`}</ItemTitle>
                </ItemContent>
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
                              ? `${agent().name} is the channel lead`
                              : `Make ${agent().name} the channel lead`
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
                            {channel()?.leadAgentId === entry.agentId ? "Channel lead" : "Make channel lead"}
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
                      entry.agent ? `Remove ${entry.agent.name}` : `Remove unavailable member ${entry.agentId}`
                    }
                    onClick={() => void commit((draft) => toggleChannelMember(draft, entry.agentId, false))}
                  >
                    Remove
                  </Button>
                </ItemActions>
              </Item>
            )}
          </For>
          <DropdownMenu.Root placement="bottom-start" modal={false}>
            <DropdownMenu.Trigger class="channel-member-add" disabled={!available().length}>
              <Plus aria-hidden="true" />
              Add member
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content class="channel-member-menu">
                <For each={available()}>
                  {(agent) => (
                    <DropdownMenu.Item
                      onSelect={() => void commit((draft) => toggleChannelMember(draft, agent.id, true))}
                    >
                      <AgentAvatar agent={agent} />
                      {agent.name}
                    </DropdownMenu.Item>
                  )}
                </For>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </ItemGroup>
        <Show when={!members().length}>
          <p class="channel-members-note">A channel needs one member before it can route work.</p>
        </Show>
      </section>
    </div>
  );
}
