import {
  type EventFilterDraft,
  eventFilterDraft,
  eventFilterDraftsValid,
  eventFiltersFromDrafts,
} from "@openbot/contracts/event-filter-value";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  ROUTINE_LIMIT_POLICIES,
  ROUTINE_MISSED_POLICIES,
  type RoutineLimitPolicy,
  type RoutineMissedPolicy,
  type RoutineResultConnectionOption,
  type RoutineResultDelivery,
  type RoutineResultDestination,
  type RoutineRunFields,
  type RoutineSchedule,
} from "@openbot/contracts/ipc";
import type { RoutineWebhookTriggerInput, WebhookTestResult } from "@openbot/contracts/ipc-events";
import type { AppTextKey } from "@openbot/i18n";
import {
  Button,
  CircleCheck,
  Clock3,
  ConfirmDialog,
  Input,
  ItemGroup,
  Link,
  Plus,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  SwitchField,
  Text,
  Textarea,
  toast,
  Webhook,
} from "@openbot/ui";
import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import { SettingsBackIcon, SettingsForwardIcon } from "@openbot/ui/components/SettingsPanel";
import {
  type RoutineResultChoice,
  RoutineResultDestinationField,
} from "@openbot/ui/features/conversation/RoutineResultDestinationField";
import { RoutineRunHistory } from "@openbot/ui/features/conversation/RoutineRunHistory";
import { RoutineSchedulePicker } from "@openbot/ui/features/conversation/RoutineSchedulePicker";
import { RoutineTriggerMenu } from "@openbot/ui/features/conversation/RoutineTriggerMenu";
import { RoutineWebhookTrigger } from "@openbot/ui/features/conversation/RoutineWebhookTrigger";
import {
  ROUTINE_EVERY_DAY,
  type RoutineScheduleDraft,
  switchDraftKind,
} from "@openbot/ui/features/conversation/routine-schedule-draft";
import {
  ROUTINE_LOCAL_DRAFT_KINDS,
  ROUTINE_SAVED_DRAFT_KINDS,
  routineDraftProblem,
  routineOnceCompleted,
  routineOncePassed,
  routineScheduleFromDraft,
  routineScheduleToDraft,
} from "@openbot/ui/features/conversation/routine-schedule-saved";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createSignal, createStore, For, onCleanup, Show, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import { type DesktopAnalyticsScope, desktopAnalytics } from "../../analytics";
import { writeClipboardText } from "../../clipboard";
import { HostedUpsellRoutinesNotice, hostedUpsellRoutineCreated } from "../servers/hosted-server-upsell-controller";
import { isEventRoutine, routineListSummary, routineScheduleOf } from "./routine-summary";
import type { RoutineEditorRecord, RoutinesPort } from "./routines-port";

export interface RoutineSelectionRequest {
  /** Null starts a new routine. */
  routineId: string | null;
  routineName: string;
  nonce: number;
}

type PendingRoutineExit =
  | "list"
  | "close"
  | "new"
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
  missedPolicy: RoutineMissedPolicy;
  triggerKind: "schedule" | "webhook";
  eventType: string;
  eventFilters: EventFilterDraft[];
  /** Undefined until the user picks a place: the saved one applies. Null stops sending. */
  destination: RoutineResultChoice | null | undefined;
}

interface WebhookEditorState {
  secret: string | null;
  connected: boolean | null;
}

const LIMIT_POLICY_LABELS = {
  wait: "routine.settings.limitPolicy.wait",
  skip: "routine.settings.limitPolicy.skip",
} as const satisfies Record<RoutineLimitPolicy, AppTextKey>;

const MISSED_POLICY_LABELS = {
  skip: "routine.settings.missedPolicy.skip",
  "run-once": "routine.settings.missedPolicy.runOnce",
} as const satisfies Record<RoutineMissedPolicy, AppTextKey>;

const NEW_ROUTINE_SCHEDULE: RoutineScheduleDraft = { kind: "daily", days: ROUTINE_EVERY_DAY, time: "09:00" };

interface AgentRoutinesSettingsProps {
  /** Names the owner and owns every call. A channel passes `channelRoutinesPort` here. */
  port: RoutinesPort;
  onCountChange: (count: number) => void;
  onBack?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
  selectionRequest?: RoutineSelectionRequest | null | undefined;
  onSelectionRequestHandled?: ((nonce: number) => void) | undefined;
  onOpenRun?: ((messageId: string) => void) | undefined;
}

