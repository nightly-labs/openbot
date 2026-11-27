import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AttachmentSummary, ConversationMessage } from "@openbot/contracts/ipc";
import { createFormat, mobileTranslateFor } from "@openbot/i18n/mobile";
import { type ChatListRow, chatListView } from "../apps/mobile/src/features/chat/model/chat-list-view";
import {
  type ChatMessage,
  indexChatMessages,
  type ProgressUpdates,
  projectChatMessages,
  withQuestionContext,
} from "../apps/mobile/src/features/chat/model/chat-messages";

const OUT = resolve(import.meta.dirname, "../.openbot-build/mobile-chat-list-performance");
const REPORT = resolve(OUT, "report.json");
const MESSAGE_COUNT = 2000;
const CHUNK_COUNT = 200;
const ROUNDS = 5;
const label = process.argv.find((arg) => arg.startsWith("--label="))?.slice("--label=".length) ?? "current";

const START = Date.UTC(2026, 9, 1, 8, 0, 0);
const MINUTE = 60_000;

function at(minutes: number): string {
  return new Date(START + minutes * MINUTE).toISOString();
}

function image(id: string): AttachmentSummary {
  return {
    id,
    name: `${id}.png`,
    size: 120_000,
    kind: "image",
    mimeType: "image/png",
    previewKind: "image",
    previewUrl: null,
  };
}

function conversation(round: number): ConversationMessage[] {
  const messages: ConversationMessage[] = [];
  let turn = 0;
  while (messages.length < MESSAGE_COUNT) {
    const turnId = `r${round}-turn-${turn}`;
    const minute = turn * 37;
    messages.push({
      id: `r${round}-user-${turn}`,
      turnId,
      author: "user",
      text: `Question ${turn}: please look at **item ${turn}** and the \`file-${turn}.ts\` file.`,
      createdAt: at(minute),
      status: "completed",
      ...(turn % 25 === 0 ? { attachments: [image(`r${round}-image-${turn}`)] } : {}),
    });
    messages.push({
      id: `r${round}-note-${turn}`,
      turnId,
      author: "assistant",
      itemType: "commentary",
      text: `Reading file-${turn}.ts`,
      createdAt: at(minute + 1),
      status: "completed",
    });
    messages.push({
      id: `r${round}-reply-${turn}`,
      turnId,
      author: "assistant",
      text: `Answer ${turn}.\n\n- First point with \`code\`.\n- Second point.\n\n${"Body text. ".repeat(20)}`,
      createdAt: at(minute + 2),
      status: "completed",
    });
    if (turn % 10 === 5)
      messages.push({
        id: `r${round}-exchange-${turn}`,
        turnId,
        author: "assistant",
        text: "",
        createdAt: at(minute + 3),
        status: "completed",
        exchange: {
          direction: "outgoing",
          messageId: `x-${turn}`,
          senderAgentId: "agent-1",
          recipientAgentIds: ["agent-2"],
          replyToMessageId: null,
          deliveries: [],
        },
      });
    turn += 1;
  }
  return messages.slice(0, MESSAGE_COUNT);
}

const PROGRESS: ProgressUpdates = { provider: () => undefined };
const NO_ALIASES: ReadonlyMap<string, string> = new Map();
const text = { t: mobileTranslateFor("en"), format: createFormat("en") };
const shown = (message: ChatMessage) => message.kind !== "thinking";
const viewableImage = (attachment: AttachmentSummary) => attachment.kind === "image";

function derive(messages: ConversationMessage[]) {
  const projected = withQuestionContext(projectChatMessages(messages, null, null, PROGRESS), null);
  const byId = indexChatMessages(projected, NO_ALIASES, []);
  const view = chatListView({
    messages: projected,
    shown,
    focusMessageId: null,
    focusUnread: false,
    unreadMessageIds: null,
    branchRowId: undefined,
    text,
    hasOlder: false,
    viewableImage,
  });
  return { projected, byId, view };
}

function changedRows(previous: readonly ChatListRow[], next: readonly ChatListRow[]): number {
  const before = new Map(previous.map((row) => [row.id, row]));
  return next.reduce((count, row) => (before.get(row.id) === row ? count : count + 1), 0);
}

