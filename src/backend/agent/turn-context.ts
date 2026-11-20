import { AGENT_INSTRUCTION_FILE_NAMES } from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";
import {
  type InstructionsFileText,
  instructionsFileUpdate,
  type MemoryContext,
  memoryContextUpdate,
  NATURAL_TURN_REMINDER,
  type SectionTeammates,
  savedLoginsUpdate,
  sectionTeammatesUpdate,
} from "./developer-instructions";

export class TurnContext {
  readonly #memories = new Map<string, { current: MemoryContext; delivered: MemoryContext | null }>();
  readonly #teammates = new Map<
    string,
    { current: SectionTeammates | null; delivered: SectionTeammates | null | undefined }
  >();
  readonly #instructionsFiles = new Map<
    string,
    { current: InstructionsFileText | null; delivered: InstructionsFileText | null | undefined }
  >();
  readonly #savedLogins = new Map<string, { current: boolean; delivered: boolean | undefined }>();
  readonly #styleReminders = new Set<string>();

  set(threadId: string, params: unknown, resume: boolean): void {
    if (isDynamicRecord(params) && params.turnStyleReminder === true) this.#styleReminders.add(threadId);
    else this.#styleReminders.delete(threadId);
    const current = readMemoryContext(params);
    if (current) {
      const memory = this.#memories.get(threadId);
      if (memory) memory.current = current;
      else this.#memories.set(threadId, { current, delivered: null });
    } else this.#memories.delete(threadId);
    if (isDynamicRecord(params) && typeof params.savedLogins === "boolean") {
      const logins = this.#savedLogins.get(threadId);
      if (logins) logins.current = params.savedLogins;
      else this.#savedLogins.set(threadId, { current: params.savedLogins, delivered: resume ? undefined : false });
    }
    if (isDynamicRecord(params) && "instructionsFile" in params) {
      const file = readInstructionsFile(params.instructionsFile);
      const known = this.#instructionsFiles.get(threadId);
      if (known) known.current = file;
      else this.#instructionsFiles.set(threadId, { current: file, delivered: resume ? undefined : null });
    }
    if (!isDynamicRecord(params) || !("sectionTeammates" in params)) return;
    const section = readSectionTeammates(params.sectionTeammates);
    const teammates = this.#teammates.get(threadId);
    if (teammates) teammates.current = section;
    else this.#teammates.set(threadId, { current: section, delivered: resume ? undefined : null });
  }

  take(threadId: string, command = false): string[] {
    const memory = this.#memories.get(threadId);
    const teammates = this.#teammates.get(threadId);
    const file = this.#instructionsFiles.get(threadId);
    const logins = this.#savedLogins.get(threadId);
    const blocks = command
      ? []
      : [
          memory ? memoryContextUpdate(memory.delivered, memory.current) : null,
          teammates ? sectionTeammatesUpdate(teammates.delivered, teammates.current) : null,
          file ? instructionsFileUpdate(file.delivered, file.current) : null,
          logins ? savedLoginsUpdate(logins.delivered, logins.current) : null,
          this.#styleReminders.has(threadId) ? NATURAL_TURN_REMINDER : null,
        ].filter((block): block is string => block !== null);
    if (memory) memory.delivered = command ? null : memory.current;
    if (teammates) teammates.delivered = command ? undefined : teammates.current;
    if (file) file.delivered = command ? undefined : file.current;
    if (logins) logins.delivered = command ? undefined : logins.current;
    return blocks;
  }

  resend(threadId: string): void {
    const memory = this.#memories.get(threadId);
    if (memory) memory.delivered = null;
    const teammates = this.#teammates.get(threadId);
    if (teammates) teammates.delivered = undefined;
    const file = this.#instructionsFiles.get(threadId);
    if (file) file.delivered = undefined;
    const logins = this.#savedLogins.get(threadId);
    if (logins) logins.delivered = undefined;
  }

  forget(threadId: string): void {
    this.#memories.delete(threadId);
    this.#teammates.delete(threadId);
    this.#instructionsFiles.delete(threadId);
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

function readInstructionsFile(value: unknown): InstructionsFileText | null {
  if (!isDynamicRecord(value) || !isOneOf(AGENT_INSTRUCTION_FILE_NAMES, value.fileName)) return null;
  if (!isString(value.text) || value.text.length === 0 || typeof value.truncated !== "boolean") return null;
  return { fileName: value.fileName, text: value.text, truncated: value.truncated };
}
