import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type AgentEvent,
  type AgentPromptQuestion,
  type ConversationSnapshot,
  MCP_ELICITATION_DECISION_QUESTION_ID,
} from "@openbot/contracts/ipc";
import { TRANSLATED_LOCALES } from "@openbot/i18n";
import { localizeSourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { AttentionRegistry } from "../src/backend/agent/attention-registry";
import { AgentApiKeys } from "../src/backend/agent-api-keys";
import { CodexAppServerClient } from "../src/backend/app-server-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { RequestId } from "../src/backend/protocol";

const OUT = resolve(import.meta.dirname, "../.openbot-build/mcp-consent-language-e2e");
const AGENT = "agent-1";
const THREAD = "thread-1";
const SERVER = "github";
const ENGLISH = {
  allowOnce: "Allow once",
  allowAlways: "Always allow",
  decline: "Don't allow",
  allowOnceDetail: `Allow this ${SERVER} request.`,
  allowAlwaysDetail: `Remember this access for future ${SERVER} requests.`,
  declineDetail: "Keep access blocked.",
};

class RecordingClient extends CodexAppServerClient {
  readonly answers = new Map<RequestId, unknown>();

  override get running(): boolean {
    return true;
  }

  override respond(id: RequestId, result: unknown): void {
    this.answers.set(id, result);
  }
}

const root = await mkdtemp(join(tmpdir(), "openbot-mcp-consent-language-e2e-"));
const client = new RecordingClient("/nonexistent/codex");
const snapshot: ConversationSnapshot = {
  agentId: AGENT,
  threadId: THREAD,
  activeTurnId: null,
  revision: 0,
  messages: [],
};
const events: AgentEvent[] = [];
const registry = new AttentionRegistry({
  conversation: {
    agentForThread: (threadId: string) => (threadId === THREAD ? AGENT : undefined),
    publicThreadId: (_agentId: string, threadId: string) => threadId,
    ensureSnapshot: () => snapshot,
    emitConversation: () => {
      snapshot.revision += 1;
    },
  },
  browser: { listTabs: () => [], toolCanUseTab: () => false, beginTakeover: () => Effect.void, endTakeover: () => {} },
  hostedSites: { prepareApproval: () => Effect.succeed(null), resolveApproval: () => Effect.void },
  routines: { markNeedsAttention: () => {}, markRunningForTurn: () => {}, runsTurn: () => false },
  emit: (event: AgentEvent) => events.push(event),
  emitError: () => {},
  emitRuntimeSnapshot: () => {},
  apiKeys: new AgentApiKeys(join(root, "agent-api-keys")),
});

let nextRequest = 1;

function askConsent(turnId: string): { id: number; question: AgentPromptQuestion } {
  const id = nextRequest++;
  registry.surfaceMcpElicitation(client, {
    id,
    method: "mcpServer/elicitation/request",
    params: {
      threadId: THREAD,
      turnId,
      serverName: SERVER,
      mode: "form",
      message: `Allow the ${SERVER} MCP server to run tool "create_issue"?`,
      requestedSchema: { type: "object", properties: {} },
      _meta: { codex_approval_kind: "mcp_tool_call", persist: ["session", "always"] },
    },
  });
  const event = events.findLast((item) => item.type === "prompt" && item.requestId === id);
  assert.ok(event && event.type === "prompt", "OpenBot did not show the MCP consent prompt");
  const question = event.questions.find((item) => item.id === MCP_ELICITATION_DECISION_QUESTION_ID);
  assert.ok(question?.options, "the MCP consent prompt has no choices");
  return { id, question };
}

const steps: Array<{ step: string; result: unknown }> = [];

async function step(name: string, run: () => unknown): Promise<void> {
  const result = await run();
  steps.push({ step: name, result });
}

try {
  await mkdir(OUT, { recursive: true });

  const first = askConsent("turn-1");

  await step("the host sends the released English choices", () => {
    assert.deepEqual(first.question.options, [
      { label: ENGLISH.allowOnce, description: ENGLISH.allowOnceDetail },
      { label: ENGLISH.allowAlways, description: ENGLISH.allowAlwaysDetail },
      { label: ENGLISH.decline, description: ENGLISH.declineDetail },
    ]);
    return first.question.options;
  });

  await step("each app language shows the choices in that language", () => {
    const shown = Object.fromEntries(
      TRANSLATED_LOCALES.filter((locale) => locale !== "en").map((locale) => {
        const options = (first.question.options ?? []).map((option) => ({
          label: localizeSourceText(option.label, locale),
          description: localizeSourceText(option.description, locale),
        }));
        for (const [index, option] of options.entries()) {
          const english = first.question.options?.[index];
          assert.notEqual(option.label, english?.label, `${locale} shows "${english?.label}" in English`);
          assert.notEqual(
            option.description,
            english?.description,
            `${locale} shows "${english?.description}" in English`,
          );
        }
        assert.ok(
          options.every((option, index) => index === 2 || option.description.includes(SERVER)),
          `${locale} lost the server name`,
        );
        return [locale, options];
      }),
    );
    assert.equal(shown.pt?.[0]?.label, "Permitir uma vez");
    return shown;
  });

  await step("an older host's English choices are translated too", () => ({
    allowOnce: localizeSourceText(ENGLISH.allowOnce, "pt"),
    decline: localizeSourceText(ENGLISH.decline, "pt"),
  }));

  await step("the English label is the answer, so Allow once runs the tool", async () => {
    await runCauseEffect(
      registry.respondToPrompt({
        requestId: first.id,
        answers: { [MCP_ELICITATION_DECISION_QUESTION_ID]: [ENGLISH.allowOnce] },
      }),
    );
    const answer = client.answers.get(first.id);
    assert.deepEqual(answer, { action: "accept", content: {}, _meta: null });
    return answer;
  });

  const second = askConsent("turn-2");
  await step("Always allow keeps the access", async () => {
    await runCauseEffect(
      registry.respondToPrompt({
        requestId: second.id,
        answers: { [MCP_ELICITATION_DECISION_QUESTION_ID]: [ENGLISH.allowAlways] },
      }),
    );
    const answer = client.answers.get(second.id);
    assert.deepEqual(answer, { action: "accept", content: {}, _meta: { persist: "always" } });
    return answer;
  });

  const third = askConsent("turn-3");
  await step("Don't allow blocks the tool", async () => {
    await runCauseEffect(
      registry.respondToPrompt({
        requestId: third.id,
        answers: { [MCP_ELICITATION_DECISION_QUESTION_ID]: [ENGLISH.decline] },
      }),
    );
    const answer = client.answers.get(third.id);
    assert.deepEqual(answer, { action: "decline", content: null, _meta: null });
    return answer;
  });

  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed: true, steps }, null, 2)}\n`);
  process.stdout.write(`MCP consent language E2E passed. Report: ${join(OUT, "report.json")}\n`);
} catch (error) {
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed: false, steps }, null, 2)}\n`);
  throw error;
} finally {
  await rm(root, { recursive: true, force: true });
}
