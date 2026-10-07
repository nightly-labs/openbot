import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  ROUTINE_LIMIT_POLICIES,
  type RoutineLimitPolicy,
  type RoutineRunFields,
  type RoutineSchedule,
} from "@openbot/contracts/ipc";
import type { EventFilter, EventRoutine, EventRoutineTrigger, EventSource } from "@openbot/contracts/ipc-events";
import type { AppTextKey } from "@openbot/i18n";
import {
  Button,
  CirclePause,
  Clock3,
  ConfirmDialog,
  Input,
  Plus,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Text,
  Textarea,
  toast,
  X,
} from "@openbot/ui";
import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import { SettingsBackIcon, SettingsForwardIcon } from "@openbot/ui/components/SettingsPanel";
import { RoutineRunHistory } from "@openbot/ui/features/conversation/RoutineRunHistory";
import { RoutineSchedulePicker } from "@openbot/ui/features/conversation/RoutineSchedulePicker";
import { RoutineWebhookNotifications } from "@openbot/ui/features/conversation/RoutineWebhookNotifications";
import { RoutineWebhookSource } from "@openbot/ui/features/conversation/RoutineWebhookSource";
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
import { type RoutineText, routineScheduleSummary } from "@openbot/ui/features/conversation/routine-schedule-ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import { type DesktopAnalyticsScope, desktopAnalytics } from "../../analytics";
import { writeClipboardText } from "../../clipboard";
import type { RoutineEditorRecord, RoutinesPort } from "./routines-port";

export interface RoutineSelectionRequest {
  routineId: string;
  routineName: string;
  nonce: number;
}

type PendingRoutineExit =
  | "list"
  | "close"
  | { kind: "routine-selection"; routine: RoutineEditorRecord | null; routineName: string }
  | { kind: "conversation-message"; messageId: string };

interface RoutineDraft {
  id: string | null;
  name: string;
  instruction: string;
  active: boolean;
  /** Saved as it is until the user changes a chip, so a rename keeps a schedule the chips cannot show. */
  schedule: RoutineSchedule;
  scheduleDraft: RoutineScheduleDraft;
  limitPolicy: RoutineLimitPolicy;
  triggerKind: "schedule" | "event";
  eventSourceId: string;
  eventType: string;
  eventFilters: EventFilter[];
}

