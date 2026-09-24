import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { RoutineFields, RoutineRunFields, RoutineSchedule } from "@openbot/contracts/ipc";
import { Button, CirclePause, Clock3, ConfirmDialog, Input, Plus, Switch, Textarea } from "@openbot/ui";
import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import { SettingsBackIcon, SettingsForwardIcon } from "@openbot/ui/components/SettingsPanel";
import { errorMessage } from "@openbot/ui/error-message";
import { RoutineRunHistory } from "@openbot/ui/features/conversation/RoutineRunHistory";
import { RoutineSchedulePicker } from "@openbot/ui/features/conversation/RoutineSchedulePicker";
import {
  ROUTINE_EVERY_DAY,
  type RoutineScheduleDraft,
  routineDraftSummary,
} from "@openbot/ui/features/conversation/routine-schedule-draft";
import {
  ROUTINE_SAVED_DRAFT_KINDS,
  routineDraftProblem,
  routineScheduleFromDraft,
  routineScheduleToDraft,
} from "@openbot/ui/features/conversation/routine-schedule-saved";
import { routineScheduleSummary } from "@openbot/ui/features/conversation/routine-schedule-ui";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { type DesktopAnalyticsScope, desktopAnalytics } from "../../analytics";
import type { RoutinesPort } from "./routines-port";

export interface RoutineSelectionRequest {
  routineId: string;
  routineName: string;
  nonce: number;
}

type PendingRoutineExit =
  | "list"
  | "close"
  | { kind: "routine-selection"; routine: RoutineFields | null; routineName: string }
  | { kind: "conversation-message"; messageId: string };

interface RoutineDraft {
  id: string | null;
  name: string;
  instruction: string;
  active: boolean;
  /** Saved as it is until the user changes a chip, so a rename keeps a schedule the chips cannot show. */
  schedule: RoutineSchedule;
  scheduleDraft: RoutineScheduleDraft;
}

const NEW_ROUTINE_SCHEDULE: RoutineScheduleDraft = { kind: "daily", days: ROUTINE_EVERY_DAY, time: "09:00" };

interface AgentRoutinesSettingsProps {
  /** Names the owner and owns every call. A channel passes `channelRoutinesPort` here. */
  port: RoutinesPort;
  onCountChange: (count: number) => void;
  onBack?: () => void;
  onClose?: () => void;
  selectionRequest?: RoutineSelectionRequest | null;
  onSelectionRequestHandled?: (nonce: number) => void;
  onOpenRun?: (messageId: string) => void;
}

