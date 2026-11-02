// Runs `request_api_key` end to end on the real modules: the real `AttentionRegistry` shows the form
// that the router builds, the owner, a member and an admin answer it, and the real `AgentApiKeys` saves
// the key in a temporary folder. It checks that the value reaches the file and the log redaction, and
// no tool result, event or stored message. It also saves API keys in the real Vault and checks that
// `list` writes them to files for every agent and that a Vault change rewrites or removes the files.
// No provider or account is used.
// `bun scripts/agent-api-keys-e2e.ts`. Writes .openbot-build/agent-api-keys-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentEvent, ConversationSnapshot } from "@openbot/contracts/ipc";
import { type UiBlockSpec, uiBlockAnswersFromResponse } from "@openbot/contracts/ui-blocks";
import { redactText } from "@openbot/logging";
import { Effect } from "effect";
import { AttentionRegistry, type PromptResponder } from "../src/backend/agent/attention-registry";
import { API_KEY_FIELD_ID, apiKeyFormSpec } from "../src/backend/agent/prompts";
import { AgentApiKeys } from "../src/backend/agent-api-keys";
import { CodexAppServerClient } from "../src/backend/app-server-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { requestApiKeyToolSchema } from "../src/backend/openbot-tools";
import type { RequestId } from "../src/backend/protocol";
import { VaultService } from "../src/main/vault-service";
import { VaultStore } from "../src/main/vault-store";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-api-keys-e2e");
const AGENT = "agent-1";
const THREAD = "thread-1";
const KEY = "e2e-key-value-4be1c0d7";
const NEW_KEY = "e2e-key-replaced-77c1a0b2";
const VAULT_KEY = "e2e-vault-key-5d0e9a41";
const NEW_VAULT_KEY = "e2e-vault-key-changed-c3f8";
/** Reverses the bytes, so the Vault file never holds the plain text. */
const REVERSING_CIPHER = {
  encrypt: (value: string) => Buffer.from(value, "utf8").reverse(),
  decrypt: (value: Buffer) => Buffer.from(value).reverse().toString("utf8"),
};
const MEMBER: PromptResponder = { sender: { id: "member-1", name: "Mia" }, privileged: false };
const ADMIN: PromptResponder = { sender: { id: "admin-1", name: "Ada" }, privileged: true };

/** Records what OpenBot answers to the agent, as raw JSON. The process never starts. */
class RecordingClient extends CodexAppServerClient {
  readonly answers = new Map<RequestId, string>();

  override get running(): boolean {
    return true;
  }

  override respond(id: RequestId, result: unknown): void {
    this.answers.set(id, JSON.stringify(result));
  }
}

/** The JSON of the `request_api_key` result, as `apiKeyPromptResult` writes it. */
interface AgentAnswer {
  status: string;
  blockId?: string;
  name?: string;
  path?: string;
  next?: string;
}

/** The JSON that the agent reads in a tool result. */
function agentAnswer(raw: string | undefined): AgentAnswer {
  assert.ok(raw, "OpenBot did not answer the agent");
  const parsed: { contentItems?: Array<{ text?: string }> } = JSON.parse(raw);
  const text = parsed.contentItems?.[0]?.text;
  assert.ok(text, "the answer has no text");
  return JSON.parse(text);
}

const root = await mkdtemp(join(tmpdir(), "openbot-api-keys-e2e-"));
const apiKeys = new AgentApiKeys(join(root, "agent-api-keys"));
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
    agentForThread: (threadId) => (threadId === THREAD ? AGENT : undefined),
    publicThreadId: (_agentId, threadId) => threadId,
    ensureSnapshot: () => snapshot,
    emitConversation: () => {
      snapshot.revision += 1;
    },
  },
  browser: { listTabs: () => [], beginTakeover: () => Effect.void, endTakeover: () => {} },
  hostedSites: { prepareApproval: () => Effect.succeed(null), resolveApproval: () => Effect.void },
  routines: { markNeedsAttention: () => {}, markRunningForTurn: () => {} },
  emit: (event) => events.push(event),
  emitError: () => {},
  emitRuntimeSnapshot: () => {},
  apiKeys,
});

