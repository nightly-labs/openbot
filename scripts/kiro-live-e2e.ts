// Runs the real `kiro` provider driver over the user's own signed-in Kiro CLI, to check what the fake
// agents cannot: that turns of two sessions of one process run at the same time (in two folders and in
// one folder), and that the roster of subagents becomes subagent cards. It spends Kiro credits (about
// one), so it is a manual run and not a CI gate. Only the approval of the subagent tool is accepted; every other one is declined.
// `bun run test:kiro-live`. Writes .openbot-build/kiro-live-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ConversationSubagent } from "@openbot/contracts/ipc";
import { homeSkillInstructions } from "../src/backend/agent/developer-instructions";
import { SUBAGENTS_UPDATED_METHOD, subagentsFromNotification } from "../src/backend/agent/subagent-updates";
import type { AgentClient } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import {
  decodeAccountReadResult,
  decodeModelListResponse,
  getRecord,
  getString,
  isRecord,
} from "../src/backend/protocol";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/kiro-live-e2e");
const NUMBERS = "Reply with the numbers 1 to 40, one per line, and nothing else. Do not use any tools.";
const SUBAGENTS =
  "Start two subagents at the same time with your subagent tool. The first one must answer with exactly the " +
  "word one. The second one must answer with exactly the word two. They must not read or write files. When " +
  "both have finished, answer with the two words.";

interface Span {
  startedAt: number;
  endedAt: number;
  status: string | null;
  error: string | null;
  replyLines: number;
}

interface Report {
  passed: boolean;
  version: string;
  model: string;
  twoFolders?: { first: Span; second: Span; overlapMs: number; wallMs: number; sumMs: number };
  oneFolder?: { first: Span; second: Span; overlapMs: number };
  signedOut?: { account: unknown };
  skillByPath?: { reply: string };
  context?: { updates: number; window: number | null; lastTokens: number | null };
  subagents?: { seen: number; final: Pick<ConversationSubagent, "agentType" | "status" | "title" | "steps">[] };
  approvals: { method: string; subagent: boolean; shape: string }[];
  failure?: string;
}

const root = await mkdtemp(join(tmpdir(), "openbot-kiro-live-e2e-"));
const report: Report = { passed: false, version: "", model: "", approvals: [] };
const clients: AgentClient[] = [];

async function timed(client: AgentClient, thread: string, model: string, text: string): Promise<Span> {
  const startedAt = Date.now();
  const turn = await runTurn(client, thread, { model, text, timeoutMs: 120_000 });
  return {
    startedAt,
    endedAt: Date.now(),
    status: turn.status,
    error: turn.error,
    replyLines: turn.reply.split(/\r?\n/u).filter((line) => line.trim()).length,
  };
}

const overlap = (first: Span, second: Span) =>
  Math.min(first.endedAt, second.endedAt) - Math.max(first.startedAt, second.startedAt);

