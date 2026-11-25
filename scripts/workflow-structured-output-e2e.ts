import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { type AgentModelOption, isReasoningEffort, parseWorkflowAnswerSpec } from "@openbot/contracts/ipc";
import { generateTextWithoutTools, startToolless, stopToolless } from "../src/backend/agent/profile-generation";
import { ClaudeAgentClient } from "../src/backend/claude-client";
import { resolveClaudeCli } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { getArray, getString } from "../src/backend/protocol";
import { readAnswer, workflowAnswerJsonSchema } from "../src/backend/workflows/workflow-answers";
import { modelStepPrompt } from "../src/backend/workflows/workflow-walk";
import { observedQuery } from "./claude-agent-harness";

const OUT = resolve(import.meta.dirname, "../.openbot-build/workflow-structured-output-e2e");
const TIMEOUT_MS = 120_000;
const report: { model: string; checks: { name: string; passed: boolean }[]; answers: string[] } = {
  model: "",
  checks: [],
  answers: [],
};

function check(name: string, passed: boolean, detail?: unknown) {
  report.checks.push({ name, passed });
  assert.ok(passed, `${name}: ${JSON.stringify(detail)}`);
}

const seen: { options: Options[]; toolNames: string[] } = { options: [], toolNames: [] };
const onMessage = (message: SDKMessage) => {
  if (message.type !== "assistant") return;
  for (const block of message.message.content) if (block.type === "tool_use") seen.toolNames.push(block.name);
};
const cli = await runCauseEffect(resolveClaudeCli());
const client = new ClaudeAgentClient(
  cli,
  observedQuery(onMessage, (options) => {
    seen.options.push(options);
    return options;
  }),
  undefined,
  TIMEOUT_MS,
);

async function smallModel(): Promise<AgentModelOption> {
  await runCauseEffect(startToolless(client));
  try {
    const list = await runCauseEffect(
      client.request("model/list", { limit: 100, includeHidden: true }, (value) => value),
    );
    const item = getArray(list, "data").find((entry) => getString(entry, "model")?.includes("haiku"));
    const id = getString(item, "model");
    assert.ok(id, "Claude lists no Haiku model.");
    const effort = getString(item, "defaultReasoningEffort");
    return {
      provider: "claude",
      id,
      name: id,
      description: "",
      defaultReasoningEffort: isReasoningEffort(effort) ? effort : "low",
      supportedReasoningEfforts: isReasoningEffort(effort) ? [effort] : ["low"],
    };
  } finally {
    await runCauseEffect(stopToolless(client)).catch(() => undefined);
  }
}

try {
  const model = await smallModel();
  report.model = model.id;
  const fields = parseWorkflowAnswerSpec(
    "priority: high|normal|low\ncount: integer\ntags: list\nurgent: yes/no\nnote?: text",
  ).fields;
  const schema = workflowAnswerJsonSchema(fields);
  check(
    "the answer spec becomes a JSON Schema with labels, types and the required fields",
    JSON.stringify(schema) ===
      JSON.stringify({
        type: "object",
        properties: {
          priority: { type: "string", enum: ["high", "normal", "low"] },
          count: { type: "integer" },
          tags: { type: "array", items: { type: "string" } },
          urgent: { type: "boolean" },
          note: { type: "string" },
        },
        required: ["priority", "count", "tags", "urgent"],
        additionalProperties: false,
      }),
    schema,
  );
  const prompt = modelStepPrompt(
    "You sort support tickets. First write one short sentence about the ticket.",
    "Sort this ticket.",
    "Three customers say the payment page is down since 9:00. They cannot pay.",
  );
  const answer = await runCauseEffect(
    generateTextWithoutTools(client, model, prompt, undefined, undefined, "text", [], schema),
  );
  report.answers.push(answer);
  check(
    "Claude gets the schema as its output format",
    JSON.stringify(seen.options.at(-1)?.outputFormat) === JSON.stringify({ type: "json_schema", schema }),
    seen.options.at(-1)?.outputFormat,
  );
  check("Claude gives the answer with its structured output tool", seen.toolNames.includes("StructuredOutput"), seen);
  const read = readAnswer(fields, answer);
  check(
    "the reply is only the JSON answer, and it fits the fields with no fix try",
    "output" in read && JSON.stringify(JSON.parse(answer)) === answer,
    { answer, read },
  );
  const queries = seen.options.length;
  const plain = await runCauseEffect(generateTextWithoutTools(client, model, "Say the word ready."));
  report.answers.push(plain);
  const plainOptions = seen.options.at(-1);
  check(
    "a generation with no schema has no output format",
    seen.options.length === queries + 1 && plainOptions?.outputFormat === undefined && plain.length > 0,
    { plain, outputFormat: plainOptions?.outputFormat },
  );
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`passed: ${report.checks.length} checks; ${resolve(OUT, "report.json")}\n`);
