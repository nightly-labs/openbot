import { agentProviderName } from "@openbot/contracts/agent-providers";
import type { InstanceTransferAgent, InstanceTransferResult } from "@openbot/contracts/ipc";
import type { ServerAppearance } from "@openbot/contracts/team-protocol/host-appearance-v1";
import {
  ArrowRight,
  Button,
  Checkbox,
  CircleCheck,
  Dialog,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openbot/ui";
import { createEffect, createMemo, createSignal, createUniqueId, For, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { ServerLogo } from "../servers/ServerLogo";
import { NotMoved, TransferAlert, TransferNotes } from "./InstanceTransferView";

export type CopyAgentsAgent = Pick<InstanceTransferAgent, "id" | "name" | "avatarSeed" | "avatarHue" | "avatarUrl">;

export interface CopyAgentsServer {
  id: string;
  name: string;
  logoUrl: string | null;
  appearance?: ServerAppearance | null | undefined;
}

export type CopyAgentsPhase = "idle" | "copying" | "done";

export interface CopyAgentsDialogProps {
  /** The servers that the user can copy from and to. */
  servers: readonly CopyAgentsServer[];
  fromId: string;
  toId: string | null;
  onFromChange: (serverId: string) => void;
  onToChange: (serverId: string) => void;
  /** The agents of each side, or null while they load. */
  fromAgents: readonly CopyAgentsAgent[] | null;
  toAgents: readonly CopyAgentsAgent[] | null;
  /** The agents of a side could not be read. */
  loadError: string | null;
  phase: CopyAgentsPhase;
  result: InstanceTransferResult | null;
  error: string | null;
  onCopy: (agentIds: string[]) => void;
  /** Opens the destination server. Absent when the app cannot open it from here. */
  onOpenServer?: (() => void) | undefined;
  onClose: () => void;
}

/** A search field shows when a server has more agents than this. */
const SEARCH_FROM = 8;

/**
 * Server settings > Transfer > Copy to another server. The source server and its agents are on the
 * left; the destination server and the agents it will have are on the right.
 */
export function CopyAgentsDialog(props: CopyAgentsDialogProps) {
  const { t } = useText();
  const id = `copy-agents-${createUniqueId()}`;
  const [mount, setMount] = createSignal<Element>();
  const [excluded, setExcluded] = createSignal<ReadonlySet<string>>(new Set());
  const [query, setQuery] = createSignal("");
  // A new source starts with all of its agents selected.
  createEffect(
    () => props.fromId,
    () => {
      setExcluded(new Set<string>());
      setQuery("");
    },
  );
  const agents = () => props.fromAgents ?? [];
  const selected = createMemo(() => agents().filter((agent) => !excluded().has(agent.id)));
  const visible = createMemo(() => {
    const text = query().trim().toLowerCase();
    return text ? agents().filter((agent) => agent.name.toLowerCase().includes(text)) : agents();
  });
  const takenNames = createMemo(() => new Set((props.toAgents ?? []).map((agent) => agent.name.toLowerCase())));
  const busy = () => props.phase === "copying";
  const done = () => props.phase === "done";
  const from = () => props.servers.find((server) => server.id === props.fromId) ?? null;
  const to = () => props.servers.find((server) => server.id === props.toId) ?? null;
  const toggle = (agentId: string, include: boolean) => {
    const next = new Set(excluded());
    if (include) next.delete(agentId);
    else next.add(agentId);
    setExcluded(next);
  };
  const allChecked = () => agents().length > 0 && selected().length === agents().length;
  // Named functions, not ternaries in component props: a tracked read of such a prop halts Solid.
  const doneResult = () => (done() ? props.result : null);
  const doneVariant = () => (props.onOpenServer ? "ghost" : "default");

  return (
    <Dialog.Root
      open
      modal
      onOpenChange={(open) => {
        if (!open && !busy()) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="ui-dialog-overlay">
          <Dialog.Content as="section" class="ui-dialog-content ui-confirm-dialog copy-agents-dialog">
            <div class="copy-agents-main" aria-busy={busy() ? "true" : undefined}>
              <Dialog.Title as="h2" class="ui-confirm-dialog-title">
                {t("settings.transfer.copy.title")}
              </Dialog.Title>
              <div class="copy-agents-panes" ref={setMount}>
                <section class="copy-agents-pane" aria-labelledby={`${id}-from`}>
                  <span id={`${id}-from`} class="copy-agents-side-label">
                    {t("settings.transfer.copy.from")}
                  </span>
                  <ServerSelect
                    label={t("settings.transfer.copy.from")}
                    servers={props.servers}
                    value={from()}
                    disabled={busy()}
                    onChange={props.onFromChange}
                    mount={mount()}
                  />
                  <Show when={agents().length > SEARCH_FROM}>
                    <Input
                      type="search"
                      placeholder={t("settings.transfer.copy.search")}
                      aria-label={t("settings.transfer.copy.search")}
                      value={query()}
                      onInput={(event) => setQuery(event.currentTarget.value)}
                    />
                  </Show>
                  <ul
                    class="storage-rows copy-agents-list"
                    aria-label={t("settings.transfer.copy.agentsOn", { server: from()?.name ?? "" })}
                  >
                    <Show when={props.fromAgents} fallback={<Loading />}>
                      <Show when={agents().length > 0} fallback={<Empty />}>
                        <Show when={!query()}>
                          <li>
                            <label class="storage-row agent-import-row" for={`${id}-all`}>
                              <Checkbox
                                id={`${id}-all`}
                                checked={allChecked()}
                                disabled={busy()}
                                onChange={(event) =>
                                  setExcluded(
                                    event.currentTarget.checked
                                      ? new Set<string>()
                                      : new Set(agents().map((agent) => agent.id)),
                                  )
                                }
                              />
                              <span class="storage-row-title">
                                {t("settings.transfer.copy.all", { count: agents().length })}
                              </span>
                            </label>
                          </li>
                        </Show>
                        <For each={visible()}>
                          {(agent) => (
                            <li>
                              <label class="storage-row agent-import-row" for={`${id}-${agent.id}`}>
                                <Checkbox
                                  id={`${id}-${agent.id}`}
                                  checked={!excluded().has(agent.id)}
                                  disabled={busy()}
                                  onChange={(event) => toggle(agent.id, event.currentTarget.checked)}
                                />
                                <AgentName agent={agent} />
                              </label>
                            </li>
                          )}
                        </For>
                      </Show>
                    </Show>
                  </ul>
                </section>
                <ArrowRight class="copy-agents-arrow" aria-hidden="true" />
                <section class="copy-agents-pane" aria-labelledby={`${id}-to`}>
                  <span id={`${id}-to`} class="copy-agents-side-label">
                    {t("settings.transfer.copy.to")}
                  </span>
                  <ServerSelect
                    label={t("settings.transfer.copy.to")}
                    servers={props.servers}
                    value={to()}
                    disabled={busy()}
                    onChange={props.onToChange}
                    mount={mount()}
                  />
                  <Show when={to()}>
                    {(server) => (
                      <ul
                        class="storage-rows copy-agents-list"
                        aria-label={t("settings.transfer.copy.agentsOn", { server: server().name })}
                      >
                        <Show when={props.toAgents} fallback={<Loading />}>
                          {(toAgents) => (
                            <>
                              <Show when={!done()}>
                                <For each={selected()}>
                                  {(agent) => (
                                    <li class="storage-row agent-import-row">
                                      <AgentName agent={agent} />
                                      <span class="instance-transfer-chip">
                                        {takenNames().has(agent.name.toLowerCase())
                                          ? t("settings.transfer.import.nameExists")
                                          : t("settings.transfer.copy.new")}
                                      </span>
                                    </li>
                                  )}
                                </For>
                              </Show>
                              <For each={toAgents()}>
                                {(agent) => (
                                  <li class="storage-row agent-import-row">
                                    <AgentName agent={agent} />
                                  </li>
                                )}
                              </For>
                            </>
                          )}
                        </Show>
                      </ul>
                    )}
                  </Show>
                </section>
              </div>
              <Show when={props.loadError}>
                {(message) => <TransferAlert title={t("settings.transfer.copy.loadFailed")} description={message()} />}
              </Show>
              <Show when={props.error}>
                {(message) => <TransferAlert title={t("settings.transfer.copy.failed")} description={message()} />}
              </Show>
              <Show when={doneResult()} fallback={<NotMoved text="settings.transfer.copy.notCopied" />}>
                {(result) => <CopyResult result={result()} server={to()?.name ?? ""} />}
              </Show>
            </div>
            <footer class="ui-confirm-dialog-actions">
              <Show
                when={done()}
                fallback={
                  <>
                    <Button type="button" variant="ghost" disabled={busy()} onClick={() => props.onClose()}>
                      {t("common.cancel")}
                    </Button>
                    <Button
                      type="button"
                      disabled={!to() || selected().length === 0}
                      loading={busy()}
                      loadingLabel={t("settings.transfer.copy.copying")}
                      onClick={() => props.onCopy(selected().map((agent) => agent.id))}
                    >
                      {t("settings.transfer.copy.submit", { count: selected().length })}
                    </Button>
                  </>
                }
              >
                <Button type="button" variant={doneVariant()} onClick={() => props.onClose()}>
                  {t("common.done")}
                </Button>
                <Show when={props.onOpenServer}>
                  {(open) => (
                    <Button type="button" onClick={() => open()()}>
                      {t("settings.transfer.copy.open", { server: to()?.name ?? "" })}
                    </Button>
                  )}
                </Show>
              </Show>
            </footer>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ServerName(props: { server: CopyAgentsServer }) {
  return (
    <span class="copy-agents-server">
      <ServerLogo serverId={props.server.id} url={props.server.logoUrl} appearance={props.server.appearance} />
      <span class="copy-agents-server-name">{props.server.name}</span>
    </span>
  );
}

function ServerSelect(props: {
  label: string;
  servers: readonly CopyAgentsServer[];
  value: CopyAgentsServer | null;
  disabled: boolean;
  onChange: (serverId: string) => void;
  mount: Element | undefined;
}) {
  const { t } = useText();
  // A new array only when a server changes: Kobalte loops on a new options array from each write,
  // and the server list gets a new array on each status change.
  const key = createMemo(() =>
    props.servers.map((server) => `${server.id}\n${server.name}\n${server.logoUrl ?? ""}`).join("\n"),
  );
  const options = createMemo(() => {
    key();
    return untrack(() => [...props.servers]);
  });
  return (
    <Select<CopyAgentsServer>
      options={options()}
      optionValue="id"
      optionTextValue="name"
      value={props.value}
      disabled={props.disabled}
      placeholder={t("settings.transfer.copy.chooseServer")}
      onChange={(server) => {
        if (server && server.id !== props.value?.id) props.onChange(server.id);
      }}
      itemComponent={(item) => (
        <SelectItem item={item.item}>
          <ServerName server={item.item.rawValue} />
        </SelectItem>
      )}
    >
      <SelectTrigger class="copy-agents-trigger" aria-label={props.label}>
        <SelectValue<CopyAgentsServer>>{(state) => <ServerName server={state.selectedOption()} />}</SelectValue>
      </SelectTrigger>
      <SelectContent mount={props.mount} />
    </Select>
  );
}

function AgentName(props: { agent: CopyAgentsAgent }) {
  return (
    <>
      <AgentAvatar
        class="storage-row-avatar"
        seed={props.agent.avatarSeed}
        hue={props.agent.avatarHue}
        url={props.agent.avatarUrl}
      />
      <span class="storage-row-title copy-agents-name">{props.agent.name}</span>
    </>
  );
}

function Loading() {
  const { t } = useText();
  return <li class="storage-row copy-agents-status">{t("settings.transfer.loading")}</li>;
}

function Empty() {
  const { t } = useText();
  return <li class="storage-row copy-agents-status">{t("settings.transfer.copy.noAgents")}</li>;
}

function CopyResult(props: { result: InstanceTransferResult; server: string }) {
  const { t } = useText();
  return (
    <>
      <p class="agent-import-done copy-agents-done" role="status">
        <Show when={props.result.agents.length > 0}>
          <CircleCheck class="agent-import-done-icon" aria-hidden="true" />
        </Show>
        {t("settings.transfer.copy.done", { count: props.result.agents.length, server: props.server })}
      </p>
      <Show when={props.result.signIn.length > 0}>
        <TransferNotes
          title={t("settings.transfer.result.signIn")}
          notes={props.result.signIn.map((provider) => agentProviderName(provider))}
        />
      </Show>
      <Show when={props.result.skipped.length > 0}>
        <TransferNotes
          title={t("settings.transfer.result.notImported")}
          notes={props.result.skipped.map((entry) => `${entry.name}: ${entry.reason}`)}
        />
      </Show>
      <Show when={props.result.warnings.length > 0}>
        <TransferNotes title={t("settings.transfer.result.warnings")} notes={props.result.warnings} />
      </Show>
    </>
  );
}