try {
  const driver = requireProviderDriver("kiro");
  const cli = await runCauseEffect(driver.resolveCli());
  report.version = cli.version;
  // A Kiro CLI with an empty home folder has no sign-in (and never touches the user's own): the process writes
  // "You are not logged in" and exits, so the account is null and no model is listed.
  const emptyHome = join(root, "empty-home");
  await mkdir(emptyHome);
  const signedOutClient = driver.createClient(cli, 30_000, {
    ...NO_PROVIDER_CREDENTIALS,
    agentEnvironment: () => ({ HOME: emptyHome }),
  });
  clients.push(signedOutClient);
  signedOutClient.start();
  const signedOut = await runCauseEffect(signedOutClient.request("account/read", {}, decodeAccountReadResult));
  report.signedOut = { account: signedOut.account };
  assert.equal(signedOut.account, null, "A Kiro CLI with no sign-in reports an account.");
  await runCauseEffect(signedOutClient.stop());

  const client = driver.createClient(cli, 60_000, NO_PROVIDER_CREDENTIALS);
  clients.push(client);
  client.on("request", (request) => {
    // Only the subagent tool may run. Anything else that asks is declined.
    const text = JSON.stringify(request.params ?? {});
    const subagent = /subagent|agent crew/iu.test(text);
    // Reading the skill is the one other action that the skill case needs: a read of its SKILL.md.
    const readsSkill = /secret-word/iu.test(text) && /read/iu.test(text);
    report.approvals.push({ method: request.method, subagent, shape: text.slice(0, 300) });
    if (request.method.endsWith("/requestApproval"))
      client.respond(request.id, { decision: subagent || readsSkill ? "accept" : "decline" });
    else client.respondError(request.id, { code: -32601, message: `The test does not answer ${request.method}.` });
  });
  client.start();

  const listed = await runCauseEffect(client.request("model/list", {}, decodeModelListResponse));
  const models = listed.data.flatMap((model) => model.model ?? []);
  assert.ok(models.length > 0, "Kiro lists models: sign in with `kiro-cli login` first.");
  const model = models.find((id) => id.includes("haiku")) ?? models[0] ?? "";
  report.model = model;

  const folders = await Promise.all(
    ["a", "b", "shared"].map(async (name) => {
      const folder = join(root, name);
      await mkdir(folder);
      await writeFile(join(folder, "README.md"), "Scratch folder of a test.\n");
      return folder;
    }),
  );
  const [folderA = root, folderB = root, shared = root] = folders;

  // The context fill of a turn: `_kiro.dev/metadata` gives a percentage, and the model list the size.
  const fills: { tokens: number; window: number }[] = [];
  client.on("notification", (notification) => {
    if (notification.method !== "thread/tokenUsage/updated" || !isRecord(notification.params)) return;
    const usage = getRecord(notification.params, "tokenUsage");
    const window = usage?.modelContextWindow;
    const tokens = getRecord(usage, "last")?.totalTokens;
    if (typeof window === "number" && typeof tokens === "number") fills.push({ tokens, window });
  });

  // Two sessions in two folders, one process: the turns overlap.
  const [first, second] = await Promise.all([
    startThread(client, { cwd: folderA, model }),
    startThread(client, { cwd: folderB, model }),
  ]);
  const startedAt = Date.now();
  const [one, two] = await Promise.all([timed(client, first, model, NUMBERS), timed(client, second, model, NUMBERS)]);
  const wallMs = Date.now() - startedAt;
  report.twoFolders = {
    first: one,
    second: two,
    overlapMs: overlap(one, two),
    wallMs,
    sumMs: one.endedAt - one.startedAt + (two.endedAt - two.startedAt),
  };
  for (const span of [one, two]) {
    assert.equal(span.error, null, "A turn in two folders fails.");
    assert.equal(span.status, "completed", "A turn in two folders does not complete.");
  }
  assert.ok(report.twoFolders.overlapMs > 1_000, "The turns of two folders do not overlap.");

  // Two sessions in one folder, the case that an agent with shared MCP servers could break.
  const [third, fourth] = await Promise.all([
    startThread(client, { cwd: shared, model }),
    startThread(client, { cwd: shared, model }),
  ]);
  const [three, four] = await Promise.all([
    timed(client, third, model, NUMBERS),
    timed(client, fourth, model, NUMBERS),
  ]);
  report.oneFolder = { first: three, second: four, overlapMs: overlap(three, four) };
  for (const span of [three, four]) {
    assert.equal(span.error, null, "A turn in one folder fails.");
    assert.equal(span.status, "completed", "A turn in one folder does not complete.");
  }
  assert.ok(report.oneFolder.overlapMs > 1_000, "The turns of one folder do not overlap.");

  // A skill in `.agents/skills`, which Kiro does not read, reaches the agent when its instructions name the
  // path of the `SKILL.md`: the agent opens the file and follows it.
  const skillFolder = join(root, "skill-folder");
  const skillDir = join(skillFolder, ".agents", "skills", "secret-word");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    "---\nname: secret-word\ndescription: Gives the secret word of the test.\n---\nThe secret word is PINEAPPLE-42.\n",
  );
  const skillThread = await startThread(client, {
    cwd: skillFolder,
    model,
    developerInstructions: homeSkillInstructions(
      [
        {
          slug: "secret-word",
          description: "Gives the secret word of the test.",
          directory: skillDir,
          file: join(skillDir, "SKILL.md"),
        },
      ],
      "the .agents/skills folder of your workspace",
    ).join("\n"),
  });
  const skillTurn = await runTurn(client, skillThread, {
    model,
    text: "What is the secret word of the test? Answer with the word only.",
    timeoutMs: 120_000,
  });
  report.skillByPath = { reply: skillTurn.reply.trim().slice(-120) };
  assert.equal(skillTurn.error, null, "The turn with a skill by path fails.");
  assert.match(skillTurn.reply, /PINEAPPLE-42/u, "The agent did not read the skill that its instructions name.");

  report.context = {
    updates: fills.length,
    window: fills.at(-1)?.window ?? null,
    lastTokens: fills.at(-1)?.tokens ?? null,
  };
  assert.ok(fills.length > 0, "A turn shows no context fill.");
  assert.equal(report.context.window, 1_000_000, "The context size is not the 1M of the model description.");
  assert.ok((report.context.lastTokens ?? 0) > 0, "The context fill has no tokens.");

  // Subagents: the roster of the process becomes cards of the parent's turn.
  const lists: ConversationSubagent[][] = [];
  client.on("notification", (notification) => {
    if (notification.method !== SUBAGENTS_UPDATED_METHOD || !isRecord(notification.params)) return;
    if (getString(notification.params, "threadId") !== first) return;
    const subagents = subagentsFromNotification(notification.params);
    if (subagents) lists.push(subagents);
  });
  const parent = await timed(client, first, model, SUBAGENTS);
  assert.equal(parent.error, null, "The turn with subagents fails.");
  const final = lists.at(-1) ?? [];
  report.subagents = {
    seen: new Set(lists.flat().map((subagent) => subagent.id)).size,
    final: final.map(({ agentType, status, title, steps }) => ({ agentType, status, title, steps })),
  };
  assert.ok(report.subagents.seen >= 2, `Two subagents showed as cards, not ${report.subagents.seen}.`);
  assert.ok(
    final.every((subagent) => subagent.status !== "running"),
    "A subagent still shows as running after the turn.",
  );
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await stopClients(clients);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
