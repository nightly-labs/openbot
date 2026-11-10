import { isDynamicRecord, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";
import {
  type MemoryContext,
  memoryContextUpdate,
  NATURAL_TURN_REMINDER,
  type SectionTeammates,
  savedLoginsUpdate,
  sectionTeammatesUpdate,
} from "./developer-instructions";

/**
 * The essential memories, the section-mates, the saved-logins rule and the style reminder of each
 * thread, for a client that sends them with the user turns (`AgentClient.turnContext`). In the
 * system prompt, each memory change would change the prefix, and the provider would write the full
 * conversation to its cache again. With the turns, a change is one small block.
 *
 * Kept by thread, not by process: a restarted or reopened session resumes a conversation that
 * already holds the blocks it was sent.
 */
export class TurnContext {
  /** The latest memories that OpenBot gave, and the last that a turn sent. */
  readonly #memories = new Map<string, { current: MemoryContext; delivered: MemoryContext | null }>();
  /** The same for the section-mates. `undefined` as `delivered`: the context can hold any earlier list. */
  readonly #teammates = new Map<
    string,
    { current: SectionTeammates | null; delivered: SectionTeammates | null | undefined }
  >();
  /** The same for the saved-logins rule. `undefined` as `delivered`: the context can hold any earlier block. */
  readonly #savedLogins = new Map<string, { current: boolean; delivered: boolean | undefined }>();
  /** The threads whose turns repeat the natural style's first-line rule (`NATURAL_TURN_REMINDER`). */
  readonly #styleReminders = new Set<string>();

  /** Takes the context from the params of a thread start or resume. */
  set(threadId: string, params: unknown, resume: boolean): void {
    if (isDynamicRecord(params) && params.turnStyleReminder === true) this.#styleReminders.add(threadId);
    else this.#styleReminders.delete(threadId);
    const current = readMemoryContext(params);
    if (current) {
      const memory = this.#memories.get(threadId);
      if (memory) memory.current = current;
      else this.#memories.set(threadId, { current, delivered: null });
    }
    if (isDynamicRecord(params) && typeof params.savedLogins === "boolean") {
      const logins = this.#savedLogins.get(threadId);
      if (logins) logins.current = params.savedLogins;
      // A new conversation holds no block, as if logins were not shared.
      else this.#savedLogins.set(threadId, { current: params.savedLogins, delivered: resume ? undefined : false });
    }
    if (!isDynamicRecord(params) || !("sectionTeammates" in params)) return;
    const section = readSectionTeammates(params.sectionTeammates);
    const teammates = this.#teammates.get(threadId);
    if (teammates) teammates.current = section;
    // A new conversation holds no list, so no section needs no block.
    else this.#teammates.set(threadId, { current: section, delivered: resume ? undefined : null });
  }

  /**
   * The blocks for the next user turn, each a text block of its own so that history readers can
   * tell them from the user's text, and marks them as sent. A slash command gets none: a CLI can
   * drop the blocks before it, and `/clear` empties the context, so the next turn sends them in full.
   */
  take(threadId: string, command = false): string[] {
    const memory = this.#memories.get(threadId);
    const teammates = this.#teammates.get(threadId);
    const logins = this.#savedLogins.get(threadId);
    const blocks = command
      ? []
      : [
          memory ? memoryContextUpdate(memory.delivered, memory.current) : null,
          teammates ? sectionTeammatesUpdate(teammates.delivered, teammates.current) : null,
          logins ? savedLoginsUpdate(logins.delivered, logins.current) : null,
          this.#styleReminders.has(threadId) ? NATURAL_TURN_REMINDER : null,
        ].filter((block): block is string => block !== null);
    if (memory) memory.delivered = command ? null : memory.current;
    if (teammates) teammates.delivered = command ? undefined : teammates.current;
    if (logins) logins.delivered = command ? undefined : logins.current;
    return blocks;
  }

  /**
   * The context can have lost the blocks: a compaction summary can leave them out, and a failed
   * prompt may not be kept. The next turn sends them in full.
   */
  resend(threadId: string): void {
    const memory = this.#memories.get(threadId);
    if (memory) memory.delivered = null;
    const teammates = this.#teammates.get(threadId);
    if (teammates) teammates.delivered = undefined;
    const logins = this.#savedLogins.get(threadId);
    if (logins) logins.delivered = undefined;
  }

  forget(threadId: string): void {
    this.#memories.delete(threadId);
    this.#teammates.delete(threadId);
    this.#savedLogins.delete(threadId);
    this.#styleReminders.delete(threadId);
  }
}

function readMemoryContext(params: unknown): MemoryContext | null {
  const context = isDynamicRecord(params) ? params.memoryContext : undefined;
  if (!isDynamicRecord(context) || !Array.isArray(context.memories)) return null;
  if (!isNumber(context.storedCount) || !isNumber(context.limit)) return null;
  const memories = context.memories.filter(
    (memory): memory is MemoryContext["memories"][number] =>
      isDynamicRecord(memory) &&
      isString(memory.id) &&
      isString(memory.text) &&
      isOneOf(["automatic", "manual"] as const, memory.origin),
  );
  return { memories, storedCount: context.storedCount, limit: context.limit };
}

function readSectionTeammates(value: unknown): SectionTeammates | null {
  if (!isDynamicRecord(value) || !isString(value.name) || !Array.isArray(value.members)) return null;
  const members = value.members.filter(
    (member): member is SectionTeammates["members"][number] =>
      isDynamicRecord(member) && isString(member.id) && isString(member.name) && isString(member.title),
  );
  return members.length > 0 ? { name: value.name, members } : null;
}
