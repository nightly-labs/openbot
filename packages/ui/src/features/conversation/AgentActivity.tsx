import type { AgentStepActivity } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createSignal, createUniqueId, Show } from "solid-js";
import { Button } from "../../button";
import type { AgentProfile } from "../../data";
import { ChevronDown } from "../../icons";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { ActivityShine } from "./ActivityShine";
import { type AgentStep, AgentStepList } from "./AgentSteps";

/**
 * The English source of each label. A label is an identifier here: render it with
 * `t(agentActivityLabelKey(label))`.
 */
export const AGENT_ACTIVITY_LABELS = [
  "Working on it…",
  "Thinking it through…",
  "Connecting the dots…",
  "Checking the details…",
  "Putting the answer together…",
  "Making sense of it…",
  "One step at a time…",
  "Tiny gears are turning…",
  "Consulting the inner council…",
  "Cooking up something useful…",
] as const;

const FACTUAL_ACTIVITY_LABELS = AGENT_ACTIVITY_LABELS.slice(0, 7);
const PLAYFUL_ACTIVITY_LABELS = AGENT_ACTIVITY_LABELS.slice(7);

export type AgentActivityLabel = (typeof AGENT_ACTIVITY_LABELS)[number];

const AGENT_ACTIVITY_LABEL_KEYS = {
  "Working on it…": "chat.activity.workingOnIt",
  "Thinking it through…": "chat.activity.thinking",
  "Connecting the dots…": "chat.activity.connectingDots",
  "Checking the details…": "chat.activity.checkingDetails",
  "Putting the answer together…": "chat.activity.puttingTogether",
  "Making sense of it…": "chat.activity.makingSense",
  "One step at a time…": "chat.activity.oneStep",
  "Tiny gears are turning…": "chat.activity.tinyGears",
  "Consulting the inner council…": "chat.activity.innerCouncil",
  "Cooking up something useful…": "chat.activity.cookingUp",
} as const satisfies Record<AgentActivityLabel, AppTextKey>;

/** The catalog key that renders `label` in the interface language. */
export function agentActivityLabelKey(label: AgentActivityLabel): AppTextKey {
  return AGENT_ACTIVITY_LABEL_KEYS[label];
}

/**
 * The line the indicator shows while an agent works.
 *
 * Only the wording is drawn. The avatar used to draw an animation from here too, which is how a
 * turn could turn the agent into a comet and the next one into a burst of particles: a silhouette
 * is identity, so it is not something to shuffle. The face now follows the `working` mood like
 * every other avatar in the app.
 */
export function nextAgentActivityLabel(
  previous?: AgentActivityLabel,
  random: () => number = Math.random,
): AgentActivityLabel {
  return pickActivityLabel(previous, random);
}

/**
 * A step shorter than this shows no time. Most steps end sooner, and a counter that appears and
 * goes away at once is only noise.
 */
const ELAPSED_VISIBLE_AFTER_MS = 5_000;
/**
 * A plain line shows the time of a step only after this long. A short step keeps the calm line, and a
 * command that runs for an hour does not look like an agent that stopped (#5757).
 */
const PLAIN_ELAPSED_VISIBLE_AFTER_MS = 60_000;

