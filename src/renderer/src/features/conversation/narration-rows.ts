import type { AgentProviderRef } from "@openbot/contracts/agent-providers";
import { isNarrationItemId, showsNarration } from "@openbot/contracts/conversation-narration";
import type { AgentMessage } from "@openbot/ui/data";
import { formatMessageTime } from "../../app-message-projection";

/**
 * The narration of a `thinking` row as rows of their own, in order. A row is still a step of the
 * turn: with `itemType: "commentary"` the timeline gives it no stored-message actions. A filler note,
 * or one that repeats an earlier note of the turn, stays only in the steps (`showsNarration`).
 */
export function narrationRows(thinking: AgentMessage, provider: AgentProviderRef | undefined): AgentMessage[] {
  const items = thinking.items ?? [];
  const rows: AgentMessage[] = [];
  const shown = new Set<string>();
  for (const [index, body] of items.entries()) {
    const id = thinking.itemIds?.[index];
    if (!id || !isNarrationItemId(id, provider) || !showsNarration(body, shown)) continue;
    const createdAt = thinking.itemCreatedAt?.[index];
    rows.push({
      id,
      ...(thinking.turnId === undefined ? {} : { turnId: thinking.turnId }),
      author: "agent",
      ...(thinking.senderAgentId === undefined ? {} : { senderAgentId: thinking.senderAgentId }),
      body,
      time: createdAt ? formatMessageTime(createdAt) : thinking.time,
      ...(createdAt ? { createdAt } : {}),
      streaming: thinking.itemStreaming?.[index] === true,
      itemType: "commentary",
      kind: "text",
      // A row that arrives while the chat is open enters as a new message does. The timeline plays
      // the entrance once for each id, so an update enters when it arrives, not when the next one does.
      animate: thinking.animate,
    });
  }
  return rows;
}

/**
 * Puts the progress updates and the steps row of each turn among the other rows, by time. Each
 * update goes before the first row that is newer. The steps row of a turn takes the time of its last
 * update, so it stays under them. A row with no time does not move an update.
 */
export function placeTurnRowsByTime(rows: readonly AgentMessage[], turns: readonly AgentMessage[][]): AgentMessage[] {
  const timed = turns.flatMap((turn) => {
    let at = "";
    return turn.map((row) => {
      if (row.kind !== "thinking" || !at) at = row.createdAt ?? at;
      return { row, at };
    });
  });
  if (timed.length === 0) return [...rows];
  // A stable sort keeps the order of a turn when its rows share a time.
  timed.sort((left, right) => (left.at < right.at ? -1 : left.at > right.at ? 1 : 0));
  const placed: AgentMessage[] = [];
  let next = 0;
  for (const row of rows) {
    const at = row.createdAt;
    for (let update = timed[next]; at && update && update.at < at; update = timed[++next]) placed.push(update.row);
    placed.push(row);
  }
  for (const { row } of timed.slice(next)) placed.push(row);
  return placed;
}

/**
 * Puts the updates that an agent wrote after a message steered into its turn under that message.
 * The rows of a turn show where its first update is, so a reply to a steer showed above the steer
 * (#7717). As in the shared order (`sortConversationMessages`), a turn goes by time from its steer on:
 * its second message, or an earlier `steered` message that came after the turn's first row. Such an
 * update goes before the first newer row of its turn, or after the turn's last row. The steps row
 * goes under the last update that moves. All other rows keep their place.
 */
export function placeUpdatesAfterSteers(rows: AgentMessage[], turns: readonly AgentMessage[][]): AgentMessage[] {
  const steerTimes = turnSteerTimes(rows);
  const moved = new Map<string, { row: AgentMessage; at: string }[]>();
  for (const turn of turns) {
    const turnId = turn[0]?.turnId;
    const steerAt = turnId ? steerTimes.get(turnId) : undefined;
    if (!turnId || steerAt === undefined) continue;
    const later = turn.flatMap((row) =>
      row.kind !== "thinking" && row.createdAt && row.createdAt >= steerAt ? [{ row, at: row.createdAt }] : [],
    );
    const last = later.at(-1);
    if (!last) continue;
    const steps = turn.at(-1);
    if (steps?.kind === "thinking") later.push({ row: steps, at: last.at });
    moved.set(turnId, later);
  }
  if (moved.size === 0) return rows;
  const movedRows = new Set([...moved.values()].flat().map(({ row }) => row));
  const kept = rows.filter((row) => !movedRows.has(row));
  const lastOfTurn = new Map(kept.flatMap((row, index) => (row.turnId ? [[row.turnId, index] as const] : [])));
  const placed: AgentMessage[] = [];
  for (const [index, row] of kept.entries()) {
    const waiting = row.turnId ? moved.get(row.turnId) : undefined;
    const createdAt = row.createdAt;
    if (waiting && createdAt) {
      const newer = waiting.findIndex(({ at }) => at >= createdAt);
      placed.push(...waiting.splice(0, newer < 0 ? waiting.length : newer).map((update) => update.row));
    }
    placed.push(row);
    if (waiting && lastOfTurn.get(row.turnId ?? "") === index) placed.push(...waiting.splice(0).map(({ row }) => row));
  }
  return placed;
}

/** When each turn took its steer, as `sortConversationMessages` finds it. */
function turnSteerTimes(rows: readonly AgentMessage[]): Map<string, string> {
  const firstTimes = new Map<string, string>();
  const inputs = new Map<string, AgentMessage[]>();
  for (const row of rows) {
    if (!row.turnId || !row.createdAt) continue;
    const first = firstTimes.get(row.turnId);
    if (first === undefined || row.createdAt < first) firstTimes.set(row.turnId, row.createdAt);
    if (row.author !== "you" && row.exchange?.direction !== "incoming") continue;
    inputs.set(row.turnId, [...(inputs.get(row.turnId) ?? []), row]);
  }
  const steerTimes = new Map<string, string>();
  for (const [turnId, turnInputs] of inputs) {
    const second = turnInputs.map((row) => row.createdAt ?? "").sort()[1];
    const first = firstTimes.get(turnId) ?? "";
    const steers = turnInputs.flatMap((row) =>
      row.steered && row.createdAt && row.createdAt > first ? [row.createdAt] : [],
    );
    const steerAt = [...(second === undefined ? [] : [second]), ...steers].sort()[0];
    if (steerAt !== undefined) steerTimes.set(turnId, steerAt);
  }
  return steerTimes;
}
