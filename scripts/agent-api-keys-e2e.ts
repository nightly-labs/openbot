import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentEvent, ConversationSnapshot } from "@openbot/contracts/ipc";
import { type UiBlockSpec, uiBlockAnswersFromResponse } from "@openbot/contracts/ui-blocks";
import { redactText } from "@openbot/logging";
import { Effect } from "effect";
import { AttentionRegistry, type PromptResponder } from "../src/backend/agent/attention-registry";
import {
  API_KEY_FIELD_ID,
  API_KEY_SCOPE_AGENT,
  API_KEY_SCOPE_FIELD_ID,
  apiKeyFormSpec,
} from "../src/backend/agent/prompts";
import { AgentApiKeys } from "../src/backend/agent-api-keys";
import { CodexAppServerClient } from "../src/backend/app-server-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { requestApiKeyToolSchema } from "../src/backend/openbot-tools";
import type { RequestId } from "../src/backend/protocol";
import { decodeVaultSaveInput } from "../src/main/vault-inputs";
import { VaultService } from "../src/main/vault-service";
import { VaultStore } from "../src/main/vault-store";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-api-keys-e2e");
const AGENT = "agent-1";
const THREAD = "thread-1";
const KEY = "e2e-key-value-4be1c0d7";
const NEW_KEY = "e2e-key-replaced-77c1a0b2";
const VAULT_KEY = "e2e-vault-key-5d0e9a41";
const NEW_VAULT_KEY = "e2e-vault-key-changed-c3f8";
const REVERSING_CIPHER = {
  encrypt: (value: string) => Buffer.from(value, "utf8").reverse(),
  decrypt: (value: Buffer) => Buffer.from(value).reverse().toString("utf8"),
};
const MEMBER: PromptResponder = { sender: { id: "member-1", name: "Mia" }, privileged: false };
const ADMIN: PromptResponder = { sender: { id: "admin-1", name: "Ada" }, privileged: true };

class RecordingClient extends CodexAppServerClient {
  readonly answers = new Map<RequestId, string>();

  override get running(): boolean {
    return true;
  }

  override respond(id: RequestId, result: unknown): void {
    this.answers.set(id, JSON.stringify(result));
  }
}

interface AgentAnswer {
  status: string;
  blockId?: string;
  name?: string;
  path?: string;
  source?: string;
  next?: string;
}

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
const registryHost = {
  conversation: {
    agentForThread: (threadId: string) => (threadId === THREAD ? AGENT : undefined),
    publicThreadId: (_agentId: string, threadId: string) => threadId,
    ensureSnapshot: () => snapshot,
    emitConversation: () => {
      snapshot.revision += 1;
    },
  },
  browser: {
    listTabs: () => [],
    toolCanUseTab: () => false,
    beginTakeover: () => Effect.succeed(false),
    endTakeover: () => {},
  },
  hostedSites: { prepareApproval: () => Effect.succeed(null), resolveApproval: () => Effect.void },
  routines: { markNeedsAttention: () => {}, markRunningForTurn: () => {}, runsTurn: () => false },
  emit: (event: AgentEvent) => events.push(event),
  emitError: () => {},
  emitRuntimeSnapshot: () => {},
};
const registry = new AttentionRegistry({ ...registryHost, apiKeys });

async function vaultRegistry(name: string) {
  const vault = new VaultService({
    store: new VaultStore(join(root, `openbot-vault-${name}.json`), REVERSING_CIPHER),
    canPersist: () => true,
  });
  await Effect.runPromise(vault.load());
  const keys = new AgentApiKeys(join(root, `${name}-api-keys`), vault.items);
  const registry = new AttentionRegistry({
    ...registryHost,
    apiKeys: keys,
    vaultItems: vault.items,
    agentName: () => "Coder",
  });
  return { vault, keys, registry };
}

