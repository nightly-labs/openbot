import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { AgentMessage, AgentProfile } from "../../data";
import { documentFocused } from "../../document-focus";
import { useText } from "../../text";
import { prefersReducedMotion } from "../../utils";
import { AgentAvatar } from "../agents/AgentAvatar";
import { AGENT_ACTIVITY_LABELS, AgentActivityIndicator } from "./AgentActivity";
import type { AgentStep } from "./AgentSteps";
import { ChatMessageRow } from "./ChatMessageRow";

export interface AgentChatEmptyStateProps {
  agent: AgentProfile;
  samplePrompt?: string | undefined;
  sampleSkillName?: string | undefined;
}

const STEP_MS = 900;
const HOLD_STEPS = 3;

const WORD_MARK = "\u0000";

const noop = () => undefined;

export function AgentChatEmptyState(props: AgentChatEmptyStateProps) {
  const { t } = useText();
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
  key: number;
  phase: number;
}

function SampleTurnLoop(props: { agent: AgentProfile; prompt: string; skillName: string | undefined; still: boolean }) {
  const { t } = useText();
  const steps = createMemo((): Extract<AgentStep, { kind: "progress" }>[] => [
    ...(props.skillName
      ? [{ id: "skill", kind: "progress" as const, text: t("status.agent.skillUsing", { name: props.skillName }) }]
      : []),
    { id: "gather", kind: "progress", text: t("chat.empty.agent.stepGather") },
    { id: "review", kind: "progress", text: t("chat.empty.agent.stepReview") },
  ]);
  const turnLength = () => 2 + steps().length + HOLD_STEPS + 1;
  const [step, setStep] = createSignal(0);
  createEffect(
    () => !props.still && (documentFocused() || step() % turnLength() !== 0),
    (playing) => {
      if (!playing) return;
      const timer = window.setInterval(() => setStep((value) => value + 1), STEP_MS);
      return () => window.clearInterval(timer);
    },
  );
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
