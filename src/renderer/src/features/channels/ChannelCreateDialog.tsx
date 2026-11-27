import type { ChannelDraft } from "@openbot/contracts/ipc";
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Dialog,
  ErrorReference,
  Field,
  IconButton,
  Input,
  Search,
  UsersRound,
  X,
} from "@openbot/ui";
import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import { ChannelMemberRow } from "@openbot/ui/features/channels/ChannelMemberRow";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, createStore, For, onSettled, Show, snapshot } from "solid-js";
import { useChannels } from "./channels-context";
import { emptyChannelDraft, matchesAgentSearch, toggleChannelMember } from "./channels-draft";

export function ChannelCreateDialog() {
  const channels = useChannels();
  const { t, sourceText } = useText();
  const agentList = channels.agents;
  const channelId = crypto.randomUUID();
  const [draft, setDraft] = createStore<ChannelDraft>(emptyChannelDraft());
  const [view, setView] = createStore({ search: "" });
  const filtered = () => agentList().filter((agent) => matchesAgentSearch(agent, view.search));
  let listBody: HTMLDivElement | undefined;
  const [listHeight, setListHeight] = createSignal<string>();
  const listFades = createScrollFades();
  onSettled(() => listFades.stop);
  createEffect(
    () => filtered(),
    () => {
      const height = listBody?.getBoundingClientRect().height;
      if (height) setListHeight(`${height}px`);
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
              <Dialog.Title>{t("sidebar.new.channel")}</Dialog.Title>
              <IconButton label={t("channel.create.close")} variant="ghost" onClick={channels.closeEditor}>
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
                    <AlertDescription>
                      {sourceText(message())}
                      <ErrorReference reference={channels.state.errorReference} />
                    </AlertDescription>
                  </Alert>
                )}
              </Show>
              <Field label={t("channel.form.name")}>
                <Input
                  size="lg"
                  placeholder={t("channel.form.namePlaceholder")}
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
                <legend>{t("channel.create.addAgents")}</legend>
                <label class="search-field channel-member-search">
                  <span class="sr-only">{t("channel.create.searchAgents")}</span>
                  <Search class="channel-search-icon" aria-hidden="true" />
                  <Input
                    type="search"
                    aria-label={t("channel.create.searchAgents")}
                    placeholder={t("channel.create.searchAgents")}
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
                        <p>{agentList().length ? t("channel.create.noMatches") : t("sidebar.empty.noAgents")}</p>
                        <Show when={!agentList().length}>
                          <span>{t("channel.create.noAgentsHint")}</span>
                        </Show>
                      </div>
                    </Show>
                  </div>
                </div>
              </fieldset>
              <footer class="channel-editor-footer">
                <Button type="submit" disabled={channels.state.pending || !draft.name.trim() || !draft.members.length}>
                  {t("common.create")}
                </Button>
              </footer>
            </form>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
