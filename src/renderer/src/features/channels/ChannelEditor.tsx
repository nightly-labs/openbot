import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { Channel, ChannelDraft } from "@openbot/contracts/ipc";
import { createEffect, createStore, For, Show } from "solid-js";
import { SettingsField, SettingsLinkGroup, SettingsLinkRow } from "../../components/SettingsPanel";
import {
  Button,
  buttonVariants,
  Crown,
  DropdownMenu,
  Input,
  ItemActions,
  ItemGroup,
  Plus,
  Textarea,
  Tooltip,
} from "../../components/ui";
import { AgentAvatar } from "../agents/AgentAvatar";
import { useAgents } from "../agents/agents-context";
import { ChannelMemberRow } from "./ChannelMemberRow";
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
        return channels.command({ type: "save", operationId: crypto.randomUUID(), channelId: targetId, draft });
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
      <SettingsField label="Name">
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
      </SettingsField>
      <SettingsField label="Title">
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
      </SettingsField>
      <SettingsField label="Instructions">
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
      </SettingsField>
      <SettingsLinkGroup>
        <SettingsLinkRow label="Memories" value={`${props.memoryCount} saved`} onClick={props.onOpenMemories} />
        <SettingsLinkRow label="Routines" value={`${props.routineCount} configured`} onClick={props.onOpenRoutines} />
      </SettingsLinkGroup>
      <section class="channel-members" aria-label="Members">
        <h3 class="channel-members-title">Members</h3>
        <ItemGroup class="channel-member-list">
          <For each={members()}>
            {(entry) => (
              <ChannelMemberRow
                agent={entry.agent}
                fallbackName={`Unavailable member ${entry.agentId}`}
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
                }
              />
            )}
          </For>
          <DropdownMenu.Root placement="bottom-start" modal={false}>
            <DropdownMenu.Trigger
              class={buttonVariants({ variant: "ghost", class: "channel-member-add" })}
              disabled={!available().length}
            >
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
