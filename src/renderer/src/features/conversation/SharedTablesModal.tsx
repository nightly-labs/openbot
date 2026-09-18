import type { SharedTable } from "@openbot/contracts/ipc";
import { createEffect, createSignal, For, onSettled, Show } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import { Button, Dialog, IconButton, Trash2, X } from "../../components/ui";
import type { AgentProfile } from "../../data";
import { errorMessage } from "../../error-message";

interface SharedTablesModalProps {
  /** Resolves an owner id to a name. The owner can be an agent the user deleted, hence the lookup. */
  agents: readonly AgentProfile[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCountChange: (count: number) => void;
}

/**
 * Everything the agents keep, listed under whichever agent's settings the user opened.
 *
 * The list is global on purpose: the agents share one database, and any of them can read and write
 * any table in it. `ownerAgentId` records which agent made a table, and it gates deletion for agents
 * only -- the user can delete any table here, including one whose owner no longer exists.
 */
export function SharedTablesModal(props: SharedTablesModalProps) {
  const [tables, setTables] = createSignal<SharedTable[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [confirmName, setConfirmName] = createSignal<string | null>(null);
  const [deletingName, setDeletingName] = createSignal<string | null>(null);
  const scrollFades = createScrollFades();
  let modalContent: HTMLDivElement | undefined;

  onSettled(() => scrollFades.stop);

  async function loadTables(showLoading = true): Promise<void> {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const next = await window.openbot.agent.listTables();
      setTables(next);
      props.onCountChange(next.length);
    } catch (caught) {
      setError(errorMessage(caught, "Could not load the saved data."));
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
      await window.openbot.agent.deleteTable({ name: table.name });
      setConfirmName(null);
      await loadTables(false);
    } catch (caught) {
      setError(errorMessage(caught, "Could not delete this."));
    } finally {
      setDeletingName(null);
    }
  }

  function ownerLine(table: SharedTable): string {
    if (!table.ownerAgentId) return "Made outside OpenBot · any agent can delete it";
    const owner = props.agents.find((agent) => agent.id === table.ownerAgentId);
    return owner ? `Kept by ${owner.name}` : "Kept by an agent that no longer exists";
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
              <Dialog.Title>Saved data</Dialog.Title>
              <Dialog.Description class="sr-only">
                What the agents keep between tasks, with the agent that started each set of records
              </Dialog.Description>
            </div>
            <div class="agent-memories-header-actions">
              <IconButton label="Close saved data" variant="ghost" onClick={() => props.onOpenChange(false)}>
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

            <Show when={!loading()} fallback={<p class="agent-memory-state">Loading saved data…</p>}>
              <Show
                when={tables().length > 0}
                fallback={
                  <p class="agent-memory-state">
                    Nothing saved yet. An agent starts keeping records itself when a task needs them between turns, and
                    every agent can use them.
                  </p>
                }
              >
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
                            {rowCount(table.rowCount)} · {ownerLine(table)}
                          </span>
                        </div>
                        <Show
                          when={confirmName() === table.name}
                          fallback={
                            <IconButton
                              label={`Delete ${table.name}`}
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
                            <p>Delete this for every agent? The records cannot be recovered.</p>
                            <div class="shared-table-confirm-actions">
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={deletingName() === table.name}
                                onClick={() => setConfirmName(null)}
                              >
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                loading={deletingName() === table.name}
                                onClick={() => void deleteTable(table)}
                              >
                                Delete
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

function rowCount(count: number | null): string {
  if (count === null) return "not counted";
  return count === 1 ? "1 record" : `${count} records`;
}
