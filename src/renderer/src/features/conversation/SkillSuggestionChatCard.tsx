import type { SkillSuggestionEvent } from "@openbot/contracts/ipc";
import type { AgentMessage } from "@openbot/ui/data";
import {
  MarketplaceSuggestionCard,
  type MarketplaceSuggestionSkillAction,
} from "@openbot/ui/features/conversation/MarketplaceSuggestionCard";
import { useText } from "@openbot/ui/text";
import { createSignal } from "solid-js";
import { dismissMarketplaceSuggestion, marketplaceSuggestionDismissed } from "./marketplace-suggestion-dismissals";

/**
 * Where a skill suggestion is. `open`: the user has not answered. `working`: the agent works on the
 * answer. `saved`: the agent saved the skill. `answered`: the user answered and the agent saved
 * nothing, or the user wrote about something else.
 */
export type SkillSuggestionOutcome = "open" | "working" | "saved" | "answered";

/**
 * The outcome from the messages after the suggestion. Only the first user message after it carries
 * the suggestion to the agent, so a later one cannot save it: a new skill after a later message counts
 * only when it has the suggested name, as when the host saved it from the Save button.
 */
export function skillSuggestionOutcome(
  messages: readonly AgentMessage[],
  messageId: string,
  suggestion: SkillSuggestionEvent,
  turnActive: boolean,
): SkillSuggestionOutcome {
  const index = messages.findIndex((message) => message.id === messageId);
  if (index < 0) return "open";
  let answers = 0;
  for (const message of messages.slice(index + 1)) {
    if (message.author === "you") answers += 1;
    const marker = message.actionMarker;
    if (marker?.kind !== "skill-lifecycle") continue;
    if (
      suggestion.action === "create"
        ? marker.action === "created" &&
          (answers === 1 || marker.skillName.trim().toLowerCase() === suggestion.skillName.trim().toLowerCase())
        : marker.skillId === suggestion.skillId
    )
      return "saved";
  }
  if (answers === 0) return "open";
  return turnActive ? "working" : "answered";
}

export interface SkillSuggestionChatCardProps {
  messageId: string;
  suggestion: SkillSuggestionEvent;
  outcome: SkillSuggestionOutcome;
  /**
   * Saves the skill on the host in the background, or sends `reply`, the user's yes, to the agent of
   * this chat when the host saved nothing. False when the chat cannot send now.
   */
  onSave?: ((reply: string) => Promise<boolean>) | undefined;
  /** Opens the skill that an update changes. */
  onOpenSkill?: ((skill: { skillId: string }) => void) | undefined;
}

/**
 * A memory review's question to save a skill from the chat. Save asks the host to write the skill in
 * the background, and the card turns to Saved when the skill line comes. When the host saves nothing,
 * Save sends the user's yes to the agent, which saves the skill in a turn.
 */
export function SkillSuggestionChatCard(props: SkillSuggestionChatCardProps) {
  const { t } = useText();
  /* The save or the yes runs before the chat shows its result, so the card waits from the click. */
  const [sent, setSent] = createSignal(false);
  const state = () => {
    if (props.outcome === "saved") return "connected";
    if (props.outcome === "working" || (sent() && props.outcome === "open")) return "busy";
    return "available";
  };
  const save = async () => {
    if (sent()) return;
    setSent(true);
    const reply =
      props.suggestion.action === "create" ? t("chat.suggestion.saveReply") : t("chat.suggestion.updateReply");
    if (!(await props.onSave?.(reply))) setSent(false);
  };
  const skillAction = (): MarketplaceSuggestionSkillAction =>
    props.suggestion.action === "create" ? "save" : "update";
  const onSave = () => (props.outcome === "answered" || !props.onSave ? undefined : () => void save());
  const openSkill = () => {
    const suggestion = props.suggestion;
    const open = props.onOpenSkill;
    return suggestion.action === "update" && open ? () => open({ skillId: suggestion.skillId }) : undefined;
  };
  return (
    <MarketplaceSuggestionCard
      kind="skill"
      skillAction={skillAction()}
      name={props.suggestion.skillName}
      description={props.suggestion.question}
      fullDescription
      iconUrl={null}
      state={state()}
      dismissed={marketplaceSuggestionDismissed(props.messageId)}
      onConnect={onSave()}
      onOpenDetails={openSkill()}
      onDismiss={() => dismissMarketplaceSuggestion(props.messageId, true)}
      onRestore={() => dismissMarketplaceSuggestion(props.messageId, false)}
    />
  );
}
