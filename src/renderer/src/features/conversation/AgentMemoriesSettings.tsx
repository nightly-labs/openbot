import type { AgentMemorySelectionChange, AgentMemorySelectionState, MemoryEntry } from "@openbot/contracts/ipc";
import { ConfirmDialog, toast } from "@openbot/ui";
import { AGENT_DELETE_UNDO_MS } from "@openbot/ui/features/agents/AgentDeleteUndoToast";
import { AgentMemoriesView } from "@openbot/ui/features/conversation/AgentMemoriesView";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, onCleanup, Show, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import { desktopAnalytics } from "../../analytics";
import type { MemoriesPort } from "./memories-port";

interface AgentMemoriesSettingsProps {
  port: MemoriesPort;
  open: boolean;
  onBack: () => void;
  onClose: () => void;
  onCountChange: (count: number) => void;
}

export function AgentMemoriesSettings(props: AgentMemoriesSettingsProps) {
  const { t, errorMessage } = useText();
  const [selection, setSelection] = createSignal<AgentMemorySelectionState | null>(null);
  const inclusionById = createMemo(() => {
    const state = selection();
    return state ? new Map(state.selections.map((entry) => [entry.memoryId, entry.inclusion])) : undefined;
  });
  const userControlled = createMemo(() => {
    const state = selection();
    return state
      ? new Set(state.selections.filter((entry) => entry.userControlled).map((entry) => entry.memoryId))
      : undefined;
  });
  const [memories, setMemories] = createSignal<MemoryEntry[]>([]);
  const hidden = new Set<string>();
  const [hiddenIds, setHiddenIds] = createSignal<ReadonlySet<string>>(new Set());
  const visibleMemories = createMemo(() => {
    const ids = hiddenIds();
    return ids.size === 0 ? memories() : memories().filter((memory) => !ids.has(memory.id));
  });
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [savingId, setSavingId] = createSignal<string | null>(null);
  const [clearConfirmation, setClearConfirmation] = createSignal(false);

  const pendingDeletes = new Map<string, { commit: () => void; settle: () => boolean }>();
  onCleanup(() => {
    for (const pending of [...pendingDeletes.values()]) pending.commit();
  });

  const reachedLimit = () => {
    const limit = props.port.limit;
    return limit !== null && memories().length >= limit ? limit : null;
  };

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

  const ownerId = createMemo(() => props.port.ownerId);
  createEffect(
    () => [props.open, ownerId()] as const,
    ([open]) => {
      if (!open) return;
      setSelection(null);
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

  async function createMemory(text: string): Promise<boolean> {
    if (reachedLimit() !== null) return false;
    const analytics = desktopAnalytics.scope();
    let operationSucceeded = false;
    setSavingId("new");
    setError(null);
    try {
      await props.port.create(text);
      analytics.track("memory_action", { action: "create", result: "succeeded" });
      operationSucceeded = true;
      await loadMemories(false);
      return true;
    } catch (caught) {
      if (!operationSucceeded) {
        analytics.track("memory_action", { action: "create", result: "failed", failure_code: "create_failed" });
      }
      setError(errorMessage(caught, t("memory.saveFailed")));
      return false;
    } finally {
      setSavingId(null);
    }
  }

  async function updateMemory(memory: MemoryEntry, text: string): Promise<boolean> {
    const analytics = desktopAnalytics.scope();
    let operationSucceeded = false;
    setSavingId(memory.id);
    setError(null);
    try {
      await props.port.update(memory.id, text);
      analytics.track("memory_action", { action: "update", result: "succeeded" });
      operationSucceeded = true;
      await loadMemories(false);
      return true;
    } catch (caught) {
      if (!operationSucceeded) {
        analytics.track("memory_action", { action: "update", result: "failed", failure_code: "update_failed" });
      }
      setError(errorMessage(caught, t("memory.updateFailed")));
      return false;
    } finally {
      setSavingId(null);
    }
  }

  function deleteMemory(memory: MemoryEntry): void {
    if (pendingDeletes.has(memory.id)) return;
    const port = props.port;
    const analytics = desktopAnalytics.scope();
    const toastId = `memory-delete-${port.ownerId}-${memory.id}`;
    setError(null);
    setHidden(memory.id, true);

    let settled = false;
    function settle(): boolean {
      if (settled) return false;
      settled = true;
      pendingDeletes.delete(memory.id);
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
      for (const pending of [...pendingDeletes.values()]) pending.settle();
      setClearConfirmation(false);
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

  async function setInclusion(memory: MemoryEntry, inclusion: AgentMemorySelectionChange["inclusion"]): Promise<void> {
    const current = selection()?.selections.find((entry) => entry.memoryId === memory.id);
    const port = props.port.selection;
    if (!current || !port || savingId()) return;
    setSavingId(memory.id);
    setError(null);
    try {
      setSelection(
        await port.set([
          {
            memoryId: memory.id,
            inclusion,
            expectedRevision: current.revision,
          },
        ]),
      );
    } catch (caught) {
      await loadMemories(false);
      setError(errorMessage(caught, t("memory.updateFailed")));
    } finally {
      setSavingId(null);
    }
  }

  const pageError = () => (clearConfirmation() ? null : error());

  return (
    <>
      <Show when={props.open}>
        <AgentMemoriesView
          ownerNoun={props.port.ownerNoun}
          ownerLabel={props.port.ownerLabel}
          memories={visibleMemories()}
          inclusion={inclusionById()}
          userControlled={userControlled()}
          loading={loading()}
          error={pageError()}
          reachedLimit={reachedLimit()}
          savingId={savingId()}
          onBack={props.onBack}
          onClose={props.onClose}
          onCreate={createMemory}
          onUpdate={updateMemory}
          onDelete={deleteMemory}
          onSetEveryChat={(memory, everyChat) => void setInclusion(memory, everyChat ? "essential" : "searchable")}
          onLetAgentDecide={(memory) => void setInclusion(memory, "automatic")}
          onClearAll={() => setClearConfirmation(true)}
        />
      </Show>
      <ConfirmDialog
        open={clearConfirmation()}
        onCancel={() => setClearConfirmation(false)}
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