function quantile(values: readonly number[], share: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

interface RoundResult {
  chunkMs: number[];
  changedRows: number[];
  changedProjected: number[];
  checked: number;
}

function runRound(round: number): RoundResult {
  const base = conversation(round);
  const turnId = `r${round}-turn-live`;
  const last = base.at(-1)?.createdAt ?? at(0);
  const lastMinute = (Date.parse(last) - START) / MINUTE;
  let messages: ConversationMessage[] = [
    ...base,
    {
      id: `r${round}-user-live`,
      turnId,
      author: "user",
      text: "Stream please",
      createdAt: at(lastMinute + 1),
      status: "completed",
    },
    {
      id: `r${round}-reply-live`,
      turnId,
      author: "assistant",
      text: "",
      createdAt: at(lastMinute + 2),
      status: "streaming",
    },
  ];
  let previous = derive(messages);
  const result: RoundResult = { chunkMs: [], changedRows: [], changedProjected: [], checked: 0 };
  for (let chunk = 1; chunk <= CHUNK_COUNT; chunk += 1) {
    const index = messages.length - 1;
    const streaming = messages[index];
    assert.ok(streaming);
    const next = messages.slice();
    next[index] = {
      ...streaming,
      text: `${streaming.text}word${chunk} `,
      status: chunk === CHUNK_COUNT ? "completed" : "streaming",
    };
    messages = next;
    const started = performance.now();
    const derived = derive(messages);
    result.chunkMs.push(performance.now() - started);
    result.changedRows.push(changedRows(previous.view.rows, derived.view.rows));
    result.changedProjected.push(
      derived.projected.filter((row, position) => previous.projected[position] !== row).length,
    );
    if (chunk % 20 === 0 || chunk === CHUNK_COUNT) {
      const fresh = derive(structuredClone(messages));
      assert.equal(JSON.stringify(derived.view), JSON.stringify(fresh.view));
      assert.deepEqual([...derived.view.dayLabels], [...fresh.view.dayLabels]);
      assert.equal(JSON.stringify(derived.projected), JSON.stringify(fresh.projected));
      assert.equal(derived.byId.size, fresh.byId.size);
      result.checked += 1;
    }
    previous = derived;
  }
  return result;
}

const rounds = Array.from({ length: ROUNDS }, (_, round) => runRound(round));
const measured = rounds.slice(1);
const chunkMs = measured.flatMap((round) => round.chunkMs);
const rowChanges = measured.flatMap((round) => round.changedRows);
const projectedChanges = measured.flatMap((round) => round.changedProjected);
const summary = {
  label,
  measuredAt: new Date().toISOString(),
  warmupRounds: 1,
  measuredRounds: measured.length,
  chunkMs: {
    mean: round3(chunkMs.reduce((sum, value) => sum + value, 0) / chunkMs.length),
    p50: round3(quantile(chunkMs, 0.5)),
    p95: round3(quantile(chunkMs, 0.95)),
    max: round3(Math.max(...chunkMs)),
  },
  rowsWithNewIdentityPerChunk: {
    mean: round3(rowChanges.reduce((sum, value) => sum + value, 0) / rowChanges.length),
    max: Math.max(...rowChanges),
  },
  projectedRowsWithNewIdentityPerChunk: {
    mean: round3(projectedChanges.reduce((sum, value) => sum + value, 0) / projectedChanges.length),
    max: Math.max(...projectedChanges),
  },
  equalityChecks: rounds.reduce((sum, round) => sum + round.checked, 0),
};

mkdirSync(OUT, { recursive: true });
const report = existsSync(REPORT) ? JSON.parse(readFileSync(REPORT, "utf8")) : {};
report.input = {
  messages: MESSAGE_COUNT + 2,
  chunks: CHUNK_COUNT,
  pipeline: ["projectChatMessages", "withQuestionContext", "indexChatMessages", "chatListView"],
  runtime: `bun ${Bun.version}`,
};
report.runs = { ...(report.runs ?? {}), [label]: summary };
writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\nReport: ${REPORT}\n`);
