import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentMemorySelectionState, MemoryEntry, SetAgentMemoryInclusionInput } from "@openbot/contracts/ipc";
import type { AppFormat, AppMessages } from "@openbot/i18n";
import { Button, ConfirmDialog, Dialog, IconButton, Plus, Textarea, Trash2, toast, X } from "@openbot/ui";
import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import { AGENT_DELETE_UNDO_MS } from "@openbot/ui/features/agents/AgentDeleteUndoToast";
import { AgentMemoriesEmpty } from "@openbot/ui/features/conversation/AgentMemoriesEmpty";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, For, onCleanup, onSettled, Show, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import { desktopAnalytics } from "../../analytics";
import type { MemoriesPort } from "./memories-port";

interface AgentMemoriesModalProps {
  /** Names the owner and owns every call. A channel passes `channelMemoriesPort` here. */
  port: MemoriesPort;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCountChange: (count: number) => void;
}

const LIMIT_TEXT = {
  agent: "memory.limitAgent",
  channel: "memory.limitChannel",
} as const satisfies Record<MemoriesPort["ownerNoun"], keyof AppMessages>;

export function AgentMemoriesModal(props: AgentMemoriesModalProps) {
  const { t, format, errorMessage } = useText();
  const [selection, setSelection] = createSignal<AgentMemorySelectionState | null>(null);
  const selectionById = createMemo(() => new Map(selection()?.selections.map((entry) => [entry.memoryId, entry])));
  const [memories, setMemories] = createSignal<MemoryEntry[]>([]);
  // Memories that wait for the undo time to end. The modal hides them; the host still has them.
  // A deleted id stays here: the host never gives the id again, so the set needs no cleanup.
  // `hidden` is the source; the signal holds a copy, because a read after a write gives the old value.
  const hidden = new Set<string>();
  const [hiddenIds, setHiddenIds] = createSignal<ReadonlySet<string>>(new Set());
  const visibleMemories = createMemo(() => {
    const ids = hiddenIds();
    return ids.size === 0 ? memories() : memories().filter((memory) => !ids.has(memory.id));
  });
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [addOpen, setAddOpen] = createSignal(false);
  const [newText, setNewText] = createSignal("");
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editingText, setEditingText] = createSignal("");
  const [savingId, setSavingId] = createSignal<string | null>(null);
  const [clearConfirmation, setClearConfirmation] = createSignal(false);
  const scrollFades = createScrollFades();
  let modalContent: HTMLDivElement | undefined;
  let newMemoryInput: HTMLTextAreaElement | undefined;
  let editingInput: HTMLTextAreaElement | undefined;
  let confirmationTrigger: HTMLButtonElement | undefined;

  onSettled(() => scrollFades.stop);

  /**
   * Deletes that wait for the undo time to end, by memory. When the modal goes away, each delete runs
   * at once, against the owner it was made on.
   */
  const pendingDeletes = new Map<string, { commit: () => void; settle: () => boolean }>();
  onCleanup(() => {
    for (const pending of [...pendingDeletes.values()]) pending.commit();
  });

  /**
   * The cap the owner reached, or null. A remote host's cap is unknown here; it refuses on save. A
   * memory that waits for undo is still stored, so it still counts.
   */
  const reachedLimit = () => {
    const limit = props.port.limit;
    return limit !== null && memories().length >= limit ? limit : null;
  };

  /** Hides or shows a memory while its delete waits. */
  function setHidden(memoryId: string, hide: boolean): void {
    if (hide) hidden.add(memoryId);
    else hidden.delete(memoryId);
    setHiddenIds(new Set(hidden));
    props.onCountChange(visibleCount(memories(), hidden));
  }

  async function loadMemories(showLoading = true): Promise<void> {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const [next, nextSelection] = await Promise.all([props.port.list(), props.port.selection?.read() ?? null]);
      setSelection(nextSelection);
      setMemories(next);
      props.onCountChange(visibleCount(next, hidden));
    } catch (caught) {
      setError(errorMessage(caught, t("memory.loadFailed")));
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  // The port is new after each activity of the agent, and an effect runs again for an equal value.
  // The memo keeps a memory edit until the owner changes.
  const ownerId = createMemo(() => props.port.ownerId);
  createEffect(
    () => [props.open, ownerId()] as const,
    ([open]) => {
      if (!open) return;
      setSelection(null);
      setEditingId(null);
      setAddOpen(false);
      setNewText("");
      setClearConfirmation(false);
      void untrack(() => loadMemories());
    },
  );

  createEffect(
    () => [props.open, props.port] as const,
    ([open, port]) => {
      if (!open) return;
      return port.subscribe(() => void loadMemories(false));
    },
  );

  async function createMemory(): Promise<void> {
    const text = newText().trim();
    if (!text || reachedLimit() !== null) return;
    const analytics = desktopAnalytics.scope();
    let operationSucceeded = false;
    setSavingId("new");
    setError(null);
    try {
      await props.port.create(text);
      analytics.track("memory_action", { action: "create", result: "succeeded" });
      operationSucceeded = true;
      setNewText("");
      // The composer closes after the reload, so the empty state does not show again for a moment.
      await loadMemories(false);
      setAddOpen(false);
    } catch (caught) {
      if (!operationSucceeded) {
        analytics.track("memory_action", { action: "create", result: "failed", failure_code: "create_failed" });
      }
      setError(errorMessage(caught, t("memory.saveFailed")));
    } finally {
      setSavingId(null);
    }
  }

  function startEditing(memory: MemoryEntry): void {
    if (savingId()) return;
    setEditingId(memory.id);
    setEditingText(memory.text);
    setAddOpen(false);
    setError(null);
    queueMicrotask(() => {
      editingInput?.focus();
      editingInput?.setSelectionRange(memory.text.length, memory.text.length);
    });
  }

  function openAddComposer(): void {
    setEditingId(null);
    setAddOpen(true);
    setError(null);
    queueMicrotask(() => newMemoryInput?.focus());
  }

  function cancelAddComposer(): void {
    setAddOpen(false);
    setNewText("");
  }

  async function updateMemory(memory: MemoryEntry): Promise<void> {
    const text = editingText().trim();
    if (!text) return;
    if (text === memory.text) {
      setEditingId(null);
      return;
    }
    const analytics = desktopAnalytics.scope();
    let operationSucceeded = false;
    setSavingId(memory.id);
    setError(null);
    try {
      await props.port.update(memory.id, text);
      analytics.track("memory_action", { action: "update", result: "succeeded" });
      operationSucceeded = true;
      setEditingId(null);
      await loadMemories(false);
    } catch (caught) {
      if (!operationSucceeded) {
        analytics.track("memory_action", { action: "update", result: "failed", failure_code: "update_failed" });
      }
      setError(errorMessage(caught, t("memory.updateFailed")));
    } finally {
      setSavingId(null);
    }
  }

  /**
   * The memory leaves the list at once, and a toast offers Undo. The host deletes the memory only when
   * the time is over, so an undo has nothing to restore. If the app quits before then, the memory stays.
   */
  function deleteMemory(memory: MemoryEntry): void {
    if (pendingDeletes.has(memory.id)) return;
    const port = props.port;
    const analytics = desktopAnalytics.scope();
    const toastId = `memory-delete-${port.ownerId}-${memory.id}`;
    if (editingId() === memory.id) setEditingId(null);
    setError(null);
    setHidden(memory.id, true);

    let settled = false;
    /** Undo and delete each end the same wait, so only the first of them runs. */
    function settle(): boolean {
      if (settled) return false;
      settled = true;
      pendingDeletes.delete(memory.id);
      // A cleanup can call this, and a write to the Toaster from there stops the reactive system.
      queueMicrotask(() => toast.dismiss(toastId));
      return true;
    }

    function undo(): void {
      if (settle()) setHidden(memory.id, false);
    }

    async function commit(): Promise<void> {
      if (!settle()) return;
      try {
        await port.remove(memory.id);
      } catch (caught) {
        analytics.track("memory_action", { action: "delete", result: "failed", failure_code: "delete_failed" });
        setHidden(memory.id, false);
        const message = errorMessage(caught, t("memory.deleteFailed"));
        setError(message);
        actionToast.error(message);
        return;
      }
      analytics.track("memory_action", { action: "delete", result: "succeeded" });
      await loadMemories(false);
    }

    pendingDeletes.set(memory.id, { commit: () => void commit(), settle });
    toast(t("memory.deleteUndo.title"), {
      id: toastId,
      duration: AGENT_DELETE_UNDO_MS,
      action: { label: t("memory.deleteUndo.action"), onClick: undo },
      onAutoClose: () => void commit(),
      onDismiss: () => void commit(),
    });
  }

  async function clearMemories(): Promise<void> {
    const analytics = desktopAnalytics.scope();
    let operationSucceeded = false;
    setSavingId("clear");
    setError(null);
    try {
      await props.port.clear();
      analytics.track("memory_action", { action: "clear", result: "succeeded" });
      operationSucceeded = true;
      // The clear removed the memories that wait for their undo time too, so nothing is left to delete.
      for (const pending of [...pendingDeletes.values()]) pending.settle();
      setClearConfirmation(false);
      setEditingId(null);
      await loadMemories(false);
    } catch (caught) {
      if (!operationSucceeded) {
        analytics.track("memory_action", { action: "clear", result: "failed", failure_code: "clear_failed" });
      }
      setError(errorMessage(caught, t("memory.clearFailed")));
    } finally {
      setSavingId(null);
    }
  }

  async function changeInclusion(
    memoryId: string,
    inclusion: SetAgentMemoryInclusionInput["changes"][number]["inclusion"],
  ): Promise<void> {
    const current = selectionById().get(memoryId);
    const port = props.port.selection;
    if (!current || !port || savingId()) return;
    setSavingId(memoryId);
    setError(null);
    try {
      setSelection(await port.set([{ memoryId, inclusion, expectedRevision: current.revision }]));
    } catch (caught) {
      // Refresh revisions after another client changes the selection, but keep the error visible.
      await loadMemories(false);
      setError(errorMessage(caught, t("memory.updateFailed")));
    } finally {
      setSavingId(null);
    }
  }

  function cancelConfirmation(): void {
    setClearConfirmation(false);
    queueMicrotask(() => confirmationTrigger?.focus());
  }

  return (
    <>
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
                <Dialog.Title>{t("memory.title")}</Dialog.Title>
                <Dialog.Description class="sr-only">
                  {t("memory.description", { name: props.port.ownerLabel })}
                </Dialog.Description>
              </div>
              <div class="agent-memories-header-actions">
                <IconButton
                  label={t("memory.add")}
                  class="agent-memories-add-button"
                  variant="ghost"
                  disabled={loading() || reachedLimit() !== null}
                  onClick={openAddComposer}
                >
                  <Plus />
                </IconButton>
                <IconButton label={t("memory.close")} variant="ghost" onClick={() => props.onOpenChange(false)}>
                  <X />
                </IconButton>
              </div>
            </header>

            <div class="agent-memories-body">
              {/* The selection explains how memories reach the agent, so it waits for the first memory. */}
              <Show when={visibleMemories().length > 0 ? selection() : null}>
                {(state) => (
                  <div class="agent-memory-limit">
                    <p>{t("memory.inclusion.explanation")}</p>
                    <p>
                      {t("memory.inclusion.capacity", {
                        used: format.fileSize(state().usedBytes),
                        total: format.fileSize(state().budgetBytes),
                      })}
                    </p>
                  </div>
                )}
              </Show>
              <Show when={addOpen()}>
                <section class="agent-memory-composer" aria-label={t("memory.add")}>
                  <Textarea
                    ref={(element) => (newMemoryInput = element)}
                    class="agent-memory-input"
                    rows="2"
                    maxlength={INPUT_LIMITS.agentMemoryText}
                    value={newText()}
                    placeholder={t("memory.newPlaceholder")}
                    aria-label={t("memory.new")}
                    onValueChange={setNewText}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        cancelAddComposer();
                      }
                      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault();
                        void createMemory();
                      }
                    }}
                  />
                  <div class="agent-memory-composer-actions">
                    <Button size="sm" variant="ghost" onClick={cancelAddComposer}>
                      {t("common.cancel")}
                    </Button>
                    <Button
                      size="sm"
                      variant="default"
                      disabled={!newText().trim()}
                      loading={savingId() === "new"}
                      onClick={() => void createMemory()}
                    >
                      {t("memory.save")}
                    </Button>
                  </div>
                </section>
              </Show>

              <Show when={reachedLimit()}>
                {(limit) => (
                  <p class="agent-memory-limit" role="status">
                    {t(LIMIT_TEXT[props.port.ownerNoun], { limit: limit() })}
                  </p>
                )}
              </Show>
              <Show when={!clearConfirmation() ? error() : null}>
                {(message) => (
                  <p class="agent-memory-error" role="alert">
                    {message()}
                  </p>
                )}
              </Show>

              <Show when={!loading()} fallback={<p class="agent-memory-state">{t("memory.loading")}</p>}>
                <Show
                  when={visibleMemories().length > 0}
                  fallback={
                    <Show when={!addOpen() && !error()}>
                      <AgentMemoriesEmpty
                        ownerNoun={props.port.ownerNoun}
                        ownerLabel={props.port.ownerLabel}
                        addDisabled={reachedLimit() !== null}
                        onAdd={openAddComposer}
                      />
                    </Show>
                  }
                >
                  <ul
                    ref={scrollFades.bind}
                    class={["agent-memory-list", scrollFades.classes()]}
                    onScroll={scrollFades.measure}
                  >
                    <For each={visibleMemories()} keyed={(memory) => memory.id}>
                      {(memory) => (
                        <li class="agent-memory-row">
                          <Show
                            when={editingId() === memory().id}
                            fallback={
                              <>
                                <Button
                                  type="button"
                                  class="agent-memory-row-main"
                                  variant="ghost"
                                  aria-label={t("memory.editText", { text: memory().text })}
                                  onClick={() => startEditing(memory())}
                                >
                                  <span class="agent-memory-text">{memory().text}</span>
                                  <span class="agent-memory-meta">
                                    {memory().origin === "automatic" ? t("memory.learned") : t("memory.manual")}
                                    {" · "}
                                    {formatMemoryDate(memory().updatedAt, t("memory.unknownDate"), format)}
                                    <Show when={selectionById().get(memory().id)}>
                                      {(entry) => (
                                        <>
                                          {" · "}
                                          {t(
                                            entry().inclusion === "essential"
                                              ? "memory.inclusion.essential"
                                              : "memory.inclusion.searchable",
                                          )}
                                          {" · "}
                                          {t(
                                            entry().userControlled
                                              ? "memory.inclusion.userControlled"
                                              : "memory.inclusion.agentControlled",
                                          )}
                                        </>
                                      )}
                                    </Show>
                                  </span>
                                </Button>
                                <IconButton
                                  label={t("memory.delete")}
                                  class="agent-memory-delete-button"
                                  variant="destructive-ghost"
                                  disabled={savingId() === memory().id}
                                  onClick={() => deleteMemory(memory())}
                                >
                                  <Trash2 />
                                </IconButton>
                              </>
                            }
                          >
                            <div class="agent-memory-editor">
                              <Show when={selectionById().get(memory().id)}>
                                {(entry) => {
                                  const currentInclusion = () =>
                                    t(
                                      entry().inclusion === "essential"
                                        ? "memory.inclusion.essential"
                                        : "memory.inclusion.searchable",
                                    );
                                  // The accessible name and the tooltip say the same: the choice and what applies now.
                                  const automaticLabel = () =>
                                    t("memory.inclusion.automaticCurrent", { current: currentInclusion() });
                                  return (
                                    <>
                                      <p class="agent-memory-meta">{currentInclusion()}</p>
                                      <fieldset
                                        class="agent-memory-inclusion-actions"
                                        aria-label={t("memory.inclusion.label")}
                                      >
                                        <Button
                                          size="sm"
                                          variant={
                                            entry().userControlled && entry().inclusion === "essential"
                                              ? "secondary"
                                              : "ghost"
                                          }
                                          aria-pressed={
                                            entry().userControlled && entry().inclusion === "essential"
                                              ? "true"
                                              : "false"
                                          }
                                          disabled={savingId() !== null}
                                          onClick={() => void changeInclusion(memory().id, "essential")}
                                        >
                                          {t("memory.inclusion.essential")}
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant={
                                            entry().userControlled && entry().inclusion === "searchable"
                                              ? "secondary"
                                              : "ghost"
                                          }
                                          aria-pressed={
                                            entry().userControlled && entry().inclusion === "searchable"
                                              ? "true"
                                              : "false"
                                          }
                                          disabled={savingId() !== null}
                                          onClick={() => void changeInclusion(memory().id, "searchable")}
                                        >
                                          {t("memory.inclusion.searchable")}
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant={!entry().userControlled ? "secondary" : "ghost"}
                                          aria-label={automaticLabel()}
                                          title={automaticLabel()}
                                          aria-pressed={!entry().userControlled ? "true" : "false"}
                                          disabled={savingId() !== null}
                                          onClick={() => void changeInclusion(memory().id, "automatic")}
                                        >
                                          {t("memory.inclusion.automatic")}
                                        </Button>
                                      </fieldset>
                                    </>
                                  );
                                }}
                              </Show>
                              <Textarea
                                ref={(element) => (editingInput = element)}
                                class="agent-memory-input"
                                rows="2"
                                maxlength={INPUT_LIMITS.agentMemoryText}
                                value={editingText()}
                                aria-label={t("memory.edit")}
                                onValueChange={setEditingText}
                                onKeyDown={(event) => {
                                  if (event.key !== "Escape") return;
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setEditingId(null);
                                }}
                              />
                              <div class="agent-memory-editor-actions">
                                <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                                  {t("common.cancel")}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="default"
                                  disabled={!editingText().trim()}
                                  loading={savingId() === memory().id}
                                  onClick={() => void updateMemory(memory())}
                                >
                                  {t("common.save")}
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
            <Show when={!loading() && visibleMemories().length > 0}>
              <footer class="agent-memories-footer">
                <Button
                  ref={(element) => (confirmationTrigger = element)}
                  size="sm"
                  variant="destructive"
                  onClick={() => setClearConfirmation(true)}
                >
                  {t("memory.clearAll")}
                </Button>
              </footer>
            </Show>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ConfirmDialog
        open={clearConfirmation()}
        onCancel={cancelConfirmation}
        onConfirm={clearMemories}
        title={t("memory.clearTitle")}
        description={t("memory.clearDescription", { total: visibleMemories().length, name: props.port.ownerLabel })}
        confirmLabel={t("memory.clearAll")}
        pending={savingId() === "clear"}
        error={error()}
        initialFocus="cancel"
      />
    </>
  );
}

function visibleCount(list: readonly MemoryEntry[], hidden: ReadonlySet<string>): number {
  return list.filter((memory) => !hidden.has(memory.id)).length;
}

function formatMemoryDate(value: string, unknown: string, format: AppFormat): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return unknown;
  return format.date(date, { dateStyle: "medium" });
}
