import {
  type ConversationMessage,
  isContextResetMarker,
  type QueueDelivery,
  type SkillSuggestionTarget,
  skillConversationEvent,
  skillSuggestionTarget,
} from "@openbot/contracts/ipc";
import { chatTranscript, promptJson } from "./side-question";

/** The tool steps that a review or a note reads, failed steps and the step after them first. */
const WORK_STEP_LIMIT = 80;
const WORK_STEP_CHARACTERS = 300;
/**
 * The most characters of a cleared chat that the note repeats. The agent writes the skill from it,
 * so the newest part counts most: it holds the correction or the method that worked.
 */
const CLEARED_CHAT_CHARACTERS = 24_000;

/** The skill suggestions in the messages, oldest first. */
export function skillSuggestionMessages(messages: readonly ConversationMessage[]): ConversationMessage[] {
  return messages.filter((message) => skillSuggestionTarget(message) !== null);
}

/**
 * True when a skill line after the suggestion at `index` shows the skill that it asks for. A new
 * skill counts when it has the suggested name, or when the agent made it in answer to the first user
 * message after the suggestion: only that message carries the suggestion to the agent.
 */
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

/** Two skill names that differ only in case or outer spaces are the same name. */
function sameSkillName(a: string, b: string | undefined): boolean {
  return b !== undefined && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** One tool step of a turn, as a review or a note reads it. */
export interface WorkStep {
  step: string;
  failed?: true;
  error?: string;
}

/**
 * The tool steps of the turns, in their order. When there are more than the limit, the failed steps
 * and the step after each come first, then the latest others.
 */
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

/**
 * The note for the user's first message after a skill suggestion. The suggestion is not in the
 * provider's history, so without it the agent cannot know what the user agrees to. A later user
 * message gets no note: the user answered the question, or passed it over. A suggestion that the
 * host saved from the Save button gets no note either.
 *
 * A clear between the reviewed chat and this message took that chat from the provider, as when the
 * clear started the review. Then the note repeats the chat, so the agent writes the skill from it.
 */
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
      // The user pressed Save and the host wrote the skill, so there is nothing to agree to.
      if (skillSuggestionSaved(messages, index)) return null;
      const chat = clearedChat(messages, clearedAt ?? clearBefore(messages, index));
      return skillSuggestionNote(target, message.text, chat ? clearedChatBlocks(agentName, chat) : []);
    }
  }
  return null;
}

/**
 * The chat that the review of the suggestion at `index` read: the chat that a clear right before the
 * suggestion ended, or else the chat before it, back to the last clear. The lines of the suggestion's
 * own review are not part of it.
 */
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

/** The clear right before the suggestion, after the last message of the chat it reviewed. */
function clearBefore(messages: readonly ConversationMessage[], suggestion: number): number | null {
  for (let index = suggestion - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    if (isContextResetMarker(message)) return index;
    if (message.author !== "system") return null;
  }
  return null;
}

/** The chat that the clear at `clearedAt` ended: back to the clear before it. */
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
