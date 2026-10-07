import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  ROUTINE_LIMIT_POLICIES,
  type RoutineLimitPolicy,
  type RoutineRunFields,
  type RoutineSchedule,
} from "@openbot/contracts/ipc";
import type { EventRoutine, RoutineWebhookTriggerInput } from "@openbot/contracts/ipc-events";
import type { AppTextKey } from "@openbot/i18n";
import {
  Button,
  CirclePause,
  Clock3,
  ConfirmDialog,
  Input,
  Link,
  Plus,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  toast,
} from "@openbot/ui";
import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import { SettingsBackIcon, SettingsForwardIcon } from "@openbot/ui/components/SettingsPanel";
import { RoutineRunHistory } from "@openbot/ui/features/conversation/RoutineRunHistory";
import { RoutineSchedulePicker } from "@openbot/ui/features/conversation/RoutineSchedulePicker";
import { RoutineTriggerMenu } from "@openbot/ui/features/conversation/RoutineTriggerMenu";
import {
  type RoutineWebhookFilterDraft,
  RoutineWebhookTrigger,
  routineWebhookFilterDraft,
  routineWebhookFilters,
  routineWebhookFiltersValid,
} from "@openbot/ui/features/conversation/RoutineWebhookTrigger";
import {
  ROUTINE_EVERY_DAY,
  type RoutineScheduleDraft,
  routineDraftSummary,
  switchDraftKind,
} from "@openbot/ui/features/conversation/routine-schedule-draft";
import {
  ROUTINE_SAVED_DRAFT_KINDS,
  routineDraftProblem,
  routineScheduleFromDraft,
  routineScheduleToDraft,
} from "@openbot/ui/features/conversation/routine-schedule-saved";
import { type RoutineText, routineScheduleSummary } from "@openbot/ui/features/conversation/routine-schedule-ui";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, createStore, For, onCleanup, Show, untrack } from "solid-js";
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
  triggerKind: "schedule" | "webhook";
  eventType: string;
  eventFilters: RoutineWebhookFilterDraft[];
}

