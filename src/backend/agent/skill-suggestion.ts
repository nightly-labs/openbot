import {
  type ConversationMessage,
  isContextResetMarker,
  type QueueDelivery,
  type SkillSuggestionTarget,
  skillConversationEvent,
  skillSuggestionTarget,
} from "@openbot/contracts/ipc";
import { chatTranscript, promptJson } from "./side-question";

const WORK_STEP_LIMIT = 80;
const WORK_STEP_CHARACTERS = 300;
const CLEARED_CHAT_CHARACTERS = 24_000;

export function skillSuggestionMessages(messages: readonly ConversationMessage[]): ConversationMessage[] {
  return messages.filter((message) => skillSuggestionTarget(message) !== null);
}

export function skillSuggestionSaved(messages: readonly ConversationMessage[], index: number): boolean {
  const suggestion = messages[index];
  const target = suggestion ? skillSuggestionTarget(suggestion) : null;
  if (!target) return false;
  const name = suggestion?.skillSuggestion?.name;
  let answers = 0;
  for (const later of messages.slice(index + 1)) {
    if (later.author === "user") answers += 1;
    const event = skillConversationEvent(later);
    if (!event) continue;
    if (
      target.action === "update"
        ? event.skillId === target.skillId
        : event.action === "created" && (answers === 1 || sameSkillName(event.skillName, name))
    )
      return true;
  }
  return false;
}

function sameSkillName(a: string, b: string | undefined): boolean {
  return b !== undefined && a.trim().toLowerCase() === b.trim().toLowerCase();
}

export interface WorkStep {
  step: string;
  failed?: true;
  error?: string;
}

export function workSteps(messages: readonly ConversationMessage[]): WorkStep[] {
  const all = messages.flatMap((message) =>
    (message.trace?.steps ?? []).flatMap((step): WorkStep[] => {
      const text = (step.command ?? step.text)?.trim();
      if (step.kind !== "tool" || !text) return [];
      return [
        {
          step: text.slice(0, WORK_STEP_CHARACTERS),
          ...(step.failed ? { failed: true as const } : {}),
          ...(step.error ? { error: step.error.slice(0, WORK_STEP_CHARACTERS) } : {}),
        },
      ];
    }),
  );
  if (all.length <= WORK_STEP_LIMIT) return all;
  const kept = new Set<number>();
  all.forEach((step, index) => {
    if (!step.failed || kept.size >= WORK_STEP_LIMIT) return;
    kept.add(index);
    if (index + 1 < all.length && kept.size < WORK_STEP_LIMIT) kept.add(index + 1);
  });
  for (let index = all.length - 1; index >= 0 && kept.size < WORK_STEP_LIMIT; index -= 1) kept.add(index);
  return all.filter((_, index) => kept.has(index));
}

export function pendingSkillSuggestionNote(
  delivery: Pick<QueueDelivery, "id" | "sender">,
  messages: readonly ConversationMessage[],
  agentName: string,
): string | null {
  if (delivery.sender.kind !== "user") return null;
  let clearedAt: number | null = null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.id === delivery.id) continue;
    if (message.author === "user") return null;
    if (isContextResetMarker(message)) clearedAt = index;
    const target = skillSuggestionTarget(message);
    if (target) {
      if (skillSuggestionSaved(messages, index)) return null;
      const chat = clearedChat(messages, clearedAt ?? clearBefore(messages, index));
      return skillSuggestionNote(target, message.text, chat ? clearedChatBlocks(agentName, chat) : []);
    }
  }
  return null;
}

export function reviewedChat(messages: readonly ConversationMessage[], index: number): ConversationMessage[] {
  const turnId = messages[index]?.turnId;
  const cleared = clearedChat(messages, clearBefore(messages, index));
  if (cleared) return cleared;
  let start = index;
  while (start > 0) {
    const message = messages[start - 1];
    if (message && isContextResetMarker(message)) break;
    start -= 1;
  }
  return messages.slice(start, index).filter((message) => turnId === undefined || message.turnId !== turnId);
}

function clearBefore(messages: readonly ConversationMessage[], suggestion: number): number | null {
  for (let index = suggestion - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    if (isContextResetMarker(message)) return index;
    if (message.author !== "system") return null;
  }
  return null;
}

function clearedChat(messages: readonly ConversationMessage[], clearedAt: number | null) {
  if (clearedAt === null) return null;
  const cleared = (index: number) => {
    const message = messages[index];
    return message !== undefined && isContextResetMarker(message);
  };
  let end = clearedAt;
  while (end > 0 && cleared(end - 1)) end -= 1;
  let start = end;
  while (start > 0 && !cleared(start - 1)) start -= 1;
  const chat = messages.slice(start, end);
  return chat.length ? chat : null;
}

function clearedChatBlocks(agentName: string, chat: readonly ConversationMessage[]): string[] {
  const transcript = chatTranscript({ name: agentName }, chat, CLEARED_CHAT_CHARACTERS);
  if (!transcript.length) return [];
  const steps = workSteps(chat);
  return [
    "The user started a new chat after it, so you no longer have the chat that the review read. Here it is:",
    "<reviewed_chat>",
    promptJson(transcript),
    "</reviewed_chat>",
    ...(steps.length ? ["<reviewed_work_steps>", promptJson(steps), "</reviewed_work_steps>"] : []),
  ];
}

function skillSuggestionNote(target: SkillSuggestionTarget, question: string, chat: readonly string[]): string {
  const save =
    target.action === "create"
      ? "make the skill with create_skill."
      : `read skill ${target.skillId} with read_local_skill, change it with revise_skill. revise_skill installs the new revision for you.`;
  return [
    "After your last answer, a review of this chat asked the user this question in your name:",
    "--- suggestion ---",
    question,
    "--- end suggestion ---",
    ...chat,
    `If the user's message below agrees, ${save} Write it from this chat and follow openbot-skill-creator:`,
    "- Write the procedure first: the steps in their order, with the commands, tools and decision points that worked. Attach each pitfall to its step, as a rule with one clause of why.",
    "- Keep the rules general: no dates, PR or issue numbers, or quotes of the user, and no failed attempts as a method.",
    "- Do not repeat what the workspace instructions or the tool descriptions already say.",
    "- When the skill says something wrong, change that sentence; state each lesson once.",
    "If the user declines, or writes about something else, do not save it and do not ask again.",
  ].join("\n");
}
