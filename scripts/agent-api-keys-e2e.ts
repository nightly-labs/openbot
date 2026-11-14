// Runs `request_api_key` end to end on the real modules: the real `AttentionRegistry` shows the form
// that the router builds, the owner, a member and an admin answer it, and the real `AgentApiKeys` saves
// the key in a temporary folder. It checks that the value reaches the file and the log redaction, and
// no tool result, event or stored message. It also saves API keys in the real Vault and checks that
// `list` writes to each agent's files only the keys that the agent can use, that a Vault change
// rewrites or removes the files, and that a key file of one agent from a build before agent scope moves
// into the Vault. The keys for every agent also stay at the shared path of earlier versions,
// `.vault/<NAME>`, and come back there at start after 0.70.0 deleted them (#8983). The key file of one
// agent from such a build becomes a link to its Vault copy, and comes back at start after 0.70.0
// deleted it (#9313). With a Vault, the form saves the key there for every agent by default, and "Only this
// agent" saves it there for the agent only. Logins, cards and contacts for chosen agents are hidden
// from the other agents. A login that an agent saves for one subdomain never changes the password of a
// login for another subdomain.
// No provider or account is used.
// `bun scripts/agent-api-keys-e2e.ts`. Writes .openbot-build/agent-api-keys-e2e/report.json.
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
  source?: string;
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
/** The registry options that do not change between the stores. */
const registryHost = {
  conversation: {
    agentForThread: (threadId: string) => (threadId === THREAD ? AGENT : undefined),
    publicThreadId: (_agentId: string, threadId: string) => threadId,
    ensureSnapshot: () => snapshot,
    emitConversation: () => {
      snapshot.revision += 1;
    },
  },
  browser: { listTabs: () => [], beginTakeover: () => Effect.void, endTakeover: () => {} },
  hostedSites: { prepareApproval: () => Effect.succeed(null), resolveApproval: () => Effect.void },
  routines: { markNeedsAttention: () => {}, markRunningForTurn: () => {} },
  emit: (event: AgentEvent) => events.push(event),
  emitError: () => {},
  emitRuntimeSnapshot: () => {},
};
const registry = new AttentionRegistry({ ...registryHost, apiKeys });

