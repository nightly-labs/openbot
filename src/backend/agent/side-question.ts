import { CHAT_VISUAL_ITEM_TYPE_PREFIX } from "@openbot/contracts/chat-visual";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_WELCOME_ITEM_TYPE,
  type AgentSummary,
  type AskSideQuestionInput,
  CHANNEL_RESUME_ITEM_TYPE,
  CONVERSATION_PLAN_ITEM_TYPE,
  CONVERSATION_SUBAGENTS_ITEM_TYPE,
  type ConversationMessage,
  ROUTINE_QUIET_ANSWER_ITEM_TYPE,
} from "@openbot/contracts/ipc";
import { tagSafe } from "./developer-instructions";

export const SIDE_QUESTION_CHAT_MESSAGES = 60;
const MESSAGE_CHARACTERS = INPUT_LIMITS.sideQuestionEarlierText;
const CHAT_CHARACTERS = 60_000;
const EARLIER_CHARACTERS = 60_000;

export function promptJson(value: unknown): string {
  return tagSafe(JSON.stringify(value));
}

function chatMessage(message: ConversationMessage): boolean {
  return (
    (message.author === "user" || message.author === "assistant" || message.author === "agent") &&
    message.text.trim().length > 0 &&
    message.itemType !== "commentary" &&
    message.itemType !== "question_prompt" &&
    message.itemType !== "agent_attachment" &&
    message.itemType !== AGENT_WELCOME_ITEM_TYPE &&
    message.itemType !== CHANNEL_RESUME_ITEM_TYPE &&
    !message.itemType?.startsWith(CHAT_VISUAL_ITEM_TYPE_PREFIX) &&
    message.itemType !== CONVERSATION_PLAN_ITEM_TYPE &&
    message.itemType !== CONVERSATION_SUBAGENTS_ITEM_TYPE &&
    message.itemType !== ROUTINE_QUIET_ANSWER_ITEM_TYPE
  );
}

export function chatTranscript(
  agent: Pick<AgentSummary, "name">,
  messages: readonly ConversationMessage[],
  budget = CHAT_CHARACTERS,
) {
  const entries: { from: string; text: string }[] = [];
  let characters = 0;
  for (const message of [...messages].filter(chatMessage).reverse()) {
    const text = message.text.slice(0, MESSAGE_CHARACTERS);
    if (characters + text.length > budget) break;
    characters += text.length;
    const from =
      message.author === "user"
        ? (message.senderMember?.name ?? "User")
        : message.senderAgentId
          ? "Another agent"
          : agent.name;
    entries.push({ from, text });
  }
  return entries.reverse();
}

function earlierTurns(input: AskSideQuestionInput) {
  const turns: AskSideQuestionInput["earlier"] = [];
  let characters = 0;
  for (const turn of [...input.earlier].reverse()) {
    const question = turn.question.slice(0, MESSAGE_CHARACTERS);
    const answer = turn.answer.slice(0, MESSAGE_CHARACTERS);
    if (characters + question.length + answer.length > EARLIER_CHARACTERS) break;
    characters += question.length + answer.length;
    turns.push({ question, answer });
  }
  return turns.reverse();
}

export function sideQuestionPrompt(
  agent: AgentSummary,
  messages: readonly ConversationMessage[],
  input: AskSideQuestionInput,
): string {
  const earlier = earlierTurns(input);
  return [
    "You are the agent in this profile. The user asks a side question about your chat with them. The question and your answer stay out of the chat, and you cannot use tools here. Answer from the chat and from what you know. Give the shortest complete answer in plain text or Markdown.",
    "<agent_profile>",
    promptJson({
      name: agent.name,
      title: agent.title.trim() || "General assistant",
      description: agent.description.trim() || "No additional description configured.",
    }),
    "</agent_profile>",
    "<chat>",
    promptJson(chatTranscript(agent, messages)),
    "</chat>",
    ...(earlier.length > 0 ? ["<earlier_side_questions>", promptJson(earlier), "</earlier_side_questions>"] : []),
    "<side_question>",
    promptJson(input.question),
    "</side_question>",
  ].join("\n");
}
