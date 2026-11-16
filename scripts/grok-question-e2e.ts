// Runs the real `grok` provider driver over a fake Grok agent (`provider-fakes/agents/grok-question.ts`)
// to check the reply to Grok's `ask_user_question`. Grok CLI 1.0.77 reads the reply as an enum with
// the tag `outcome`; a reply without it failed the tool, and the model then asked in prose.
// Cases: all questions answered, one question answered, and no answer.
// `bun run test:grok-question`. Writes .openbot-build/grok-question-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentClient } from "../src/backend/agent-client";
import { getArray, getString, isRecord } from "../src/backend/protocol";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { installFakeAgent, readJsonl, runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/grok-question-e2e");

interface Asked {
  id: string | null;
  question: string | null;
  options: number;
  multiSelect: boolean;
}

interface Case {
  asked: Asked[];
  reply: unknown;
  answer: string;
  status: string | null;
}

interface Report {
  passed: boolean;
  answered?: Case;
  partial?: Case;
  skipped?: Case;
  failure?: string;
}

const root = await mkdtemp(join(tmpdir(), "openbot-grok-question-e2e-"));
const report: Report = { passed: false };
const clients: AgentClient[] = [];

try {
  const executable = join(root, "bin", "grok");
  const log = join(root, "agent.jsonl");
  await installFakeAgent(executable, "grok-question", { FAKE_LOG: log });
  const client = requireProviderDriver("grok").createClient(
    { executable, version: "1.0.77", source: "managed" },
    10_000,
    NO_PROVIDER_CREDENTIALS,
  );
  clients.push(client);
  /** The answers of the next question prompt, by question number. */
  let answers: readonly (readonly string[])[] = [];
  let asked: Asked[] = [];
  client.on("request", (request) => {
    if (request.method !== "item/tool/requestUserInput") {
      client.respondError(request.id, { code: -32601, message: `The test does not answer ${request.method}.` });
      return;
    }
    const questions = getArray(request.params, "questions").filter(isRecord);
    asked = questions.map((question) => ({
      id: getString(question, "id"),
      question: getString(question, "question"),
      options: getArray(question, "options").length,
      multiSelect: question.multiSelect === true,
    }));
    // As the app answers: only the answered questions, by question id.
    client.respond(request.id, {
      answers: Object.fromEntries(
        asked.flatMap(({ id }, index) => {
          const values = answers[index] ?? [];
          return id && values.length > 0 ? [[id, { answers: values }]] : [];
        }),
      ),
    });
  });
  client.start();
  const thread = await startThread(client, { cwd: root });

  const run = async (given: readonly (readonly string[])[]): Promise<Case> => {
    answers = given;
    const before = (await readJsonl<{ event: string; text?: string }>(log)).length;
    const turn = await runTurn(client, thread, { timeoutMs: 20_000 });
    const entry = (await readJsonl<{ event: string; text?: string }>(log))
      .slice(before)
      .find((e) => e.event === "reply");
    assert.ok(entry?.text, "The agent must get a reply to its questions.");
    assert.deepEqual(
      asked.map(({ question, options, multiSelect }) => ({ question, options, multiSelect })),
      [
        { question: "Which color?", options: 2, multiSelect: false },
        { question: "Which sizes?", options: 2, multiSelect: true },
      ],
    );
    assert.equal(new Set(asked.map(({ id }) => id)).size, 2, "Each question must have its own id.");
    assert.equal(turn.status, "completed");
    assert.equal(turn.reply, "answered");
    return { asked, reply: JSON.parse(entry.text), answer: turn.reply, status: turn.status };
  };

  report.answered = await run([["Red"], ["Small", "Large"]]);
  assert.deepEqual(report.answered.reply, {
    outcome: "accepted",
    answers: { "Which color?": "Red", "Which sizes?": ["Small", "Large"] },
    annotations: {},
  });

  report.partial = await run([[], ["Large"]]);
  assert.deepEqual(report.partial.reply, {
    outcome: "accepted",
    answers: { "Which sizes?": "Large" },
    annotations: {},
  });

  report.skipped = await run([]);
  assert.deepEqual(report.skipped.reply, { outcome: "cancelled" });

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await stopClients(clients);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
