import { Host, Switch } from "@expo/ui";
import { eventFilterDraftsValid, eventFiltersFromDrafts } from "@openbot/contracts/event-filter-value";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type CreateRoutineInput,
  type EventRoutine,
  type EventRoutineTriggerInput,
  isRoutineSchedule,
  type MemoryEntry,
  type RoutineFields,
  type RoutineSchedule,
  type SaveEventRoutineInput,
  type UpdateRoutineInput,
  type RoutineWebhookTrigger as WebhookTriggerFields,
} from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import {
  type RoutineScheduleDraft,
  routineDraftProblemCode,
  routineScheduleFromDraft,
  routineScheduleToDraft,
  switchDraftKind,
} from "@openbot/team-client/routine-schedule-draft";
import { type QueryKey, useQueryClient } from "@tanstack/react-query";
import { router, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { useUniwind } from "uniwind";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { type MobileAgent, useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { RoutineScheduleFields } from "./routine-schedule-fields";
import { type RoutineTriggerChoice, RoutineTriggerPicker } from "./routine-trigger-picker";
import { RoutineWebhookActivity } from "./routine-webhook-activity";
import { type FilterDraft, filterDrafts, RoutineWebhookTrigger } from "./routine-webhook-trigger";

const DEFAULT_SCHEDULE: RoutineSchedule = { kind: "daily", time: "09:00" };

type RoutineRecord = RoutineFields | EventRoutine;
type WebhookRoutine = EventRoutine & { trigger: WebhookTriggerFields };

function isWebhookRoutine(routine: RoutineRecord | null | undefined): routine is WebhookRoutine {
  return Boolean(routine && "owner" in routine && routine.trigger.kind === "webhook");
}

function useRecordDraftGuard(dirty: boolean, pending: boolean) {
  const navigation = useNavigation();
  const { t } = useText();
  usePreventRemove(dirty || pending, ({ data }) => {
    if (pending) return;
    Alert.alert(t("mobile.agent.discard.title"), t("mobile.agent.discard.body"), [
      { text: t("mobile.agent.discard.keepEditing"), style: "cancel" },
      {
        text: t("mobile.agent.discard.discard"),
        style: "destructive",
        onPress: () => navigation.dispatch(data.action),
      },
    ]);
  });
}

function useRecordAction(
  invalidate: QueryKey = ["agent-info"],
  failure: MobileTextKey = "mobile.agent.record.saveFailed",
) {
  const { t, errorMessage } = useText();
  const client = useQueryClient();
  const lock = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<void>, done?: () => void) {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      await action();
      void haptics.notification("success");
      done?.();
      void client.invalidateQueries({ queryKey: invalidate });
    } catch (cause) {
      void haptics.notification("error");
      setError(errorMessage(cause, t(failure)));
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return { pending, error, run };
}

export function MemoryEditor({
  agent,
  memory,
  available,
  port,
}: {
  agent: Pick<MobileAgent, "id" | "serverId">;
  memory?: MemoryEntry;
  available: boolean;
  port?: {
    save(text: string, id?: string): Promise<void>;
    delete(id: string): Promise<void>;
    queryKey: QueryKey;
  };
}) {
  const { t } = useText();
  const workspace = useMobileWorkspace();
  const action = useRecordAction(port?.queryKey);
  const [editedText, setEditedText] = useState<string | undefined>();
  const text = editedText ?? memory?.text ?? "";
  const [savedText, setSavedText] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const dirty = text.trim() !== (memory ? memory.text : (savedText ?? ""));
  useRecordDraftGuard(dirty && !finished, action.pending);
  useEffect(() => {
    if (finished) router.back();
  }, [finished]);
  const disabled = !available || action.pending || (!memory && savedText !== null);
  return (
    <View className="gap-5">
      <SheetFormField
        label={t("mobile.agent.record.memory")}
        appearance="soft"
        multiline
        value={text}
        editable={!disabled}
        maxLength={INPUT_LIMITS.agentMemoryText}
        onChangeText={(value) => setEditedText(value === (memory?.text ?? "") ? undefined : value)}
      />
      <SheetSaveAction
        dirty={dirty}
        canSave={!disabled && Boolean(text.trim())}
        pending={action.pending}
        onSave={() =>
          void action.run(
            () =>
              port
                ? port.save(text.trim(), memory?.id)
                : workspace.saveAgentMemory(agent.id, text.trim(), agent.serverId, memory?.id),
            () => {
              setSavedText(text.trim());
              if (memory) setEditedText(undefined);
              else setFinished(true);
            },
          )
        }
      />
      {memory ? (
        <SettingsSection>
          <SettingsRow
            disclosure={false}
            disabled={disabled}
            onPress={() =>
              Alert.alert(t("mobile.agent.record.deleteMemoryTitle"), t("mobile.agent.record.deleteMemoryBody"), [
                { text: t("common.cancel"), style: "cancel" },
                {
                  text: t("common.delete"),
                  style: "destructive",
                  onPress: () =>
                    void action.run(
                      () =>
                        port
                          ? port.delete(memory.id)
                          : workspace.deleteAgentMemory(agent.id, memory.id, agent.serverId),
                      () => setFinished(true),
                    ),
                },
              ])
            }
          >
            <Typography.Paragraph className="text-danger-text">
              {t("mobile.agent.record.deleteMemory")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
      {action.error ? (
        <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
          {action.error}
        </Typography.Paragraph>
      ) : null}
    </View>
  );
}

function webhookTriggerInput(trigger: WebhookTriggerFields): EventRoutineTriggerInput {
  return { kind: "webhook", eventType: trigger.eventType, filters: trigger.filters };
}

export function RoutineEditor({
  agent,
  routine,
  available,
  port,
}: {
  agent: Pick<MobileAgent, "id" | "serverId">;
  routine?: RoutineRecord;
  available: boolean;
  port?: {
    create(input: Omit<CreateRoutineInput, "agentId">): Promise<void>;
    update(input: Omit<UpdateRoutineInput, "agentId">): Promise<void>;
    delete(id: string): Promise<void>;
    test(id: string): Promise<void>;
    queryKey: QueryKey;
  };
}) {
  const { t } = useText();
  const workspace = useMobileWorkspace();
  const action = useRecordAction(port?.queryKey);
  const toggle = useRecordAction(port?.queryKey);
  const testRun = useRecordAction(port?.queryKey, "mobile.agent.record.testFailed");
  const rotate = useRecordAction(port?.queryKey, "mobile.agent.webhook.rotateFailed");
  const [testStarted, setTestStarted] = useState(false);
  const [activeOverride, setActiveOverride] = useState<boolean | null>(null);
  // The host returns a signing secret one time: from the save that makes a webhook trigger, or from a rotation.
  const [secret, setSecret] = useState<string | null>(null);
  // A new webhook routine stays open after its save, so the user can copy its URL and secret.
  const [created, setCreated] = useState<WebhookRoutine | null>(null);
  const keepOpen = useRef(false);
  const eventOwner = { kind: port ? "channel" : "agent", id: agent.id } as const;
  const webhookRoutine = isWebhookRoutine(routine) ? routine : undefined;
  useEffect(() => {
    if (routine?.active === activeOverride) setActiveOverride(null);
  }, [routine?.active, activeOverride]);
  function toggleActive(active: boolean) {
    if (!routine || toggle.pending || !available) return;
    setActiveOverride(active);
    void toggle.run(async () => {
      try {
        if (webhookRoutine)
          await workspace.saveEventRoutine(
            {
              id: webhookRoutine.id,
              owner: eventOwner,
              name: webhookRoutine.name,
              instruction: webhookRoutine.instruction,
              active,
              timezone: webhookRoutine.timezone,
              trigger: webhookTriggerInput(webhookRoutine.trigger),
              ...(webhookRoutine.limitPolicy ? { limitPolicy: webhookRoutine.limitPolicy } : {}),
            },
            agent.serverId,
          );
        else if (port) await port.update({ routineId: routine.id, active });
        else await workspace.updateAgentRoutine({ agentId: agent.id, routineId: routine.id, active }, agent.serverId);
      } catch (cause) {
        setActiveOverride(null);
        throw cause;
      }
    });
  }
  const { theme } = useUniwind();
  const [finished, setFinished] = useState(false);
  const [savedDraft, setSavedDraft] = useState<string | null>(null);
  const [edits, setEdits] = useState<{
    name?: string;
    instruction?: string;
    schedule?: RoutineScheduleDraft;
    trigger?: "schedule" | "webhook";
    eventType?: string;
    filters?: FilterDraft[];
  }>({});
  const name = edits.name ?? routine?.name ?? "";
  const instruction = edits.instruction ?? routine?.instruction ?? "";
  const savedSchedule = routine && "schedule" in routine.trigger ? routine.trigger.schedule : DEFAULT_SCHEDULE;
  const savedTrigger = webhookRoutine ? "webhook" : "schedule";
  const trigger = edits.trigger ?? savedTrigger;
  const savedEventType = webhookRoutine?.trigger.eventType ?? "";
  const savedFilters = webhookRoutine?.trigger.filters ?? [];
  const eventType = edits.eventType ?? savedEventType;
  const filters = edits.filters ?? filterDrafts(savedFilters);
  const eventsSupported = workspace.canManageEvents(agent.serverId);
  // The form edits a draft; an untouched schedule saves as it is, so a kind the form cannot show stays.
  const scheduleDraft = edits.schedule ?? routineScheduleToDraft(savedSchedule);
  const scheduleProblem = routineDraftProblemCode(scheduleDraft);
  const schedule = edits.schedule && !scheduleProblem ? routineScheduleFromDraft(edits.schedule) : savedSchedule;
  const setName = (name: string) => setEdits((current) => ({ ...current, name }));
  const setInstruction = (instruction: string) => setEdits((current) => ({ ...current, instruction }));
  const setSchedule = (schedule: RoutineScheduleDraft) => setEdits((current) => ({ ...current, schedule }));
  // A schedule frequency also switches the trigger back to the schedule, as on desktop. The same
  // frequency keeps the draft untouched, so a saved schedule that the form cannot show stays.
  const selectTrigger = (choice: RoutineTriggerChoice) =>
    setEdits((current) =>
      choice === "webhook"
        ? { ...current, trigger: "webhook" }
        : choice === scheduleDraft.kind
          ? { ...current, trigger: "schedule" }
          : { ...current, trigger: "schedule", schedule: switchDraftKind(scheduleDraft, choice, new Date()) },
    );
  const setEventType = (eventType: string) => setEdits((current) => ({ ...current, eventType }));
  const setFilters = (filters: FilterDraft[]) => setEdits((current) => ({ ...current, filters }));
  const [timezone, setTimezone] = useState(routine?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const initialTimezone = useRef(timezone);
  const draft = JSON.stringify({
    name,
    instruction,
    trigger,
    schedule: edits.schedule ?? savedSchedule,
    eventType,
    filters: eventFiltersFromDrafts(filters),
    timezone,
  });
  const nameChanged = name.trim() !== (routine?.name ?? "");
  const instructionChanged = instruction.trim() !== (routine?.instruction ?? "");
  const scheduleChanged =
    trigger === "schedule" &&
    edits.schedule !== undefined &&
    (scheduleProblem !== null || JSON.stringify(schedule) !== JSON.stringify(savedSchedule));
  const webhookChanged =
    trigger !== savedTrigger ||
    (trigger === "webhook" &&
      (eventType.trim() !== savedEventType ||
        JSON.stringify(eventFiltersFromDrafts(filters)) !== JSON.stringify(savedFilters)));
  const dirty = routine
    ? nameChanged || instructionChanged || scheduleChanged || webhookChanged
    : draft !==
      (savedDraft ??
        JSON.stringify({
          name: "",
          instruction: "",
          trigger: "schedule",
          schedule: DEFAULT_SCHEDULE,
          eventType: "",
          filters: [],
          timezone: initialTimezone.current,
        }));
  useRecordDraftGuard(dirty && !finished, action.pending);
  useEffect(() => {
    if (finished) router.back();
  }, [finished]);
  const disabled = !available || action.pending || (!routine && savedDraft !== null);
  const validTrigger =
    trigger === "webhook" ? eventFilterDraftsValid(filters) : scheduleProblem === null && isRoutineSchedule(schedule);
  async function save() {
    if (webhookRoutine || trigger === "webhook") {
      const input: SaveEventRoutineInput = {
        ...(routine ? { id: routine.id } : {}),
        owner: eventOwner,
        name: name.trim(),
        instruction: instruction.trim(),
        active: routine?.active ?? true,
        timezone,
        trigger:
          trigger === "webhook"
            ? { kind: "webhook", eventType: eventType.trim() || null, filters: eventFiltersFromDrafts(filters) }
            : { kind: "schedule", schedule },
        ...(routine?.limitPolicy ? { limitPolicy: routine.limitPolicy } : {}),
      };
      const result = await workspace.saveEventRoutine(input, agent.serverId);
      // A save that removes the webhook trigger also ends the secret that this screen shows.
      if (result.secret || result.routine.trigger.kind === "schedule") setSecret(result.secret);
      if (!routine && isWebhookRoutine(result.routine)) {
        keepOpen.current = true;
        setCreated(result.routine);
      }
      return;
    }
    if (port) {
      if (routine)
        await port.update({
          routineId: routine.id,
          ...(nameChanged ? { name: name.trim() } : {}),
          ...(instructionChanged ? { instruction: instruction.trim() } : {}),
          ...(scheduleChanged ? { schedule } : {}),
        });
      else await port.create({ name: name.trim(), instruction: instruction.trim(), schedule, timezone, active: true });
      return;
    }
    if (routine)
      await workspace.updateAgentRoutine(
        {
          agentId: agent.id,
          routineId: routine.id,
          ...(nameChanged ? { name: name.trim() } : {}),
          ...(instructionChanged ? { instruction: instruction.trim() } : {}),
          ...(scheduleChanged ? { schedule } : {}),
        },
        agent.serverId,
      );
    else
      await workspace.createAgentRoutine(
        { agentId: agent.id, name: name.trim(), instruction: instruction.trim(), schedule, timezone, active: true },
        agent.serverId,
      );
  }
  const shownWebhook = webhookRoutine ?? created ?? undefined;
  // The URL and the secret belong to the saved trigger. An unsaved switch to a webhook has neither yet.
  const savedWebhook = trigger === "webhook" && shownWebhook ? shownWebhook : undefined;
  const triggerPicker = (
    <RoutineTriggerPicker
      value={trigger === "webhook" ? "webhook" : scheduleDraft.kind}
      webhook={Boolean(webhookRoutine || eventsSupported)}
      disabled={disabled}
      onSelect={selectTrigger}
    />
  );
  return (
    <View className="gap-5">
      <SheetFormField
        appearance="soft"
        label={t("mobile.agent.record.routineName")}
        placeholder={t("mobile.agent.record.routineNamePlaceholder")}
        value={name}
        editable={!disabled}
        maxLength={INPUT_LIMITS.routineName}
        onChangeText={setName}
      />
      <SheetFormField
        appearance="soft"
        label={t("mobile.agent.record.routineInstructions")}
        placeholder={t(
          port
            ? "mobile.agent.record.channelInstructionsPlaceholder"
            : "mobile.agent.record.agentInstructionsPlaceholder",
        )}
        multiline
        value={instruction}
        editable={!disabled}
        maxLength={INPUT_LIMITS.routineInstruction}
        onChangeText={setInstruction}
      />
      {trigger === "schedule" ? (
        <RoutineScheduleFields
          draft={scheduleDraft}
          disabled={disabled}
          header={triggerPicker}
          onChange={setSchedule}
          footer={
            routine ? (
              <SettingsRow
                trailing={
                  <Typography type="body-sm" className="text-grouped-secondary">
                    {routine.timezone}
                  </Typography>
                }
              >
                <Typography.Paragraph>{t("mobile.agent.record.timeZone")}</Typography.Paragraph>
              </SettingsRow>
            ) : null
          }
        />
      ) : (
        <RoutineWebhookTrigger
          header={triggerPicker}
          url={savedWebhook ? savedWebhook.trigger.url : undefined}
          secret={secret}
          eventType={eventType}
          filters={filters}
          disabled={disabled}
          rotatePending={rotate.pending}
          onEventTypeChange={setEventType}
          onFiltersChange={setFilters}
          onSecretDismiss={() => setSecret(null)}
          onRotate={
            webhookRoutine && eventsSupported
              ? () =>
                  void rotate.run(async () => {
                    const rotated = await workspace.rotateEventRoutineSecret(
                      { id: webhookRoutine.id, owner: eventOwner },
                      agent.serverId,
                    );
                    setSecret(rotated.secret);
                  })
              : undefined
          }
        />
      )}
      {trigger === "schedule" &&
      routine &&
      "schedule" in routine.trigger &&
      routine.trigger.schedule.kind === "interval" &&
      edits.schedule === undefined ? (
        <Typography.Paragraph type="body-xs" className="-mt-3 px-4 text-grouped-secondary">
          {t("mobile.agent.record.scheduleKept")}
        </Typography.Paragraph>
      ) : null}
      {!routine ? (
        <SheetFormField
          label={t("mobile.agent.record.timeZone")}
          value={timezone}
          editable={!disabled}
          onChangeText={setTimezone}
        />
      ) : null}
      <SheetSaveAction
        dirty={dirty}
        canSave={!disabled && Boolean(name.trim() && instruction.trim() && timezone.trim()) && validTrigger}
        pending={action.pending}
        onSave={() =>
          void action.run(save, () => {
            setSavedDraft(draft);
            if (routine) setEdits({});
            else if (!keepOpen.current) setFinished(true);
          })
        }
      />
      {routine ? (
        <SettingsSection>
          <SettingsRow
            trailing={
              <Host matchContents colorScheme={theme === "dark" ? "dark" : "light"}>
                <Switch
                  label={t("mobile.agent.record.enabled")}
                  value={activeOverride ?? routine.active}
                  disabled={disabled || toggle.pending}
                  onValueChange={toggleActive}
                />
              </Host>
            }
          >
            <Typography.Paragraph>{t("mobile.agent.record.routine")}</Typography.Paragraph>
          </SettingsRow>
          <SettingsRow
            disclosure={false}
            disabled={disabled || dirty || testRun.pending}
            onPress={() => {
              setTestStarted(false);
              void testRun.run(
                () =>
                  webhookRoutine
                    ? workspace.testEventRoutine({ id: webhookRoutine.id, owner: eventOwner }, agent.serverId)
                    : port
                      ? port.test(routine.id)
                      : workspace.testAgentRoutine(agent.id, routine.id, agent.serverId),
                () => setTestStarted(true),
              );
            }}
          >
            <Typography.Paragraph className="text-accent">
              {t(testRun.pending ? "mobile.agent.record.testStarting" : "mobile.agent.record.testRun")}
            </Typography.Paragraph>
          </SettingsRow>
          <SettingsRow
            disclosure={false}
            disabled={disabled}
            onPress={() =>
              Alert.alert(t("mobile.agent.record.deleteRoutineTitle"), t("mobile.agent.record.deleteRoutineBody"), [
                { text: t("common.cancel"), style: "cancel" },
                {
                  text: t("common.delete"),
                  style: "destructive",
                  onPress: () =>
                    void action.run(
                      () =>
                        webhookRoutine
                          ? workspace.deleteEventRoutine({ id: webhookRoutine.id, owner: eventOwner }, agent.serverId)
                          : port
                            ? port.delete(routine.id)
                            : workspace.deleteAgentRoutine(agent.id, routine.id, agent.serverId),
                      () => setFinished(true),
                    ),
                },
              ])
            }
          >
            <Typography.Paragraph className="text-danger-text">
              {t("mobile.agent.record.deleteRoutine")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : null}
      {testStarted ? (
        <Typography.Paragraph accessibilityLiveRegion="polite">
          {t("mobile.agent.record.testStarted")}
        </Typography.Paragraph>
      ) : null}
      {testRun.error ? (
        <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
          {testRun.error}
        </Typography.Paragraph>
      ) : null}
      {rotate.error ? (
        <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
          {rotate.error}
        </Typography.Paragraph>
      ) : null}
      {toggle.error ? (
        <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
          {toggle.error}
        </Typography.Paragraph>
      ) : null}
      {action.error ? (
        <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
          {action.error}
        </Typography.Paragraph>
      ) : null}
      {eventsSupported && routine ? (
        <RoutineWebhookActivity key={routine.id} serverId={agent.serverId} owner={eventOwner} routineId={routine.id} />
      ) : null}
    </View>
  );
}
