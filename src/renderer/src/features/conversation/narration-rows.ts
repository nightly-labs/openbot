import type { AgentProviderRef } from "@openbot/contracts/agent-providers";
import { isNarrationItemId, showsNarration } from "@openbot/contracts/conversation-narration";
import type { AgentMessage } from "@openbot/ui/data";
import { formatMessageTime } from "../../app-message-projection";

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
      animate: thinking.animate,
    });
  }
  return rows;
}

export function naturalThreadRows(
  messages: readonly AgentMessage[],
  provider: AgentProviderRef | undefined,
  held: (message: AgentMessage) => boolean,
): AgentMessage[] {
  const turns: AgentMessage[][] = [];
  const listed = messages.flatMap((message) => {
    if (message.kind !== "thinking") return [message];
    const rows = [...narrationRows(message, provider), message];
    turns.push(rows);
    return rows;
  });
  return placeUpdatesAfterSteers(listed, turns).filter((message) => !held(message));
}

export function placeTurnRowsByTime(rows: readonly AgentMessage[], turns: readonly AgentMessage[][]): AgentMessage[] {
  const timed = turns.flatMap((turn) => {
    let at = "";
    return turn.map((row) => {
      if (row.kind !== "thinking" || !at) at = row.createdAt ?? at;
      return { row, at };
    });
  });
  if (timed.length === 0) return [...rows];
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