let nextRequest = 1;

/** Shows the form as the router does after it checks the arguments. */
function requestKey(args: unknown, turnId: string) {
  const parsed = requestApiKeyToolSchema.parse(args);
  const spec = apiKeyFormSpec(parsed);
  assert.ok(spec, "the router would refuse this form");
  const id = nextRequest++;
  registry.surfaceUiBlock(
    client,
    { id, method: "item/tool/call", params: { threadId: THREAD, turnId } },
    { blockId: `block-${id}`, spec, apiKey: { name: parsed.name } },
  );
  return { id, spec };
}

const submitted = (spec: UiBlockSpec, value: string) =>
  uiBlockAnswersFromResponse(spec, { actionId: "submit", values: { [API_KEY_FIELD_ID]: value } });

function answer(requestId: number, answers: Record<string, string[]>, responder?: PromptResponder) {
  return runCauseEffect(registry.respondToPrompt({ requestId, answers }, responder));
}

const steps: Array<{ step: string; result: unknown }> = [];
async function step(name: string, run: () => unknown): Promise<void> {
  try {
    steps.push({ step: name, result: (await run()) ?? "ok" });
  } catch (error) {
    steps.push({ step: name, result: { failed: error instanceof Error ? error.message : String(error) } });
    throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

try {
  await step("before the save, no redaction rule masks the test keys", () => {
    for (const value of [KEY, NEW_KEY]) assert.equal(redactText(value), value);
  });

  await step("the tool refuses a name that is not a variable name", () => {
    for (const name of ["openai_key", "../KEY", "1KEY", "KEY-1", "A".repeat(65)])
      assert.equal(requestApiKeyToolSchema.safeParse({ name, title: "Key" }).success, false, name);
  });

  await step("the form has one required secret field labelled with the name", () => {
    const spec = apiKeyFormSpec({ name: "OPENAI_API_KEY", title: "OpenAI API key", placeholder: "sk-…" });
    assert.ok(spec?.type === "form");
    assert.deepEqual(spec.fields, [
      {
        id: API_KEY_FIELD_ID,
        kind: "text",
        label: "OPENAI_API_KEY",
        required: true,
        secret: true,
        placeholder: "sk-…",
      },
    ]);
  });

  await step("a member cannot answer, and the form stays open", async () => {
    const { id, spec } = requestKey({ name: "OPENAI_API_KEY", title: "OpenAI API key" }, "turn-1");
    await assert.rejects(answer(id, submitted(spec, KEY), MEMBER));
    assert.equal(client.answers.has(id), false);
    assert.deepEqual(await Effect.runPromise(apiKeys.list(AGENT)), []);
    // The owner answers the same form.
    await answer(id, submitted(spec, KEY));
    const result = agentAnswer(client.answers.get(id));
    const path = join(root, "agent-api-keys", AGENT, "OPENAI_API_KEY");
    assert.deepEqual(result, { status: "saved", blockId: `block-${id}`, name: "OPENAI_API_KEY", path });
    return { result };
  });

  await step("the key is in a private file and nowhere the agent or a client reads", async () => {
    const path = join(root, "agent-api-keys", AGENT, "OPENAI_API_KEY");
    assert.equal(await readFile(path, "utf8"), KEY);
    const mode = (await stat(path)).mode & 0o777;
    const folderMode = (await stat(join(root, "agent-api-keys", AGENT))).mode & 0o777;
    if (process.platform !== "win32") {
      assert.equal(mode, 0o600);
      assert.equal(folderMode, 0o700);
    }
    for (const raw of client.answers.values()) assert.ok(!raw.includes(KEY), "the key is in a tool result");
    assert.ok(!JSON.stringify(events).includes(KEY), "the key is in an event");
    assert.ok(!JSON.stringify(snapshot).includes(KEY), "the key is in the stored conversation");
    const message = snapshot.messages.find((candidate) => candidate.uiBlock?.blockId === "block-1");
    assert.equal(message?.uiBlock?.state.status, "answered");
    return { mode: mode.toString(8), folderMode: folderMode.toString(8) };
  });

  await step("the saved key is masked in log text", () => {
    assert.ok(!redactText(`curl -H "Authorization: Bearer ${KEY}"`).includes(KEY));
  });

  await step("an admin replaces the key, and the pasted spaces are not saved", async () => {
    const { id, spec } = requestKey({ name: "OPENAI_API_KEY", title: "New OpenAI API key" }, "turn-2");
    await answer(id, submitted(spec, `  ${NEW_KEY}\t`), ADMIN);
    assert.equal(agentAnswer(client.answers.get(id)).status, "saved");
    assert.equal(await readFile(join(root, "agent-api-keys", AGENT, "OPENAI_API_KEY"), "utf8"), NEW_KEY);
  });

  await step("a skip saves nothing and returns no value", async () => {
    const skipped = requestKey({ name: "STRIPE_API_KEY", title: "Stripe key" }, "turn-3");
    await answer(skipped.id, {});
    assert.deepEqual(agentAnswer(client.answers.get(skipped.id)), {
      status: "skipped",
      blockId: `block-${skipped.id}`,
    });
    const names = (await Effect.runPromise(apiKeys.list(AGENT))).map((key) => key.name);
    assert.deepEqual(names, ["OPENAI_API_KEY"]);
  });

  await step("a member can skip, so the turn does not wait for an owner", async () => {
    const skipped = requestKey({ name: "STRIPE_API_KEY", title: "Stripe key" }, "turn-5");
    await answer(skipped.id, {}, MEMBER);
    assert.equal(agentAnswer(client.answers.get(skipped.id)).status, "skipped");
    const names = (await Effect.runPromise(apiKeys.list(AGENT))).map((key) => key.name);
    assert.deepEqual(names, ["OPENAI_API_KEY"]);
  });

  await step("an expired form saves nothing", async () => {
    const { id } = requestKey({ name: "GITHUB_TOKEN", title: "GitHub token" }, "turn-4");
    registry.cancelRequest(client, id);
    assert.equal(agentAnswer(client.answers.get(id)).status, "expired");
    const names = (await Effect.runPromise(apiKeys.list(AGENT))).map((key) => key.name);
    assert.deepEqual(names, ["OPENAI_API_KEY"]);
  });

  await step("a key saved before a restart is masked once OpenBot registers the saved keys", async () => {
    const earlier = "e2e-key-saved-before-restart-91d2";
    await mkdir(join(root, "agent-api-keys", "agent-2"), { recursive: true, mode: 0o700 });
    await writeFile(join(root, "agent-api-keys", "agent-2", "ANTHROPIC_API_KEY"), earlier, { mode: 0o600 });
    assert.ok(redactText(earlier).includes(earlier));
    await Effect.runPromise(new AgentApiKeys(join(root, "agent-api-keys")).registerSaved());
    assert.ok(!redactText(earlier).includes(earlier));
  });

  await step("remove deletes one key, and removeAgent deletes the agent's folder", async () => {
    assert.equal(await Effect.runPromise(apiKeys.remove(AGENT, "OPENAI_API_KEY")), true);
    assert.equal(await Effect.runPromise(apiKeys.remove(AGENT, "OPENAI_API_KEY")), false);
    assert.deepEqual(await Effect.runPromise(apiKeys.list(AGENT)), []);
    await Effect.runPromise(apiKeys.removeAgent("agent-2"));
    await assert.rejects(stat(join(root, "agent-api-keys", "agent-2")));
    await assert.rejects(Effect.runPromise(apiKeys.list("../agent-1")));
  });

  await step(
    "a Vault key reaches every agent as a file, the agent's own key wins, and a Vault change follows",
    async () => {
      const vault = new VaultService({
        store: new VaultStore(join(root, "openbot-vault-v1.json"), REVERSING_CIPHER),
        canPersist: () => true,
      });
      await Effect.runPromise(vault.load());
      const keys = new AgentApiKeys(join(root, "agent-api-keys"), () => vault.items.apiKeys());
      // As OpenBot wires it: each Vault change brings the written files in line.
      let synced: Promise<void> = Promise.resolve();
      vault.onChanged(() => {
        synced = Effect.runPromise(keys.syncVault());
      });
      const saveKey = async (id: string | null, name: string, key: string) => {
        await Effect.runPromise(vault.save({ kind: "apiKey", id, name, notes: "", key }));
        await synced;
        return vault.state().items.find((item) => item.kind === "apiKey" && item.name === name)?.id ?? "";
      };
      const githubId = await saveKey(null, "GITHUB_TOKEN", VAULT_KEY);
      await saveKey(null, "OPENAI_API_KEY", "e2e-vault-openai-key-31b0");
      await Effect.runPromise(keys.save("agent-3", "OPENAI_API_KEY", KEY));
      const vaultFolder = join(root, "agent-api-keys", ".vault");
      // A start registers the agents' own keys and writes no Vault key: only an agent's list does.
      await Effect.runPromise(keys.registerSaved());
      await assert.rejects(stat(vaultFolder));
      const listed = await Effect.runPromise(keys.list("agent-3"));
      assert.deepEqual(listed, [
        { name: "OPENAI_API_KEY", path: join(root, "agent-api-keys", "agent-3", "OPENAI_API_KEY") },
        { name: "GITHUB_TOKEN", path: join(vaultFolder, "GITHUB_TOKEN"), source: "vault" },
      ]);
      assert.equal(await readFile(join(vaultFolder, "GITHUB_TOKEN"), "utf8"), VAULT_KEY);
      if (process.platform !== "win32")
        assert.equal((await stat(join(vaultFolder, "GITHUB_TOKEN"))).mode & 0o777, 0o600);
      assert.ok(!JSON.stringify(listed).includes(VAULT_KEY), "the Vault key is in the list result");
      assert.ok(!redactText(`token ${VAULT_KEY}`).includes(VAULT_KEY), "the Vault key is not masked in logs");
      const forOther = await Effect.runPromise(keys.list(AGENT));
      assert.deepEqual(
        forOther.map((key) => [key.name, key.source]),
        [
          ["GITHUB_TOKEN", "vault"],
          ["OPENAI_API_KEY", "vault"],
        ],
      );
      // The Vault folder is not an agent: a restart registers the agents' keys and skips it.
      await Effect.runPromise(keys.registerSaved());
      await saveKey(githubId, "GITHUB_TOKEN", NEW_VAULT_KEY);
      assert.equal(await readFile(join(vaultFolder, "GITHUB_TOKEN"), "utf8"), NEW_VAULT_KEY);
      await Effect.runPromise(vault.delete(githubId));
      await synced;
      await assert.rejects(stat(join(vaultFolder, "GITHUB_TOKEN")));
      assert.equal(await readFile(join(vaultFolder, "OPENAI_API_KEY"), "utf8"), "e2e-vault-openai-key-31b0");
      // A Vault that cannot be read leaves no key file behind after the next sync.
      await writeFile(join(root, "openbot-vault-v1.json"), "not json");
      await Effect.runPromise(vault.load());
      await Effect.runPromise(keys.syncVault());
      await assert.rejects(stat(join(vaultFolder, "OPENAI_API_KEY")));
      assert.deepEqual(await Effect.runPromise(keys.list("agent-3")), [
        { name: "OPENAI_API_KEY", path: join(root, "agent-api-keys", "agent-3", "OPENAI_API_KEY") },
      ]);
    },
  );

  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed: true, steps }, null, 2)}\n`);
  process.stdout.write(`agent-api-keys-e2e: ${steps.length} steps passed\n`);
} catch (error) {
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed: false, steps }, null, 2)}\n`);
  throw error;
} finally {
  await rm(root, { recursive: true, force: true });
}
