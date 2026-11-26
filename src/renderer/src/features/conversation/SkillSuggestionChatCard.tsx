import type { SkillSuggestionEvent } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import type { AgentMessage } from "@openbot/ui/data";
import {
  MarketplaceSuggestionCard,
  type MarketplaceSuggestionSkillAction,
} from "@openbot/ui/features/conversation/MarketplaceSuggestionCard";
import { useText } from "@openbot/ui/text";
import { dismissMarketplaceSuggestion, marketplaceSuggestionDismissed } from "./marketplace-suggestion-dismissals";
import {
  type SkillSuggestionPressKey,
  setSkillSuggestionPress,
  skillSuggestionPress,
} from "./skill-suggestion-presses";

export type SkillSuggestionOutcome = "open" | "working" | "saved" | "answered";

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

export type SkillSuggestionSaveResult = "saved" | "sent" | null;

export interface SkillSuggestionChatCardProps {
  messageId: string;
  pressKey: SkillSuggestionPressKey;
  suggestion: SkillSuggestionEvent;
  outcome: SkillSuggestionOutcome;
  onSave?: ((reply: string) => Promise<SkillSuggestionSaveResult>) | undefined;
  onOpenSkill?: ((skill: { skillId: string }) => void) | undefined;
}

export function SkillSuggestionChatCard(props: SkillSuggestionChatCardProps) {
  const { t } = useText();
  const press = () => skillSuggestionPress(props.pressKey);
  const state = () => {
    if (props.outcome === "saved" || press() === "saved") return "connected";
    if (press() === "pending" || (press() === "sent" && props.outcome === "working")) return "busy";
    return "available";
  };
  const handedToChat = () => press() === "sent" && state() !== "busy";
  const save = async () => {
    if (state() !== "available" || handedToChat()) return;
    const key = props.pressKey;
    const messageId = props.messageId;
    setSkillSuggestionPress(key, "pending");
    const reply =
      props.suggestion.action === "create" ? t("chat.suggestion.saveReply") : t("chat.suggestion.updateReply");
    const result = await props.onSave?.(reply);
    if (result === "saved" || result === "sent") setSkillSuggestionPress(key, result);
    else {
      setSkillSuggestionPress(key, null);
      toast.error(t("chat.suggestion.saveFailed"), {
        id: `skill-suggestion-save:${messageId}`,
        report: { operation: "memory", source: "action", cause_code: "unknown" },
      });
    }
  };
  const skillAction = (): MarketplaceSuggestionSkillAction =>
    props.suggestion.action === "create" ? "save" : "update";
  const onSave = () => (handedToChat() || !props.onSave ? undefined : () => void save());
  const openSkill = () => {
    const suggestion = props.suggestion;
    const open = props.onOpenSkill;
    return suggestion.action === "update" && open ? () => open({ skillId: suggestion.skillId }) : undefined;
  };
  return (
    <MarketplaceSuggestionCard
      kind="skill"
      skillAction={skillAction()}
      saving={state() === "busy"}
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
