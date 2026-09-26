import type { SharedTable } from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import { Button, Dialog, IconButton, Trash2, X } from "@openbot/ui";
import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import type { AgentProfile } from "@openbot/ui/data";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, For, onSettled, Show } from "solid-js";
import { conversationPort, type SharedTableCalls } from "./conversation-port";

interface SharedTablesModalProps {
  /** Resolves an owner id to a name. The owner can be an agent the user deleted, hence the lookup. */
  agents: readonly AgentProfile[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCountChange: (count: number) => void;
  /** Replaces the desktop calls, for a client that reaches the host another way. */
  calls?: SharedTableCalls | undefined;
}

/**
 * Everything the agents keep, listed under whichever agent's settings the user opened.
 *
 * The list is global on purpose: the agents share one database, and any of them can read and write
 * any table in it. `ownerAgentId` records which agent made a table, and it gates deletion for agents
 * only -- the user can delete any table here, including one whose owner no longer exists.
 */
export function SharedTablesModal(props: SharedTablesModalProps) {
  const { t, errorMessage } = useText();
  const [tables, setTables] = createSignal<SharedTable[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [confirmName, setConfirmName] = createSignal<string | null>(null);
  const [deletingName, setDeletingName] = createSignal<string | null>(null);
  const scrollFades = createScrollFades();
  let modalContent: HTMLDivElement | undefined;
  const tableCalls = (): SharedTableCalls => props.calls ?? conversationPort().agent;

  onSettled(() => scrollFades.stop);

  async function loadTables(showLoading = true): Promise<void> {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const next = await tableCalls().listTables();
      setTables(next);
      props.onCountChange(next.length);
    } catch (caught) {
      setError(errorMessage(caught, t("sharedTable.loadFailed")));
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  createEffect(
    () => props.open,
    (open) => {
      if (!open) return;
      setConfirmName(null);
      void loadTables();
    },
  );

  async function deleteTable(table: SharedTable): Promise<void> {
    setDeletingName(table.name);
    setError(null);
    try {
      await tableCalls().deleteTable({ name: table.name });
      setConfirmName(null);
      await loadTables(false);
    } catch (caught) {
      setError(errorMessage(caught, t("sharedTable.deleteFailed")));
    } finally {
      setDeletingName(null);
    }
  }

  function ownerLine(table: SharedTable): string {
    if (!table.ownerAgentId) return t("sharedTable.madeOutside");
    const owner = props.agents.find((agent) => agent.id === table.ownerAgentId);
    return owner ? t("sharedTable.keptBy", { name: owner.name }) : t("sharedTable.keptByDeleted");
  }

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay class="agent-memories-overlay" />
        <Dialog.Content
          ref={(element) => (modalContent = element)}
          class="agent-memories-modal"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            modalContent?.focus({ preventScroll: true });
          }}
        >
          <header class="agent-memories-header">
            <div class="agent-memories-heading">
              <Dialog.Title>{t("sharedTable.title")}</Dialog.Title>
              <Dialog.Description class="sr-only">{t("sharedTable.description")}</Dialog.Description>
            </div>
            <div class="agent-memories-header-actions">
              <IconButton label={t("sharedTable.close")} variant="ghost" onClick={() => props.onOpenChange(false)}>
                <X />
              </IconButton>
            </div>
          </header>

          <div class="agent-memories-body">
            <Show when={error()}>
              {(message) => (
                <p class="agent-memory-error" role="alert">
                  {message()}
                </p>
              )}
            </Show>

            <Show when={!loading()} fallback={<p class="agent-memory-state">{t("sharedTable.loading")}</p>}>
              <Show when={tables().length > 0} fallback={<p class="agent-memory-state">{t("sharedTable.empty")}</p>}>
                <ul
                  ref={scrollFades.bind}
                  class={["shared-table-list", scrollFades.classes()]}
                  onScroll={scrollFades.measure}
                >
                  <For each={tables()}>
                    {(table) => (
                      <li class="shared-table-row">
                        <div class="shared-table-main">
                          <span class="shared-table-name">{table.name}</span>
                          <span class="agent-memory-meta">
                            {rowCount(table.rowCount, t)} · {ownerLine(table)}
                          </span>
                        </div>
                        <Show
                          when={confirmName() === table.name}
                          fallback={
                            <IconButton
                              label={t("sharedTable.deleteName", { name: table.name })}
                              class="agent-memory-delete-button"
                              variant="destructive-ghost"
                              disabled={deletingName() !== null}
                              onClick={() => setConfirmName(table.name)}
                            >
                              <Trash2 />
                            </IconButton>
                          }
                        >
                          <div class="shared-table-confirm">
                            <p>{t("sharedTable.confirmDelete")}</p>
                            <div class="shared-table-confirm-actions">
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={deletingName() === table.name}
                                onClick={() => setConfirmName(null)}
                              >
                                {t("common.cancel")}
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                loading={deletingName() === table.name}
                                onClick={() => void deleteTable(table)}
                              >
                                {t("common.delete")}
                              </Button>
                            </div>
                          </div>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </Show>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function rowCount(count: number | null, t: AppTranslate): string {
  if (count === null) return t("sharedTable.notCounted");
  return t("sharedTable.records", { count });
}