const LIMIT_POLICY_LABELS = {
  wait: "routine.settings.limitPolicy.wait",
  skip: "routine.settings.limitPolicy.skip",
} as const satisfies Record<RoutineLimitPolicy, AppTextKey>;

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
  const text = useText();
  const { t, errorMessage } = text;
  const [routines, setRoutines] = createSignal<RoutineEditorRecord[]>([]);
  const [draft, setDraft] = createSignal<RoutineDraft | null>(null);
  const [runs, setRuns] = createSignal<RoutineRunFields[]>([]);
  const [notificationsOpen, setNotificationsOpen] = createSignal(false);
  const [eventSources, setEventSources] = createSignal<EventSource[]>([]);
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
  let draftBase: RoutineEditorRecord | null = null;

  onCleanup(scrollFades.stop);

  // Only the newest list applies: an older response can arrive after a save and undo it.
  let listRequest = 0;

  async function loadRoutines(): Promise<void> {
    const request = ++listRequest;
    try {
      const next = await props.port.list();
      if (request !== listRequest) return;
      setRoutines(next);
      setRoutinesLoaded(true);
      props.onCountChange(next.length);
      const selectedId = draft()?.id;
      const selected = selectedId ? next.find((routine) => routine.id === selectedId) : undefined;
      if (selectedId && !selected) closeEditor();
      if (selected) refreshDraft(selected);
    } catch (caught) {
      if (request !== listRequest) return;
      setRoutinesLoaded(false);
      setError(errorMessage(caught, t("routine.settings.loadFailed")));
    } finally {
      if (request === listRequest) setLoading(false);
    }
  }

  async function loadRuns(routineId: string): Promise<void> {
    try {
      setRuns(await props.port.listRuns(routineId, 10));
    } catch (caught) {
      setError(errorMessage(caught, t("routine.settings.loadRunsFailed")));
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
      setNotificationsOpen(false);
      closeEditor();
      setLoading(true);
      setRoutinesLoaded(false);
      void untrack(loadRoutines);
    },
  );

  createEffect(
    () => Boolean(props.port.eventSources) && draft()?.triggerKind === "event",
    (visible) => {
      if (!visible) return;
      void props.port
        .eventSources?.()
        .then(setEventSources, (cause) => setError(errorMessage(cause, t("server.events.loadFailed"))));
    },
  );

  createEffect(
    () => draft()?.id,
    () => {
      setNotificationsOpen(false);
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
  function refreshDraft(routine: RoutineEditorRecord): void {
    const base = draftBase;
    draftBase = routine;
    if (base?.id !== routine.id) return;
    setDraft((current) => {
      if (current?.id !== routine.id) return current;
      const scheduleEdited = JSON.stringify(current.schedule) !== JSON.stringify(routineScheduleOf(base));
      const eventEdited =
        current.triggerKind === "event" &&
        JSON.stringify(eventTriggerOf(current)) !== JSON.stringify(eventTriggerOf(base));
      return {
        ...current,
        name: current.name === base.name ? routine.name : current.name,
        instruction: current.instruction === base.instruction ? routine.instruction : current.instruction,
        active: current.active === base.active ? routine.active : current.active,
        limitPolicy:
          current.limitPolicy === (base.limitPolicy ?? "wait") ? (routine.limitPolicy ?? "wait") : current.limitPolicy,
        ...(scheduleEdited || eventEdited
          ? {}
          : {
              schedule: structuredClone(routineScheduleOf(routine)),
              scheduleDraft: routineScheduleToDraft(routineScheduleOf(routine)),
              triggerKind: routineTriggerKind(routine),
              eventSourceId: eventTriggerOf(routine)?.sourceId ?? "",
              eventType: eventTriggerOf(routine)?.eventType ?? "",
              eventFilters: structuredClone(eventTriggerOf(routine)?.filters ?? []),
            }),
      };
    });
  }

  function openRoutine(routine: RoutineEditorRecord): void {
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
      schedule: structuredClone(routineScheduleOf(routine)),
      scheduleDraft: routineScheduleToDraft(routineScheduleOf(routine)),
      limitPolicy: routine.limitPolicy ?? "wait",
      triggerKind: routineTriggerKind(routine),
      eventSourceId: eventTriggerOf(routine)?.sourceId ?? "",
      eventType: eventTriggerOf(routine)?.eventType ?? "",
      eventFilters: structuredClone(eventTriggerOf(routine)?.filters ?? []),
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
      limitPolicy: "wait",
      triggerKind: "schedule",
      eventSourceId: "",
      eventType: "",
      eventFilters: [],
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

  function requestRoutineSelection(request: RoutineSelectionRequest, routine: RoutineEditorRecord | null): void {
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
    setError(t("routine.settings.missing", { name: target.routineName }));
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
    if (!current || !dirty() || !validDraft(current, eventSources()) || saving()) return;
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
        trigger:
          current.triggerKind === "event"
            ? {
                kind: "event",
                sourceId: current.eventSourceId,
                eventType: current.eventType.trim(),
                filters: current.eventFilters,
              }
            : { kind: "schedule", schedule: current.schedule },
        limitPolicy: current.limitPolicy,
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
      setError(errorMessage(caught, t("routine.settings.saveFailed")));
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
      setError(errorMessage(caught, t("routine.settings.deleteFailed")));
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
      setError(errorMessage(caught, t("routine.settings.testFailed")));
    } finally {
      setTesting(false);
    }
  }

  async function copyRunCommand(): Promise<void> {
    const routineId = draft()?.id;
    const runCommand = props.port.runCommand;
    if (!routineId || !runCommand) return;
    setError(null);
    try {
      await writeClipboardText(await runCommand(routineId));
      toast.success(t("routine.settings.runCommandCopied"));
    } catch (caught) {
      setError(errorMessage(caught, t("routine.settings.copyRunCommandFailed")));
    }
  }

  return (
    <div class="agent-routines-settings">
      <header class="settings-panel-header agent-routines-header">
        <Button
          variant="ghost"
          type="button"
          class="settings-panel-nav-button"
          aria-label={draft() ? t("routine.settings.backToRoutines") : t("routine.settings.backToSettings")}
          disabled={Boolean(draft() && saving())}
          onClick={() => (draft() ? requestExit("list") : props.onBack?.())}
        >
          <SettingsBackIcon />
        </Button>
        <div class="agent-routines-heading">
          <h2>{draft() ? t("routine.settings.routine") : t("routine.settings.routines")}</h2>
        </div>
        <Show
          when={!draft()}
          fallback={
            <Button
              variant="ghost"
              type="button"
              class="settings-panel-nav-button"
              aria-label={t("routine.settings.closeDetails")}
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
            aria-label={t("routine.settings.create")}
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
              <Show when={!loading()} fallback={<p class="agent-routines-empty">{t("routine.settings.loading")}</p>}>
                <Show
                  when={routines().length > 0}
                  fallback={<p class="agent-routines-empty">{t("routine.settings.empty")}</p>}
                >
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
                            <small>
                              {routine.active ? routineListSummary(routine, text) : t("routine.settings.paused")}
                            </small>
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
                    aria-label={t("routine.settings.activeToggle")}
                    checked={current().active}
                    onChange={(active) => changeDraft((value) => ({ ...value, active }))}
                  />
                  <label for="routine-active">
                    {current().active ? t("routine.settings.active") : t("routine.settings.paused")}
                  </label>
                </div>
                <div class="agent-routine-action-buttons">
                  <Show
                    when={!confirmDelete()}
                    fallback={
                      <>
                        <Button variant="destructive" type="button" size="sm" onClick={() => void deleteRoutine()}>
                          {t("routine.settings.deleteNow")}
                        </Button>
                        <Button variant="secondary" type="button" size="sm" onClick={() => setConfirmDelete(false)}>
                          {t("common.cancel")}
                        </Button>
                      </>
                    }
                  >
                    <Button variant="destructive" type="button" size="sm" onClick={() => setConfirmDelete(true)}>
                      {t("common.delete")}
                    </Button>
                    <Show
                      when={dirty()}
                      fallback={
                        <>
                          <Show when={props.port.runCommand && current().id}>
                            <Button variant="secondary" type="button" size="sm" onClick={() => void copyRunCommand()}>
                              {t("routine.settings.copyRunCommand")}
                            </Button>
                          </Show>
                          <Button
                            type="button"
                            size="sm"
                            class="agent-routine-test"
                            disabled={!current().id || testing() || !validDraft(current(), eventSources())}
                            loading={testing()}
                            loadingLabel={t("routine.settings.starting")}
                            onClick={() => void testRun()}
                          >
                            {t("routine.settings.testRun")}
                          </Button>
                        </>
                      }
                    >
                      <Button
                        type="button"
                        size="sm"
                        disabled={saving() || !validDraft(current(), eventSources())}
                        loading={saving()}
                        loadingLabel={t("common.saving")}
                        onClick={() => void saveDraft()}
                      >
                        {t("common.save")}
                      </Button>
                    </Show>
                  </Show>
                </div>
              </div>

              <label class="settings-field">
                <span>{t("routine.settings.name")}</span>
                <Input
                  value={current().name}
                  placeholder={t("routine.settings.namePlaceholder")}
                  maxlength={INPUT_LIMITS.routineName}
                  onValueChange={(name) => changeDraft((value) => ({ ...value, name }))}
                />
              </label>
              <section class="agent-routine-when" aria-labelledby="agent-routine-when-heading">
                <h3 id="agent-routine-when-heading">{t("routine.settings.whenToRun")}</h3>
                <Show when={props.port.eventSources}>
                  <div class="agent-routine-trigger-choice">
                    <For each={["schedule", "event"] as const}>
                      {(kind) => (
                        <Button
                          type="button"
                          size="sm"
                          variant={current().triggerKind === kind ? "secondary" : "ghost"}
                          aria-pressed={current().triggerKind === kind ? "true" : "false"}
                          onClick={() => changeDraft((value) => ({ ...value, triggerKind: kind }))}
                        >
                          {t(kind === "event" ? "routine.settings.triggerEvent" : "routine.settings.triggerSchedule")}
                        </Button>
                      )}
                    </For>
                  </div>
                </Show>
                <Show
                  when={current().triggerKind === "schedule"}
                  fallback={
                    <div class="agent-routine-event-trigger">
                      <Show when={props.port.webhooks}>
                        {(api) => (
                          <RoutineWebhookSource
                            api={api()}
                            sources={eventSources()}
                            sourceId={current().eventSourceId}
                            name={current().name}
                            onChange={(eventSourceId) => changeDraft((value) => ({ ...value, eventSourceId }))}
                            onSourcesChange={setEventSources}
                          />
                        )}
                      </Show>
                      <EventTriggerFields draft={current()} onChange={changeDraft} />
                    </div>
                  }
                >
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
                </Show>
              </section>
              <label class="settings-field agent-routine-instruction-field">
                <span>{t("routine.settings.instruction")}</span>
                <Textarea
                  value={current().instruction}
                  placeholder={
                    props.port.ownerNoun === "channel"
                      ? t("routine.settings.instructionPlaceholderChannel")
                      : t("routine.settings.instructionPlaceholderAgent")
                  }
                  maxlength={INPUT_LIMITS.routineInstruction}
                  onValueChange={(instruction) => changeDraft((value) => ({ ...value, instruction }))}
                />
              </label>
              <Show when={props.port.limitPolicy}>
                <div class="settings-field">
                  <span id="agent-routine-limit-policy-label">{t("routine.settings.limitPolicy")}</span>
                  <Select<RoutineLimitPolicy>
                    options={[...ROUTINE_LIMIT_POLICIES]}
                    value={current().limitPolicy}
                    onChange={(limitPolicy) => {
                      if (limitPolicy) changeDraft((value) => ({ ...value, limitPolicy }));
                    }}
                    itemComponent={(item) => (
                      <SelectItem item={item.item}>{t(LIMIT_POLICY_LABELS[item.item.rawValue])}</SelectItem>
                    )}
                  >
                    <SelectTrigger aria-labelledby="agent-routine-limit-policy-label">
                      <SelectValue<RoutineLimitPolicy>>
                        {(state) => t(LIMIT_POLICY_LABELS[state.selectedOption()])}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent />
                  </Select>
                </div>
              </Show>

              <Show when={props.port.webhooks && current().id}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="agent-routine-disclosure"
                  aria-expanded={notificationsOpen() ? "true" : "false"}
                  onClick={() => setNotificationsOpen((value) => !value)}
                >
                  {t("routine.settings.notifications")}
                </Button>
                <Show when={notificationsOpen()}>
                  <Show when={props.port.webhooks}>
                    {(api) => (
                      <RoutineWebhookNotifications
                        api={api()}
                        canManage={true}
                        routineId={current().id ?? ""}
                        sourceId={current().eventSourceId}
                      />
                    )}
                  </Show>
                </Show>
              </Show>
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
        title={t("routine.settings.discardTitle")}
        description={t("routine.settings.discardDescription")}
        confirmLabel={t("routine.settings.discardConfirm")}
        cancelLabel={t("routine.settings.keepEditing")}
        initialFocus="cancel"
      />
    </div>
  );
}

/**
 * The list row reads the schedule as the chips do. A schedule the chips show only as cron, such
 * as an interval, keeps its own summary: "Every 15 minutes", not the cron text.
 */
function routineListSummary(routine: RoutineEditorRecord, text: RoutineText): string {
  const schedule = routineScheduleOf(routine);
  const event = eventTriggerOf(routine);
  if (event) return text.t("routine.settings.eventSummary", { eventType: event.eventType });
  const draft = routineScheduleToDraft(schedule);
  if (draft.kind === "custom") return routineScheduleSummary(schedule, false, text);
  return routineDraftSummary(draft, text);
}

function isEventRoutine(routine: RoutineEditorRecord): routine is EventRoutine {
  return "owner" in routine;
}

function routineTriggerKind(routine: RoutineEditorRecord): "schedule" | "event" {
  return isEventRoutine(routine) ? (routine.trigger.kind === "event" ? "event" : "schedule") : "schedule";
}

function routineScheduleOf(routine: RoutineEditorRecord): RoutineSchedule {
  if (isEventRoutine(routine)) {
    return routine.trigger.kind === "schedule" ? routine.trigger.schedule : { kind: "daily", time: "09:00" };
  }
  return routine.trigger.schedule;
}

function eventTriggerOf(routine: RoutineEditorRecord | RoutineDraft): EventRoutineTrigger | null {
  if ("triggerKind" in routine) {
    return routine.triggerKind === "event"
      ? { kind: "event", sourceId: routine.eventSourceId, eventType: routine.eventType, filters: routine.eventFilters }
      : null;
  }
  if (!isEventRoutine(routine) || routine.trigger.kind !== "event") return null;
  return routine.trigger;
}

function EventTriggerFields(props: {
  draft: RoutineDraft;
  onChange: (change: (current: RoutineDraft) => RoutineDraft) => void;
}) {
  const { t } = useText();
  const [filtersOpen, setFiltersOpen] = createSignal(false);
  return (
    <div class="agent-routine-event-trigger">
      <label class="settings-field">
        <span>{t("routine.settings.eventType")}</span>
        <Input
          value={props.draft.eventType}
          placeholder={t("routine.settings.eventTypePlaceholder")}
          onValueChange={(eventType) => props.onChange((value) => ({ ...value, eventType }))}
        />
      </label>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        class="agent-routine-disclosure"
        aria-expanded={filtersOpen() || props.draft.eventFilters.length > 0 ? "true" : "false"}
        onClick={() => setFiltersOpen((value) => !value)}
      >
        {t("routine.settings.eventFilters")}
      </Button>
      <Show when={filtersOpen() || props.draft.eventFilters.length > 0}>
        <div class="settings-field">
          <Text variant="caption" tone="muted">
            {t("routine.settings.eventFiltersHint")}
          </Text>
          <For each={props.draft.eventFilters}>
            {(filter, index) => (
              <div class="agent-routine-event-filter">
                <Input
                  aria-label={t("routine.settings.filterPointer")}
                  value={filter.pointer}
                  placeholder={t("routine.settings.filterPointer")}
                  onValueChange={(pointer) =>
                    props.onChange((value) => ({
                      ...value,
                      eventFilters: value.eventFilters.map((item, itemIndex) =>
                        itemIndex === index() ? { ...item, pointer } : item,
                      ),
                    }))
                  }
                />
                <Input
                  aria-label={t("routine.settings.filterValue")}
                  value={filter.value === null ? "null" : String(filter.value)}
                  placeholder={t("routine.settings.filterValue")}
                  onValueChange={(raw) =>
                    props.onChange((value) => ({
                      ...value,
                      eventFilters: value.eventFilters.map((item, itemIndex) =>
                        itemIndex === index() ? { ...item, value: parseEventScalar(raw) } : item,
                      ),
                    }))
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t("routine.settings.removeFilter")}
                  onClick={() =>
                    props.onChange((value) => ({
                      ...value,
                      eventFilters: value.eventFilters.filter((_, itemIndex) => itemIndex !== index()),
                    }))
                  }
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
            )}
          </For>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              props.onChange((value) => ({
                ...value,
                eventFilters: [...value.eventFilters, { pointer: "", value: "" }],
              }))
            }
          >
            {t("routine.settings.addFilter")}
          </Button>
        </div>
      </Show>
    </div>
  );
}

function validDraft(draft: RoutineDraft, sources: EventSource[] = []): boolean {
  if (!draft.name.trim() || !draft.instruction.trim()) return false;
  if (draft.triggerKind === "event") {
    return Boolean(
      draft.eventSourceId.trim() &&
        sources.some((source) => source.id === draft.eventSourceId) &&
        draft.eventType.trim() &&
        draft.eventFilters.every((filter) => filter.pointer === "" || filter.pointer.startsWith("/")),
    );
  }
  return routineDraftProblem(draft.scheduleDraft) === null;
}

function parseEventScalar(raw: string): EventFilter["value"] {
  const value = raw.trim();
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (value !== "" && Number.isFinite(Number(value))) return Number(value);
  return raw;
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