/** A registry with its own key folder and a real Vault, as OpenBot wires them when the Vault is ready. */
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
/** A Vault refusal carries the text that the user reads in its cause. */
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
    // With no Vault the form has no scope choice, so the app draws no small select.
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
      // A build before agent scope: an agent's own key as a plain file, and a Vault key for every agent
      // directly in the Vault folder.
      await mkdir(join(keyRoot, "agent-3"), { recursive: true, mode: 0o700 });
      await writeFile(join(keyRoot, "agent-3", "OPENAI_API_KEY"), `${KEY}\n`, { mode: 0o600 });
      await mkdir(vaultFolder, { recursive: true, mode: 0o700 });
      await writeFile(join(vaultFolder, "OLD_SHARED_TOKEN"), "e2e-old-shared-0a1b");
      const vault = new VaultService({
        store: new VaultStore(join(root, "openbot-vault-v1.json"), REVERSING_CIPHER),
        canPersist: () => true,
      });
      await Effect.runPromise(vault.load());
      const keys = new AgentApiKeys(keyRoot, vault.items);
      // As OpenBot wires it: each Vault change brings the written files in line.
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
      // The start: the old agent key moves into the Vault, and the old shared file goes.
      await Effect.runPromise(keys.registerSaved());
      await Effect.runPromise(keys.syncVault());
      // Scripts of 0.69 and earlier read the agent's own key at its old path: a link to the Vault copy
      // takes the place of the file (#9313). Windows can refuse the link; then the file is deleted.
      const ownPath = join(keyRoot, "agent-3", "OPENAI_API_KEY");
      const links = process.platform !== "win32";
      if (links) {
        assert.ok((await lstat(ownPath)).isSymbolicLink(), "the old key file is not a link");
        assert.equal(await readFile(ownPath, "utf8"), KEY);
      } else await assert.rejects(stat(ownPath));
      await assert.rejects(stat(join(vaultFolder, "OLD_SHARED_TOKEN")));
      const moved = vault.state().items.find((item) => item.kind === "apiKey" && item.name === "OPENAI_API_KEY");
      assert.deepEqual(moved?.agents, ["agent-3"]);
      assert.equal(vault.state().agentScope, true);
      const githubId = await saveKey(null, "GITHUB_TOKEN", VAULT_KEY);
      await saveKey(null, "OPENAI_API_KEY", "e2e-vault-openai-key-31b0");
      // A start writes the Vault keys only of an agent with a key for it only in a folder of 0.69 and
      // earlier. Other agents get them when they list their keys.
      await assert.rejects(stat(join(vaultFolder, AGENT)));
      const listed = await Effect.runPromise(keys.list("agent-3"));
      assert.deepEqual(listed, [
        { name: "GITHUB_TOKEN", path: join(vaultFolder, "agent-3", "GITHUB_TOKEN"), source: "vault" },
        { name: "OPENAI_API_KEY", path: join(vaultFolder, "agent-3", "OPENAI_API_KEY") },
      ]);
      // The key for this agent only wins over the key for every agent of its name.
      assert.equal(await readFile(join(vaultFolder, "agent-3", "OPENAI_API_KEY"), "utf8"), KEY);
      assert.equal(await readFile(join(vaultFolder, "agent-3", "GITHUB_TOKEN"), "utf8"), VAULT_KEY);
      // Scripts read the shared path of earlier versions: it has the keys for every agent (#8983).
      assert.equal(await readFile(join(vaultFolder, "GITHUB_TOKEN"), "utf8"), VAULT_KEY);
      assert.equal(await readFile(join(vaultFolder, "OPENAI_API_KEY"), "utf8"), "e2e-vault-openai-key-31b0");
      // 0.70.0 deleted the shared files at start; the next start writes them again.
      await rm(join(vaultFolder, "GITHUB_TOKEN"));
      await Effect.runPromise(keys.syncVault());
      assert.equal(await readFile(join(vaultFolder, "GITHUB_TOKEN"), "utf8"), VAULT_KEY);
      // Also when no agent listed its keys after 0.70.0: the empty folder shows an earlier list.
      const emptiedRoot = join(root, "emptied-api-keys");
      await mkdir(join(emptiedRoot, ".vault"), { recursive: true, mode: 0o700 });
      await Effect.runPromise(new AgentApiKeys(emptiedRoot, vault.items).syncVault());
      assert.equal(await readFile(join(emptiedRoot, ".vault", "GITHUB_TOKEN"), "utf8"), VAULT_KEY);
      // A start writes no key when no agent ever listed its keys.
      const freshRoot = join(root, "fresh-api-keys");
      await Effect.runPromise(new AgentApiKeys(freshRoot, vault.items).syncVault());
      await assert.rejects(stat(join(freshRoot, ".vault")));
      if (links) {
        // A change in the Vault reaches the old path through the link.
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
        // 0.70.0 deleted the file with no link, and wrote no Vault copy until the agent listed its keys.
        // The next start writes both again.
        await rm(ownPath);
        await rm(join(vaultFolder, "agent-3"), { recursive: true });
        // The temporary link of a replace that stopped before its rename goes too.
        const stoppedLink = `${ownPath}.0f8e6a52-3c1d-4b7e-9a20-5d6c7b8e9f10.tmp`;
        await symlink(join("..", ".vault", "agent-3", "OPENAI_API_KEY"), stoppedLink);
        await Effect.runPromise(keys.syncVault());
        assert.ok((await lstat(ownPath)).isSymbolicLink());
        assert.equal(await readFile(ownPath, "utf8"), NEW_KEY);
        await assert.rejects(lstat(stoppedLink));
        // A key that the agent saves for itself gets a link too, also in place of a link that the user
        // made, and a plain file of the agent stays.
        await writeFile(join(keyRoot, "agent-3", "notes.txt"), "e2e-agent-notes");
        await symlink("notes.txt", join(keyRoot, "agent-3", "LINEAR_API_KEY"));
        await Effect.runPromise(keys.save({ id: "agent-3", name: undefined }, "LINEAR_API_KEY", VAULT_KEY));
        await synced;
        assert.equal(await readFile(join(keyRoot, "agent-3", "LINEAR_API_KEY"), "utf8"), VAULT_KEY);
        assert.equal(await readFile(join(keyRoot, "agent-3", "notes.txt"), "utf8"), "e2e-agent-notes");
        // An agent that removes its own key removes its link.
        assert.equal(await Effect.runPromise(keys.remove("agent-3", "LINEAR_API_KEY")), true);
        await synced;
        await assert.rejects(lstat(join(keyRoot, "agent-3", "LINEAR_API_KEY")));
        // A key that the user deletes in the Vault, or gives to every agent, leaves no link.
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
      // A key for a chosen agent reaches only that agent.
      const notionId = await saveKey(null, "NOTION_TOKEN", "e2e-notion-key-a91e", [AGENT]);
      assert.equal(await readFile(join(vaultFolder, AGENT, "NOTION_TOKEN"), "utf8"), "e2e-notion-key-a91e");
      assert.deepEqual(
        (await Effect.runPromise(keys.list("agent-3"))).map((key) => key.name),
        ["GITHUB_TOKEN", "OPENAI_API_KEY"],
      );
      await assert.rejects(stat(join(vaultFolder, "agent-3", "NOTION_TOKEN")));
      await assert.rejects(stat(join(vaultFolder, "NOTION_TOKEN")), "a key for a chosen agent is on the shared path");
      // One agent reads one key of a name: a second key of the name for a shared agent is refused.
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
      // The user gives the key to the other agent: the first agent's file goes.
      await saveKey(notionId, "NOTION_TOKEN", "e2e-notion-key-a91e", ["agent-3"]);
      await assert.rejects(stat(join(vaultFolder, AGENT, "NOTION_TOKEN")));
      assert.equal(await readFile(join(vaultFolder, "agent-3", "NOTION_TOKEN"), "utf8"), "e2e-notion-key-a91e");
      // A file that an agent put here, such as a key that cannot be downloaded again, survives each
      // Vault change (#7136). The temporary file of a stopped write does not.
      const handPlaced = join(vaultFolder, AGENT, "AuthKey_E2E.p8");
      const stoppedWrite = join(vaultFolder, AGENT, "GITHUB_TOKEN.0f8e6a52-3c1d-4b7e-9a20-5d6c7b8e9f10.tmp");
      await writeFile(handPlaced, "e2e-hand-placed-private-key");
      await mkdir(join(vaultFolder, AGENT, "notes"));
      await writeFile(stoppedWrite, "e2e-partial");
      await saveKey(githubId, "GITHUB_TOKEN", NEW_VAULT_KEY);
      assert.equal(await readFile(join(vaultFolder, AGENT, "GITHUB_TOKEN"), "utf8"), NEW_VAULT_KEY);
      assert.equal(await readFile(join(vaultFolder, "agent-3", "GITHUB_TOKEN"), "utf8"), NEW_VAULT_KEY);
      assert.equal(await readFile(join(vaultFolder, "GITHUB_TOKEN"), "utf8"), NEW_VAULT_KEY);
      await assert.rejects(stat(stoppedWrite));
      await Effect.runPromise(vault.delete(githubId));
      await synced;
      await assert.rejects(stat(join(vaultFolder, "GITHUB_TOKEN")));
      await assert.rejects(stat(join(vaultFolder, AGENT, "GITHUB_TOKEN")));
      await assert.rejects(stat(join(vaultFolder, "agent-3", "GITHUB_TOKEN")));
      // An agent removes its own key, never a key that other agents use.
      assert.equal(await Effect.runPromise(keys.remove("agent-3", "OPENAI_API_KEY")), true);
      // Its old path no longer gives a key: a key for every agent of the name was never there.
      await assert.rejects(lstat(ownPath));
      assert.equal(
        await readFile(join(vaultFolder, "agent-3", "OPENAI_API_KEY"), "utf8"),
        "e2e-vault-openai-key-31b0",
        "the key for every agent comes back after the agent's own key goes",
      );
      assert.equal(await Effect.runPromise(keys.remove("agent-3", "OPENAI_API_KEY")), false);
      // A Vault that cannot be read leaves no key file behind after the next sync.
      await writeFile(join(root, "openbot-vault-v1.json"), "not json");
      await Effect.runPromise(vault.load());
      await Effect.runPromise(keys.syncVault());
      await assert.rejects(stat(join(vaultFolder, AGENT, "OPENAI_API_KEY")));
      await assert.rejects(stat(join(vaultFolder, "OPENAI_API_KEY")));
      await assert.rejects(stat(join(vaultFolder, "agent-3", "NOTION_TOKEN")));
      assert.equal(await readFile(handPlaced, "utf8"), "e2e-hand-placed-private-key");
      assert.ok((await stat(join(vaultFolder, AGENT, "notes"))).isDirectory());
      assert.deepEqual(await Effect.runPromise(keys.list("agent-3")), []);
      // Without a Vault, a key for one agent is a plain file again.
      const plain = await Effect.runPromise(keys.save({ id: "agent-3", name: undefined }, "PLAIN_TOKEN", KEY));
      assert.deepEqual(plain, { name: "PLAIN_TOKEN", path: join(keyRoot, "agent-3", "PLAIN_TOKEN") });
      await Effect.runPromise(keys.removeAgent("agent-3"));
      await assert.rejects(stat(join(keyRoot, "agent-3")));
      await assert.rejects(stat(join(vaultFolder, "agent-3")));
    },
  );

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
    // The settings page cannot keep an item that no agent can use.
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
    // A caller that names no agent gets only the items for every agent.
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
    // An agent cannot change or delete an item that it cannot use.
    assert.equal(await Effect.runPromise(vault.items.delete(chosen.id, AGENT)), null);
    await assert.rejects(
      Effect.runPromise(
        vault.items.save({ kind: "login", id: chosen.id, password: "e2e-x" }, { id: AGENT, name: "Coder" }),
      ),
    );
    // A login that an agent types, and that the user keeps from it, reaches only the agent that typed it.
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
    // An item that an agent adds is for every agent.
    const added = await Effect.runPromise(
      vault.items.save(
        { kind: "contact", fields: { label: "Office", fullName: "Office desk" } },
        { id: "agent-3", name: "Coder" },
      ),
    );
    assert.equal(vault.state().items.find((item) => item.id === added.id)?.agents, undefined);
    // The settings page keeps the agents when it saves an item without them, and null is every agent.
    await save({
      kind: "login",
      id: chosen.id,
      website: site,
      username: "chosen@example.com",
      password: null,
      notes: "n",
    });
    assert.deepEqual(vault.state().items.find((item) => item.id === chosen.id)?.agents, ["agent-3"]);
    // The choice survives a restart.
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

    // The password of a login for another subdomain already fills there, so nothing is added.
    const shop = await typeLogin("https://shop.example.com", "blake", "e2e-status-password");
    assert.deepEqual([shop.id, shop.created, shop.changed], [status.id, false, false]);

    // A new password for the same host changes that login.
    const changed = await typeLogin("https://status.example.com", "blake", "e2e-status-new-password");
    assert.deepEqual([changed.id, changed.created, changed.changed], [status.id, false, true]);
    assert.equal(await password(status.id, "https://status.example.com"), "e2e-status-new-password");
    assert.equal(await password(billing.id, "https://billing.example.com"), "e2e-billing-password");

    // A login that the user keeps from this agent still makes the agent's new login for this agent only.
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

    // www.example.com is the same host as example.com.
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

      // The Vault option comes first and is selected when the form opens.
      const scope = ask("DEPLOY_TOKEN", "turn-vault-0").spec;
      assert.ok(scope.type === "form");
      const scopeField = scope.fields?.find((field) => field.id === API_KEY_SCOPE_FIELD_ID);
      assert.ok(scopeField && scopeField.kind === "segmented");
      assert.deepEqual(scopeField.options, ["All agents (Vault)", API_KEY_SCOPE_AGENT]);
      assert.equal(scopeField.value, "All agents (Vault)");
      formRegistry.cancelRequest(formClient, nextRequest - 1);

      // An agent that asked before keeps its own key, which would hide the key for every agent.
      await Effect.runPromise(keys.save({ id: AGENT, name: "Coder" }, "DEPLOY_TOKEN", KEY));
      assert.deepEqual(vault.items.apiKeys(AGENT), [{ name: "DEPLOY_TOKEN", value: KEY, own: true }]);
      const { id, spec } = ask("DEPLOY_TOKEN", "turn-vault-1");
      const values = { [API_KEY_FIELD_ID]: ` ${VAULT_KEY}\n`, [API_KEY_SCOPE_FIELD_ID]: "All agents (Vault)" };
      const answers = uiBlockAnswersFromResponse(spec, { actionId: "submit", values });
      await assert.rejects(respond(id, answers, MEMBER));
      assert.equal(vault.items.apiKeys("agent-4").length, 0, "a member saved a key in the Vault");
      await respond(id, answers);
      const vaultPath = join(root, "form-api-keys", ".vault", AGENT, "DEPLOY_TOKEN");
      const result = agentAnswer(formClient.answers.get(id));
      assert.deepEqual(result, {
        status: "saved",
        blockId: `block-${id}`,
        name: "DEPLOY_TOKEN",
        path: vaultPath,
        source: "vault",
      });
      // The agent's own key went: one key of the name is left, for every agent.
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
      // The app draws the scope choice small, next to the submit button, also after the answer.
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
    // No plain file: the Vault keeps the key encrypted.
    await assert.rejects(stat(join(root, "private-api-keys", AGENT)));
    assert.deepEqual(vault.items.apiKeys(AGENT), [{ name: "PRIVATE_TOKEN", value: KEY, own: true }]);
    const saved = vault.state().items.find((item) => item.kind === "apiKey" && item.name === "PRIVATE_TOKEN");
    assert.deepEqual(saved?.agents, [AGENT]);
    assert.equal(saved?.addedBy, "Coder");
    assert.deepEqual(vault.items.apiKeys("agent-4"), []);
    assert.deepEqual(await Effect.runPromise(keys.list("agent-4")), []);
    await assert.rejects(stat(join(root, "private-api-keys", ".vault", "agent-4", "PRIVATE_TOKEN")));
  });

  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed: true, steps }, null, 2)}\n`);
  process.stdout.write(`agent-api-keys-e2e: ${steps.length} steps passed\n`);
} catch (error) {
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed: false, steps }, null, 2)}\n`);
  throw error;
} finally {
  await rm(root, { recursive: true, force: true });
}