export function AgentActivityIndicator(props: {
  agent: AgentProfile | undefined;
  detail?: string | null;
  label: AgentActivityLabel;
  phase?: "active" | "exiting";
  /**
   * When the current line started, from `Date.now()`. A long step then shows how long it has run,
   * so a working agent reads differently from a stalled one.
   */
  since?: number;
  /** The steps of the running turn. With steps, a chevron opens them under the line. */
  steps?: readonly AgentStep[] | undefined;
  /** The "Show agent steps" setting: the steps are open when the turn starts. */
  stepsOpenByDefault?: boolean | undefined;
  /**
   * The provider name, when nothing has come from the provider for a while or the computer has no
   * network. The line then says that it waits, with no shine, because a silent provider is not visible work.
   */
  waitingFor?: string | null | undefined;
  /**
   * The line shows only what the agent does now, as the step names it: no label while no step is
   * named, and no steps. A named step shows its time only when it runs long. The avatar shows what
   * the step does, and each new label rises into place.
   */
  plain?: boolean | undefined;
  /** What the running step does, as the host names it. A plain line shows it on the avatar. */
  activity?: AgentStepActivity | null | undefined;
}) {
  const { t, format } = useText();
  // While the model reads the result of a step, a plain line keeps the name of that step: the host's
  // "Reviewing the latest tool result…" would replace each step name a moment after it shows. The
  // review text stays as the detail when the answer starts and the step kind goes, so it is kept out
  // until a new step names itself.
  let reviewDetail: string | null | undefined;
  const detail = createMemo<string | null | undefined>((previous) => {
    if (!props.plain) return props.detail;
    if (props.activity === "reviewing") reviewDetail = props.detail;
    return previous && props.detail && props.detail === reviewDetail ? previous : props.detail;
  });
  const label = () => {
    const provider = props.waitingFor;
    if (provider) return t("chat.activity.waitingFor", { provider });
    return detail() ?? t(agentActivityLabelKey(props.label));
  };
  /** The text on the line. A plain line shows no general label: the moving avatar says that the agent works. */
  const shownLabel = () => (props.plain && !props.waitingFor && !detail() ? null : label());
  const statusLabel = () => {
    const name = props.agent?.name ?? t("chat.activity.agentFallback");
    const provider = props.waitingFor;
    return provider
      ? t("chat.activity.waitingStatus", { name, provider })
      : t("chat.activity.status", { name, label: label() });
  };
  // A named function, not a ternary in the prop: the compiler wraps a ternary prop in a memo, and
  // the avatar reads its mood in a tracked effect, where a new memo halts the reactive system.
  const mood = () => (props.waitingFor ? "connecting" : "working");
  const waiting = () => (props.waitingFor ? "true" : undefined);
  const plain = () => (props.plain ? "true" : undefined);
  const avatarActivity = () => (props.plain && !props.waitingFor ? (props.activity ?? null) : undefined);
  const shownSteps = () => (props.plain ? undefined : props.steps);
  const elapsedMs = createElapsed(() => (props.phase === "exiting" ? undefined : props.since));
  const elapsed = createMemo(() => {
    const ms = elapsedMs();
    if (ms < (props.plain ? PLAIN_ELAPSED_VISIBLE_AFTER_MS : ELAPSED_VISIBLE_AFTER_MS)) return null;
    // A plain line with no step label shows only the avatar; a time alone would not say what it counts.
    // While the model reads a result, the line keeps the name of the step that ended, but the time
    // counts the review, so it would not belong to that name.
    if (props.plain && (!shownLabel() || (!props.waitingFor && detail() !== props.detail))) return null;
    const total = Math.floor(ms / 1_000);
    const seconds = format.number(total % 60, { style: "unit", unit: "second", unitDisplay: "narrow" });
    if (total < 60) return seconds;
    const minutes = format.number(Math.floor(total / 60), { style: "unit", unit: "minute", unitDisplay: "narrow" });
    return `${minutes} ${seconds}`;
  });
  return (
    <div
      class="agent-activity-entry"
      data-state={props.phase ?? "active"}
      data-waiting={waiting()}
      data-plain={plain()}
    >
      <span class="sr-only" role="status" aria-live="polite" aria-atomic="true" aria-label={statusLabel()} />
      <AgentActivityBody
        steps={shownSteps()}
        stepsOpenByDefault={props.stepsOpenByDefault}
        live={props.phase !== "exiting"}
      >
        <AgentAvatar agent={props.agent} mood={mood()} activity={avatarActivity()} class="agent-activity-avatar" />
        <Show
          when={plain()}
          fallback={
            <Show when={shownLabel()}>
              {(text) => (
                <span class="agent-activity-label">
                  {text()}
                  <ActivityShine text={text()} />
                </span>
              )}
            </Show>
          }
        >
          {/* Keyed, so that each new label is a new element and plays its entrance. */}
          <Show when={shownLabel()} keyed>
            {(text) => (
              <span class="agent-activity-label">
                {text}
                <ActivityShine text={text} />
              </span>
            )}
          </Show>
        </Show>
        <Show when={elapsed()}>{(time) => <span class="agent-activity-elapsed">{time()}</span>}</Show>
      </AgentActivityBody>
    </div>
  );
}

