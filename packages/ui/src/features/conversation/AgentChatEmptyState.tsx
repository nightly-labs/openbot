import { createMemo, createSignal, For, onSettled, Show } from "solid-js";
import type { AgentMessage, AgentProfile } from "../../data";
import { useText } from "../../text";
import { prefersReducedMotion } from "../../utils";
import { AgentAvatar } from "../agents/AgentAvatar";
import { AGENT_ACTIVITY_LABELS, AgentActivityIndicator } from "./AgentActivity";
import type { AgentStep } from "./AgentSteps";
import { ChatMessageRow } from "./ChatMessageRow";

export interface AgentChatEmptyStateProps {
  agent: AgentProfile;
  /**
   * The instruction of one of the agent's routines. The faint sample turn asks it. With no
   * instruction, the empty state shows no sample turn.
   */
  samplePrompt?: string | undefined;
  /** The name of one of the agent's skills, for a step of the sample turn. */
  sampleSkillName?: string | undefined;
}

/** One step of the loop. A turn is: rest, prompt, one step for each agent step, hold, fade. */
const STEP_MS = 900;
const HOLD_STEPS = 3;

/** Splits the translated sentence around its `{word}`, which the empty state writes by hand. */
const WORD_MARK = "\u0000";

const noop = () => undefined;

/**
 * A direct chat before its first message: the agent, its line, and a faint turn that plays its
 * work one step at a time from its own routine and skill. The turn is decoration: a reader does
 * not hear it, and a pointer or a key cannot reach it. The composer stays the only action.
 */
export function AgentChatEmptyState(props: AgentChatEmptyStateProps) {
  const { t } = useText();
  // Less motion: the title word is written and the turn stands still from the start.
  const still = prefersReducedMotion();
  const watchParts = createMemo(() => t("chat.empty.agent.watch", { word: WORD_MARK }).split(WORD_MARK));
  return (
    <div class="agent-chat-empty" data-still={still ? "" : undefined}>
      <div class="agent-chat-empty-pitch">
        <AgentAvatar agent={props.agent} mood="idle" motion="always" class="agent-chat-empty-avatar" />
        <h2 class="agent-chat-empty-title">
          <span class="agent-chat-empty-ready">{t("chat.empty.agent.ready", { name: props.agent.name })}</span>
          <span>
            {watchParts()[0]}
            <span class="agent-chat-empty-hand">{t("chat.empty.agent.watchWord")}</span>
            {watchParts()[1]}
          </span>
        </h2>
        <Show when={props.agent.description.trim()}>
          {(description) => <p class="agent-chat-empty-description">{description()}</p>}
        </Show>
      </div>
      <Show when={props.samplePrompt?.trim()}>
        {(prompt) => (
          <SampleTurnLoop agent={props.agent} prompt={prompt()} skillName={props.sampleSkillName} still={still} />
        )}
      </Show>
    </div>
  );
}

interface TurnFrame {
  /** One showing of the turn. The rows mount again for the next showing, so they enter again. */
  key: number;
  /** The phase in the turn: 0 rests, 1 shows the prompt, and so on. */
  phase: number;
}

function SampleTurnLoop(props: { agent: AgentProfile; prompt: string; skillName: string | undefined; still: boolean }) {
  const { t } = useText();
  // The host's own progress lines for a turn that uses a skill, then reads and reviews.
  const steps = createMemo((): Extract<AgentStep, { kind: "progress" }>[] => [
    ...(props.skillName
      ? [{ id: "skill", kind: "progress" as const, text: t("status.agent.skillUsing", { name: props.skillName }) }]
      : []),
    { id: "gather", kind: "progress", text: t("chat.empty.agent.stepGather") },
    { id: "review", kind: "progress", text: t("chat.empty.agent.stepReview") },
  ]);
  const turnLength = () => 2 + steps().length + HOLD_STEPS + 1;
  const [step, setStep] = createSignal(0);
  onSettled(() => {
    if (props.still) return;
    const timer = window.setInterval(() => setStep((value) => value + 1), STEP_MS);
    return () => window.clearInterval(timer);
  });
  // Less motion: one still frame, with the prompt and all the steps.
  const frame = createMemo(
    (): TurnFrame =>
      props.still
        ? { key: 0, phase: 1 + steps().length }
        : { key: Math.floor(step() / turnLength()), phase: step() % turnLength() },
  );
  const shown = createMemo(() => (frame().phase > 0 ? [frame()] : []));
  const message = (): AgentMessage => ({
    id: "agent-chat-empty-prompt",
    author: "you",
    body: props.prompt,
    time: "",
    kind: "text",
  });
  return (
    <div class="agent-chat-empty-turn" aria-hidden="true" inert>
      <For each={shown()} keyed={(current) => current.key}>
        {(current) => {
          const shownSteps = () => steps().slice(0, Math.max(0, current().phase - 1));
          const detail = () => shownSteps().at(-1)?.text ?? null;
          const leaving = () => !props.still && current().phase >= turnLength() - 1;
          return (
            <div class="agent-chat-empty-showing" data-leaving={leaving() ? "" : undefined}>
              <div class="agent-chat-empty-row">
                <ChatMessageRow
                  message={message()}
                  author={{ kind: "you", name: t("chat.message.you") }}
                  showAuthor={false}
                  animate={!props.still}
                  agents={[props.agent]}
                  onSelectAgent={noop}
                  onOpenLink={noop}
                  onPreview={noop}
                  onAttachmentAction={noop}
                />
              </div>
              <Show when={shownSteps().length > 0}>
                <div class="agent-chat-empty-row">
                  <AgentActivityIndicator
                    agent={props.agent}
                    label={AGENT_ACTIVITY_LABELS[0]}
                    detail={detail()}
                    steps={shownSteps()}
                    stepsOpenByDefault
                  />
                </div>
              </Show>
            </div>
          );
        }}
      </For>
    </div>
  );
}