export function AgentRoutinesSettings(props: AgentRoutinesSettingsProps) {
  const [routines, setRoutines] = createSignal<RoutineFields[]>([]);
  const [draft, setDraft] = createSignal<RoutineDraft | null>(null);
  const [runs, setRuns] = createSignal<RoutineRunFields[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [routinesLoaded, setRoutinesLoaded] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [dirty, setDirty] = createSignal(false);
  const [testing, setTesting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const [pendingExit, setPendingExit] = createSignal<PendingRoutineExit | null>(null);
  const scrollFades = createScrollFades();
  let draftRevision = 0;
  // The saved routine the open draft started from. A field that still matches it is unedited.
  let draftBase: RoutineFields | null = null;

  onCleanup(scrollFades.stop);

  async function loadRoutines(): Promise<void> {
    try {
      const next = await props.port.list();
      setRoutines(next);
      setRoutinesLoaded(true);
      props.onCountChange(next.length);
      const selectedId = draft()?.id;
      const selected = selectedId ? next.find((routine) => routine.id === selectedId) : undefined;
      if (selectedId && !selected) closeEditor();
      if (selected) refreshDraft(selected);
    } catch (caught) {
      setRoutinesLoaded(false);
      setError(errorMessage(caught, "Could not load routines."));
    } finally {
      setLoading(false);
    }
  }

  async function loadRuns(routineId: string): Promise<void> {
    try {
      setRuns(await props.port.listRuns(routineId, 10));
    } catch (caught) {
      setError(errorMessage(caught, "Could not load run history."));
    }
  }

  createEffect(
    () => props.port,
    (port) =>
      port.subscribe(() => {
        void loadRoutines();
        const routineId = draft()?.id;
        if (routineId) void loadRuns(routineId);
      }),
  );

  createEffect(
    () => props.port.ownerId,
    () => {
      closeEditor();
      setLoading(true);
      setRoutinesLoaded(false);
      void loadRoutines();
    },
  );

  let lastSelectionRequestNonce: number | undefined;
  createEffect(
    () => ({
      request: props.selectionRequest,
      loading: loading(),
      loaded: routinesLoaded(),
      routines: routines(),
    }),
    ({ request, loading: isLoading, loaded, routines: currentRoutines }) => {
      if (!request || isLoading || request.nonce === lastSelectionRequestNonce) return;
      lastSelectionRequestNonce = request.nonce;
      props.onSelectionRequestHandled?.(request.nonce);
      if (!loaded) return;
      requestRoutineSelection(request, currentRoutines.find((routine) => routine.id === request.routineId) ?? null);
    },
  );

  createEffect(
    () => [draft(), routines().length, runs().length, loading(), confirmDelete(), error()] as const,
    () => {
      scrollFades.remeasure();
    },
  );

  /**
   * Takes a change saved elsewhere, such as from a chat card, into each field the person did not
   * edit here. Without it, the next Save would write the old values back.
   */
  function refreshDraft(routine: RoutineFields): void {
    const base = draftBase;
    draftBase = routine;
    if (base?.id !== routine.id) return;
    setDraft((current) => {
      if (current?.id !== routine.id) return current;
      const scheduleEdited = JSON.stringify(current.schedule) !== JSON.stringify(base.trigger.schedule);
      return {
        ...current,
        name: current.name === base.name ? routine.name : current.name,
        instruction: current.instruction === base.instruction ? routine.instruction : current.instruction,
        active: current.active === base.active ? routine.active : current.active,
        ...(scheduleEdited
          ? {}
          : {
              schedule: structuredClone(routine.trigger.schedule),
              scheduleDraft: routineScheduleToDraft(routine.trigger.schedule),
            }),
      };
    });
  }

  function openRoutine(routine: RoutineFields): void {
    draftBase = routine;
    setConfirmDelete(false);
    setError(null);
    draftRevision = 0;
    setDirty(false);
    setDraft({
      id: routine.id,
      name: routine.name,
      instruction: routine.instruction,
      active: routine.active,
      schedule: structuredClone(routine.trigger.schedule),
      scheduleDraft: routineScheduleToDraft(routine.trigger.schedule),
    });
    void loadRuns(routine.id);
  }

  function createDraft(): void {
    draftBase = null;
    setConfirmDelete(false);
    setRuns([]);
    setError(null);
    draftRevision = 0;
    setDirty(false);
    setDraft({
      id: null,
      name: "",
      instruction: "",
      active: true,
      schedule: routineScheduleFromDraft(NEW_ROUTINE_SCHEDULE),
      scheduleDraft: NEW_ROUTINE_SCHEDULE,
    });
  }

  function closeEditor(): void {
    draftBase = null;
    setDraft(null);
    setRuns([]);
    setError(null);
    draftRevision = 0;
    setDirty(false);
    setConfirmDelete(false);
    setPendingExit(null);
  }

  function requestRoutineSelection(request: RoutineSelectionRequest, routine: RoutineFields | null): void {
    const current = draft();
    if (routine && current?.id === routine.id) {
      if (!dirty()) openRoutine(routine);
      return;
    }
    const target: PendingRoutineExit = {
      kind: "routine-selection",
      routine,
      routineName: request.routineName,
    };
    if (current && dirty() && !isBlankNewDraft(current)) {
      setPendingExit(target);
      return;
    }
    performExit(target);
  }

  function requestExit(target: PendingRoutineExit): void {
    if (saving()) return;
    const current = draft();
    if (current && dirty() && !isBlankNewDraft(current)) {
      setPendingExit(target);
      return;
    }
    performExit(target);
  }

  function requestOpenRun(messageId: string): void {
    requestExit({ kind: "conversation-message", messageId });
  }

  function performExit(target: PendingRoutineExit): void {
    setPendingExit(null);
    if (target === "list") {
      closeEditor();
      return;
    }
    if (target === "close") {
      props.onClose?.();
      return;
    }
    if (target.kind === "conversation-message") {
      props.onOpenRun?.(target.messageId);
      return;
    }
    closeEditor();
    if (target.routine) {
      openRoutine(target.routine);
      return;
    }
    setError(`Routine "${target.routineName}" no longer exists.`);
  }

  function discardChanges(): void {
    const target = pendingExit();
    if (target) performExit(target);
  }

  function changeDraft(change: (current: RoutineDraft) => RoutineDraft): void {
    setDraft((current) => (current ? change(current) : current));
    draftRevision += 1;
    setDirty(true);
  }

  async function saveDraft(): Promise<void> {
    const current = draft();
    if (!current || !dirty() || !validDraft(current) || saving()) return;
    const savingRevision = draftRevision;
    setSaving(true);
    setError(null);
    const startedAt = performance.now();
    const action = current.id ? "update" : "create";
    const analytics = desktopAnalytics.scope();
    try {
      const saved = await props.port.save({
        routineId: current.id,
        name: current.name.trim(),
        instruction: current.instruction.trim(),
        active: current.active,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        schedule: current.schedule,
      });
      setRoutines((items) => {
        const next = [saved, ...items.filter((routine) => routine.id !== saved.id)];
        props.onCountChange(next.length);
        return next;
      });
      setDraft((latest) => (latest && latest.id === current.id ? { ...latest, id: saved.id } : latest));
      if (draft()?.id === current.id) draftBase = saved;
      if (draftRevision === savingRevision) setDirty(false);
      if (!current.id) void loadRuns(saved.id);
      trackRoutineAction(analytics, action, current.schedule, startedAt, "succeeded");
    } catch (caught) {
      trackRoutineAction(analytics, action, current.schedule, startedAt, "failed");
      setError(errorMessage(caught, "Could not save this routine."));
    } finally {
      setSaving(false);
    }
  }

  async function deleteRoutine(): Promise<void> {
    const current = draft();
    if (!current?.id) {
      closeEditor();
      return;
    }
    const startedAt = performance.now();
    const analytics = desktopAnalytics.scope();
    try {
      await props.port.remove(current.id);
      setRoutines((items) => {
        const next = items.filter((routine) => routine.id !== current.id);
        props.onCountChange(next.length);
        return next;
      });
      closeEditor();
      trackRoutineAction(analytics, "delete", current.schedule, startedAt, "succeeded");
    } catch (caught) {
      trackRoutineAction(analytics, "delete", current.schedule, startedAt, "failed");
      setError(errorMessage(caught, "Could not delete this routine."));
    }
  }

  async function testRun(): Promise<void> {
    const current = draft();
    if (!current?.id || testing()) return;
    setTesting(true);
    setError(null);
    const startedAt = performance.now();
    const analytics = desktopAnalytics.scope();
    try {
      await props.port.test(current.id);
      trackRoutineAction(analytics, "test", current.schedule, startedAt, "succeeded");
      await loadRuns(current.id);
    } catch (caught) {
      trackRoutineAction(analytics, "test", current.schedule, startedAt, "failed");
      setError(errorMessage(caught, "Could not start the test run."));
    } finally {
      setTesting(false);
    }
  }

  return (
    <div class="agent-routines-settings">
      <header class="settings-panel-header agent-routines-header">
        <Button
          variant="ghost"
          type="button"
          class="settings-panel-nav-button"
          aria-label={draft() ? "Back to Routines" : "Back to settings"}
          disabled={Boolean(draft() && saving())}
          onClick={() => (draft() ? requestExit("list") : props.onBack?.())}
        >
          <SettingsBackIcon />
        </Button>
        <div class="agent-routines-heading">
          <h2>{draft() ? "Routine" : "Routines"}</h2>
        </div>
        <Show
          when={!draft()}
          fallback={
            <Button
              variant="ghost"
              type="button"
              class="settings-panel-nav-button"
              aria-label="Close details"
              disabled={saving()}
              onClick={() => requestExit("close")}
            >
              <SettingsForwardIcon />
            </Button>
          }
        >
          <Button
            variant="ghost"
            type="button"
            class="settings-panel-nav-button"
            aria-label="Create Routine"
            onClick={createDraft}
          >
            <Plus aria-hidden="true" />
          </Button>
        </Show>
      </header>
      <div ref={scrollFades.bind} class={["agent-routines-body", scrollFades.classes()]} onScroll={scrollFades.measure}>
        <Show
          when={draft()}
          fallback={
            <div class="agent-routines-list-view">
              <Show when={!loading()} fallback={<p class="agent-routines-empty">Loading routines…</p>}>
                <Show when={routines().length > 0} fallback={<p class="agent-routines-empty">No routines yet.</p>}>
                  <div class="agent-routines-list">
                    <For each={routines()}>
                      {(routine) => (
                        <Button
                          variant="ghost"
                          type="button"
                          class="agent-routine-row"
                          onClick={() => openRoutine(routine)}
                        >
                          <span
                            class={
                              routine.active ? "agent-routine-status-icon-active" : "agent-routine-status-icon-paused"
                            }
                          >
                            <Show when={routine.active} fallback={<CirclePause aria-hidden="true" />}>
                              <Clock3 aria-hidden="true" />
                            </Show>
                          </span>
                          <span>
                            <strong>{routine.name}</strong>
                            <small>{routine.active ? routineListSummary(routine.trigger.schedule) : "Paused"}</small>
                          </span>
                        </Button>
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
            </div>
          }
        >
          {(current) => (
            <div class="agent-routine-editor">
              <div class="agent-routine-editor-actions">
                <div class="agent-routine-active-toggle">
                  <Switch
                    id="routine-active"
                    aria-label="Routine active"
                    checked={current().active}
                    onChange={(active) => changeDraft((value) => ({ ...value, active }))}
                  />
                  <label for="routine-active">{current().active ? "Active" : "Paused"}</label>
                </div>
                <div class="agent-routine-action-buttons">
                  <Show
                    when={!confirmDelete()}
                    fallback={
                      <>
                        <Button variant="destructive" type="button" size="sm" onClick={() => void deleteRoutine()}>
                          Delete now
                        </Button>
                        <Button variant="secondary" type="button" size="sm" onClick={() => setConfirmDelete(false)}>
                          Cancel
                        </Button>
                      </>
                    }
                  >
                    <Button variant="destructive" type="button" size="sm" onClick={() => setConfirmDelete(true)}>
                      Delete
                    </Button>
                    <Show
                      when={dirty()}
                      fallback={
                        <Button
                          type="button"
                          size="sm"
                          class="agent-routine-test"
                          disabled={!current().id || testing() || !validDraft(current())}
                          loading={testing()}
                          loadingLabel="Starting…"
                          onClick={() => void testRun()}
                        >
                          Test run
                        </Button>
                      }
                    >
                      <Button
                        type="button"
                        size="sm"
                        disabled={saving() || !validDraft(current())}
                        loading={saving()}
                        loadingLabel="Saving…"
                        onClick={() => void saveDraft()}
                      >
                        Save
                      </Button>
                    </Show>
                  </Show>
                </div>
              </div>

              <label class="settings-field">
                <span>Name</span>
                <Input
                  value={current().name}
                  placeholder="Morning brief"
                  maxlength={INPUT_LIMITS.routineName}
                  onValueChange={(name) => changeDraft((value) => ({ ...value, name }))}
                />
              </label>
              <section class="agent-routine-when" aria-labelledby="agent-routine-when-heading">
                <h3 id="agent-routine-when-heading">When to run</h3>
                <RoutineSchedulePicker
                  schedule={current().scheduleDraft}
                  kinds={ROUTINE_SAVED_DRAFT_KINDS}
                  onChange={(scheduleDraft) =>
                    changeDraft((value) => ({
                      ...value,
                      schedule: routineScheduleFromDraft(scheduleDraft),
                      scheduleDraft,
                    }))
                  }
                />
              </section>
              <label class="settings-field agent-routine-instruction-field">
                <span>Instruction</span>
                <Textarea
                  value={current().instruction}
                  placeholder={`Describe what this ${props.port.ownerNoun} should do.`}
                  maxlength={INPUT_LIMITS.routineInstruction}
                  onValueChange={(instruction) => changeDraft((value) => ({ ...value, instruction }))}
                />
              </label>

              <RoutineRunHistory runs={runs()} onOpenRun={props.onOpenRun ? requestOpenRun : undefined} />
            </div>
          )}
        </Show>
        <Show when={error()}>
          {(message) => (
            <p class="agent-settings-save-error" role="alert">
              {message()}
            </p>
          )}
        </Show>
      </div>
      <ConfirmDialog
        open={pendingExit() !== null}
        onCancel={() => setPendingExit(null)}
        onConfirm={discardChanges}
        title="Discard changes?"
        description="Your unsaved changes to this routine will be lost."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        initialFocus="cancel"
      />
    </div>
  );
}

/**
 * The list row reads the schedule as the chips do. A schedule the chips show only as cron, such
 * as an interval, keeps its own summary: "Every 15 minutes", not the cron text.
 */
function routineListSummary(schedule: RoutineSchedule): string {
  const draft = routineScheduleToDraft(schedule);
  if (draft.kind === "custom") return routineScheduleSummary(schedule);
  return routineDraftSummary(draft);
}

function validDraft(draft: RoutineDraft): boolean {
  return Boolean(draft.name.trim() && draft.instruction.trim()) && routineDraftProblem(draft.scheduleDraft) === null;
}

function isBlankNewDraft(draft: RoutineDraft): boolean {
  return draft.id === null && !draft.name.trim() && !draft.instruction.trim();
}

function trackRoutineAction(
  analytics: DesktopAnalyticsScope,
  action: "create" | "update" | "delete" | "test",
  schedule: RoutineSchedule,
  startedAt: number,
  result: "succeeded" | "failed",
): void {
  analytics.track("routine_action", {
    action,
    trigger_type: schedule.kind,
    duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
    result,
    ...(result === "failed" ? { failure_code: `${action}_failed` } : {}),
  });
}