/**
 * The activity line, with a chevron that opens the steps of the running work under it. The agent
 * chat and the channel give the faces and the label as children, so both have one steps toggle.
 */
export function AgentActivityBody(props: {
  /** A class for the line besides `agent-activity-content`. */
  class?: string;
  steps?: readonly AgentStep[] | undefined;
  /** The "Show agent steps" setting: the steps are open when the work starts. */
  stepsOpenByDefault?: boolean | undefined;
  live: boolean;
  children: JSX.Element;
}) {
  const { t } = useText();
  const stepsId = createUniqueId();
  const [stepsChoice, setStepsChoice] = createSignal<boolean>();
  const hasSteps = () => (props.steps?.length ?? 0) > 0;
  const stepsOpen = () => hasSteps() && (stepsChoice() ?? props.stepsOpenByDefault === true);
  // A new turn starts with no steps, and with the setting again.
  createEffect(hasSteps, (has) => {
    if (!has) setStepsChoice(undefined);
  });
  return (
    <div class="agent-activity-body">
      <section
        class={props.class ? `agent-activity-content ${props.class}` : "agent-activity-content"}
        aria-label={t("chat.activity.current")}
      >
        {props.children}
        <Show when={hasSteps()}>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            class="agent-steps-toggle"
            aria-expanded={stepsOpen() ? "true" : "false"}
            aria-controls={stepsOpen() ? stepsId : undefined}
            aria-label={stepsOpen() ? t("chat.steps.hide") : t("chat.steps.show")}
            onClick={() => setStepsChoice(!stepsOpen())}
          >
            <ChevronDown class="agent-steps-chevron" aria-hidden="true" />
          </Button>
        </Show>
      </section>
      <Show when={stepsOpen()}>
        <div class="agent-activity-steps">
          <AgentStepList id={stepsId} steps={props.steps ?? []} live={props.live} />
        </div>
      </Show>
    </div>
  );
}

/** Milliseconds since `since`, ticking each second while there is one, and 0 when there is not. */
function createElapsed(since: () => number | undefined) {
  const [now, setNow] = createSignal(Date.now());
  createEffect(
    () => since(),
    (from) => {
      if (from === undefined) return;
      setNow(Date.now());
      const clock = window.setInterval(() => setNow(Date.now()), 1_000);
      return () => window.clearInterval(clock);
    },
  );
  return createMemo(() => {
    const from = since();
    return from === undefined ? 0 : Math.max(0, now() - from);
  });
}

function pickDifferent<T>(items: readonly T[], previous: T | undefined, random: () => number): T {
  const choices = previous === undefined ? items : items.filter((item) => item !== previous);
  const value = random();
  const normalized = Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.999_999) : 0;
  const selected = choices[Math.floor(normalized * choices.length)];
  if (selected === undefined) throw new Error("Agent activity options are empty.");
  return selected;
}

function pickActivityLabel(previous: AgentActivityLabel | undefined, random: () => number): AgentActivityLabel {
  const tone = random();
  const pool = Number.isFinite(tone) && tone >= 0.7 ? PLAYFUL_ACTIVITY_LABELS : FACTUAL_ACTIVITY_LABELS;
  return pickDifferent(pool, previous, random);
}