interface WebhookEditorState {
  secret: string | null;
  connected: boolean | null;
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
  // Webhook state that is not part of the saved routine. `secret` is the one-time reveal after a save or a regeneration.
  const [webhook, setWebhook] = createStore<WebhookEditorState>({
    secret: null,
    connected: null,
  });
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
      closeEditor();
      setLoading(true);
      setRoutinesLoaded(false);
      void untrack(loadRoutines);
    },
  );

  createEffect(
    () => (draft()?.triggerKind === "webhook" ? props.port.events?.api : undefined),
    (api) => {
      if (!api) return;
      // The status only explains a missing URL, so a failed check leaves the connection unknown.
      void api.getStatus().then(
        (status) =>
          setWebhook((state) => {
            state.connected = status.connected;
          }),
        () =>
          setWebhook((state) => {
            state.connected = null;
          }),
      );
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
      const webhookEdited =
        current.triggerKind === "webhook" &&
        JSON.stringify(webhookTriggerOf(current)) !== JSON.stringify(webhookTriggerOf(base));
      return {
        ...current,
        name: current.name === base.name ? routine.name : current.name,
        instruction: current.instruction === base.instruction ? routine.instruction : current.instruction,
        active: current.active === base.active ? routine.active : current.active,
        limitPolicy:
          current.limitPolicy === (base.limitPolicy ?? "wait") ? (routine.limitPolicy ?? "wait") : current.limitPolicy,
        ...(scheduleEdited || webhookEdited ? {} : triggerDraftOf(routine)),
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
      limitPolicy: routine.limitPolicy ?? "wait",
      ...triggerDraftOf(routine),
    });
    resetWebhookState();
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
      eventType: "",
      eventFilters: [],
    });
    resetWebhookState();
  }

  function resetWebhookState(): void {
    setWebhook((state) => {
      state.secret = null;
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
    resetWebhookState();
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
    if (!current || !dirty() || !validDraft(current) || saving()) return;
    const savingRevision = draftRevision;
    setSaving(true);
    setError(null);
    const startedAt = performance.now();
    const action = current.id ? "update" : "create";
    const analytics = desktopAnalytics.scope();
    try {
      const result = await props.port.save({
        routineId: current.id,
        name: current.name.trim(),
        instruction: current.instruction.trim(),
        active: current.active,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        schedule: current.schedule,
        trigger: webhookTriggerOf(current) ?? { kind: "schedule", schedule: current.schedule },
        limitPolicy: current.limitPolicy,
      });
      const saved = result.routine;
      setRoutines((items) => {
        const next = [saved, ...items.filter((routine) => routine.id !== saved.id)];
        props.onCountChange(next.length);
        return next;
      });
      setDraft((latest) => (latest && latest.id === current.id ? { ...latest, id: saved.id } : latest));
      if (draft()?.id === current.id) draftBase = saved;
      if (draftRevision === savingRevision) setDirty(false);
      if (!current.id) void loadRuns(saved.id);
      if (result.secret && draft()?.id === saved.id) {
        const secret = result.secret;
        setWebhook((state) => {
          state.secret = secret;
        });
      }
      trackRoutineAction(analytics, action, current, startedAt, "succeeded");
    } catch (caught) {
      trackRoutineAction(analytics, action, current, startedAt, "failed");
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
      trackRoutineAction(analytics, "delete", current, startedAt, "succeeded");
    } catch (caught) {
      trackRoutineAction(analytics, "delete", current, startedAt, "failed");
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
      trackRoutineAction(analytics, "test", current, startedAt, "succeeded");
      await loadRuns(current.id);
    } catch (caught) {
      trackRoutineAction(analytics, "test", current, startedAt, "failed");
      setError(errorMessage(caught, t("routine.settings.testFailed")));
    } finally {
      setTesting(false);
    }
  }

  /** The menu that changes the trigger. A host without events keeps the schedule chips only. */
  function triggerMenu(current: RoutineDraft): JSX.Element {
    if (!props.port.events) return undefined;
    return (
      <RoutineTriggerMenu
        value={current.triggerKind === "webhook" ? "webhook" : current.scheduleDraft.kind}
        kinds={ROUTINE_SAVED_DRAFT_KINDS}
        webhook
        onSelect={(choice) =>
          changeDraft((value) => {
            if (choice === "webhook") return { ...value, triggerKind: "webhook" };
            const scheduleDraft = switchDraftKind(value.scheduleDraft, choice, new Date());
            return {
              ...value,
              triggerKind: "schedule",
              schedule: routineScheduleFromDraft(scheduleDraft),
              scheduleDraft,
            };
          })
        }
      />
    );
  }

  async function regenerateSecret(): Promise<void> {
    const events = props.port.events;
    const id = draft()?.id;
    if (!events || !id) return;
    const { secret } = await events.api.rotateSecret({ id, owner: events.owner });
    if (draft()?.id !== id) return;
    setWebhook((state) => {
      state.secret = secret;
    });
  }

  /** The saved record of the open draft. Its trigger, not the draft, says whether a URL and a secret exist. */
  const savedRoutine = () => {
    const id = draft()?.id;
    return id ? routines().find((routine) => routine.id === id) : undefined;
  };
  const savedWebhook = () => {
    const routine = savedRoutine();
    return routine && isEventRoutine(routine) && routine.trigger.kind === "webhook" ? routine.trigger : null;
  };
  const routineRef = () => {
    const events = props.port.events;
    const id = draft()?.id;
    return events && id ? { api: events.api, routine: { id, owner: events.owner } } : null;
  };

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
                              <Show
                                when={routineTriggerKind(routine) === "webhook"}
                                fallback={<Clock3 aria-hidden="true" />}
                              >
                                <Link aria-hidden="true" />
                              </Show>
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
                            disabled={!current().id || testing() || !validDraft(current())}
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
                        disabled={saving() || !validDraft(current())}
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
                <Show
                  when={current().triggerKind === "schedule"}
                  fallback={
                    <RoutineWebhookTrigger
                      url={savedWebhook()?.url ?? null}
                      saved={savedWebhook() !== null}
                      connected={webhook.connected}
                      eventType={current().eventType}
                      filters={current().eventFilters}
                      onEventTypeChange={(eventType) => changeDraft((value) => ({ ...value, eventType }))}
                      onFiltersChange={(eventFilters) => changeDraft((value) => ({ ...value, eventFilters }))}
                      secret={webhook.secret}
                      onSecretDismiss={() =>
                        setWebhook((state) => {
                          state.secret = null;
                        })
                      }
                      onRegenerateSecret={props.port.events ? regenerateSecret : undefined}
                      menu={triggerMenu(current())}
                    />
                  }
                >
                  <RoutineSchedulePicker
                    schedule={current().scheduleDraft}
                    kinds={ROUTINE_SAVED_DRAFT_KINDS}
                    action={triggerMenu(current())}
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

              <RoutineRunHistory
                runs={runs()}
                onOpenRun={props.onOpenRun ? requestOpenRun : undefined}
                activity={routineRef() ?? undefined}
              />
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
  if (isEventRoutine(routine) && routine.trigger.kind === "webhook") {
    const eventType = routine.trigger.eventType;
    return eventType
      ? text.t("routine.settings.webhookSummary", { eventType })
      : text.t("routine.settings.webhookSummaryAny");
  }
  const schedule = routineScheduleOf(routine);
  const draft = routineScheduleToDraft(schedule);
  if (draft.kind === "custom") return routineScheduleSummary(schedule, false, text);
  return routineDraftSummary(draft, text);
}

function isEventRoutine(routine: RoutineEditorRecord): routine is EventRoutine {
  return "owner" in routine;
}

function routineTriggerKind(routine: RoutineEditorRecord): RoutineDraft["triggerKind"] {
  return isEventRoutine(routine) && routine.trigger.kind === "webhook" ? "webhook" : "schedule";
}

function routineScheduleOf(routine: RoutineEditorRecord): RoutineSchedule {
  if (isEventRoutine(routine)) {
    return routine.trigger.kind === "schedule" ? routine.trigger.schedule : { kind: "daily", time: "09:00" };
  }
  return routine.trigger.schedule;
}

/** The trigger fields of a draft that opens `routine`. */
function triggerDraftOf(
  routine: RoutineEditorRecord,
): Pick<RoutineDraft, "schedule" | "scheduleDraft" | "triggerKind" | "eventType" | "eventFilters"> {
  const trigger = isEventRoutine(routine) && routine.trigger.kind === "webhook" ? routine.trigger : null;
  return {
    schedule: structuredClone(routineScheduleOf(routine)),
    scheduleDraft: routineScheduleToDraft(routineScheduleOf(routine)),
    triggerKind: routineTriggerKind(routine),
    eventType: trigger?.eventType ?? "",
    eventFilters: trigger?.filters.map(routineWebhookFilterDraft) ?? [],
  };
}

/** The webhook trigger that a save sends, or that a saved routine has. The host-made URL is not part of it. */
function webhookTriggerOf(routine: RoutineEditorRecord | RoutineDraft): RoutineWebhookTriggerInput | null {
  if ("triggerKind" in routine) {
    return routine.triggerKind === "webhook"
      ? {
          kind: "webhook",
          eventType: routine.eventType.trim() || null,
          filters: routineWebhookFilters(routine.eventFilters),
        }
      : null;
  }
  if (!isEventRoutine(routine) || routine.trigger.kind !== "webhook") return null;
  return { kind: "webhook", eventType: routine.trigger.eventType, filters: routine.trigger.filters };
}

function validDraft(draft: RoutineDraft): boolean {
  if (!draft.name.trim() || !draft.instruction.trim()) return false;
  if (draft.triggerKind === "webhook") return routineWebhookFiltersValid(draft.eventFilters);
  return routineDraftProblem(draft.scheduleDraft) === null;
}

function isBlankNewDraft(draft: RoutineDraft): boolean {
  return draft.id === null && !draft.name.trim() && !draft.instruction.trim();
}

function trackRoutineAction(
  analytics: DesktopAnalyticsScope,
  action: "create" | "update" | "delete" | "test",
  routine: Pick<RoutineDraft, "triggerKind" | "schedule">,
  startedAt: number,
  result: "succeeded" | "failed",
): void {
  analytics.track("routine_action", {
    action,
    trigger_type: routine.triggerKind === "webhook" ? "webhook" : routine.schedule.kind,
    duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
    result,
    ...(result === "failed" ? { failure_code: `${action}_failed` } : {}),
  });
}
