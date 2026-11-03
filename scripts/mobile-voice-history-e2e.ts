// Exercises persisted call provenance and real mobile chat projection without native rendering.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ConversationMessage } from "@openbot/contracts/ipc";
import type { ChatMessage } from "../apps/mobile/src/features/chat/model/chat-messages";
import { createVoiceCallHistory } from "../apps/mobile/src/features/chat/model/voice-call-history";
import { presentVoiceCalls } from "../apps/mobile/src/features/chat/model/voice-call-presentation";

const root = await mkdtemp(join(tmpdir(), "openbot-voice-history-"));
const file = join(root, "history.json");
const port = {
  read: () => readFile(file, "utf8").catch(() => null),
  write: (value: string) => writeFile(file, value),
  remove: () => rm(file, { force: true }),
};
const target = '["server","agent",null]';
const message = (id: string, author: "user" | "assistant", turnId: string): ConversationMessage => ({
  id,
  author,
  turnId,
  text: id,
  status: "completed",
  createdAt: "2026-11-04T00:00:00.000Z",
});
try {
  const history = createVoiceCallHistory(port);
  await history.selectOwner("account-one");
  history.begin(target, "call-one");
  history.bind("call-one", "client-one");
  const raw = [message("delivery-one", "user", "turn-one"), message("answer-one", "assistant", "turn-one")];
  history.resolve(target, [{ clientMessageId: "client-one", messageId: "delivery-one" }], raw, []);
  await history.settled();
  const restored = createVoiceCallHistory(port);
  await restored.selectOwner("account-one");
  const rows: ChatMessage[] = [
    { id: "delivery-one", kind: "message", author: "user", body: "request", streaming: false },
    { id: "answer-one", kind: "message", author: "agent", body: "answer", streaming: false },
    { id: "failed", kind: "message", author: "agent", body: "failed", streaming: false, status: "failed" },
  ];
  const collapsed = presentVoiceCalls(rows, restored.snapshot(), raw, new Map(), new Set(), null);
  assert.deepEqual(
    collapsed.map((row) => row.kind),
    ["voice-call", "message"],
  );
  assert.equal(collapsed[1]?.id, "failed", "Failures were hidden with call details.");
  const failed = presentVoiceCalls(
    rows,
    restored.snapshot(),
    raw,
    new Map(),
    new Set(),
    null,
    new Set(["delivery-one"]),
  );
  assert.ok(
    failed.some((row) => row.id === "delivery-one"),
    "A failed outgoing request was hidden.",
  );
  const failedAnswer = presentVoiceCalls(
    rows.map((row) => (row.id === "answer-one" && row.kind === "message" ? { ...row, status: "failed" } : row)),
    restored.snapshot(),
    raw,
    new Map(),
    new Set(),
    null,
  );
  assert.ok(
    failedAnswer.some((row) => row.id === "answer-one"),
    "A correlated failed answer was hidden.",
  );
  const expanded = presentVoiceCalls(rows, restored.snapshot(), raw, new Map(), new Set(["call-one"]), null);
  assert.deepEqual(
    expanded.slice(1).map((row) => row.id),
    rows.map((row) => row.id),
  );
  assert.ok(
    presentVoiceCalls(rows, restored.snapshot(), raw, new Map(), new Set(), "answer-one").some(
      (row) => row.id === "answer-one",
    ),
    "Search did not reveal its call answer.",
  );
  const mixed = presentVoiceCalls(
    rows,
    restored.snapshot(),
    [...raw, message("typed-on-desktop", "user", "turn-one")],
    new Map(),
    new Set(),
    null,
  );
  assert.ok(
    mixed.some((row) => row.id === "answer-one"),
    "An answer shared with an unrelated typed request was hidden.",
  );
  await restored.selectOwner("account-two");
  assert.equal(restored.snapshot().length, 0, "Another account inherited call metadata.");
  await restored.selectOwner(null);
  await restored.settled();
  assert.equal(await port.read(), null, "Sign-out retained presentation metadata.");
  const late = createVoiceCallHistory({
    ...port,
    read: () => Promise.resolve('{"version":1,"owner":"account-one","calls":[]}'),
  });
  const loading = late.selectOwner("account-one");
  await late.selectOwner(null);
  await loading;
  assert.equal(late.snapshot().length, 0, "A stale load repopulated signed-out state.");
  const output = resolve(".openbot-build/mobile-voice-history-e2e");
  await mkdir(output, { recursive: true });
  const report = {
    passed: true,
    restartRestoresCollapsedCall: true,
    expansionAndSearchRetainDetails: true,
    failuresAndMixedTypedTurnStayVisible: true,
    accountAndSignOutIsolation: true,
  };
  await writeFile(join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
