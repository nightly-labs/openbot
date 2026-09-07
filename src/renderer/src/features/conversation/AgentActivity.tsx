import type { StateId } from "@norbert_bodziony/bloub";
import type { AgentProfile } from "../../data";
import { AgentAvatar } from "../agents/AgentAvatar";

export const AGENT_ACTIVITY_ANIMATIONS = [
  "thinking",
  "orbit",
  "comet",
  "swirl",
  "burst",
  "wide",
] as const satisfies readonly StateId[];

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

export interface AgentActivityPresentation {
  animation: (typeof AGENT_ACTIVITY_ANIMATIONS)[number];
  label: (typeof AGENT_ACTIVITY_LABELS)[number];
}

export function nextAgentActivityPresentation(
  previous?: AgentActivityPresentation,
  random: () => number = Math.random,
): AgentActivityPresentation {
  return {
    animation: pickDifferent(AGENT_ACTIVITY_ANIMATIONS, previous?.animation, random),
    label: pickActivityLabel(previous?.label, random),
  };
}

export function AgentActivityIndicator(props: {
  agent: AgentProfile | undefined;
  detail?: string | null;
  presentation: AgentActivityPresentation;
  phase?: "active" | "exiting";
}) {
  const label = () => props.detail ?? props.presentation.label;
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
        <AgentAvatar
          agent={props.agent}
          url={null}
          motion="working"
          animationState={props.presentation.animation}
          class="agent-activity-avatar"
        />
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

function pickActivityLabel(
  previous: AgentActivityPresentation["label"] | undefined,
  random: () => number,
): AgentActivityPresentation["label"] {
  const tone = random();
  const pool = Number.isFinite(tone) && tone >= 0.7 ? PLAYFUL_ACTIVITY_LABELS : FACTUAL_ACTIVITY_LABELS;
  return pickDifferent(pool, previous, random);
}
