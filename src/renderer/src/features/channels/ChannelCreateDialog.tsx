import type { ChannelDraft } from "@openbot/contracts/ipc";
import { createEffect, createSignal, createStore, For, Show, snapshot } from "solid-js";
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Dialog,
  Field,
  IconButton,
  Input,
  Search,
  UsersRound,
  X,
} from "../../components/ui";
import { AgentAvatar } from "../agents/AgentAvatar";
import { useAgents } from "../agents/agents-context";
import { useChannels } from "./channels-context";
import { emptyChannelDraft, toggleChannelMember } from "./channels-draft";

/**
 * Creation asks for the two things that cannot be guessed - a name and the agents - and leaves
 * purpose, responsibilities and the lead to Channel settings. The lead is the first selected
 * member until settings changes it.
 */
export function ChannelCreateDialog() {
  const channels = useChannels();
  const { agentList } = useAgents();
  const channelId = crypto.randomUUID();
  const [draft, setDraft] = createStore<ChannelDraft>(emptyChannelDraft());
  const [view, setView] = createStore({ search: "" });
  const filtered = () =>
    agentList().filter((agent) =>
      `${agent.name} ${agent.description}`.toLowerCase().includes(view.search.toLowerCase()),
    );
  const selected = () => agentList().filter((agent) => draft.members.some((member) => member.agentId === agent.id));
  // The chips have to stay mounted while the row collapses, or removing the last one would empty
  // the row before it has any height to animate. The delay is read back from the transition token
  // so the two never drift apart.
  const [chipAgents, setChipAgents] = createSignal(selected());
  createEffect(
    () => selected(),
    (agents) => {
      if (agents.length) {
        setChipAgents(agents);
        return;
      }
      const timer = setTimeout(() => setChipAgents([]), motionDuration("--acc-collapse"));
      return () => clearTimeout(timer);
    },
  );
  // `.t-resize` tweens between two explicit heights, so the list gets its measured content height
  // after every filter change. The stylesheet's `max-height` still caps how tall it can grow.
  let listBody: HTMLDivElement | undefined;
  const [listHeight, setListHeight] = createSignal<string>();
  createEffect(
    () => filtered(),
    () => {
      const height = listBody?.getBoundingClientRect().height;
      if (height) setListHeight(`${height}px`);
    },
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
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) channels.closeEditor();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="channel-dialog-backdrop">
          <Dialog.Content class="channel-create-dialog">
            <header class="channel-dialog-header">
              <Dialog.Title>New channel</Dialog.Title>
              <IconButton label="Close new channel" variant="ghost" onClick={channels.closeEditor}>
                <X />
              </IconButton>
            </header>
            <form
              class="channel-create-form"
              onSubmit={(event) => {
                event.preventDefault();
                void channels.command({
                  type: "save",
                  operationId: crypto.randomUUID(),
                  channelId,
                  draft: snapshot(draft),
                });
              }}
            >
              <Show when={channels.state.error}>
                {(message) => (
                  <Alert tone="danger" role="alert">
                    <AlertDescription>{message()}</AlertDescription>
                  </Alert>
                )}
              </Show>
              <Field label="Channel name">
                <Input
                  size="lg"
                  placeholder="Ex: Project Falcon"
                  required
                  value={draft.name}
                  onValueChange={(name) =>
                    setDraft((state) => {
                      state.name = name;
                    })
                  }
                />
              </Field>
              <fieldset class="channel-picker">
                <legend>Add agents</legend>
                <div class="t-acc" data-open={selected().length ? "true" : "false"}>
                  <div class="t-acc-panel">
                    <div class="t-acc-panel-inner">
                      <div class="channel-selected-members">
                        <For each={chipAgents()}>
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
                      </div>
                    </div>
                  </div>
                </div>
                <label class="search-field channel-member-search">
                  <span class="sr-only">Search agents</span>
                  <Search class="channel-search-icon" aria-hidden="true" />
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
                </label>
                <div class="channel-picker-list t-resize" style={{ height: listHeight() }}>
                  <div ref={listBody} class="channel-picker-body">
                    <For each={filtered()}>
                      {(agent) => (
                        <label class="channel-picker-entry channel-member-row" for={`channel-member-${agent.id}`}>
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
                  </div>
                </div>
              </fieldset>
              <footer class="channel-editor-footer">
                <Button type="button" variant="ghost" onClick={channels.closeEditor}>
                  Cancel
                </Button>
                <Button type="submit" disabled={channels.state.pending || !draft.name.trim() || !draft.members.length}>
                  Create
                </Button>
              </footer>
            </form>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Reads a transition duration token so JS timing follows the stylesheet instead of a copy of it. */
function motionDuration(token: string): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token)) || 250;
}
