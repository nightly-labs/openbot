import type { ChannelDraft } from "@openbot/contracts/ipc";
import { createEffect, createSignal, createStore, For, onSettled, Show, snapshot } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
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
import { useAgents } from "../agents/agents-context";
import { useI18n } from "../i18n/i18n-context";
import { ChannelMemberRow } from "./ChannelMemberRow";
import { useChannels } from "./channels-context";
import { emptyChannelDraft, toggleChannelMember } from "./channels-draft";

/**
 * Creation asks for the two things that cannot be guessed - a name and the agents - and leaves the
 * purpose and the lead to Channel settings. The lead is the first selected member until settings
 * changes it. Create is the one button here: unlike settings, there is nothing to save into until
 * the channel exists.
 */
export function ChannelCreateDialog() {
  const channels = useChannels();
  const i18n = useI18n();
  const { agentList } = useAgents();
  const channelId = crypto.randomUUID();
  const [draft, setDraft] = createStore<ChannelDraft>(emptyChannelDraft());
  const [view, setView] = createStore({ search: "" });
  const filtered = () =>
    agentList().filter((agent) =>
      `${agent.name} ${agent.description}`.toLowerCase().includes(view.search.toLowerCase()),
    );
  // `.t-resize` tweens between two explicit heights, so the list gets its measured content height
  // after every filter change. The stylesheet's `max-height` still caps how tall it can grow.
  let listBody: HTMLDivElement | undefined;
  const [listHeight, setListHeight] = createSignal<string>();
  const listFades = createScrollFades();
  onSettled(() => listFades.stop);
  createEffect(
    () => filtered(),
    () => {
      const height = listBody?.getBoundingClientRect().height;
      if (height) setListHeight(`${height}px`);
      // A filter changes what overflows without always changing the element's own height, which
      // is the one case the bound resize observer cannot see.
      listFades.remeasure();
    },
  );
  const toggle = (agentId: string, checked: boolean) =>
    setDraft((state) => {
      toggleChannelMember(state, agentId, checked);
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
              <Dialog.Title>{i18n.t("channels.create.title")}</Dialog.Title>
              <IconButton label={i18n.t("common.closeNewChannel")} variant="ghost" onClick={channels.closeEditor}>
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
              <Field label={i18n.t("channels.fields.name")}>
                <Input
                  size="lg"
                  placeholder={i18n.t("channels.fields.namePlaceholder")}
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
                <legend>{i18n.t("channels.create.addAgents")}</legend>
                <label class="search-field channel-member-search">
                  <span class="sr-only">{i18n.t("channels.search.label")}</span>
                  <Search class="channel-search-icon" aria-hidden="true" />
                  <Input
                    type="search"
                    aria-label={i18n.t("channels.search.label")}
                    placeholder={i18n.t("channels.search.placeholder")}
                    value={view.search}
                    onValueChange={(search) =>
                      setView((state) => {
                        state.search = search;
                      })
                    }
                  />
                </label>
                <div
                  ref={listFades.bind}
                  class={["channel-picker-list t-resize", listFades.classes()]}
                  style={{ height: listHeight() }}
                  onScroll={listFades.measure}
                >
                  <div ref={listBody} class="channel-picker-body">
                    <For each={filtered()}>
                      {(agent) => (
                        // The label stays the outer element, so pointing anywhere on the row
                        // selects the agent, and the row still names the checkbox it holds.
                        <label class="channel-picker-entry" for={`channel-member-${agent.id}`}>
                          <ChannelMemberRow
                            agent={agent}
                            fallbackName={agent.name}
                            description={agent.description}
                            leading={
                              <Checkbox
                                id={`channel-member-${agent.id}`}
                                checked={draft.members.some((member) => member.agentId === agent.id)}
                                onChange={(event) => toggle(agent.id, event.currentTarget.checked)}
                              />
                            }
                          />
                        </label>
                      )}
                    </For>
                    <Show when={!filtered().length}>
                      <div class="channel-picker-empty">
                        <Show when={!agentList().length}>
                          <UsersRound aria-hidden="true" />
                        </Show>
                        <p>
                          {agentList().length ? i18n.t("channels.empty.noMatches") : i18n.t("channels.empty.noAgents")}
                        </p>
                        <Show when={!agentList().length}>
                          <span>{i18n.t("channels.empty.createAgent")}</span>
                        </Show>
                      </div>
                    </Show>
                  </div>
                </div>
              </fieldset>
              <footer class="channel-editor-footer">
                <Button type="submit" disabled={channels.state.pending || !draft.name.trim() || !draft.members.length}>
                  {i18n.t("common.create")}
                </Button>
              </footer>
            </form>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