export function AgentRoutinesSettings(props: AgentRoutinesSettingsProps) {
  const text = useText();
  const { t, errorMessage } = text;
  const [routines, setRoutines] = createSignal<RoutineEditorRecord[]>([]);
  const [draft, setDraft] = createSignal<RoutineDraft | null>(null);
  const [runs, setRuns] = createSignal<RoutineRunFields[]>([]);
  // Where the open routine sends its answers. Only an agent routine on this computer has a place.
  const [resultOptions, setResultOptions] = createSignal<RoutineResultConnectionOption[]>([]);
  const [savedDestination, setSavedDestination] = createSignal<RoutineResultDestination | null>(null);
  const [deliveries, setDeliveries] = createSignal<RoutineResultDelivery[]>([]);
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
  // Set by a Save of a draft with a missing field, so the fields say what is missing.
  const [showErrors, setShowErrors] = createSignal(false);
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  // The list rows whose active switch waits for the host.
  const [togglingIds, setTogglingIds] = createSignal<ReadonlySet<string>>(new Set());
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

  /** The open routine's place and deliveries. A late answer for a routine that is no longer open is dropped. */
  async function loadResults(routineId: string): Promise<void> {
    const results = props.port.results;
    if (!results) return;
    try {
      const [destination, items] = await Promise.all([results.destination(routineId), results.deliveries(routineId)]);
      if (draft()?.id !== routineId) return;
      setSavedDestination(destination);
      setDeliveries(items);
    } catch (caught) {
      if (draft()?.id === routineId) setError(errorMessage(caught, t("routine.settings.resultDestination.loadFailed")));
    }
  }

  async function loadResultOptions(): Promise<void> {
    const results = props.port.results;
    if (!results) return;
    try {
      setResultOptions(await results.options());
    } catch (caught) {
      setError(errorMessage(caught, t("routine.settings.resultDestination.loadFailed")));
    }
  }

  function resetResults(): void {
    setSavedDestination(null);
    setDeliveries([]);
  }

  createEffect(
    () => props.port,
    (port) =>
      port.subscribe(() => {
        void loadRoutines();
        const routineId = draft()?.id;
        if (routineId) {
          void loadRuns(routineId);
          void loadResults(routineId);
        }
      }),
  );

  // The port is new after each activity of the agent, and an effect runs again for an equal value.
  // The memo closes the open routine only when the owner changes.
  const ownerId = createMemo(() => props.port.ownerId);
  createEffect(ownerId, () => {
    closeEditor();
    setLoading(true);
    setRoutinesLoaded(false);
    void untrack(loadRoutines);
  });

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
      // The editor state is read once, when the request arrives; a later edit must not run it again.
      untrack(() => {
        if (request.routineId === null) {
          requestExit("new");
          return;
        }
        requestRoutineSelection(request, currentRoutines.find((routine) => routine.id === request.routineId) ?? null);
      });
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
      const triggerEdited = current.triggerKind !== routineTriggerKind(base);
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
        missedPolicy:
          current.missedPolicy === (base.missedPolicy ?? "skip")
            ? (routine.missedPolicy ?? "skip")
            : current.missedPolicy,
        ...(triggerEdited || scheduleEdited || webhookEdited ? {} : triggerDraftOf(routine)),
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
      missedPolicy: routine.missedPolicy ?? "skip",
      ...triggerDraftOf(routine),
      destination: undefined,
    });
    resetWebhookState();
    setShowErrors(false);
    resetResults();
    void loadRuns(routine.id);
    void loadResults(routine.id);
    void loadResultOptions();
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
      missedPolicy: "skip",
      triggerKind: "schedule",
      eventType: "",
      eventFilters: [],
      destination: undefined,
    });
    resetWebhookState();
    setShowErrors(false);
    resetResults();
    void loadResultOptions();
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
    setShowErrors(false);
    resetResults();
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
    if (target === "new") {
      createDraft();
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

  /** A done one-time routine that gets a later time is active again, so it runs at that time. */
  function reopened(value: RoutineDraft): RoutineDraft {
    const base = draftBase;
    if (value.active || value.schedule.kind !== "once" || !base || !routineCompleted(base)) return value;
    return routineOncePassed(value.schedule, base.timezone) ? value : { ...value, active: true };
  }

  function changeDraft(change: (current: RoutineDraft) => RoutineDraft): void {
    setDraft((current) => (current ? change(current) : current));
    draftRevision += 1;
    setDirty(true);
  }

  async function saveDraft(): Promise<void> {
    const current = draft();
    if (!current || !dirty() || saving()) return;
    if (!validDraft(current)) {
      setShowErrors(true);
      return;
    }
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
        // An update keeps the saved zone, so an edit on a computer in another zone does not move the schedule.
        timezone:
          (current.id ? draftBase?.timezone : undefined) ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"),
        schedule: current.schedule,
        trigger: webhookTriggerOf(current) ?? { kind: "schedule", schedule: current.schedule },
        limitPolicy: current.limitPolicy,
        missedPolicy: current.missedPolicy,
      });
      const saved = result.routine;
      setRoutines((items) => {
        const next = [saved, ...items.filter((routine) => routine.id !== saved.id)];
        props.onCountChange(next.length);
        return next;
      });
      setDraft((latest) => (latest && latest.id === current.id ? { ...latest, id: saved.id } : latest));
      if (draft()?.id === current.id) draftBase = saved;
      const destinationSaved = await saveDestination(saved.id, current.destination);
      if (draftRevision === savingRevision && destinationSaved) setDirty(false);
      if (!current.id) void loadRuns(saved.id);
      if (result.secret && draft()?.id === saved.id) {
        const secret = result.secret;
        setWebhook((state) => {
          state.secret = secret;
        });
      }
      trackRoutineAction(analytics, action, current, startedAt, "succeeded");
      if (action === "create" && saved.active) {
        hostedUpsellRoutineCreated({ id: saved.id, name: saved.name, agentId: null });
      }
    } catch (caught) {
      trackRoutineAction(analytics, action, current, startedAt, "failed");
      setError(errorMessage(caught, t("routine.settings.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Saves the place after the routine, which a new routine needs first. The routine stays saved when
   * this fails, and the editor keeps its changes so that Save tries again.
   */
  async function saveDestination(
    routineId: string,
    destination: RoutineResultChoice | null | undefined,
  ): Promise<boolean> {
    const results = props.port.results;
    if (!results || destination === undefined) return true;
    try {
      const saved = await results.setDestination(routineId, destination);
      if (draft()?.id !== routineId) return true;
      setSavedDestination(saved);
      setDraft((latest) => {
        if (!latest || latest.id !== routineId || latest.destination !== destination) return latest;
        return { ...latest, destination: undefined };
      });
      return true;
    } catch (caught) {
      setError(errorMessage(caught, t("routine.settings.resultDestination.saveFailed")));
      return false;
    }
  }

  async function resendDelivery(runId: string): Promise<void> {
    const results = props.port.results;
    const routineId = draft()?.id;
    if (!results || !routineId) return;
    await results.resend(runId);
    await loadResults(routineId);
  }

  async function deleteRoutine(): Promise<void> {
    if (deleting()) return;
    const current = draft();
    if (!current?.id) {
      closeEditor();
      return;
    }
    const startedAt = performance.now();
    const analytics = desktopAnalytics.scope();
    setDeleting(true);
    setError(null);
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
    } finally {
      setDeleting(false);
    }
  }

  /**
   * Pauses or resumes a routine from the list. It saves the routine as the editor does, with only
   * `active` changed, so the host keeps every other field.
   */
  async function setRoutineActive(routine: RoutineEditorRecord, active: boolean): Promise<void> {
    if (togglingIds().has(routine.id)) return;
    setTogglingIds((current) => new Set(current).add(routine.id));
    const schedule = routineScheduleOf(routine);
    const tracked = { triggerKind: routineTriggerKind(routine), schedule };
    const startedAt = performance.now();
    const analytics = desktopAnalytics.scope();
    try {
      const { routine: saved } = await props.port.save({
        routineId: routine.id,
        name: routine.name,
        instruction: routine.instruction,
        active,
        timezone: routine.timezone,
        schedule,
        trigger: webhookTriggerOf(routine) ?? { kind: "schedule", schedule },
        ...(routine.limitPolicy ? { limitPolicy: routine.limitPolicy } : {}),
        ...(routine.missedPolicy ? { missedPolicy: routine.missedPolicy } : {}),
      });
      setRoutines((items) => items.map((item) => (item.id === saved.id ? saved : item)));
      trackRoutineAction(analytics, "update", tracked, startedAt, "succeeded");
    } catch (caught) {
      trackRoutineAction(analytics, "update", tracked, startedAt, "failed");
      const fallback = active ? t("routine.settings.resumeFailed") : t("routine.settings.pauseFailed");
      actionToast.error(errorMessage(caught, fallback));
    } finally {
      setTogglingIds((current) => {
        const next = new Set(current);
        next.delete(routine.id);
        return next;
      });
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

  /**
   * The menu that changes the schedule frequency. A host without events keeps the schedule chips only.
   * It reads the draft through `current` in its props, so a draft change does not make a new menu.
   */
  function triggerMenu(current: () => RoutineDraft): JSX.Element {
    if (!props.port.events) return undefined;
    return (
      <RoutineTriggerMenu
        value={current().scheduleDraft.kind}
        kinds={scheduleKinds()}
        onSelect={(choice) =>
          changeDraft((value) =>
            reopened(withSchedule(value, switchDraftKind(value.scheduleDraft, choice, new Date()))),
          )
        }
      />
    );
  }

  function scheduleKinds() {
    return props.port.onceSchedule ? ROUTINE_LOCAL_DRAFT_KINDS : ROUTINE_SAVED_DRAFT_KINDS;
  }

  /**
   * Sends one signed test event to the saved routine, then shows its run. Undefined when the host
   * cannot send one; the card shows the step disabled until the routine is saved.
   */
  function sendTestEvent(): (() => Promise<WebhookTestResult>) | undefined {
    const events = props.port.events;
    const send = events?.api.sendTestEvent;
    if (!events || !send) return undefined;
    return async () => {
      const id = draft()?.id;
      if (!id) throw new Error(t("routine.webhook.testFailed"));
      const result = await send({ id, owner: events.owner });
      if (draft()?.id === id) await loadRuns(id);
      return result;
    };
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
  /** Only a saved webhook routine receives requests, so only it loads webhook activity. */
  const webhookActivity = () => {
    const events = props.port.events;
    const id = draft()?.id;
    return events && id && savedWebhook() ? { api: events.api, routine: { id, owner: events.owner } } : undefined;
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
                  <HostedUpsellRoutinesNotice count={routines().filter((routine) => routine.active).length} />
                  <div class="agent-routines-list">
                    <For each={routines()}>
                      {(routine) => (
                        <ItemGroup class="agent-routine-card">
                          <div class="agent-routine-list-item">
                            <Button
                              variant="ghost"
                              type="button"
                              class="agent-routine-row"
                              onClick={() => openRoutine(routine)}
                            >
                              <span
                                class={
                                  routine.active
                                    ? "agent-routine-status-icon-active"
                                    : "agent-routine-status-icon-paused"
                                }
                              >
                                <Show when={!routineCompleted(routine)} fallback={<CircleCheck aria-hidden="true" />}>
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
                                  {routineCompleted(routine)
                                    ? t("routine.settings.completed", { schedule: routineListSummary(routine, text) })
                                    : routineListSummary(routine, text)}
                                </small>
                              </span>
                            </Button>
                            {/* A done one-time routine needs a new time to run again, so only the editor resumes it. */}
                            <Switch
                              size="sm"
                              aria-label={routine.name}
                              checked={routine.active}
                              disabled={routineCompleted(routine) || togglingIds().has(routine.id)}
                              onChange={(active) => void setRoutineActive(routine, active)}
                            />
                          </div>
                        </ItemGroup>
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
                <SwitchField
                  class="agent-routine-active-toggle"
                  label={current().active ? t("routine.settings.active") : t("routine.settings.paused")}
                  checked={current().active}
                  onChange={(active) => changeDraft((value) => ({ ...value, active }))}
                />
                <div class="agent-routine-action-buttons">
                  <Show
                    when={!confirmDelete()}
                    fallback={
                      <>
                        <Button
                          variant="destructive"
                          type="button"
                          size="sm"
                          loading={deleting()}
                          loadingLabel={t("routine.settings.deleting")}
                          onClick={() => void deleteRoutine()}
                        >
                          {t("routine.settings.deleteNow")}
                        </Button>
                        <Button
                          variant="secondary"
                          type="button"
                          size="sm"
                          disabled={deleting()}
                          onClick={() => setConfirmDelete(false)}
                        >
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
                            disabled={!current().id || !validDraft(current())}
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
                  invalid={showErrors() && !current().name.trim()}
                  aria-describedby={showErrors() && !current().name.trim() ? "agent-routine-name-error" : undefined}
                  onValueChange={(name) => changeDraft((value) => ({ ...value, name }))}
                />
                <Show when={showErrors() && !current().name.trim()}>
                  <Text
                    as="p"
                    id="agent-routine-name-error"
                    variant="caption"
                    tone="danger"
                    class="agent-routine-field-error"
                  >
                    {t("routine.settings.nameRequired")}
                  </Text>
                </Show>
              </label>
              <section class="agent-routine-when" aria-labelledby="agent-routine-when-heading">
                <h3 id="agent-routine-when-heading">{t("routine.settings.whenToRun")}</h3>
                {/* A host with events offers both triggers, so the choice is always in view. */}
                <Show when={props.port.events}>
                  <fieldset class="agent-routine-trigger-kind">
                    <legend class="sr-only">{t("routine.trigger.kind")}</legend>
                    <Button
                      type="button"
                      size="sm"
                      variant={current().triggerKind === "schedule" ? "secondary" : "ghost"}
                      aria-pressed={current().triggerKind === "schedule" ? "true" : "false"}
                      onClick={() => {
                        if (current().triggerKind !== "schedule")
                          changeDraft((value) => ({ ...value, triggerKind: "schedule" }));
                      }}
                    >
                      <Clock3 class="agent-routine-trigger-kind-icon" aria-hidden="true" />
                      {t("routine.trigger.groupSchedule")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={current().triggerKind === "webhook" ? "secondary" : "ghost"}
                      aria-pressed={current().triggerKind === "webhook" ? "true" : "false"}
                      onClick={() => {
                        if (current().triggerKind !== "webhook")
                          changeDraft((value) => ({ ...value, triggerKind: "webhook" }));
                      }}
                    >
                      <Webhook class="agent-routine-trigger-kind-icon" aria-hidden="true" />
                      {t("routine.settings.triggerWebhook")}
                    </Button>
                  </fieldset>
                </Show>
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
                      onSecretDismiss={resetWebhookState}
                      onRegenerateSecret={regenerateSecret}
                      onSave={() => void saveDraft()}
                      saving={saving()}
                      onSendTest={sendTestEvent()}
                    />
                  }
                >
                  <RoutineSchedulePicker
                    schedule={current().scheduleDraft}
                    kinds={scheduleKinds()}
                    action={triggerMenu(current)}
                    onChange={(scheduleDraft) => changeDraft((value) => reopened(withSchedule(value, scheduleDraft)))}
                  />
                </Show>
              </section>
              <div class="settings-field agent-routine-instruction-field">
                <span id="agent-routine-instruction-label">{t("routine.settings.instruction")}</span>
                <Textarea
                  aria-labelledby="agent-routine-instruction-label"
                  invalid={showErrors() && !current().instruction.trim()}
                  value={current().instruction}
                  placeholder={
                    props.port.ownerNoun === "channel"
                      ? t("routine.settings.instructionPlaceholderChannel")
                      : t("routine.settings.instructionPlaceholderAgent")
                  }
                  maxlength={INPUT_LIMITS.routineInstruction}
                  aria-describedby={
                    [
                      showErrors() && !current().instruction.trim() ? "agent-routine-instruction-error" : "",
                      props.port.ownerNoun === "channel" ? "" : "agent-routine-no-update-hint",
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined
                  }
                  onValueChange={(instruction) => changeDraft((value) => ({ ...value, instruction }))}
                />
                <Show when={showErrors() && !current().instruction.trim()}>
                  <Text
                    as="p"
                    id="agent-routine-instruction-error"
                    variant="caption"
                    tone="danger"
                    class="agent-routine-field-error"
                  >
                    {t("routine.settings.instructionRequired")}
                  </Text>
                </Show>
                {/* A scheduled run of an agent routine that answers only the marker posts nothing. */}
                <Show when={props.port.ownerNoun !== "channel"}>
                  <Text id="agent-routine-no-update-hint" variant="caption" tone="muted">
                    {t("routine.settings.instructionNoUpdateHint")}
                  </Text>
                </Show>
              </div>
              {/* The host does not skip a one-time run at a spent plan: it waits, so the reminder is not lost. */}
              <Show
                when={
                  props.port.limitPolicy &&
                  !(current().triggerKind === "schedule" && current().scheduleDraft.kind === "once")
                }
              >
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
              <Show when={props.port.missedPolicy && current().triggerKind === "schedule"}>
                <div class="settings-field">
                  <span id="agent-routine-missed-policy-label">{t("routine.settings.missedPolicy")}</span>
                  <Select<RoutineMissedPolicy>
                    options={[...ROUTINE_MISSED_POLICIES]}
                    value={current().missedPolicy}
                    onChange={(missedPolicy) => {
                      if (missedPolicy) changeDraft((value) => ({ ...value, missedPolicy }));
                    }}
                    itemComponent={(item) => (
                      <SelectItem item={item.item}>{t(MISSED_POLICY_LABELS[item.item.rawValue])}</SelectItem>
                    )}
                  >
                    <SelectTrigger aria-labelledby="agent-routine-missed-policy-label">
                      <SelectValue<RoutineMissedPolicy>>
                        {(state) => t(MISSED_POLICY_LABELS[state.selectedOption()])}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent />
                  </Select>
                </div>
              </Show>

              <Show when={props.port.results && (resultOptions().length > 0 || savedDestination())}>
                <RoutineResultDestinationField
                  options={resultOptions()}
                  saved={savedDestination()}
                  value={current().destination === undefined ? savedDestination() : (current().destination ?? null)}
                  onChange={(destination) => changeDraft((value) => ({ ...value, destination }))}
                />
              </Show>

              <RoutineRunHistory
                runs={runs()}
                onOpenRun={props.onOpenRun ? requestOpenRun : undefined}
                activity={webhookActivity()}
                deliveries={props.port.results ? { items: deliveries(), onResend: resendDelivery } : undefined}
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

function routineCompleted(routine: RoutineEditorRecord): boolean {
  if (routineTriggerKind(routine) === "webhook") return false;
  return routineOnceCompleted({
    active: routine.active,
    timezone: routine.timezone,
    schedule: routineScheduleOf(routine),
    updatedAt: routine.updatedAt,
  });
}

/**
 * The draft with a new schedule. A switch to a one-time run also runs it when OpenBot opens after
 * its time, so a reminder is not lost; the person can still choose to skip it.
 */
function withSchedule(value: RoutineDraft, scheduleDraft: RoutineScheduleDraft): RoutineDraft {
  const missedPolicy =
    scheduleDraft.kind === "once" && value.scheduleDraft.kind !== "once" ? "run-once" : value.missedPolicy;
  return {
    ...value,
    triggerKind: "schedule",
    schedule: routineScheduleFromDraft(scheduleDraft),
    scheduleDraft,
    missedPolicy,
  };
}

function routineTriggerKind(routine: RoutineEditorRecord): RoutineDraft["triggerKind"] {
  return isEventRoutine(routine) && routine.trigger.kind === "webhook" ? "webhook" : "schedule";
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
    eventFilters: trigger?.filters.map(eventFilterDraft) ?? [],
  };
}

/** The webhook trigger that a save sends, or that a saved routine has. The host-made URL is not part of it. */
function webhookTriggerOf(routine: RoutineEditorRecord | RoutineDraft): RoutineWebhookTriggerInput | null {
  if ("triggerKind" in routine) {
    return routine.triggerKind === "webhook"
      ? {
          kind: "webhook",
          eventType: routine.eventType.trim() || null,
          filters: eventFiltersFromDrafts(routine.eventFilters),
        }
      : null;
  }
  if (!isEventRoutine(routine) || routine.trigger.kind !== "webhook") return null;
  return { kind: "webhook", eventType: routine.trigger.eventType, filters: routine.trigger.filters };
}

function validDraft(draft: RoutineDraft): boolean {
  if (!draft.name.trim() || !draft.instruction.trim()) return false;
  if (draft.triggerKind === "webhook") return eventFilterDraftsValid(draft.eventFilters);
  return routineDraftProblem(draft.scheduleDraft) === null;
}

function isBlankNewDraft(draft: RoutineDraft): boolean {
  return draft.id === null && draft.triggerKind === "schedule" && !draft.name.trim() && !draft.instruction.trim();
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
