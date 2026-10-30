/** A trigger: the start of a workflow. */

import type { AppTranslate } from "@openbot/i18n";
import {
  type RoutineScheduleDraft,
  routineScheduleFromDraft,
  routineScheduleToDraft,
} from "@openbot/team-client/routine-schedule-draft";
import {
  Button,
  CalendarClock,
  CopyButton,
  MessageSquare,
  MousePointerClick,
  Play,
  toast,
  Webhook,
  Zap,
} from "@openbot/ui";
import { createSignal, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { RoutineSchedulePicker } from "../conversation/RoutineSchedulePicker";
import { RoutineWebhookSecretField } from "../conversation/RoutineWebhookEndpoint";
import { useBoard } from "./workflow-board";
import { newTriggerSchedule, stableJson } from "./workflow-history";
import {
  type Choice,
  ChoicePill,
  Field,
  NodeShell,
  NodeToolbar,
  oneOf,
  PlacePill,
  useField,
  useLocked,
  usePlace,
  useStepRun,
} from "./workflow-node-parts";

type TriggerType = "schedule" | "manual" | "webhook" | "message";

const TRIGGERS = (t: AppTranslate): readonly Choice<TriggerType>[] => [
  {
    value: "schedule",
    label: t("workflow.trigger.type.schedule"),
    icon: () => <CalendarClock aria-hidden="true" />,
  },
  {
    value: "manual",
    label: t("workflow.trigger.type.manual"),
    icon: () => <MousePointerClick aria-hidden="true" />,
  },
  { value: "webhook", label: t("workflow.trigger.type.webhook"), icon: () => <Webhook aria-hidden="true" /> },
  {
    value: "message",
    label: t("workflow.trigger.type.message"),
    icon: () => <MessageSquare aria-hidden="true" />,
  },
];

const TRIGGER_TYPES: readonly TriggerType[] = ["schedule", "manual", "webhook", "message"];

/**
 * The start of a workflow. A schedule shows its next run, a webhook shows the address to call, and a
 * message trigger shows its channel. Each trigger has a run button: on the canvas it runs the steps
 * that this trigger leads to, and a manual trigger has no other way to start.
 *
 * The host gives the webhook address and the next run time of a schedule. Without them, the trigger
 * does not show them.
 */
export function TriggerNode(props: {
  id: string;
  trigger?: TriggerType;
  connectionId?: string;
  placeId?: string;
  webhookUrl?: string | undefined;
  /** The next run of the schedule, as an ISO time. */
  nextRun?: string | undefined;
}) {
  const board = useBoard();
  const { t, format, errorMessage } = useText();
  const [trigger, setTrigger] = useField<TriggerType>(
    () => props.id,
    "trigger",
    untrack(() => props.trigger ?? "schedule"),
    oneOf(TRIGGER_TYPES),
  );
  /**
   * The draft that the user edits. A cron text with a space at the end saves without it, so the picker
   * shows this draft while it gives the saved schedule. An undo gives another schedule, and its draft.
   * A trigger saved without a schedule shows the schedule of a new one.
   */
  const [edited, setEdited] = createSignal<RoutineScheduleDraft>();
  const schedule = () => {
    const saved = board.schedule(props.id) ?? newTriggerSchedule();
    const draft = edited();
    return draft && stableJson(routineScheduleFromDraft(draft)) === stableJson(saved)
      ? draft
      : routineScheduleToDraft(saved);
  };
  const changeSchedule = (draft: RoutineScheduleDraft) => {
    setEdited(draft);
    board.setSchedule(props.id, routineScheduleFromDraft(draft));
  };
  /** The signing secret that the host gave once. It shows until the user dismisses it. */
  const [secret, setSecret] = createSignal<string | null>(null);
  const [creating, setCreating] = createSignal(false);
  const rotate = async () => {
    const make = board.rotateWebhookSecret;
    if (make) setSecret(await make(props.id));
  };
  /** The first secret also makes the address, so a new webhook trigger has a button for both. */
  const create = () => {
    setCreating(true);
    rotate()
      .catch((cause: unknown) => toast.error(errorMessage(cause, t("routine.webhook.regenerateFailed"))))
      .finally(() => setCreating(false));
  };
  const place = usePlace(
    () => props.id,
    untrack(() => ({ connectionId: props.connectionId, placeId: props.placeId })),
  );
  const [locked, setLocked] = useLocked(() => props.id);
  const run = useStepRun(untrack(() => props.id));
  const nextRun = () =>
    props.nextRun
      ? format.date(new Date(props.nextRun), {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
      : undefined;
  return (
    <NodeShell
      action={
        <Button
          class="wfn-run"
          fullWidth
          loading={run.running()}
          loadingLabel={t("workflow.node.running")}
          disabled={locked() || board.running()}
          onClick={() => (board.runFrom ? board.runFrom(props.id) : run.start())}
        >
          {trigger() === "manual" ? t("workflow.trigger.runWorkflow") : t("workflow.trigger.runNow")}
          <Play aria-hidden="true" />
        </Button>
      }
      id={props.id}
      label={t("workflow.trigger.title")}
      icon={<Zap aria-hidden="true" />}
      kind="trigger"
      output="text"
      toolbar={<NodeToolbar id={props.id} name={t("workflow.trigger.name")} locked={locked()} onLock={setLocked} />}
    >
      <Field class="wfn-block-field">
        <Show when={trigger() === "schedule"}>
          <RoutineSchedulePicker
            schedule={schedule()}
            density="card"
            disabled={locked()}
            onChange={changeSchedule}
            onEditEnd={board.endScheduleEdit}
          />
        </Show>
        <Show when={trigger() === "webhook" ? props.webhookUrl : undefined}>
          {(url) => (
            <div class="wfn-block-copy">
              <code class="wfn-block-url">{url()}</code>
              <CopyButton value={url()} iconOnly label={t("workflow.trigger.copyWebhook")} />
            </div>
          )}
        </Show>
        <Show when={trigger() === "webhook" && board.rotateWebhookSecret}>
          <Show
            when={props.webhookUrl || secret()}
            fallback={
              <Button
                size="sm"
                variant="secondary"
                loading={creating()}
                loadingLabel={t("workflow.trigger.webhook.creating")}
                disabled={locked()}
                onClick={create}
              >
                {t("workflow.trigger.webhook.create")}
              </Button>
            }
          >
            <RoutineWebhookSecretField
              secret={secret()}
              onSecretDismiss={() => setSecret(null)}
              onRegenerateSecret={rotate}
            />
          </Show>
        </Show>
        <Show when={trigger() === "message"}>
          <PlacePill
            name={t("workflow.node.place.channel")}
            connectionId={place.connectionId()}
            placeId={place.placeId()}
            disabled={locked()}
            onChange={place.set}
          />
        </Show>
        <div class="wfn-field-foot">
          <ChoicePill
            name={t("workflow.trigger.title")}
            value={trigger()}
            choices={TRIGGERS(t).filter(
              (choice) => choice.value === trigger() || (board.features()?.triggers.includes(choice.value) ?? true),
            )}
            disabled={locked()}
            onChange={setTrigger}
          />
          <Show when={trigger() === "schedule" ? nextRun() : undefined}>
            {(time) => <span class="wfn-block-meta">{t("workflow.trigger.nextRun", { time: time() })}</span>}
          </Show>
        </div>
      </Field>
    </NodeShell>
  );
}
