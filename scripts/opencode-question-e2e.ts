// Runs the real OpenCode driver against a fake `opencode acp` (`provider-fakes/agents/opencode-question.ts`)
// that asks with OpenCode's `question` tool: a form with a `qN_custom` text field for the typed answer of
// each choice field `qN`. Checks that the card has no page for such a text field, that the card's typed
// answer fills it, that a card with each question skipped accepts with no values (OpenCode then
// continues), that only a closed card or a form that requires a value declines then, that a list of
// choices with no `_custom` field stays a text question as before, and that the text before the
// question is the answer above the card, while the text before another tool call stays a step. Another
// ACP agent (Grok) with the same form keeps one page for each field and declines when nothing is answered.
// `bun run test:opencode-question`. Writes .openbot-build/opencode-question-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentClient } from "../src/backend/agent-client";
import type { AgentCliInfo } from "../src/backend/cli";
import { getArray, getString, isRecord } from "../src/backend/protocol";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { installFakeAgent, readJsonl, runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-question-e2e");

interface Asked {
  id: string | null;
  header: string | null;
  options: (string | null)[] | null;
  multiSelect: boolean;
  detail: string | null;
}

/** One entry of a turn, in order: a completed agent message, or the question card. */
type Step = { message: string | null; phase: string | null } | { card: true };

interface Case {
  given: Record<string, string[]>;
  asked: Asked[];
  reply: unknown;
  steps: Step[];
}

interface Report {
  passed: boolean;
  cases: Record<string, Case>;
  tool?: Step[];
  failure?: string;
}

const root = await mkdtemp(join(tmpdir(), "openbot-opencode-question-e2e-"));
const report: Report = { passed: false, cases: {} };
const clients: AgentClient[] = [];

/** The card's ids in the order of the form: the `_custom` field of a choice has no page. */
const IDS = ["q0", "q1", "q2", "q3_custom"];

try {
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const executable = join(root, "opencode", "bin", "opencode");
  const log = join(root, "agent.jsonl");
  await installFakeAgent(executable, "opencode-question", { FAKE_LOG: log });
  const cli: AgentCliInfo = { executable, version: "2.1.4", source: "managed" };
  const client = requireProviderDriver("opencode").createClient(cli, 10_000, NO_PROVIDER_CREDENTIALS);
  clients.push(client);

  /** The card's answers of the next question, as the app sends them: `{}` is a closed card. */
  let given: Record<string, string[]> = {};
  let asked: Asked[] = [];
  let steps: Step[] = [];
  /** Answers the card of the client's agent as the app does, and keeps its pages and messages. */
  const watch = (watched: AgentClient) => {
    watched.on("request", (request) => {
      if (request.method !== "item/tool/requestUserInput") {
        watched.respondError(request.id, { code: -32601, message: `The test does not answer ${request.method}.` });
        return;
      }
      steps.push({ card: true });
      asked = getArray(request.params, "questions")
        .filter(isRecord)
        .map((question) => ({
          id: getString(question, "id"),
          header: getString(question, "header"),
          options: Array.isArray(question.options)
            ? question.options.filter(isRecord).map((option) => getString(option, "label"))
            : null,
          multiSelect: question.multiSelect === true,
          detail: getString(question, "detail"),
        }));
      watched.respond(request.id, {
        answers: Object.fromEntries(Object.entries(given).map(([id, values]) => [id, { answers: values }])),
      });
    });
    watched.on("notification", (notification) => {
      if (notification.method !== "item/completed" || !isRecord(notification.params)) return;
      const item = notification.params.item;
      if (!isRecord(item) || item.type !== "agentMessage") return;
      steps.push({ message: getString(item, "text"), phase: getString(item, "phase") });
    });
  };
  watch(client);
  client.start();
  const thread = await startThread(client, { cwd: workspace });

  /** The card's pages of OpenCode's form. */
  const PAGES: Asked[] = [
    { id: "q0", header: "Color", options: ["Red", "Blue"], multiSelect: false, detail: "Please answer the questions." },
    { id: "q1", header: "Sizes", options: ["Small", "Large"], multiSelect: true, detail: null },
    { id: "q2", header: "Ship", options: ["Yes", "No"], multiSelect: false, detail: null },
    { id: "q3_custom", header: "Note (other)", options: null, multiSelect: false, detail: null },
  ];
  /** `flags` are the words that pick the fake's form and steps. */
  const run = async (
    name: string,
    answers: Record<string, string[]>,
    {
      flags = "",
      pages = PAGES,
      target = { client, thread },
    }: { flags?: string; pages?: Asked[]; target?: { client: AgentClient; thread: string } } = {},
  ): Promise<Case> => {
    given = answers;
    asked = [];
    steps = [];
    const before = (await readJsonl<{ event: string; text?: string }>(log)).length;
    const turn = await runTurn(target.client, target.thread, { text: `ask ${flags}`, timeoutMs: 20_000 });
    assert.equal(turn.error, null, `${name}: the turn failed`);
    const entry = (await readJsonl<{ event: string; text?: string }>(log))
      .slice(before)
      .find((e) => e.event === "reply");
    assert.ok(entry?.text, `${name}: the agent must get a reply to its question.`);
    const result: Case = { given: answers, asked, reply: JSON.parse(entry.text), steps };
    report.cases[name] = result;
    assert.deepEqual(
      asked,
      pages,
      `${name}: a choice and its _custom field are one page; a lone _custom field keeps its page.`,
    );
    return result;
  };
  const answered = (answers: Record<string, string[]>) => Object.fromEntries(IDS.map((id) => [id, answers[id] ?? []]));
  /** The text before the question is the answer above the card, and the text after it is one more answer. */
  const answeredSteps: Step[] = [
    { message: "Here is my plan.", phase: "final_answer" },
    { card: true },
    { message: "Thanks.", phase: "final_answer" },
  ];

  const option = await run("option", answered({ q0: ["Red"] }));
  assert.deepEqual(option.reply, { action: "accept", content: { q0: "red" } });
  assert.deepEqual(option.steps, answeredSteps);

  const typed = await run("typed", answered({ q0: ["Teal"], q1: ["Huge"] }));
  assert.deepEqual(typed.reply, { action: "accept", content: { q0_custom: "Teal", q1: [], q1_custom: "Huge" } });

  const both = await run("option-and-typed", answered({ q1: ["Small", "Huge"], q2: ["Yes"], q3_custom: ["A note"] }));
  assert.deepEqual(both.reply, {
    action: "accept",
    content: { q1: ["small"], q1_custom: "Huge", q2: "yes", q3_custom: "A note" },
  });

  const partial = await run("partial", answered({ q1: ["Large"] }));
  assert.deepEqual(partial.reply, { action: "accept", content: { q1: ["large"] } });

  const skipped = await run("skipped", answered({}));
  assert.deepEqual(skipped.reply, { action: "accept", content: {} }, "A card with each question skipped continues.");
  assert.deepEqual(skipped.steps, answeredSteps);

  const cancelled = await run("cancelled", {});
  assert.deepEqual(cancelled.reply, { action: "decline" }, "A closed card declines.");
  assert.deepEqual(cancelled.steps, [{ message: "Here is my plan.", phase: "final_answer" }, { card: true }]);

  const required = await run("required-skipped", answered({}), { flags: "required" });
  assert.deepEqual(required.reply, { action: "decline" }, "A form that requires a value declines when all is skipped.");

  const plain = await run(
    "plain",
    { q1: ["Small"], q4: ["Large"] },
    {
      flags: "plain",
      pages: [
        { id: "q1", header: "Sizes", options: null, multiSelect: false, detail: "Please answer the questions." },
        { id: "q4", header: "Size", options: ["Small", "Large"], multiSelect: false, detail: null },
      ],
    },
  );
  assert.deepEqual(
    plain.reply,
    { action: "accept", content: { q1: ["Small"], q4: "large" } },
    "A list of choices with no _custom field is a text answer, as before; a single choice gives its const.",
  );

  // Seven choices with a `_custom` field: the card shows the first five, and the detail names the
  // other two. A typed answer of a hidden choice still reaches the `_custom` field.
  const many = await run(
    "many-choices",
    { q5: ["Region 7"], q5_custom: [] },
    {
      flags: "many",
      pages: [
        {
          id: "q5",
          header: "Region",
          options: ["Region 1", "Region 2", "Region 3", "Region 4", "Region 5"],
          multiSelect: false,
          detail: `Please answer the questions. More choices: Region 6, Region 7. To select one, type it as your answer.`,
        },
      ],
    },
  );
  assert.deepEqual(
    many.reply,
    { action: "accept", content: { q5: "r7" } },
    "A typed answer of a hidden choice still maps to its const, so the agent gets the value it asked for.",
  );

  // The same seven choices as a list: a multi-select page with the same 5-option cap and detail.
  const manyMulti = await run(
    "many-choices-multi-select",
    { q6: ["Region 1", "Region 2"], q6_custom: [] },
    {
      flags: "many-multi",
      pages: [
        {
          id: "q6",
          header: "Regions",
          options: ["Region 1", "Region 2", "Region 3", "Region 4", "Region 5"],
          multiSelect: true,
          detail: `Please answer the questions. More choices: Region 6, Region 7. To select one, type it as your answer.`,
        },
      ],
    },
  );
  assert.deepEqual(
    manyMulti.reply,
    { action: "accept", content: { q6: ["r1", "r2"] } },
    "A multi-select page with more choices than the card shows keeps its picked options.",
  );

  const stepped = await run("step-first", answered({ q0: ["Blue"] }), { flags: "step" });
  assert.deepEqual(stepped.reply, { action: "accept", content: { q0: "blue" } });
  assert.deepEqual(
    stepped.steps,
    [{ message: "Let me look.", phase: "commentary" }, ...answeredSteps],
    "The text before another tool call stays a step; the text right before the question is the reply.",
  );

  // Another ACP agent asks with the same form. Only OpenCode's form folds `_custom`: here each field
  // has its own page, as before, and a card with each question skipped declines. The earlier filter
  // drops `q0_custom`, whose choice field has options, and keeps `q1_custom`, whose array field has
  // no options that the card reads.
  const grokExecutable = join(root, "grok", "bin", "grok");
  await installFakeAgent(grokExecutable, "opencode-question", { FAKE_LOG: log });
  const grok = requireProviderDriver("grok").createClient(
    { executable: grokExecutable, version: "1.0.77", source: "managed" },
    10_000,
    NO_PROVIDER_CREDENTIALS,
  );
  clients.push(grok);
  watch(grok);
  grok.start();
  const other = { client: grok, thread: await startThread(grok, { cwd: workspace }) };
  const FIELD_PAGES: Asked[] = [
    { id: "q0", header: "Color", options: ["Red", "Blue"], multiSelect: false, detail: "Please answer the questions." },
    { id: "q1", header: "Sizes", options: null, multiSelect: false, detail: null },
    { id: "q1_custom", header: "Sizes (other)", options: null, multiSelect: false, detail: null },
    { id: "q2", header: "Ship", options: ["Yes", "No"], multiSelect: false, detail: null },
    { id: "q3_custom", header: "Note (other)", options: null, multiSelect: false, detail: null },
  ];
  const noAnswers = Object.fromEntries(FIELD_PAGES.map(({ id }) => [id ?? "", []]));
  const otherSkipped = await run("other-agent-skipped", noAnswers, { pages: FIELD_PAGES, target: other });
  assert.deepEqual(
    otherSkipped.reply,
    { action: "decline" },
    "Another agent's form with each question skipped declines.",
  );
  const otherTyped = await run(
    "other-agent-typed",
    { ...noAnswers, q0: ["Red"], q1_custom: ["Teal"] },
    { pages: FIELD_PAGES, target: other },
  );
  assert.deepEqual(otherTyped.reply, { action: "accept", content: { q0: "red", q1_custom: "Teal" } });

  steps = [];
  const tool = await runTurn(client, thread, { text: "tool", timeoutMs: 20_000 });
  assert.equal(tool.error, null, "tool: the turn failed");
  report.tool = steps;
  assert.deepEqual(
    steps,
    [
      { message: "Let me look.", phase: "commentary" },
      { message: "Done.", phase: "final_answer" },
    ],
    "The text before another tool call stays a step.",
  );
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await stopClients(clients);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(
  report.passed
    ? `PASS opencode-question-e2e: ${join(OUT, "report.json")}\n`
    : `FAIL opencode-question-e2e: ${report.failure ?? "unknown"}\n`,
);
