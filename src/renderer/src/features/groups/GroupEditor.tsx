import type { GroupDraft } from "@openbot/contracts/ipc";
import { createStore, For, Show, snapshot, untrack } from "solid-js";
import { Button, Checkbox, Dialog, Input, Search, Textarea, UsersRound, X } from "../../components/ui";
import { AgentAvatar } from "../agents/AgentAvatar";
import { useAgents } from "../agents/agents-context";
import { useGroups } from "./groups-context";

export function GroupCreateDialog() {
  const groups = useGroups();
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) groups.closeEditor();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="group-dialog-backdrop" />
        <Dialog.Content class="group-create-dialog">
          <header class="group-dialog-header">
            <Dialog.Title>New group</Dialog.Title>
            <Button size="icon-sm" variant="ghost" aria-label="Close new group" onClick={groups.closeEditor}>
              <X />
            </Button>
          </header>
          <GroupEditor creating />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function GroupEditor(props: { creating?: boolean }) {
  const groups = useGroups();
  const { agentList } = useAgents();
  const existing = untrack(() => (props.creating ? undefined : groups.state.page?.group));
  const groupId = existing?.id ?? crypto.randomUUID();
  const [draft, setDraft] = createStore<GroupDraft>(
    existing ? snapshot(existing) : { name: "", purpose: "", members: [], leadAgentId: null, linkedThreadIds: [] },
  );
  const [view, setView] = createStore({ search: "" });
  const filtered = () =>
    agentList().filter((agent) =>
      `${agent.name} ${agent.description}`.toLowerCase().includes(view.search.toLowerCase()),
    );
  const toggle = (agentId: string, checked: boolean) =>
    setDraft((state) => {
      state.members = checked
        ? [
            ...state.members,
            { agentId, responsibility: agentList().find((agent) => agent.id === agentId)?.description ?? "" },
          ]
        : state.members.filter((member) => member.agentId !== agentId);
      if (!state.leadAgentId || !state.members.some((member) => member.agentId === state.leadAgentId))
        state.leadAgentId = state.members[0]?.agentId ?? null;
    });
  return (
    <form
      class={props.creating ? "group-editor group-editor-creating" : "group-editor"}
      onSubmit={(event) => {
        event.preventDefault();
        void groups.command({ type: "save", operationId: crypto.randomUUID(), groupId, draft: snapshot(draft) });
      }}
    >
      <Show when={props.creating && groups.state.error}>
        <p role="alert">{groups.state.error}</p>
      </Show>
      <label class="group-field">
        Name
        <Input
          aria-label="Group name"
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
      <fieldset class="group-picker">
        <legend>{props.creating ? "Add agents" : "Members and responsibilities"}</legend>
        <div class="group-member-picker">
          <Show when={!props.creating || agentList().length}>
            <div class={props.creating ? "group-member-search group-selected-members" : "group-member-search"}>
              <Show when={props.creating && !draft.members.length}>
                <Search class="group-search-icon" aria-hidden="true" />
              </Show>
              <Show when={props.creating && draft.members.length}>
                <For each={agentList().filter((agent) => draft.members.some((member) => member.agentId === agent.id))}>
                  {(agent) => (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      aria-label={`Remove ${agent.name}`}
                      onClick={() => toggle(agent.id, false)}
                    >
                      <AgentAvatar agent={agent} />
                      {agent.name}
                      <X />
                    </Button>
                  )}
                </For>
              </Show>
              <Input
                type="search"
                aria-label="Search agents"
                placeholder={props.creating && draft.members.length ? "" : "Search"}
                value={view.search}
                onValueChange={(search) =>
                  setView((state) => {
                    state.search = search;
                  })
                }
              />
            </div>
          </Show>
          <div class="group-picker-list">
            <For each={filtered()}>
              {(agent) => (
                <div class="group-picker-entry">
                  <label class="group-member-row" for={`group-member-${agent.id}`}>
                    <Checkbox
                      id={`group-member-${agent.id}`}
                      checked={draft.members.some((member) => member.agentId === agent.id)}
                      onChange={(event) => toggle(agent.id, event.currentTarget.checked)}
                    />
                    <AgentAvatar agent={agent} />
                    <span class="group-member-copy">
                      <strong>{agent.name}</strong>
                      <Show when={!props.creating}>
                        <span>{agent.description}</span>
                      </Show>
                    </span>
                    <Show when={!props.creating && draft.leadAgentId === agent.id}>
                      <span class="group-lead-label">Lead</span>
                    </Show>
                  </label>
                  <Show when={!props.creating && draft.members.some((member) => member.agentId === agent.id)}>
                    <div class="group-member-options">
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
                        {draft.leadAgentId === agent.id ? "Group lead" : "Use as lead"}
                      </Button>
                    </div>
                  </Show>
                </div>
              )}
            </For>
            <Show when={!filtered().length}>
              <div class="group-picker-empty">
                <Show when={!agentList().length}>
                  <UsersRound aria-hidden="true" />
                </Show>
                <p>{agentList().length ? "No agents match this search." : "No agents yet"}</p>
                <Show when={!agentList().length}>
                  <span>Create an agent to add it to this group.</span>
                </Show>
              </div>
            </Show>
            <For each={draft.members.filter((member) => !agentList().some((agent) => agent.id === member.agentId))}>
              {(member) => (
                <div class="group-actions">
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
      <Show when={!props.creating}>
        <label class="group-field">
          Purpose
          <Textarea
            aria-label="Group purpose"
            placeholder="What will this group work on?"
            value={draft.purpose}
            onValueChange={(purpose) =>
              setDraft((state) => {
                state.purpose = purpose;
              })
            }
          />
        </label>
        <p class="group-empty-copy">
          The lead selects one owner for each request. Other members start only when assigned work.
        </p>
        <fieldset class="group-links">
          <legend>Linked conversations</legend>
          <For each={agentList().filter((agent) => agent.threadId)}>
            {(agent) => (
              <label class="group-member-row" for={`group-link-${agent.id}`}>
                <Checkbox
                  id={`group-link-${agent.id}`}
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
      </Show>
      <footer class="group-editor-footer">
        <Show when={!props.creating}>
          <span>{draft.members.length} selected</span>
        </Show>
        <div class="group-actions">
          <Show when={!props.creating}>
            <Button type="button" variant="ghost" onClick={groups.closeEditor}>
              Cancel
            </Button>
          </Show>
          <Button
            type="submit"
            disabled={groups.state.pending || !draft.name.trim() || (props.creating && !draft.members.length)}
          >
            {props.creating ? "Create" : "Save changes"}
          </Button>
        </div>
      </footer>
    </form>
  );
}
