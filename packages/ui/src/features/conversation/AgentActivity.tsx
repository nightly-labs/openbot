import type { AgentProfile } from "../../data";
import { AgentAvatar } from "../agents/AgentAvatar";

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

export function AgentActivityIndicator(props: {
  agent: AgentProfile | undefined;
  detail?: string | null;
  label: AgentActivityLabel;
  phase?: "active" | "exiting";
}) {
  const label = () => props.detail ?? props.label;
  return (
    <div class="agent-activity-entry" data-state={props.phase ?? "active"}>
      <span
        class="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={`${props.agent?.name ?? "Agent"} is working: ${label()}`}
      />
      <section class="agent-activity-content" aria-label="Current activity">
        <AgentAvatar agent={props.agent} mood="working" class="agent-activity-avatar" />
        <span class="agent-activity-label">{label()}</span>
      </section>
    </div>
  );
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
