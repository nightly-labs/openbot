// Consumes a real host fixture from server-work-service-e2e. Runs the released wire adapters,
// desktop/web projection and pending-send store, and mobile projection/confirmation/outbox code.
// It does not launch a native mobile app or call a model provider.
// Run after the service fixture: bun scripts/server-work-client-receipt-e2e.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const output = join(projectRoot, ".openbot-build", "server-work-client-receipt-e2e");
const fixturePath = resolve(
  process.argv.find((value) => value.startsWith("--fixture="))?.slice(10) ??
    join(projectRoot, ".openbot-build", "server-work-service-e2e", "routed-user-receipt.json"),
);
assert.ok(existsSync(fixturePath), "Run server-work-service-e2e first to write routed-user-receipt.json.");
mkdirSync(output, { recursive: true });
const entryPath = join(output, "client-fixture.mjs");
const modulePaths = {
  contracts: join(projectRoot, "packages/contracts/src/ipc.ts"),
  solid: "solid-js",
  desktopProjection: join(projectRoot, "src/renderer/src/app-message-projection.ts"),
  pending: join(projectRoot, "src/renderer/src/features/conversation/stores/pending-send-store.ts"),
  mobileProjection: join(projectRoot, "apps/mobile/src/features/chat/model/chat-messages.ts"),
  mobileOutbox: join(projectRoot, "apps/mobile/src/features/chat/model/outbox-store.ts"),
  mobileConfirmation: join(projectRoot, "apps/mobile/src/features/chat/model/upload-chat-attachments.ts"),
  mobileConversation: join(projectRoot, "apps/mobile/src/features/workspace/model/conversation.ts"),
  v1: join(projectRoot, "packages/contracts/src/team-protocol/v1.ts"),
  v1Adapter: join(projectRoot, "packages/contracts/src/team-protocol/v1-adapter.ts"),
  v8: join(projectRoot, "packages/contracts/src/team-protocol/v8-base.ts"),
  v8Adapter: join(projectRoot, "packages/contracts/src/team-protocol/v8-base-adapter.ts"),
};
const imports = Object.fromEntries(
  Object.entries(modulePaths).map(([name, path]) => [name, path.replaceAll("\\", "/")]),
);
const source =
  `const fixturePath = ${JSON.stringify(fixturePath)};
const output = ${JSON.stringify(output)};
const modules = ${JSON.stringify(imports)};
` +
  String.raw`
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement });
const report = { passed: false, fixturePath, fixtureSha256: "", checks: [], protocols: [], limitations: [
  "Uses current unchanged desktop/web/mobile model code, not installed native client binaries.",
  "The real confirmation helper and outbox store run without mounting the React Native ChatView.",
  "The transport boundary returns the immutable receipt captured from the real host fixture.",
] };
const disposers = [];
async function waitFor(label, read) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("Timed out waiting for " + label);
    await new Promise((done) => setTimeout(done, 0));
  }
}
try {
  const bytes = readFileSync(fixturePath);
  report.fixtureSha256 = createHash("sha256").update(bytes).digest("hex");
  const fixture = JSON.parse(bytes.toString("utf8"));
  // Static import expressions below let Bun resolve the real modules. Environment setup precedes
  // module initialization, so the Solid client runtime has a real DOM implementation.
  const { isConversationSnapshot, isQueuedMessageReceipt } = await IMPORT_CONTRACTS;
  const { createRoot, flush } = await IMPORT_SOLID;
  const { toAgentMessages } = await IMPORT_DESKTOP;
  const { createPendingSendStore } = await IMPORT_PENDING;
  const { projectChatMessages } = await IMPORT_MOBILE_PROJECTION;
  const { OutboxStore } = await IMPORT_MOBILE_OUTBOX;
  const { retainConfirmedAttachments } = await IMPORT_MOBILE_CONFIRMATION;
  const { conversationMessageId } = await IMPORT_MOBILE_CONVERSATION;
  const v1 = await IMPORT_V1;
  const v1Adapter = await IMPORT_V1_ADAPTER;
  const v8 = await IMPORT_V8;
  const v8Adapter = await IMPORT_V8_ADAPTER;
  assert.ok(isConversationSnapshot(fixture.mainSnapshot));
  assert.ok(isConversationSnapshot(fixture.sideSnapshot));
  assert.ok(isQueuedMessageReceipt(fixture.receipt));
  const { mainSnapshot, sideSnapshot, receipt } = fixture;
  const receiptId = conversationMessageId(receipt, mainSnapshot.agentId);
  assert.equal(receiptId, receipt.deliveries[0]?.id ?? receipt.messageId);
  const acknowledgement = mainSnapshot.messages.find((message) => message.id === receiptId);
  assert.ok(acknowledgement, "The main transcript must contain the exact client receipt ID.");
  assert.equal(acknowledgement.author, "agent");
  assert.equal(acknowledgement.senderAgentId, mainSnapshot.agentId);
  assert.equal(acknowledgement.source, "system");
  assert.equal(acknowledgement.itemType, "custom_work_route_receipt");
  assert.equal(acknowledgement.status, "completed");
  for (const field of ["turnId", "delivery", "exchange", "attachments"]) assert.equal(acknowledgement[field], undefined);
  const original = sideSnapshot.messages.find((message) => message.id === receiptId && message.author === "user");
  assert.ok(original, "The actual user message stays in the real side transcript.");
  assert.notEqual(acknowledgement.text, original.text);
  assert.equal(mainSnapshot.messages.some((message) => message.id === receiptId && message.author === "user"), false);
  report.checks.push("Real host fixture has one main acknowledgement and its original user row only in the side transcript, under the same receipt ID.");

  const adapters = [
    { protocol: 1, encode: v1Adapter.encodeTeamProtocolV1CurrentEvent, frozenDecode: v1.decodeTeamProtocolV1Event, decode: v1Adapter.decodeTeamProtocolV1CurrentEvent },
    { protocol: 8, encode: v8Adapter.encodeTeamProtocolV8BaseCurrentEvent, frozenDecode: v8.decodeTeamProtocolV8BaseEvent, decode: v8Adapter.decodeTeamProtocolV8BaseCurrentEvent },
  ];
  for (const adapter of adapters) {
    const wire = adapter.encode({ type: "conversation", snapshot: mainSnapshot });
    assert.equal(typeof wire, "string", "Frozen protocol " + adapter.protocol + " must encode the host snapshot.");
    const wireValue = JSON.parse(wire);
    assert.equal(adapter.frozenDecode(wireValue).kind, "known");
    const decoded = adapter.decode(wireValue);
    assert.equal(decoded.kind, "known");
    assert.equal(decoded.event.type, "conversation");
    const snapshot = decoded.event.snapshot;
    const desktopRows = toAgentMessages(snapshot.messages, snapshot.agentId);
    const mobileRows = projectChatMessages(snapshot.messages);
    assert.equal(desktopRows.filter((row) => row.id === receiptId).length, 1);
    assert.equal(mobileRows.filter((row) => row.id === receiptId).length, 1);
    const mobileAck = mobileRows.find((row) => row.id === receiptId);
    assert.equal(mobileAck.kind, "message");
    assert.equal(mobileAck.author, "agent");
    assert.equal(mobileAck.body, acknowledgement.text);
    assert.equal(desktopRows.find((row) => row.id === receiptId).body, acknowledgement.text);
    report.protocols.push({ protocol: adapter.protocol, wireBytes: Buffer.byteLength(wire), desktopRows: desktopRows.length, mobileRows: mobileRows.length });

    for (const client of ["desktop", "web"]) {
      let pending;
      createRoot((dispose) => { disposers.push(dispose); pending = createPendingSendStore(); });
      const target = { agentId: snapshot.agentId, serverId: client === "desktop" ? "local" : "fixture-web-server" };
      pending.add(target, {
        draft: { text: original.text, attachments: [], replyToMessageId: null },
        text: original.text, retrySafe: true, queued: true,
      }, async () => ({ messageId: receiptId }));
      await waitFor(client + " captured receipt", () => { flush(); return pending.list(target).find((send) => send.state === "sent"); });
      pending.settle(target, new Set(desktopRows.map((row) => row.id)));
      flush();
      assert.equal(pending.list(target).length, 0, client + " must remove the optimistic row when the real main acknowledgement is drawn.");
    }
    report.checks.push("Protocol " + adapter.protocol + " frozen wire preserves the acknowledgement, and actual desktop/web pending stores settle its exact ID.");

    const outbox = new OutboxStore({
      storage: null,
      randomId: () => crypto.randomUUID(),
      describeError: (error) => String(error),
      deliver: async (_message, control) => { await control.beforeStore(true); return { messageId: conversationMessageId(receipt, snapshot.agentId) }; },
    });
    await outbox.load();
    outbox.setOnline(new Set(["fixture-mobile-server"]));
    const sent = outbox.add({ kind: "agent", serverId: "fixture-mobile-server", agentId: snapshot.agentId }, { text: original.text, replyToMessageId: null, files: [] });
    const confirmed = await waitFor("mobile captured receipt", () => outbox.snapshot().messages.find((message) => message.clientMessageId === sent.clientMessageId && message.state === "sent"));
    assert.equal(confirmed.messageId, receiptId);
    // This is the production ChatView confirmation gate. It accepts any visible ordinary message
    // with the receipt ID; the acknowledgement must not be a hidden system/exchange marker.
    assert.equal(retainConfirmedAttachments(mobileRows, confirmed.messageId, [...outbox.filesInMemory(sent.clientMessageId)], () => {}), true);
    outbox.settle([sent.clientMessageId]);
    assert.equal(outbox.snapshot().messages.length, 0);
    report.checks.push("Protocol " + adapter.protocol + " actual mobile projection, attachment-confirmation gate and outbox store settle the routed send.");
  }
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.stack ?? error.message : String(error);
  process.exitCode = 1;
} finally {
  for (const dispose of disposers) dispose();
  dom.window.close();
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify(report) + "\n");
}
`;
let generated = source;
const importTokens: Record<string, keyof typeof modulePaths> = {
  CONTRACTS: "contracts",
  SOLID: "solid",
  DESKTOP: "desktopProjection",
  PENDING: "pending",
  MOBILE_PROJECTION: "mobileProjection",
  MOBILE_OUTBOX: "mobileOutbox",
  MOBILE_CONFIRMATION: "mobileConfirmation",
  MOBILE_CONVERSATION: "mobileConversation",
  V1: "v1",
  V1_ADAPTER: "v1Adapter",
  V8: "v8",
  V8_ADAPTER: "v8Adapter",
};
// Replace longer tokens first, so IMPORT_V1 does not consume IMPORT_V1_ADAPTER.
for (const token of Object.keys(importTokens).sort((a, b) => b.length - a.length)) {
  const key = importTokens[token];
  assert.ok(key);
  generated = generated.replaceAll(`IMPORT_${token}`, `import(${JSON.stringify(imports[key])})`);
}
writeFileSync(entryPath, generated);
const build = await Bun.build({
  entrypoints: [entryPath],
  target: "node",
  format: "esm",
  conditions: ["browser"],
  external: ["jsdom"],
  outdir: output,
  naming: "client-bundle.mjs",
  plugins: [
    {
      name: "mobile-source-alias",
      setup(builder) {
        builder.onResolve({ filter: /^@\// }, ({ path }) => {
          const base = join(projectRoot, "apps/mobile/src", path.slice(2));
          const match = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")].find(
            existsSync,
          );
          return match ? { path: match } : undefined;
        });
      },
    },
  ],
});
assert.ok(build.success, String(build.logs));
const child = spawnSync("node", [join(output, "client-bundle.mjs")], {
  cwd: projectRoot,
  encoding: "utf8",
  windowsHide: true,
  timeout: 30_000,
});
process.stdout.write(child.stdout ?? "");
process.stderr.write(child.stderr ?? "");
assert.ifError(child.error);
assert.equal(child.status, 0, "Client receipt compatibility fixture failed.");
