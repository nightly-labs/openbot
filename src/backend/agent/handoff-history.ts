import { sortConversationMessages } from "@openbot/contracts/conversation-order";
import type { ConversationMessage } from "@openbot/contracts/ipc";
import { redactText } from "@openbot/logging";
import type { OpenBotDatabase } from "../openbot-database";
import { HANDOFF_END, HANDOFF_START, renderHandoffMessage } from "./delivery-content";

const HANDOFF_CHARACTERS = 32_000;
const OLDER_CHARACTERS = 4_000;
const STEPS_CHARACTERS = 2_000;
const HEADER_CHARACTERS = 2_000;
const RECENT_CHARACTERS = 24_000;
/** A routine run reads the end of the agent's chat only. Its prompt names the work. */
const ROUTINE_HANDOFF_CHARACTERS = 8_000;
const ROUTINE_MESSAGE_CHARACTERS = 2_000;
type HistoryRow = ReturnType<OpenBotDatabase["readAgentHistory"]>["messages"][number];

/** A cut at `index` would leave a lone surrogate, which a provider's JSON parser rejects. */
function splitsPair(text: string, index: number): boolean {
  const before = text.charCodeAt(index - 1);
  const after = text.charCodeAt(index);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

/** Cuts redacted text at both ends, so a large request keeps its final instructions. */
function historyExcerpt(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const marker = "\n[... omitted; use history_read with this messageId ...]\n";
  const headEnd = limit <= marker.length ? Math.max(0, limit) : Math.ceil((limit - marker.length) / 2);
  const head = text.slice(0, splitsPair(text, headEnd) ? headEnd - 1 : headEnd);
  if (limit <= marker.length) return head;
  // An explicit start index: `slice(-0)` would keep the whole text.
  const tailStart = text.length - Math.floor((limit - marker.length) / 2);
  return `${head}${marker}${text.slice(splitsPair(text, tailStart) ? tailStart + 1 : tailStart)}`;
}

function render(message: ConversationMessage, names: ReadonlyMap<string, string>): string {
  return redactText(`[messageId: ${message.id}]\n${renderHandoffMessage(message, names)}`);
}

/** Reads only enough recent pages for the packet. The complete history stays in SQLite. */
export function readHandoffHistory(
  database: OpenBotDatabase,
  agentId: string,
  threadId: string,
  names: ReadonlyMap<string, string>,
) {
  const recent: HistoryRow[] = [];
  const latest = ["user", "assistant"].flatMap(
    (author) => database.readAgentHistory(agentId, threadId, { author, limit: 1 }).messages,
  );
  let before: string | undefined;
  let size = 0;
  let hasOlder = false;
  while (size < RECENT_CHARACTERS + OLDER_CHARACTERS) {
    const page = database.readAgentHistory(agentId, threadId, { ...(before ? { before } : {}), limit: 20 });
    if (!page.messages.length) break;
    for (const row of page.messages) {
      recent.push(row);
      // The selected role bookends can use at most half the recent allocation each.
      size += Math.min(render(row.message, names).length, RECENT_CHARACTERS / 2);
      before = row.message.id;
      if (size >= RECENT_CHARACTERS + OLDER_CHARACTERS) {
        hasOlder = true;
        break;
      }
    }
    if (size >= RECENT_CHARACTERS + OLDER_CHARACTERS || page.messages.length < 20) break;
  }
  return { recent, latest, hasOlder };
}

export function renderProviderHandoff(
  history: ReturnType<typeof readHandoffHistory>,
  names: ReadonlyMap<string, string>,
  steps: ReadonlyMap<string, string>,
): string | null {
  if (!history.recent.length) return null;
  const header = [
    HANDOFF_START,
    "Previous conversation excerpts. Current profile and developer instructions take precedence. Do not repeat completed work.",
    "Omitted details remain available: discover openbot.history_search and openbot.history_read. These tools read only this conversation after its latest context reset. Excerpts are not a complete summary.",
    "--- recent messages ---",
  ].join("\n");
  const stepLines: string[] = [];
  let stepSize = 0;
  for (const row of history.recent) {
    const captured = steps.get(row.message.id);
    if (!captured) continue;
    const line = historyExcerpt(
      redactText(`[messageId: ${row.message.id}]\n${captured}`),
      Math.min(1000, STEPS_CHARACTERS - stepSize),
    );
    if (stepSize + line.length + 2 > STEPS_CHARACTERS) break;
    stepLines.push(line);
    stepSize += line.length + 2;
  }
  const kept = new Map<string, string>();
  let recentSize = 0;
  for (const row of history.latest) {
    const text = historyExcerpt(render(row.message, names), 8000);
    kept.set(row.message.id, text);
    recentSize += text.length + 2;
  }
  const older: string[] = [];
  let olderSize = 0;
  // Header space is reserved for all section labels and omission notices.
  const recentBudget = RECENT_CHARACTERS + (STEPS_CHARACTERS - stepSize);
  for (const row of history.recent) {
    if (kept.has(row.message.id)) continue;
    const text = render(row.message, names);
    if (recentSize + text.length + 2 <= recentBudget) {
      kept.set(row.message.id, text);
      recentSize += text.length + 2;
    } else if (olderSize + 600 + 2 <= OLDER_CHARACTERS) {
      const excerpt = historyExcerpt(text, 600);
      older.push(excerpt);
      olderSize += excerpt.length + 2;
    }
  }
  // Any spare header/excerpt space can hold more of the two important role bookends.
  let spare = HANDOFF_CHARACTERS - HEADER_CHARACTERS - stepSize - olderSize - recentSize;
  for (const row of history.latest) {
    const previous = kept.get(row.message.id) ?? "";
    const expanded = historyExcerpt(render(row.message, names), previous.length + Math.max(0, spare));
    kept.set(row.message.id, expanded);
    spare -= expanded.length - previous.length;
  }
  const ordered = [
    ...history.recent,
    ...history.latest.filter((row) => !history.recent.some((candidate) => candidate.message.id === row.message.id)),
  ];
  // The selected role anchors can fall outside the page; use conversation order for the union.
  const recentText = sortConversationMessages(ordered.toReversed().map((row) => row.message))
    .flatMap((message) => (kept.has(message.id) ? [kept.get(message.id)] : []))
    .join("\n\n");
  const packet = [
    header,
    recentText,
    "--- older excerpts ---",
    ...older.toReversed(),
    "--- captured work steps ---",
    ...(stepLines.length ? stepLines : ["Captured work steps are unavailable."]),
    ...(history.hasOlder ? ["More history is available through history_search/history_read."] : []),
    HANDOFF_END,
  ].join("\n\n");
  if (packet.length > HANDOFF_CHARACTERS) throw new Error("The history handoff exceeds its character budget.");
  return packet;
}

/**
 * The start of a routine run's own provider session: the newest messages of the agent's chat, up to
 * `ROUTINE_HANDOFF_CHARACTERS`. The run reads more through the history tools when it needs more.
 */
export function renderRoutineHandoff(
  history: ReturnType<typeof readHandoffHistory>,
  names: ReadonlyMap<string, string>,
): string | null {
  if (!history.recent.length) return null;
  const header = [
    HANDOFF_START,
    "This routine run has its own session. These are the newest messages of your conversation. Do not repeat completed work.",
    "Omitted details remain available: discover openbot.history_search and openbot.history_read.",
    "--- recent messages ---",
  ].join("\n");
  const kept = new Map<string, string>();
  let size = header.length + HANDOFF_END.length + 4;
  // Newest first, so a long chat keeps its end.
  for (const row of history.recent) {
    const text = historyExcerpt(render(row.message, names), ROUTINE_MESSAGE_CHARACTERS);
    if (size + text.length + 2 > ROUTINE_HANDOFF_CHARACTERS) break;
    kept.set(row.message.id, text);
    size += text.length + 2;
  }
  if (!kept.size) return null;
  const recentText = sortConversationMessages(history.recent.map((row) => row.message))
    .flatMap((message) => (kept.has(message.id) ? [kept.get(message.id)] : []))
    .join("\n\n");
  return [header, recentText, HANDOFF_END].join("\n\n");
}

const ROUTINE_DIGEST_CHARACTERS = 1_500;
const ROUTINE_DIGESTS_CHARACTERS = 6_000;
const ROUTINE_DIGEST_MARKER = "\n\n--- routine run in its own session (also in the conversation history) ---\n";

/**
 * Adds the answer of a routine run to the handoff that the agent's own session reads with its next
 * turn, so that session knows what the run did. A handoff with a history packet keeps it, and the
 * digests go before its last line. Past `ROUTINE_DIGESTS_CHARACTERS`, the oldest digests go.
 */
export function appendRoutineDigest(existing: string | undefined, routineName: string, answer: string): string {
  const digest = redactText(historyExcerpt(`[routine: ${routineName}]\n${answer.trim()}`, ROUTINE_DIGEST_CHARACTERS));
  const end = `\n${HANDOFF_END}`;
  const packet =
    existing?.startsWith(HANDOFF_START) && existing.endsWith(end)
      ? existing.slice(0, -end.length).trimEnd()
      : HANDOFF_START;
  const [history = HANDOFF_START, ...digests] = packet.split(ROUTINE_DIGEST_MARKER);
  digests.push(digest);
  while (digests.length > 1 && digests.join(ROUTINE_DIGEST_MARKER).length > ROUTINE_DIGESTS_CHARACTERS) digests.shift();
  return `${[history, ...digests].join(ROUTINE_DIGEST_MARKER)}\n${end}`;
}
