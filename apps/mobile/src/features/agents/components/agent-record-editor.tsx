import { Host } from "@expo/ui";
import { eventFilterDraftsValid, eventFiltersFromDrafts } from "@openbot/contracts/event-filter-value";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AgentMemorySelectionState,
  type CreateRoutineInput,
  type EventRoutine,
  type EventRoutineTriggerInput,
  isRoutineSchedule,
  type MemoryEntry,
  type RoutineFields,
  type RoutineMissedPolicy,
  type RoutineSchedule,
  type SaveEventRoutineInput,
  type UpdateRoutineInput,
  type RoutineWebhookTrigger as WebhookTriggerFields,
} from "@openbot/contracts/ipc";
import type { EventRoutineOwner } from "@openbot/contracts/ipc-events";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import {
  type RoutineScheduleDraft,
  routineDraftProblemCode,
  routineScheduleFromDraft,
  routineScheduleToDraft,
  switchDraftKind,
} from "@openbot/team-client/routine-schedule-draft";
import { type QueryKey, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import { useEffect, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { useCSSVariable, useUniwind } from "uniwind";
import { SettingsNote, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import {
  type MobileAgent,
  type MobileWorkspaceActions,
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { AppSwitch } from "@/shared/components/app-switch";
import { SaveError } from "@/shared/components/save-error";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { useNativeLabelFont } from "@/shared/lib/native-label-font";
import { useText } from "@/shared/lib/text";
import { useDiscardGuard } from "@/shared/lib/use-discard-guard";
import { type RoutineResultChoice, RoutineResultDestinationSection } from "./routine-result-destination";
import { RoutineScheduleFields } from "./routine-schedule-fields";
import { type RoutineTriggerChoice, RoutineTriggerPicker } from "./routine-trigger-picker";
import { RoutineWebhookActivity } from "./routine-webhook-activity";
import { type FilterDraft, filterDrafts, RoutineWebhookTrigger } from "./routine-webhook-trigger";

const TIME_ZONE_PLACEHOLDER = "Europe/London";

const DEFAULT_SCHEDULE: RoutineSchedule = { kind: "daily", time: "09:00" };

const MISSED_POLICY_TEXT = {
  skip: "mobile.agent.record.missedPolicy.skip",
  "run-once": "mobile.agent.record.missedPolicy.runOnce",
} as const satisfies Record<RoutineMissedPolicy, MobileTextKey>;

export type RoutineRecord = RoutineFields | EventRoutine;
type WebhookRoutine = EventRoutine & { trigger: WebhookTriggerFields };

export function isWebhookRoutine(routine: RoutineRecord | null | undefined): routine is WebhookRoutine {
  return Boolean(routine && "owner" in routine && routine.trigger.kind === "webhook");
}

export async function saveRoutineActive(
  workspace: Pick<MobileWorkspaceActions, "saveEventRoutine" | "updateAgentRoutine">,
  owner: EventRoutineOwner,
  serverId: string,
  routine: RoutineRecord,
  active: boolean,
): Promise<void> {
  if (isWebhookRoutine(routine))
    await workspace.saveEventRoutine(
      {
        id: routine.id,
        owner,
        name: routine.name,
        instruction: routine.instruction,
        active,
        timezone: routine.timezone,
        trigger: webhookTriggerInput(routine.trigger),
        ...(routine.limitPolicy ? { limitPolicy: routine.limitPolicy } : {}),
      },
      serverId,
    );
  else await workspace.updateAgentRoutine({ agentId: owner.id, routineId: routine.id, active }, serverId);
}

function useRecordDraftGuard(dirty: boolean, pending: boolean) {
  useDiscardGuard(dirty || pending, { busy: () => pending });
}

function useRecordAction(
  invalidate: QueryKey = queryKeys.agentInfo(),
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
  selection,
  selectionAvailable = true,
  port,
}: {
  agent: Pick<MobileAgent, "id" | "serverId">;
  memory?: MemoryEntry;
  available: boolean;
  selection?: AgentMemorySelectionState | null;
  selectionAvailable?: boolean;
  port?: {
    save(text: string, id?: string): Promise<void>;
    delete(id: string): Promise<void>;
    queryKey: QueryKey;
  };
}) {
  const { t, format } = useText();
  const workspace = useMobileWorkspaceActions();
  const action = useRecordAction(port?.queryKey);
  const inclusion = useRecordAction();
  const selected = selection?.selections.find((entry) => entry.memoryId === memory?.id);
  const accent = String(useCSSVariable("--openbot-accent"));
  const [editedText, setEditedText] = useState<string | undefined>();
  const text = editedText ?? memory?.text ?? "";
  const [savedText, setSavedText] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const dirty = text.trim() !== (memory ? memory.text : (savedText ?? ""));
  useRecordDraftGuard(dirty && !finished, action.pending || inclusion.pending);
  useEffect(() => {
    if (finished) router.back();
  }, [finished]);
  const disabled = !available || action.pending || inclusion.pending || (!memory && savedText !== null);
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
      {!port && selection ? (
        <SettingsNote>
          {t("mobile.agent.info.memory.inclusion.explanation")}{" "}
          {t("mobile.agent.info.memory.inclusion.capacity", {
            used: format.fileSize(selection.usedBytes),
            total: format.fileSize(selection.budgetBytes),
          })}
        </SettingsNote>
      ) : null}
      {!port && selected ? (
        <SettingsSection
          title={t("mobile.agent.info.memory.inclusion.label")}
          footer={t(
            selected.userControlled
              ? "mobile.agent.info.memory.inclusion.userControlled"
              : "mobile.agent.info.memory.inclusion.agentControlled",
          )}
        >
          {(["essential", "searchable", "automatic"] as const).map((choice) => (
            <SettingsRow
              key={choice}
              supportingText={
                choice === "automatic"
                  ? t(
                      selected.inclusion === "essential"
                        ? "mobile.agent.info.memory.inclusion.essential"
                        : "mobile.agent.info.memory.inclusion.searchable",
                    )
                  : undefined
              }
              disclosure={false}
              checked={
                choice === "automatic"
                  ? !selected.userControlled
                  : selected.userControlled && selected.inclusion === choice
              }
              trailing={
                (
                  choice === "automatic"
                    ? !selected.userControlled
                    : selected.userControlled && selected.inclusion === choice
                ) ? (
                  <Check size={18} color={accent} strokeWidth={2} />
                ) : null
              }
              disabled={disabled || !selectionAvailable}
              onPress={() =>
                void inclusion.run(async () => {
                  await workspace.setAgentMemoryInclusion(
                    {
                      agentId: agent.id,
                      changes: [
                        { memoryId: selected.memoryId, inclusion: choice, expectedRevision: selected.revision },
                      ],
                    },
                    agent.serverId,
                  );
                })
              }
            >
              <Typography.Paragraph>
                {t(
                  choice === "essential"
                    ? "mobile.agent.info.memory.inclusion.essential"
                    : choice === "searchable"
                      ? "mobile.agent.info.memory.inclusion.searchable"
                      : "mobile.agent.info.memory.inclusion.automatic",
                )}
              </Typography.Paragraph>
            </SettingsRow>
          ))}
        </SettingsSection>
      ) : null}
      <SaveError error={inclusion.error} />
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
      <SaveError error={action.error} />
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
  agent: Pick<MobileAgent, "id" | "serverId"> & Partial<Pick<MobileAgent, "name">>;
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
  const nativeLabelFont = useNativeLabelFont();
  const workspace = useMobileWorkspaceActions();
  const action = useRecordAction(port?.queryKey);
  const toggle = useRecordAction(port?.queryKey);
  const testRun = useRecordAction(port?.queryKey, "mobile.agent.record.testFailed");
  const rotate = useRecordAction(port?.queryKey, "mobile.agent.webhook.rotateFailed");
  const give = useRecordAction(port?.queryKey, "mobile.agent.webhook.giveFailed");
  const [givenTo, setGivenTo] = useState<string | null>(null);
  const [testStarted, setTestStarted] = useState(false);
  const [activeOverride, setActiveOverride] = useState<boolean | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [created, setCreated] = useState<WebhookRoutine | null>(null);
  const keepOpen = useRef(false);
  const eventOwner = { kind: port ? "channel" : "agent", id: agent.id } as const;
  const agentName = agent.name;
  const webhookRoutine = isWebhookRoutine(routine) ? routine : undefined;
  useEffect(() => {
    if (routine?.active === activeOverride) setActiveOverride(null);
  }, [routine?.active, activeOverride]);
  function toggleActive(active: boolean) {
    if (!routine || toggle.pending || !available) return;
    setActiveOverride(active);
    void toggle.run(async () => {
      try {
        if (port && !webhookRoutine) await port.update({ routineId: routine.id, active });
        else await saveRoutineActive(workspace, eventOwner, agent.serverId, routine, active);
      } catch (cause) {
        setActiveOverride(null);
        throw cause;
      }
    });
  }
  const { theme } = useUniwind();
  const accent = String(useCSSVariable("--openbot-accent"));
  const [finished, setFinished] = useState(false);
  const [savedDraft, setSavedDraft] = useState<string | null>(null);
  const [edits, setEdits] = useState<{
    name?: string;
    instruction?: string;
    schedule?: RoutineScheduleDraft;
    trigger?: "schedule" | "webhook";
    eventType?: string;
    filters?: FilterDraft[];
    missedPolicy?: RoutineMissedPolicy;
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
  const eventsSupported = useMobileWorkspaceSelector((current) => current.canManageEvents(agent.serverId));
  const missedRuns = useMobileWorkspaceSelector((current) => current.canManageMissedRuns(agent.serverId));
  const routineResults = useMobileWorkspaceSelector((current) => current.canManageRoutineResults(agent.serverId));
  const agentSecretSupported = useMobileWorkspaceSelector((current) =>
    current.canGiveWebhookSecretToAgent(agent.serverId),
  );
  const savedMissedPolicy = routine?.missedPolicy ?? "skip";
  const missedPolicy = edits.missedPolicy ?? savedMissedPolicy;
  const setMissedPolicy = (missedPolicy: RoutineMissedPolicy) => setEdits((current) => ({ ...current, missedPolicy }));
  const [newDestination, setNewDestination] = useState<RoutineResultChoice | null>(null);
  const scheduleDraft = edits.schedule ?? routineScheduleToDraft(savedSchedule);
  const scheduleProblem = routineDraftProblemCode(scheduleDraft);
  const schedule = edits.schedule && !scheduleProblem ? routineScheduleFromDraft(edits.schedule) : savedSchedule;
  const setName = (name: string) => setEdits((current) => ({ ...current, name }));
  const setInstruction = (instruction: string) => setEdits((current) => ({ ...current, instruction }));
  const setSchedule = (schedule: RoutineScheduleDraft) => setEdits((current) => ({ ...current, schedule }));
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
    missedPolicy,
    destination: newDestination,
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
  const missedPolicyChanged = missedRuns && trigger === "schedule" && missedPolicy !== savedMissedPolicy;
  const dirty = routine
    ? nameChanged || instructionChanged || scheduleChanged || webhookChanged || missedPolicyChanged
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
          missedPolicy: "skip",
          destination: null,
        }));
  useRecordDraftGuard(dirty && !finished, action.pending);
  useEffect(() => {
    if (finished) router.back();
  }, [finished]);
  const disabled = !available || action.pending || (!routine && savedDraft !== null);
  const validTrigger =
    trigger === "webhook" ? eventFilterDraftsValid(filters) : scheduleProblem === null && isRoutineSchedule(schedule);
  async function save() {
    if (webhookRoutine || trigger === "webhook" || missedRuns) {
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
        ...(missedRuns && trigger === "schedule" && (!routine || missedPolicyChanged) ? { missedPolicy } : {}),
      };
      const result = await workspace.saveEventRoutine(input, agent.serverId);
      if (result.secret || result.routine.trigger.kind === "schedule") setSecret(result.secret);
      if (!routine && isWebhookRoutine(result.routine)) {
        keepOpen.current = true;
        setCreated(result.routine);
      }
      if (!routine && !port && newDestination)
        await workspace
          .setRoutineResultDestination(
            { agentId: agent.id, routineId: result.routine.id, destination: newDestination },
            agent.serverId,
          )
          .catch(() =>
            Alert.alert(
              t("mobile.agent.record.resultDestination"),
              t("mobile.agent.record.resultDestination.createFailed"),
            ),
          );
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
                    setGivenTo(null);
                    setSecret(rotated.secret);
                  })
              : undefined
          }
          agentSecret={
            webhookRoutine && eventsSupported && agentSecretSupported && eventOwner.kind === "agent" && agentName
              ? {
                  agentName,
                  pending: give.pending,
                  give: () =>
                    void give.run(async () => {
                      await workspace.giveEventRoutineSecretToAgent(
                        { id: webhookRoutine.id, owner: eventOwner },
                        agent.serverId,
                      );
                      setSecret(null);
                      setGivenTo(agentName);
                    }),
                }
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
      {missedRuns && trigger === "schedule" ? (
        <SettingsSection title={t("mobile.agent.record.missedPolicy")}>
          {(["skip", "run-once"] as const).map((choice) => (
            <SettingsRow
              key={choice}
              checked={missedPolicy === choice}
              disclosure={false}
              disabled={disabled}
              trailing={missedPolicy === choice ? <Check size={18} color={accent} strokeWidth={2} /> : null}
              onPress={() => {
                if (choice === missedPolicy) return;
                void haptics.selection();
                setMissedPolicy(choice);
              }}
            >
              <Typography.Paragraph>{t(MISSED_POLICY_TEXT[choice])}</Typography.Paragraph>
            </SettingsRow>
          ))}
        </SettingsSection>
      ) : null}
      {routineResults && !port && !routine && (missedRuns || trigger === "webhook") ? (
        <RoutineResultDestinationSection
          agentId={agent.id}
          serverId={agent.serverId}
          disabled={disabled}
          draft={{ value: newDestination, onChange: setNewDestination }}
        />
      ) : null}
      {!routine ? (
        <SheetFormField
          label={t("mobile.agent.record.timeZone")}
          placeholder={TIME_ZONE_PLACEHOLDER}
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
                <AppSwitch
                  label={t("mobile.agent.record.enabled")}
                  value={activeOverride ?? routine.active}
                  disabled={disabled || toggle.pending}
                  modifiers={nativeLabelFont}
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
      {routineResults && !port && routine ? (
        <RoutineResultDestinationSection
          agentId={agent.id}
          routineId={routine.id}
          serverId={agent.serverId}
          disabled={disabled}
        />
      ) : null}
      {testStarted ? (
        <Typography.Paragraph accessibilityLiveRegion="polite">
          {t("mobile.agent.record.testStarted")}
        </Typography.Paragraph>
      ) : null}
      <SaveError error={testRun.error} />
      <SaveError error={rotate.error} />
      {givenTo && !give.error ? (
        <Typography.Paragraph accessibilityLiveRegion="polite" className="text-success-text">
          {t("mobile.agent.webhook.given", { name: givenTo })}
        </Typography.Paragraph>
      ) : null}
      <SaveError error={give.error} />
      <SaveError error={toggle.error} />
      <SaveError error={action.error} />
      {eventsSupported && routine ? (
        <RoutineWebhookActivity key={routine.id} serverId={agent.serverId} owner={eventOwner} routineId={routine.id} />
      ) : null}
    </View>
  );
}
