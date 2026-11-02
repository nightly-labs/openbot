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
import { GITHUB_TRIGGER_DEFAULTS, GitHubIcon, GitHubTriggerRows, useGitHubTriggerReady } from "./workflow-github-parts";
import { newTriggerSchedule, stableJson } from "./workflow-history";
import { type Choice, NodeShell, NodeToolbar, oneOf, useField, useLocked, useStepRun } from "./workflow-node-parts";
import { PlaceRow, SettingRow, SettingRows, SettingsFoot, StaticRow } from "./workflow-setting-rows";

type TriggerType = "schedule" | "manual" | "webhook" | "message" | "github";

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
  { value: "github", label: t("workflow.trigger.type.github"), icon: () => <GitHubIcon /> },
];

const TRIGGER_TYPES: readonly TriggerType[] = ["schedule", "manual", "webhook", "message", "github"];

/**
 * The start of a workflow. The type is the first row of the card, and the settings of that type follow it:
 * a schedule shows its next run, a webhook shows the address to call, a message trigger shows its channel,
 * and a GitHub trigger shows its repository, its event and the events that GitHub sent. Each trigger has a
 * run button: on the canvas it runs the steps that this trigger leads to, and a manual trigger has no other
 * way to start. A GitHub trigger runs with the newest item that matches it.
 *
 * The host gives the webhook address and the next run time of a schedule. Without them, the trigger
 * does not show them. GitHub shows only when the host can run it.
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
  /** A new GitHub trigger stores the event and the filter that its rows show, so the host reads the same. */
  const chooseTrigger = (value: TriggerType) => {
    if (value !== "github" || board.field(props.id, "event") !== undefined) return setTrigger(value);
    board.setFields(props.id, { trigger: value, ...GITHUB_TRIGGER_DEFAULTS });
  };
  /** GitHub needs a host that can run it. Other types show unless the host lists the types it runs. */
  const offered = (type: TriggerType) => {
    const triggers = board.features()?.triggers;
    if (type === trigger()) return true;
    return type === "github" ? triggers?.includes(type) === true : (triggers?.includes(type) ?? true);
  };
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
  const [locked, setLocked] = useLocked(() => props.id);
  const run = useStepRun(untrack(() => props.id));
  const githubReady = useGitHubTriggerReady(() => props.id);
  const isGitHub = () => trigger() === "github";
  /** A GitHub trigger has no input of its own, so a run from the card uses the newest event that matches. */
  const runLabel = () => {
    if (isGitHub()) return t("workflow.trigger.runLastEvent");
    return trigger() === "manual" ? t("workflow.trigger.runWorkflow") : t("workflow.trigger.runNow");
  };
  const start = () => {
    if (isGitHub()) return board.github()?.runLastEvent(props.id);
    return board.runFrom ? board.runFrom(props.id) : run.start();
  };
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
          disabled={locked() || board.running() || (isGitHub() && !githubReady())}
          onClick={start}
        >
          {runLabel()}
          <Play aria-hidden="true" />
        </Button>
      }
      id={props.id}
      label={t("workflow.trigger.title")}
      icon={<Zap aria-hidden="true" />}
      kind="trigger"
      output="text"
      style={{ "--wfn-width": "320px" }}
      toolbar={<NodeToolbar id={props.id} name={t("workflow.trigger.name")} locked={locked()} onLock={setLocked} />}
    >
      <SettingRows
        head={
          <SettingRow
            name={t("workflow.trigger.type")}
            value={trigger()}
            choices={TRIGGERS(t).filter((choice) => offered(choice.value))}
            disabled={locked()}
            onChange={chooseTrigger}
          />
        }
      >
        <Show when={trigger() === "schedule"}>
          <div class="wfn-settings-block">
            <RoutineSchedulePicker
              schedule={schedule()}
              density="card"
              disabled={locked()}
              onChange={changeSchedule}
              onEditEnd={board.endScheduleEdit}
            />
          </div>
          <Show when={nextRun()}>
            {(time) => (
              <SettingsFoot>
                <StaticRow name={t("workflow.trigger.nextRunName")}>
                  <span class="wfn-row-text">{time()}</span>
                </StaticRow>
              </SettingsFoot>
            )}
          </Show>
        </Show>
        <Show when={trigger() === "webhook" ? props.webhookUrl : undefined}>
          {(url) => (
            <div class="wfn-row" data-static="">
              <span class="wfn-row-name">{t("workflow.trigger.webhook.address")}</span>
              <code class="wfn-row-value wfn-row-code">{url()}</code>
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
            <div class="wfn-settings-block">
              <RoutineWebhookSecretField
                secret={secret()}
                onSecretDismiss={() => setSecret(null)}
                onRegenerateSecret={rotate}
              />
            </div>
          </Show>
        </Show>
        <Show when={trigger() === "message"}>
          <PlaceRow
            id={props.id}
            connectionId={untrack(() => props.connectionId)}
            placeId={untrack(() => props.placeId)}
            disabled={locked()}
          />
        </Show>
        <Show when={isGitHub()}>
          <GitHubTriggerRows id={props.id} locked={locked()} />
        </Show>
      </SettingRows>
    </NodeShell>
  );
}
