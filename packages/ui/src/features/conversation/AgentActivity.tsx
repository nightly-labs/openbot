import type { AppTextKey } from "@openbot/i18n";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";

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
}) {
  const { t, format } = useText();
  const label = () => props.detail ?? t(agentActivityLabelKey(props.label));
  const elapsedMs = createElapsed(() => (props.phase === "exiting" ? undefined : props.since));
  const elapsed = createMemo(() => {
    const ms = elapsedMs();
    if (ms < ELAPSED_VISIBLE_AFTER_MS) return null;
    const total = Math.floor(ms / 1_000);
    const seconds = format.number(total % 60, { style: "unit", unit: "second", unitDisplay: "narrow" });
    if (total < 60) return seconds;
    const minutes = format.number(Math.floor(total / 60), { style: "unit", unit: "minute", unitDisplay: "narrow" });
    return `${minutes} ${seconds}`;
  });
  return (
    <div class="agent-activity-entry" data-state={props.phase ?? "active"}>
      <span
        class="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={t("chat.activity.status", {
          name: props.agent?.name ?? t("chat.activity.agentFallback"),
          label: label(),
        })}
      />
      <section class="agent-activity-content" aria-label={t("chat.activity.current")}>
        <AgentAvatar agent={props.agent} mood="working" class="agent-activity-avatar" />
        <span class="agent-activity-label">{label()}</span>
        <Show when={elapsed()}>{(time) => <span class="agent-activity-elapsed">{time()}</span>}</Show>
      </section>
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
