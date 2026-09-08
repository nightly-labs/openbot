import type { ChannelDraft } from "@openbot/contracts/ipc";
import { createStore, For, Show, snapshot, untrack } from "solid-js";
import { Button, Checkbox, Input, Textarea, UsersRound } from "../../components/ui";
import { AgentAvatar } from "../agents/AgentAvatar";
import { useAgents } from "../agents/agents-context";
import { useChannels } from "./channels-context";
import { emptyChannelDraft, toggleChannelMember } from "./channels-draft";

export function ChannelEditor() {
  const channels = useChannels();
  const { agentList } = useAgents();
  const existing = untrack(() => channels.state.page?.channel);
  const channelId = existing?.id ?? crypto.randomUUID();
  // `snapshot` unwraps rather than clones, so the clone is what keeps unsaved edits out of the
  // channels store and makes Cancel discard them.
  const [draft, setDraft] = createStore<ChannelDraft>(
    existing ? structuredClone(snapshot(existing)) : emptyChannelDraft(),
  );
  const [view, setView] = createStore({ search: "" });
  const filtered = () =>
    agentList().filter((agent) =>
      `${agent.name} ${agent.description}`.toLowerCase().includes(view.search.toLowerCase()),
    );
  const toggle = (agentId: string, checked: boolean) =>
    setDraft((state) => {
      toggleChannelMember(
        state,
        agentId,
        checked ? (agentList().find((agent) => agent.id === agentId)?.description ?? "") : null,
      );
    });
  return (
    <form
      class="channel-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void channels.command({ type: "save", operationId: crypto.randomUUID(), channelId, draft: snapshot(draft) });
      }}
    >
      <label class="channel-field">
        Name
        <Input
          aria-label="Channel name"
          placeholder="Ex: Project Falcon"
          required
          value={draft.name}
          onValueChange={(name) =>
            setDraft((state) => {
              state.name = name;
            })
          }
        />
      </label>
      <label class="channel-field">
        Purpose
        <Textarea
          aria-label="Channel purpose"
          placeholder="What will this channel work on?"
          value={draft.purpose}
          onValueChange={(purpose) =>
            setDraft((state) => {
              state.purpose = purpose;
            })
          }
        />
      </label>
      <fieldset class="channel-picker">
        <legend>Members and responsibilities</legend>
        <div class="channel-member-picker">
          <div class="channel-member-search">
            <Input
              type="search"
              aria-label="Search agents"
              placeholder="Search agents"
              value={view.search}
              onValueChange={(search) =>
                setView((state) => {
                  state.search = search;
                })
              }
            />
          </div>
          <div class="channel-picker-list">
            <For each={filtered()}>
              {(agent) => (
                <div class="channel-picker-entry">
                  <label class="channel-member-row" for={`channel-member-${agent.id}`}>
                    <Checkbox
                      id={`channel-member-${agent.id}`}
                      checked={draft.members.some((member) => member.agentId === agent.id)}
                      onChange={(event) => toggle(agent.id, event.currentTarget.checked)}
                    />
                    <AgentAvatar agent={agent} />
                    <span class="channel-member-copy">
                      <strong>{agent.name}</strong>
                      <span>{agent.description}</span>
                    </span>
                  </label>
                  <Show when={draft.members.some((member) => member.agentId === agent.id)}>
                    <div class="channel-member-options">
                      <Input
                        aria-label={`${agent.name} responsibility`}
                        value={draft.members.find((member) => member.agentId === agent.id)?.responsibility ?? ""}
                        onValueChange={(responsibility) =>
                          setDraft((state) => {
                            state.members = state.members.map((member) =>
                              member.agentId === agent.id ? { ...member, responsibility } : member,
                            );
                          })
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        aria-pressed={draft.leadAgentId === agent.id ? "true" : "false"}
                        onClick={() =>
                          setDraft((state) => {
                            state.leadAgentId = agent.id;
                          })
                        }
                      >
                        {draft.leadAgentId === agent.id ? "Channel lead" : "Use as lead"}
                      </Button>
                    </div>
                  </Show>
                </div>
              )}
            </For>
            <Show when={!filtered().length}>
              <div class="channel-picker-empty">
                <Show when={!agentList().length}>
                  <UsersRound aria-hidden="true" />
                </Show>
                <p>{agentList().length ? "No agents match this search." : "No agents yet"}</p>
                <Show when={!agentList().length}>
                  <span>Create an agent to add it to this channel.</span>
                </Show>
              </div>
            </Show>
            <For each={draft.members.filter((member) => !agentList().some((agent) => agent.id === member.agentId))}>
              {(member) => (
                <div class="channel-actions">
                  <span>Unavailable member: {member.agentId}</span>
                  <Button type="button" variant="ghost" size="xs" onClick={() => toggle(member.agentId, false)}>
                    Remove unavailable member
                  </Button>
                </div>
              )}
            </For>
          </div>
        </div>
      </fieldset>
      <p class="channel-empty-copy">
        The lead selects one owner for each request. Other members start only when assigned work.
      </p>
      <fieldset class="channel-links">
        <legend>Linked conversations</legend>
        <For each={agentList().filter((agent) => agent.threadId)}>
          {(agent) => (
            <label class="channel-member-row" for={`channel-link-${agent.id}`}>
              <Checkbox
                id={`channel-link-${agent.id}`}
                checked={draft.linkedThreadIds.includes(agent.threadId ?? "")}
                onChange={(event) => {
                  const id = agent.threadId;
                  if (id)
                    setDraft((state) => {
                      state.linkedThreadIds = event.currentTarget.checked
                        ? [...state.linkedThreadIds, id]
                        : state.linkedThreadIds.filter((value) => value !== id);
                    });
                }}
              />
              {agent.name}
            </label>
          )}
        </For>
        <For each={draft.linkedThreadIds.filter((id) => !agentList().some((agent) => agent.threadId === id))}>
          {(id) => (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() =>
                setDraft((state) => {
                  state.linkedThreadIds = state.linkedThreadIds.filter((value) => value !== id);
                })
              }
            >
              Unlink unavailable conversation
            </Button>
          )}
        </For>
      </fieldset>
      <footer class="channel-editor-footer">
        <span>{draft.members.length} selected</span>
        <div class="channel-actions">
          <Button type="button" variant="ghost" onClick={channels.closeEditor}>
            Cancel
          </Button>
          <Button type="submit" disabled={channels.state.pending || !draft.name.trim()}>
            Save changes
          </Button>
        </div>
      </footer>
    </form>
  );
}