let nextRequest = 1;

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
function vaultRefusal(text: RegExp): (error: unknown) => boolean {
  return (error) => error instanceof Error && error.cause instanceof Error && text.test(error.cause.message);
}

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

  await step("a member saves the key", async () => {
    const { id, spec } = requestKey({ name: "OPENAI_API_KEY", title: "OpenAI API key" }, "turn-1");
    assert.deepEqual(await Effect.runPromise(apiKeys.list(AGENT)), []);
    await answer(id, submitted(spec, KEY), MEMBER);
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
    assert.equal(message?.uiBlock?.apiKey, undefined);
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
    "a Vault key reaches only the agents that can use it, an old agent key moves into the Vault, and a Vault change follows",
    async () => {
      const keyRoot = join(root, "agent-api-keys");
      const vaultFolder = join(keyRoot, ".vault");
      await mkdir(join(keyRoot, "agent-3"), { recursive: true, mode: 0o700 });
      await writeFile(join(keyRoot, "agent-3", "OPENAI_API_KEY"), `${KEY}\n`, { mode: 0o600 });
      await mkdir(vaultFolder, { recursive: true, mode: 0o700 });
      const handPlacedKey = join(vaultFolder, "GOOGLE_SA_E2E_JSON");
      await writeFile(handPlacedKey, "e2e-hand-placed-service-account");
      const vault = new VaultService({
        store: new VaultStore(join(root, "openbot-vault-v1.json"), REVERSING_CIPHER),
        canPersist: () => true,
      });
      await Effect.runPromise(vault.load());
      const keys = new AgentApiKeys(keyRoot, vault.items);
      let synced: Promise<void> = Promise.resolve();
      vault.onChanged(() => {
        synced = Effect.runPromise(keys.syncVault());
      });
      const saveKey = async (id: string | null, name: string, key: string, agents?: string[] | null) => {
        await Effect.runPromise(
          vault.save({ kind: "apiKey", id, name, notes: "", key, ...(agents === undefined ? {} : { agents }) }),
        );
        await synced;
        return (
          vault
            .state()
            .items.find(
              (item) =>
                item.kind === "apiKey" &&
                item.name === name &&
                (id === null ? JSON.stringify(item.agents) === JSON.stringify(agents ?? undefined) : item.id === id),
            )?.id ?? ""
        );
      };
      await Effect.runPromise(keys.registerSaved());
      await Effect.runPromise(keys.syncVault());
      const ownPath = join(keyRoot, "agent-3", "OPENAI_API_KEY");
      const links = process.platform !== "win32";
      if (links) {
        assert.ok((await lstat(ownPath)).isSymbolicLink(), "the old key file is not a link");
        assert.equal(await readFile(ownPath, "utf8"), KEY);
      } else assert.equal(await readFile(ownPath, "utf8"), KEY);
      assert.equal(await readFile(handPlacedKey, "utf8"), "e2e-hand-placed-service-account");
      const moved = vault.state().items.find((item) => item.kind === "apiKey" && item.name === "OPENAI_API_KEY");
      assert.deepEqual(moved?.agents, ["agent-3"]);
      assert.equal(vault.state().agentScope, true);
      const githubId = await saveKey(null, "GITHUB_TOKEN", VAULT_KEY);
      await saveKey(null, "OPENAI_API_KEY", "e2e-vault-openai-key-31b0");
      await assert.rejects(stat(join(vaultFolder, AGENT)));
      const listed = await Effect.runPromise(keys.list("agent-3"));
      assert.deepEqual(listed, [
        { name: "GITHUB_TOKEN", path: join(vaultFolder, "agent-3", "GITHUB_TOKEN"), source: "vault" },
        { name: "OPENAI_API_KEY", path: join(vaultFolder, "agent-3", "OPENAI_API_KEY") },
      ]);
      assert.equal(await readFile(join(vaultFolder, "agent-3", "OPENAI_API_KEY"), "utf8"), KEY);
      assert.equal(await readFile(join(vaultFolder, "agent-3", "GITHUB_TOKEN"), "utf8"), VAULT_KEY);
      assert.equal(await readFile(join(vaultFolder, "GITHUB_TOKEN"), "utf8"), VAULT_KEY);
      assert.equal(await readFile(join(vaultFolder, "OPENAI_API_KEY"), "utf8"), "e2e-vault-openai-key-31b0");
      await rm(join(vaultFolder, "GITHUB_TOKEN"));
      await Effect.runPromise(keys.syncVault());
      assert.equal(await readFile(join(vaultFolder, "GITHUB_TOKEN"), "utf8"), VAULT_KEY);
      const emptiedRoot = join(root, "emptied-api-keys");
      await mkdir(join(emptiedRoot, ".vault"), { recursive: true, mode: 0o700 });
      await Effect.runPromise(new AgentApiKeys(emptiedRoot, vault.items).syncVault());
      assert.equal(await readFile(join(emptiedRoot, ".vault", "GITHUB_TOKEN"), "utf8"), VAULT_KEY);
      const freshRoot = join(root, "fresh-api-keys");
      await Effect.runPromise(new AgentApiKeys(freshRoot, vault.items).syncVault());
      await assert.rejects(stat(join(freshRoot, ".vault")));
      if (links) {
        const ownId =
          vault
            .state()
            .items.find(
              (item) =>
                item.kind === "apiKey" &&
                item.name === "OPENAI_API_KEY" &&
                JSON.stringify(item.agents) === JSON.stringify(["agent-3"]),
            )?.id ?? null;
        await saveKey(ownId, "OPENAI_API_KEY", NEW_KEY, ["agent-3"]);
        assert.equal(await readFile(ownPath, "utf8"), NEW_KEY);
        await rm(ownPath);
        await rm(join(vaultFolder, "agent-3"), { recursive: true });
        const stoppedLink = `${ownPath}.0f8e6a52-3c1d-4b7e-9a20-5d6c7b8e9f10.tmp`;
        await symlink(join("..", ".vault", "agent-3", "OPENAI_API_KEY"), stoppedLink);
        await Effect.runPromise(keys.syncVault());
        assert.ok((await lstat(ownPath)).isSymbolicLink());
        assert.equal(await readFile(ownPath, "utf8"), NEW_KEY);
        await assert.rejects(lstat(stoppedLink));
        await writeFile(join(keyRoot, "agent-3", "notes.txt"), "e2e-agent-notes");
        await symlink("notes.txt", join(keyRoot, "agent-3", "LINEAR_API_KEY"));
        await Effect.runPromise(keys.save({ id: "agent-3", name: undefined }, "LINEAR_API_KEY", VAULT_KEY));
        await synced;
        assert.equal(await readFile(join(keyRoot, "agent-3", "LINEAR_API_KEY"), "utf8"), VAULT_KEY);
        assert.equal(await readFile(join(keyRoot, "agent-3", "notes.txt"), "utf8"), "e2e-agent-notes");
        assert.equal(await Effect.runPromise(keys.remove("agent-3", "LINEAR_API_KEY")), true);
        await synced;
        await assert.rejects(lstat(join(keyRoot, "agent-3", "LINEAR_API_KEY")));
        const deletedId = await saveKey(null, "SENTRY_TOKEN", VAULT_KEY, ["agent-3"]);
        await Effect.runPromise(keys.syncVault());
        assert.ok((await lstat(join(keyRoot, "agent-3", "SENTRY_TOKEN"))).isSymbolicLink());
        await Effect.runPromise(vault.delete(deletedId));
        await synced;
        await assert.rejects(lstat(join(keyRoot, "agent-3", "SENTRY_TOKEN")));
        const sharedId = await saveKey(null, "LINEAR_API_KEY", VAULT_KEY, ["agent-3"]);
        await Effect.runPromise(keys.syncVault());
        assert.ok((await lstat(join(keyRoot, "agent-3", "LINEAR_API_KEY"))).isSymbolicLink());
        await saveKey(sharedId, "LINEAR_API_KEY", VAULT_KEY, null);
        await assert.rejects(lstat(join(keyRoot, "agent-3", "LINEAR_API_KEY")));
        await Effect.runPromise(vault.delete(sharedId));
        await synced;
        await saveKey(ownId, "OPENAI_API_KEY", KEY, ["agent-3"]);
      }
      if (process.platform !== "win32") {
        assert.equal((await stat(join(vaultFolder, "GITHUB_TOKEN"))).mode & 0o777, 0o600);
        assert.equal((await stat(join(vaultFolder, "agent-3", "GITHUB_TOKEN"))).mode & 0o777, 0o600);
        assert.equal((await stat(join(vaultFolder, "agent-3"))).mode & 0o777, 0o700);
      }
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
      assert.equal(
        await readFile(join(vaultFolder, AGENT, "OPENAI_API_KEY"), "utf8"),
        "e2e-vault-openai-key-31b0",
        "another agent reads the key for this agent only",
      );
      const notionId = await saveKey(null, "NOTION_TOKEN", "e2e-notion-key-a91e", [AGENT]);
      assert.equal(await readFile(join(vaultFolder, AGENT, "NOTION_TOKEN"), "utf8"), "e2e-notion-key-a91e");
      assert.deepEqual(
        (await Effect.runPromise(keys.list("agent-3"))).map((key) => key.name),
        ["GITHUB_TOKEN", "OPENAI_API_KEY"],
      );
      await assert.rejects(stat(join(vaultFolder, "agent-3", "NOTION_TOKEN")));
      await assert.rejects(stat(join(vaultFolder, "NOTION_TOKEN")), "a key for a chosen agent is on the shared path");
      await assert.rejects(
        Effect.runPromise(
          vault.save({ kind: "apiKey", id: null, name: "NOTION_TOKEN", notes: "", key: "x", agents: [AGENT] }),
        ),
        vaultRefusal(/An agent that you chose has an API key with this variable name already/u),
      );
      await assert.rejects(
        Effect.runPromise(vault.save({ kind: "apiKey", id: null, name: "GITHUB_TOKEN", notes: "", key: "x" })),
        vaultRefusal(/The Vault has an API key with this variable name already/u),
      );
      await saveKey(notionId, "NOTION_TOKEN", "e2e-notion-key-a91e", ["agent-3"]);
      await assert.rejects(stat(join(vaultFolder, AGENT, "NOTION_TOKEN")));
      assert.equal(await readFile(join(vaultFolder, "agent-3", "NOTION_TOKEN"), "utf8"), "e2e-notion-key-a91e");
      const handPlaced = join(vaultFolder, AGENT, "AuthKey_E2E.p8");
      const handPlacedAgentKey = join(vaultFolder, AGENT, "APP_STORE_E2E_KEY");
      const stoppedWrite = join(vaultFolder, AGENT, "GITHUB_TOKEN.0f8e6a52-3c1d-4b7e-9a20-5d6c7b8e9f10.tmp");
      const stoppedRecord = join(vaultFolder, AGENT, ".openbot-keys.0f8e6a52-3c1d-4b7e-9a20-5d6c7b8e9f10.tmp");
      await writeFile(handPlaced, "e2e-hand-placed-private-key");
      await writeFile(handPlacedAgentKey, "e2e-hand-placed-agent-key");
      await mkdir(join(vaultFolder, AGENT, "notes"));
      await writeFile(stoppedWrite, "e2e-partial");
      await writeFile(stoppedRecord, "e2e-partial");
      await saveKey(githubId, "GITHUB_TOKEN", NEW_VAULT_KEY);
      assert.equal(await readFile(join(vaultFolder, AGENT, "GITHUB_TOKEN"), "utf8"), NEW_VAULT_KEY);
      assert.equal(await readFile(join(vaultFolder, "agent-3", "GITHUB_TOKEN"), "utf8"), NEW_VAULT_KEY);
      assert.equal(await readFile(join(vaultFolder, "GITHUB_TOKEN"), "utf8"), NEW_VAULT_KEY);
      await assert.rejects(stat(stoppedWrite));
      await assert.rejects(stat(stoppedRecord));
      await Effect.runPromise(vault.delete(githubId));
      await synced;
      await assert.rejects(stat(join(vaultFolder, "GITHUB_TOKEN")));
      await assert.rejects(stat(join(vaultFolder, AGENT, "GITHUB_TOKEN")));
      await assert.rejects(stat(join(vaultFolder, "agent-3", "GITHUB_TOKEN")));
      assert.equal(await Effect.runPromise(keys.remove("agent-3", "OPENAI_API_KEY")), true);
      await assert.rejects(lstat(ownPath));
      assert.equal(
        await readFile(join(vaultFolder, "agent-3", "OPENAI_API_KEY"), "utf8"),
        "e2e-vault-openai-key-31b0",
        "the key for every agent comes back after the agent's own key goes",
      );
      assert.equal(await Effect.runPromise(keys.remove("agent-3", "OPENAI_API_KEY")), false);
      await writeFile(join(root, "openbot-vault-v1.json"), "not json");
      await Effect.runPromise(vault.load());
      await Effect.runPromise(keys.syncVault());
      await assert.rejects(stat(join(vaultFolder, AGENT, "OPENAI_API_KEY")));
      await assert.rejects(stat(join(vaultFolder, "OPENAI_API_KEY")));
      await assert.rejects(stat(join(vaultFolder, "agent-3", "NOTION_TOKEN")));
      assert.equal(await readFile(handPlaced, "utf8"), "e2e-hand-placed-private-key");
      assert.equal(await readFile(handPlacedAgentKey, "utf8"), "e2e-hand-placed-agent-key");
      assert.equal(await readFile(handPlacedKey, "utf8"), "e2e-hand-placed-service-account");
      assert.ok((await stat(join(vaultFolder, AGENT, "notes"))).isDirectory());
      assert.deepEqual(await Effect.runPromise(keys.list("agent-3")), []);
      const plain = await Effect.runPromise(keys.save({ id: "agent-3", name: undefined }, "PLAIN_TOKEN", KEY));
      assert.deepEqual(plain, { name: "PLAIN_TOKEN", path: join(keyRoot, "agent-3", "PLAIN_TOKEN") });
      await Effect.runPromise(keys.removeAgent("agent-3"));
      await assert.rejects(stat(join(keyRoot, "agent-3")));
      await assert.rejects(stat(join(vaultFolder, "agent-3")));
    },
  );

  await step("where the system refuses a link, a copy of the Vault key stays at the old path (#10240)", async () => {
    const keyRoot = join(root, "copied-api-keys");
    const folder = join(keyRoot, "agent-5");
    const oldPath = join(folder, "OPENAI_API_KEY");
    await mkdir(folder, { recursive: true, mode: 0o700 });
    await writeFile(oldPath, `${KEY}\n`, { mode: 0o600 });
    const vault = new VaultService({
      store: new VaultStore(join(root, "openbot-vault-copied.json"), REVERSING_CIPHER),
      canPersist: () => true,
    });
    await Effect.runPromise(vault.load());
    const refuseLink = () =>
      Promise.reject(Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" }));
    const keys = new AgentApiKeys(keyRoot, vault.items, refuseLink);
    let synced: Promise<void> = Promise.resolve();
    vault.onChanged(() => {
      synced = Effect.runPromise(keys.syncVault());
    });
    const ownKey = () => vault.state().items.find((item) => item.kind === "apiKey" && item.name === "OPENAI_API_KEY");
    await Effect.runPromise(keys.syncVault());
    await synced;
    assert.deepEqual(ownKey()?.agents, ["agent-5"]);
    assert.ok((await lstat(oldPath)).isFile());
    assert.equal(await readFile(oldPath, "utf8"), KEY);
    const listed = await Effect.runPromise(keys.list("agent-5"));
    assert.deepEqual(listed, [{ name: "OPENAI_API_KEY", path: join(keyRoot, ".vault", "agent-5", "OPENAI_API_KEY") }]);
    await Effect.runPromise(
      vault.save({
        kind: "apiKey",
        id: ownKey()?.id ?? null,
        name: "OPENAI_API_KEY",
        notes: "",
        key: NEW_KEY,
        agents: ["agent-5"],
      }),
    );
    await synced;
    assert.equal(await readFile(oldPath, "utf8"), NEW_KEY);
    await Effect.runPromise(keys.syncVault());
    assert.equal(vault.items.apiKeys("agent-5").find((key) => key.name === "OPENAI_API_KEY")?.value, NEW_KEY);
    await rm(oldPath);
    await rm(join(folder, ".openbot-keys"));
    const stoppedCopy = `${oldPath}.0f8e6a52-3c1d-4b7e-9a20-5d6c7b8e9f10.tmp`;
    await writeFile(stoppedCopy, "e2e-partial");
    await Effect.runPromise(keys.syncVault());
    assert.equal(await readFile(oldPath, "utf8"), NEW_KEY);
    await assert.rejects(stat(stoppedCopy));
    if (process.platform !== "win32") assert.equal((await stat(oldPath)).mode & 0o777, 0o600);
    await writeFile(join(folder, "notes.txt"), "e2e-agent-notes");
    await Effect.runPromise(keys.save({ id: "agent-5", name: undefined }, "LINEAR_API_KEY", VAULT_KEY));
    await synced;
    assert.equal(await readFile(join(folder, "LINEAR_API_KEY"), "utf8"), VAULT_KEY);
    await Effect.runPromise(keys.save({ id: "agent-5", name: undefined }, "LINEAR_API_KEY", NEW_VAULT_KEY));
    await synced;
    assert.equal(await readFile(join(folder, "LINEAR_API_KEY"), "utf8"), NEW_VAULT_KEY);
    assert.equal(await Effect.runPromise(keys.remove("agent-5", "LINEAR_API_KEY")), true);
    await synced;
    await assert.rejects(stat(join(folder, "LINEAR_API_KEY")));
    await Effect.runPromise(
      vault.save({ kind: "apiKey", id: null, name: "SENTRY_TOKEN", notes: "", key: VAULT_KEY, agents: ["agent-5"] }),
    );
    await synced;
    assert.equal(await readFile(join(folder, "SENTRY_TOKEN"), "utf8"), VAULT_KEY);
    const sentry = vault.state().items.find((item) => item.kind === "apiKey" && item.name === "SENTRY_TOKEN");
    await Effect.runPromise(
      vault.save({
        kind: "apiKey",
        id: sentry?.id ?? null,
        name: "SENTRY_TOKEN",
        notes: "",
        key: VAULT_KEY,
        agents: null,
      }),
    );
    await synced;
    await assert.rejects(stat(join(folder, "SENTRY_TOKEN")));
    await writeFile(join(root, "openbot-vault-copied.json"), "not json");
    await Effect.runPromise(vault.load());
    await Effect.runPromise(keys.syncVault());
    await assert.rejects(stat(oldPath));
    const plain = await Effect.runPromise(keys.save({ id: "agent-5", name: undefined }, "OPENAI_API_KEY", KEY));
    assert.deepEqual(plain, { name: "OPENAI_API_KEY", path: oldPath });
    await Effect.runPromise(keys.syncVault());
    assert.deepEqual(await Effect.runPromise(keys.list("agent-5")), [{ name: "OPENAI_API_KEY", path: oldPath }]);
    assert.equal(await readFile(join(folder, "notes.txt"), "utf8"), "e2e-agent-notes");
  });

  await step("logins, cards and contacts for chosen agents reach only those agents", async () => {
    const path = join(root, "openbot-vault-scope.json");
    const open = async () => {
      const vault = new VaultService({ store: new VaultStore(path, REVERSING_CIPHER), canPersist: () => true });
      await Effect.runPromise(vault.load());
      return vault;
    };
    const vault = await open();
    const site = "https://example.com";
    const save = (input: Parameters<VaultService["save"]>[0]) => Effect.runPromise(vault.save(input));
    await save({
      kind: "login",
      id: null,
      website: site,
      username: "shared@example.com",
      password: "e2e-shared-password",
      notes: "",
    });
    await save({
      kind: "login",
      id: null,
      website: site,
      username: "chosen@example.com",
      password: "e2e-chosen-password",
      notes: "",
      agents: ["agent-3"],
    });
    await save({
      kind: "contact",
      id: null,
      label: "Home",
      fullName: "Ada Example",
      address: "",
      address2: "",
      city: "",
      region: "",
      postalCode: "",
      country: "",
      phone: "",
      email: "",
      agents: ["agent-3"],
    });
    await save({
      kind: "card",
      id: null,
      label: "Work",
      nameOnCard: "Ada Example",
      number: "4242424242424242",
      securityCode: "123",
      expMonth: 12,
      expYear: 2030,
      billingContactId: null,
      agents: ["agent-3"],
    });
    assert.throws(
      () =>
        decodeVaultSaveInput({
          kind: "contact",
          id: null,
          label: "x",
          fullName: "x",
          address: "",
          address2: "",
          city: "",
          region: "",
          postalCode: "",
          country: "",
          phone: "",
          email: "",
          agents: [],
        }),
      /Choose at least one agent/u,
    );
    const usernames = async (agentId?: string) =>
      ((await Effect.runPromise(vault.logins.loginsFor(site, agentId))) ?? []).map((login) => login.username);
    assert.deepEqual(await usernames(AGENT), ["shared@example.com"]);
    assert.deepEqual((await usernames("agent-3")).sort(), ["chosen@example.com", "shared@example.com"]);
    assert.deepEqual(await usernames(), ["shared@example.com"]);
    const chosen = vault.state().items.find((item) => item.kind === "login" && item.username === "chosen@example.com");
    assert.ok(chosen);
    assert.deepEqual(chosen.agents, ["agent-3"]);
    assert.equal(await Effect.runPromise(vault.logins.secretFor(chosen.id, site, "password", AGENT)), null);
    assert.equal(
      await Effect.runPromise(vault.logins.secretFor(chosen.id, site, "password", "agent-3")),
      "e2e-chosen-password",
    );
    const other = vault.items.listForAgent(AGENT);
    assert.deepEqual([other.logins.length, other.cards.length, other.contacts.length], [1, 0, 0]);
    const own = vault.items.listForAgent("agent-3");
    assert.deepEqual([own.logins.length, own.cards.length, own.contacts.length], [2, 1, 1]);
    assert.equal(vault.items.hasCards(AGENT), false);
    assert.equal(vault.items.hasContacts(AGENT), false);
    assert.equal(vault.items.hasCards("agent-3"), true);
    const cardId = own.cards[0]?.id ?? "";
    assert.equal(vault.items.cardSecret(cardId, AGENT), null);
    assert.equal(vault.items.cardSecret(cardId, "agent-3")?.number, "4242424242424242");
    assert.equal(await Effect.runPromise(vault.items.delete(chosen.id, AGENT)), null);
    await assert.rejects(
      Effect.runPromise(
        vault.items.save({ kind: "login", id: chosen.id, password: "e2e-x" }, { id: AGENT, name: "Coder" }),
      ),
    );
    const typed = await Effect.runPromise(
      vault.items.saveLogin(
        { origin: site, username: "chosen@example.com", password: "e2e-typed-password" },
        { id: AGENT, name: "Coder" },
      ),
    );
    assert.equal(typed.created, true);
    assert.deepEqual(vault.state().items.find((item) => item.id === typed.id)?.agents, [AGENT]);
    assert.deepEqual(await usernames("agent-4"), ["shared@example.com"]);
    assert.ok(await Effect.runPromise(vault.items.delete(typed.id, AGENT)));
    const added = await Effect.runPromise(
      vault.items.save(
        { kind: "contact", fields: { label: "Office", fullName: "Office desk" } },
        { id: "agent-3", name: "Coder" },
      ),
    );
    assert.equal(vault.state().items.find((item) => item.id === added.id)?.agents, undefined);
    await save({
      kind: "login",
      id: chosen.id,
      website: site,
      username: "chosen@example.com",
      password: null,
      notes: "n",
    });
    assert.deepEqual(vault.state().items.find((item) => item.id === chosen.id)?.agents, ["agent-3"]);
    const restarted = await open();
    assert.deepEqual(restarted.state().items.find((item) => item.id === chosen.id)?.agents, ["agent-3"]);
    await Effect.runPromise(
      restarted.save({
        kind: "login",
        id: chosen.id,
        website: site,
        username: "chosen@example.com",
        password: null,
        notes: "n",
        agents: null,
      }),
    );
    assert.equal(restarted.state().items.find((item) => item.id === chosen.id)?.agents, undefined);
    assert.deepEqual(
      ((await Effect.runPromise(restarted.logins.loginsFor(site, AGENT))) ?? []).map((login) => login.username).sort(),
      ["chosen@example.com", "shared@example.com"],
    );
  });

  await step("a new password for another subdomain adds a login and keeps the saved one", async () => {
    const vault = new VaultService({
      store: new VaultStore(join(root, "openbot-vault-subdomains.json"), REVERSING_CIPHER),
      canPersist: () => true,
    });
    await Effect.runPromise(vault.load());
    const coder = { id: AGENT, name: "Coder" };
    const userLogin = async (website: string, username: string, password: string) => {
      const state = await Effect.runPromise(
        vault.save({ kind: "login", id: null, website, username, password, notes: "" }),
      );
      const saved = state.items.find((item) => item.kind === "login" && item.website === website);
      assert.ok(saved);
      return saved;
    };
    const typeLogin = (origin: string, username: string, password: string) =>
      Effect.runPromise(vault.items.saveLogin({ origin, username, password }, coder));
    const password = (id: string, origin: string) =>
      Effect.runPromise(vault.logins.secretFor(id, origin, "password", AGENT));
    const status = await userLogin("status.example.com", "blake", "e2e-status-password");

    const billing = await typeLogin("https://billing.example.com", "blake", "e2e-billing-password");
    assert.deepEqual([billing.created, billing.changed, billing.name], [true, true, "billing.example.com"]);
    assert.notEqual(billing.id, status.id);
    assert.equal(await password(status.id, "https://status.example.com"), "e2e-status-password");
    assert.equal(await password(billing.id, "https://billing.example.com"), "e2e-billing-password");

    const shop = await typeLogin("https://shop.example.com", "blake", "e2e-status-password");
    assert.deepEqual([shop.id, shop.created, shop.changed], [status.id, false, false]);

    const changed = await typeLogin("https://status.example.com", "blake", "e2e-status-new-password");
    assert.deepEqual([changed.id, changed.created, changed.changed], [status.id, false, true]);
    assert.equal(await password(status.id, "https://status.example.com"), "e2e-status-new-password");
    assert.equal(await password(billing.id, "https://billing.example.com"), "e2e-billing-password");

    const kept = await Effect.runPromise(
      vault.save({
        kind: "login",
        id: null,
        website: "admin.example.com",
        username: "blake",
        password: "e2e-admin-password",
        notes: "",
        agents: ["agent-3"],
      }),
    );
    const keptId = kept.items.find((item) => item.kind === "login" && item.website === "admin.example.com")?.id;
    const admin = await typeLogin("https://admin.example.com", "blake", "e2e-admin-agent-password");
    assert.deepEqual([admin.created, admin.changed], [true, true]);
    assert.notEqual(admin.id, keptId);
    assert.deepEqual(vault.state().items.find((item) => item.id === admin.id)?.agents, [AGENT]);
    assert.equal(await password(status.id, "https://status.example.com"), "e2e-status-new-password");
    assert.ok(await Effect.runPromise(vault.items.delete(admin.id, AGENT)));
    assert.ok(keptId && (await Effect.runPromise(vault.delete(keptId))));

    const apex = await userLogin("example.com", "ada", "e2e-apex-password");
    const www = await typeLogin("https://www.example.com", "ada", "e2e-www-password");
    assert.deepEqual([www.id, www.created, www.changed], [apex.id, false, true]);
    assert.equal(vault.state().items.filter((item) => item.kind === "login").length, 3);
  });

  await step(
    "with a Vault, the form saves the key there for every agent and deletes the asking agent's own copy",
    async () => {
      const { vault, keys, registry: formRegistry } = await vaultRegistry("form");
      const formClient = new RecordingClient("/nonexistent/codex");
      const ask = (name: string, turnId: string) => {
        const spec = apiKeyFormSpec({ name, title: `${name} for the deploy`, vault: true });
        assert.ok(spec?.type === "form", "the router would refuse this form");
        const id = nextRequest++;
        formRegistry.surfaceUiBlock(
          formClient,
          { id, method: "item/tool/call", params: { threadId: THREAD, turnId } },
          { blockId: `block-${id}`, spec, apiKey: { name, vault: true } },
        );
        return { id, spec };
      };
      const respond = (requestId: number, answers: Record<string, string[]>, responder?: PromptResponder) =>
        runCauseEffect(formRegistry.respondToPrompt({ requestId, answers }, responder));

      const scope = ask("DEPLOY_TOKEN", "turn-vault-0").spec;
      assert.ok(scope.type === "form");
      const scopeField = scope.fields?.find((field) => field.id === API_KEY_SCOPE_FIELD_ID);
      assert.ok(scopeField && scopeField.kind === "segmented");
      assert.deepEqual(scopeField.options, ["All agents (Vault)", API_KEY_SCOPE_AGENT]);
      assert.equal(scopeField.value, "All agents (Vault)");
      formRegistry.cancelRequest(formClient, nextRequest - 1);

      await Effect.runPromise(keys.save({ id: AGENT, name: "Coder" }, "DEPLOY_TOKEN", KEY));
      assert.deepEqual(vault.items.apiKeys(AGENT), [{ name: "DEPLOY_TOKEN", value: KEY, own: true }]);
      const { id, spec } = ask("DEPLOY_TOKEN", "turn-vault-1");
      const values = { [API_KEY_FIELD_ID]: ` ${VAULT_KEY}\n`, [API_KEY_SCOPE_FIELD_ID]: "All agents (Vault)" };
      const answers = uiBlockAnswersFromResponse(spec, { actionId: "submit", values });
      await respond(id, answers, MEMBER);
      const vaultPath = join(root, "form-api-keys", ".vault", AGENT, "DEPLOY_TOKEN");
      const result = agentAnswer(formClient.answers.get(id));
      assert.deepEqual(result, {
        status: "saved",
        blockId: `block-${id}`,
        name: "DEPLOY_TOKEN",
        path: vaultPath,
        source: "vault",
      });
      assert.deepEqual(vault.items.apiKeys(AGENT), [{ name: "DEPLOY_TOKEN", value: VAULT_KEY, own: false }]);
      assert.equal(vault.state().items.filter((item) => item.kind === "apiKey").length, 1);
      assert.equal(await readFile(vaultPath, "utf8"), VAULT_KEY);
      const otherAgent = await Effect.runPromise(keys.list("agent-4"));
      const otherPath = join(root, "form-api-keys", ".vault", "agent-4", "DEPLOY_TOKEN");
      assert.deepEqual(otherAgent, [{ name: "DEPLOY_TOKEN", path: otherPath, source: "vault" }]);
      const added = vault.state().items.find((item) => item.kind === "apiKey" && item.name === "DEPLOY_TOKEN");
      assert.equal(added?.addedBy, "Coder");
      const message = snapshot.messages.find((candidate) => candidate.uiBlock?.blockId === `block-${id}`);
      assert.equal(message?.uiBlock?.state.status, "answered");
      assert.equal(message?.uiBlock?.state.outcome, "Saved to Vault: DEPLOY_TOKEN");
      assert.equal(message?.uiBlock?.apiKey, true);
      for (const raw of formClient.answers.values()) assert.ok(!raw.includes(VAULT_KEY), "the key is in a result");
      assert.ok(!JSON.stringify(events).includes(VAULT_KEY), "the key is in an event");
      assert.ok(!JSON.stringify(snapshot).includes(VAULT_KEY), "the key is in the stored conversation");

      return { result };
    },
  );

  await step("with a Vault, Only this agent saves the key in the Vault for this agent only", async () => {
    const { vault, keys, registry: privateRegistry } = await vaultRegistry("private");
    const spec = apiKeyFormSpec({ name: "PRIVATE_TOKEN", title: "Private token", vault: true });
    assert.ok(spec);
    const id = nextRequest++;
    privateRegistry.surfaceUiBlock(
      client,
      { id, method: "item/tool/call", params: { threadId: THREAD, turnId: "turn-private" } },
      { blockId: `block-${id}`, spec, apiKey: { name: "PRIVATE_TOKEN", vault: true } },
    );
    const values = { [API_KEY_FIELD_ID]: KEY, [API_KEY_SCOPE_FIELD_ID]: API_KEY_SCOPE_AGENT };
    await runCauseEffect(
      privateRegistry.respondToPrompt({
        requestId: id,
        answers: uiBlockAnswersFromResponse(spec, { actionId: "submit", values }),
      }),
    );
    const path = join(root, "private-api-keys", ".vault", AGENT, "PRIVATE_TOKEN");
    assert.deepEqual(agentAnswer(client.answers.get(id)), {
      status: "saved",
      blockId: `block-${id}`,
      name: "PRIVATE_TOKEN",
      path,
    });
    assert.equal(await readFile(path, "utf8"), KEY);
    await assert.rejects(stat(join(root, "private-api-keys", AGENT)));
    assert.deepEqual(vault.items.apiKeys(AGENT), [{ name: "PRIVATE_TOKEN", value: KEY, own: true }]);
    const saved = vault.state().items.find((item) => item.kind === "apiKey" && item.name === "PRIVATE_TOKEN");
    assert.deepEqual(saved?.agents, [AGENT]);
    assert.equal(saved?.addedBy, "Coder");
    assert.deepEqual(vault.items.apiKeys("agent-4"), []);
    assert.deepEqual(await Effect.runPromise(keys.list("agent-4")), []);
    await assert.rejects(stat(join(root, "private-api-keys", ".vault", "agent-4", "PRIVATE_TOKEN")));
  });

  await step("a typed key that the form cannot read keeps the form open, and saves nothing", async () => {
    const { keys, registry: unreadRegistry } = await vaultRegistry("unread");
    const spec = apiKeyFormSpec({ name: "UNREAD_TOKEN", title: "Unread token", vault: true });
    assert.ok(spec);
    const id = nextRequest++;
    unreadRegistry.surfaceUiBlock(
      client,
      { id, method: "item/tool/call", params: { threadId: THREAD, turnId: "turn-unread" } },
      { blockId: `block-${id}`, spec, apiKey: { name: "UNREAD_TOKEN", vault: true } },
    );
    const respond = (answers: Record<string, string[]>, responder?: PromptResponder) =>
      runCauseEffect(unreadRegistry.respondToPrompt({ requestId: id, answers }, responder));
    const unreadable = /OpenBot could not read the API key/;
    await assert.rejects(
      respond({ [API_KEY_FIELD_ID]: [KEY], [API_KEY_SCOPE_FIELD_ID]: ["Todos os agentes"] }, MEMBER),
      unreadable,
    );
    await assert.rejects(
      respond({ [API_KEY_FIELD_ID]: [KEY], [API_KEY_SCOPE_FIELD_ID]: ["Todos os agentes"] }),
      unreadable,
    );
    await assert.rejects(
      respond({ [API_KEY_FIELD_ID]: ["k".repeat(8_001)], [API_KEY_SCOPE_FIELD_ID]: ["All agents (Vault)"] }),
      unreadable,
    );
    assert.equal(client.answers.has(id), false, "the agent got an answer for a refused form");
    assert.deepEqual(await Effect.runPromise(keys.list(AGENT)), []);
    const message = snapshot.messages.find((candidate) => candidate.uiBlock?.blockId === `block-${id}`);
    assert.equal(message?.uiBlock?.state.status, "pending");
    await respond({ [API_KEY_FIELD_ID]: [KEY], [API_KEY_SCOPE_FIELD_ID]: ["All agents (Vault)"] });
    assert.equal(agentAnswer(client.answers.get(id)).status, "saved");
    assert.deepEqual(
      (await Effect.runPromise(keys.list(AGENT))).map((key) => key.name),
      ["UNREAD_TOKEN"],
    );
  });

  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed: true, steps }, null, 2)}\n`);
  process.stdout.write(`agent-api-keys-e2e: ${steps.length} steps passed\n`);
} catch (error) {
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed: false, steps }, null, 2)}\n`);
  throw error;
} finally {
  await rm(root, { recursive: true, force: true });
}
