import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/read-document-tool-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-read-document-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const files = join(root, "files");
const fakeCodex = join(root, "codex");
const fakeLog = join(root, "codex.jsonl");

process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
process.env.OPENBOT_CODEX_PATH = fakeCodex;
mkdirSync(home, { recursive: true });
mkdirSync(files, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");
const { SidebarLayoutStore } = await import("../src/backend/sidebar-layout-store");
const { LibraryFoldersStore } = await import("../src/backend/library-folders-store");

const CALL_MARK = "READ-CALL";
const PDF_NOTE = "openbot.read_document";

const FAKE_CODEX = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.172.0\\n");
  process.exit(0);
}
const LOG = ${JSON.stringify(fakeLog)};
const config = { config: { mcp_servers: {} }, layers: [{ name: { type: "user", file: "/fake/.codex/config.toml", profile: null }, version: "1", config: { mcp_servers: {} } }] };
let buffer = "";
let threads = 0;
let turns = 0;
const waiting = new Map();
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const log = (entry) => appendFileSync(LOG, JSON.stringify(entry) + "\\n");
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const finish = (threadId, turnId) => {
  const item = { type: "agentMessage", id: "message-" + turnId, text: "Done.", phase: "final_answer" };
  write({ method: "item/completed", params: { threadId, turnId, item } });
  write({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
};
const answer = (message) => {
  const params = message.params || {};
  switch (message.method) {
    case "initialize": return write({ id: message.id, result: {} });
    case "account/read": return write({ id: message.id, result: { account: { type: "chatgpt", email: "codex@example.com" } } });
    case "account/rateLimits/read": return write({ id: message.id, result: { rateLimits: { limitId: "codex", primary: null, secondary: null }, rateLimitsByLimitId: null } });
    case "model/list": return write({ id: message.id, result: { data: [{ model: "gpt-6-luna", displayName: "GPT-6 Luna" }] } });
    case "plugin/list": return write({ id: message.id, result: { marketplaces: [] } });
    case "config/read": return write({ id: message.id, result: config });
    case "config/batchWrite": return write({ id: message.id, result: {} });
    case "thread/start": return write({ id: message.id, result: { thread: { id: "thread-" + (++threads), turns: [] } } });
    case "thread/resume": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "thread/unsubscribe": return write({ id: message.id, result: { status: "Unsubscribed" } });
    case "thread/turns/list":
    case "thread/items/list": return write({ id: message.id, result: { data: [], nextCursor: null } });
    case "thread/read": return write({ id: message.id, result: { thread: { id: params.threadId, turns: [] } } });
    case "turn/start": {
      const turnId = "turn-" + (++turns);
      const input = params.input || [];
      const text = input.map((item) => item.text || "").join("\\n");
      write({ id: message.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } });
      write({ method: "turn/started", params: { threadId: params.threadId, turn: { id: turnId } } });
      const match = text.includes(${JSON.stringify(CALL_MARK)}) ? text.match(/<<ARGS([\\s\\S]*?)ARGS>>/) : null;
      if (!match) return setTimeout(() => finish(params.threadId, turnId), 20);
      log({ kind: "input", turnId, text, items: input.filter((item) => item.type !== "text") });
      const args = JSON.parse(match[1]);
      const attached = text.match(/^- [^:\\n]+: (.+)$/m);
      if (args.path === "ATTACHED" && attached) args.path = attached[1];
      const id = "tool-" + turnId;
      waiting.set(id, { threadId: params.threadId, turnId });
      return write({
        id,
        method: "item/tool/call",
        params: {
          threadId: params.threadId,
          turnId,
          callId: "call-" + turnId,
          namespace: "openbot",
          tool: "tool_call",
          arguments: { name: "openbot.read_document", arguments: args },
        },
      });
    }
    case "turn/interrupt": {
      write({ id: message.id, result: {} });
      return write({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: params.turnId, status: "interrupted" } } });
    }
    default:
      return write({ id: message.id, error: { code: -32601, message: "Method not found: " + message.method } });
  }
};
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line) {
      const message = JSON.parse(line);
      if (message.method && message.id !== undefined) answer(message);
      else if (!message.method && waiting.has(message.id)) {
        const turn = waiting.get(message.id);
        waiting.delete(message.id);
        log({ kind: "result", turnId: turn.turnId, result: message.result ?? null, error: message.error ?? null });
        finish(turn.threadId, turn.turnId);
      }
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

function pdfFile(pages: string[]): Buffer {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>"];
  const kids = pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (const [index, text] of pages.entries()) {
    const stream = text
      .split("\n")
      .filter(Boolean)
      .map((line, row) => `BT /F1 10 Tf 20 ${770 - row * 14} Td (${line}) Tj ET`)
      .join("\n");
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

interface ToolResult {
  success: boolean;
  contentItems: { type: string; text: string }[];
}

type LogEntry =
  | { kind: "input"; turnId: string; text: string; items: { type: string; path?: string }[] }
  | { kind: "result"; turnId: string; result: ToolResult | null; error: unknown };

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  toolCanUseTab: () => false,
  beginTakeover: unused,
  endTakeover: () => {},
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
};

async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

function logEntries(): LogEntry[] {
  let text = "";
  try {
    text = readFileSync(fakeLog, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const report: {
  calls: { name: string; input: string; success: boolean; result: string }[];
  checks: { name: string; passed: boolean }[];
  passed: boolean;
  error?: string;
} = { calls: [], checks: [], passed: false };

function pass(name: string, condition: boolean, detail?: string) {
  report.checks.push({ name, passed: condition });
  assert.ok(condition, detail ? `${name}: ${detail}` : name);
}

await writeFile(fakeCodex, FAKE_CODEX, { mode: 0o755 });
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
const library = new LibraryFoldersStore(join(userData, "library-folders.json"));
const agents = new AgentService({
  store,
  mailbox,
  browser,
  sidebarLayout: sidebar,
  libraryFolders: {
    getSnapshot: () => library.getSnapshot(),
    placeInPath: (agentId, names, fileIds, context) => library.placeInPath(agentId, names, fileIds, context),
    mutate: (action, context) => library.mutate(action, context),
    removeAgent: (agentId) => library.removeAgent(agentId),
    fileAgents: () => Effect.succeed(new Map<string, string | null>()),
    fileWorkflows: () => Effect.succeed(new Map()),
  },
  preferredProvider: "codex",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "codex"),
  timezone: () => "UTC",
  approvalAutomation: {
    autoApproves: () => true,
    set: () => Effect.succeed({ defaultAutoApprove: true, autoApproveOverrides: {} }),
  },
});

function idle(agentId: string) {
  return waitFor("the chat turn to end", () =>
    agents
      .listQueue(agentId)
      .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status)),
  );
}

async function readFromChat(
  name: string,
  agentId: string,
  file: string | null,
  args: { path: string; firstPage?: number },
) {
  const before = logEntries().length;
  const drafts = file ? await runCauseEffect(mailbox.prepareAttachments([file])) : [];
  const text = `${CALL_MARK} <<ARGS${JSON.stringify(args)}ARGS>>`;
  await runCauseEffect(
    agents.sendMessage(
      { agentId, text, attachmentDraftIds: drafts.map((draft) => draft.id) },
      { id: "local", name: "Alex" },
    ),
  );
  const result = await waitFor(`${name} tool result`, () => {
    const entry = logEntries()
      .slice(before)
      .find((item) => item.kind === "result");
    return entry?.kind === "result" ? entry : null;
  });
  const input = logEntries()
    .slice(before)
    .find((item) => item.kind === "input");
  await idle(agentId);
  const output = result.result?.contentItems.map((item) => item.text).join("\n") ?? JSON.stringify(result.error);
  const success = result.result?.success === true;
  report.calls.push({ name, input: input?.kind === "input" ? input.text : "", success, result: output });
  return { success, output, input: input?.kind === "input" ? input : null };
}

try {
  await runCauseEffect(sidebar.initialize());
  await runCauseEffect(library.initialize());
  await runCauseEffect(agents.initialize());
  const reader = await runCauseEffect(
    agents.createAgentProfile({ name: "Reader", description: "Reads files.", avatarSeed: "reader", avatarHue: null }),
  );

  const invoice = join(files, "invoice.pdf");
  await writeFile(invoice, pdfFile(["Invoice 4711 total 99 EUR", "Paid on 2026-11-20"]));
  const attached = await readFromChat("read an attached PDF", reader.id, invoice, { path: "ATTACHED" });
  pass("The agent input tells the agent to use read_document", attached.input?.text.includes(PDF_NOTE) === true);
  pass(
    "The PDF stays a file item, not a picture",
    attached.input?.items.some((item) => item.type === "mention") === true &&
      !attached.input?.items.some((item) => item.type === "localImage"),
    JSON.stringify(attached.input?.items),
  );
  pass(
    "read_document returns the text of each page",
    attached.success &&
      attached.output.includes("--- page 1 ---\nInvoice 4711 total 99 EUR") &&
      attached.output.includes("--- page 2 ---\nPaid on 2026-11-20") &&
      attached.output.includes('"pageCount":2') &&
      attached.output.includes('"nextPage":null'),
    attached.output,
  );

  const long = join(files, "long.pdf");
  await writeFile(long, pdfFile(Array.from({ length: 35 }, (_, index) => `Line of page ${index + 1}`)));
  const first = await readFromChat("read a long PDF", reader.id, long, { path: "ATTACHED" });
  pass(
    "A long PDF returns 30 pages and the next page to read",
    first.success &&
      first.output.includes('"lastPage":30') &&
      first.output.includes('"nextPage":31') &&
      first.output.includes("firstPage 31") &&
      !first.output.includes("Line of page 31"),
    first.output,
  );
  const rest = await readFromChat("read the rest of a long PDF", reader.id, null, { path: long, firstPage: 31 });
  pass(
    "firstPage reads the next pages",
    rest.success && rest.output.includes("Line of page 35") && rest.output.includes('"nextPage":null'),
    rest.output,
  );
  const past = await readFromChat("read past the last page", reader.id, null, { path: long, firstPage: 99 });
  pass(
    "A page after the end fails with the page count",
    !past.success && past.output.includes("only 35 pages"),
    past.output,
  );

  const dense = join(files, "dense.pdf");
  const denseLines = (page: number) => [...Array.from({ length: 49 }, () => "x".repeat(60)), `End of page ${page} `];
  await writeFile(dense, pdfFile(Array.from({ length: 25 }, (_, index) => denseLines(index + 1).join("\n"))));
  const full = await readFromChat("read dense pages", reader.id, dense, { path: "ATTACHED" });
  const pageField = (name: string) => Number(full.output.match(new RegExp(`"${name}":(\\d+)`))?.[1]);
  const fullPages = { lastPage: pageField("lastPage"), nextPage: pageField("nextPage") };
  pass(
    "Dense pages stop at a whole page, and the next page is the first page not returned",
    full.success &&
      fullPages.lastPage < 25 &&
      fullPages.nextPage === fullPages.lastPage + 1 &&
      full.output.includes(`End of page ${fullPages.lastPage}`) &&
      !full.output.includes(`End of page ${fullPages.nextPage} `),
    full.output.slice(0, 200),
  );

  const scanned = join(files, "scanned.pdf");
  await writeFile(scanned, pdfFile(["", ""]));
  const empty = await readFromChat("read a PDF with no text", reader.id, scanned, { path: "ATTACHED" });
  pass(
    "A PDF with no text says that it is possibly scanned",
    empty.success && empty.output.includes("possibly scanned"),
    empty.output,
  );

  const broken = join(files, "broken.pdf");
  await writeFile(broken, "File not found");
  const damaged = await readFromChat("read a damaged PDF", reader.id, broken, { path: "ATTACHED" });
  pass(
    "A damaged PDF fails with a plain reason",
    !damaged.success && damaged.output.includes("not a valid PDF"),
    damaged.output,
  );

  const notes = join(files, "notes.txt");
  await writeFile(notes, "Plain notes.");
  const text = await readFromChat("attach a text file", reader.id, notes, { path: "ATTACHED" });
  pass("A message without a PDF has no read_document note", text.input?.text.includes(PDF_NOTE) === false);

  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
