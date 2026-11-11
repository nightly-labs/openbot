// Runs local detection and endpoint Edit end to end on the real main-process modules: the detection
// settings file, the scan, the model probe, and the encrypted endpoint store, against fake
// OpenAI-compatible servers on this computer. A fake cipher replaces the operating system's secret
// storage, which exists only in Electron. It also scans a folder that holds a file named like a known
// agent, and proves that the scan never starts it. A model list in the models.dev, OpenRouter and
// vLLM shapes gives each model's input kinds, context window and max output (#3946). A list with
// model names only gets each model's limits from the models.dev copy of OpenCode (#3946, #5789).
// `bun scripts/provider-detection-e2e.ts`. Writes .openbot-build/provider-detection-e2e/report.json.
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDiscoverModelsResult } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { type CustomProviderCipher, CustomProviderStore } from "../src/main/custom-provider-store";
import { probeModels } from "../src/main/model-server-probe";
import { ModelReleaseCatalog } from "../src/main/model-visibility";
import { createProviderDetection } from "../src/main/provider-detection";
import { ProviderDetectionSettingsStore } from "../src/main/provider-detection-settings-store";

const OUT = resolve(import.meta.dirname, "../.openbot-build/provider-detection-e2e");
const KEY = "sk-e2e-endpoint-key";
const HEADER = { name: "X-Team", value: "e2e-header-value" };

interface Seen {
  path: string;
  authorization: string | null;
  team: string | null;
}

interface FakeServer {
  baseUrl: string;
  seen: Seen[];
  close: () => Promise<void>;
}

/** A model list entry with the fields of models.dev, OpenRouter and vLLM. The input is wrong on purpose in one entry. */
interface ListedModel {
  id: string;
  object?: string;
  modalities?: { input?: string[] | string };
  limit?: { context?: number; output?: number };
  context_length?: number;
  architecture?: { input_modalities: string[] };
  top_provider?: { max_completion_tokens: number };
  max_model_len?: number;
}

/**
 * An OpenAI-compatible server that lists `models`, or redirects every request to `redirectTo`. A
 * string is a bare entry; an object is sent as it is.
 */
async function fakeServer(models: (string | ListedModel)[], redirectTo?: string): Promise<FakeServer> {
  const seen: Seen[] = [];
  const server: Server = createServer((request: IncomingMessage, response) => {
    seen.push({
      path: request.url ?? "",
      authorization: request.headers.authorization ?? null,
      team: typeof request.headers["x-team"] === "string" ? request.headers["x-team"] : null,
    });
    if (redirectTo) {
      response.writeHead(302, { location: `${redirectTo}/models` }).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    const data = models.map((model) => (typeof model === "string" ? { id: model, object: "model" } : model));
    response.end(JSON.stringify({ object: "list", data }));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address === "object", "The fake server listens on a port.");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    seen,
    close: () => new Promise((done) => server.close(() => done())),
  };
}

interface Report {
  passed: boolean;
  scan?: {
    servers: { id: string; baseUrl: string; models: number }[];
    redirectFollowed: boolean;
    scanSentKey: boolean;
    agentFound: string;
    agentStarted: boolean;
  };
  catalogLimits?: unknown;
  tornCatalog?: unknown;
  edit?: {
    keyKeptOnEdit: boolean;
    ciphertextUnchanged: boolean;
    storedKeyReachedSameOrigin: boolean;
    storedKeyReachedOtherOrigin: boolean;
    newAddressWithKeptKeyRefused: boolean;
  };
  headers?: Record<string, boolean>;
  disabled?: { requestsSent: number; savedAcrossRestart: boolean };
  catalog?: unknown[];
}

const cipher: CustomProviderCipher = {
  canPersist: () => true,
  encrypt: (value) => Buffer.from(Buffer.from(value, "utf8").map((byte) => byte ^ 0x5a)),
  decrypt: (value) => Buffer.from(value.map((byte) => byte ^ 0x5a)).toString("utf8"),
};

const root = await mkdtemp(join(tmpdir(), "openbot-provider-detection-e2e-"));
const report: Report = { passed: false };
const servers: FakeServer[] = [];

const detections: Effect.Success<ReturnType<typeof createProviderDetection>>[] = [];
try {
  const primary = await fakeServer(["llama-3.1-8b", "qwen2.5-coder"]);
  const other = await fakeServer(["other-model"]);
  const redirecting = await fakeServer([], primary.baseUrl);
  // #3946: what a list says about each model, in the shapes that servers publish.
  const catalog = await fakeServer([
    // models.dev, as the gateway of #5332 lists it.
    {
      id: "gateway-vision",
      modalities: { input: ["text", "image", "pdf"] },
      limit: { context: 200_000, output: 32_000 },
    },
    // OpenRouter: `file` is a PDF input.
    {
      id: "router-model",
      context_length: 131_072,
      architecture: { input_modalities: ["text", "file"] },
      top_provider: { max_completion_tokens: 65_536 },
    },
    // OpenRouter often lists the max output as the whole window: it leaves no room for the prompt.
    // An empty `modalities` does not hide the OpenRouter kinds.
    {
      id: "router-full-cap",
      context_length: 163_840,
      modalities: {},
      architecture: { input_modalities: ["text", "image"] },
      top_provider: { max_completion_tokens: 163_840 },
    },
    // vLLM: a window, and no input kinds.
    { id: "vllm-model", object: "model", max_model_len: 32_768 },
    // A text-only list entry.
    { id: "text-only", modalities: { input: ["text"] } },
    // Values out of range and of the wrong type are left out; a max output with no window too.
    { id: "odd-model", context_length: 12, limit: { output: 4_096 }, modalities: { input: "image" } },
    "bare-model",
  ]);
  servers.push(primary, other, redirecting, catalog);

  const settings = new ProviderDetectionSettingsStore(join(root, "openbot-provider-detection-v1.json"));
  await runCauseEffect(settings.load());
  const endpoints = new CustomProviderStore({ path: join(root, "custom-providers.json"), cipher });
  await runCauseEffect(endpoints.load());
  const detection = await Effect.runPromise(
    createProviderDetection({
      settings,
      customProviders: endpoints,
      customAgents: { configs: () => [] },
      probe: probeModels,
    }),
  );
  detections.push(detection);

  // 1. A listed address is found with its models, with no key; a redirect is not followed.
  const agentFolder = join(root, "tools");
  const marker = join(root, "started");
  await mkdir(agentFolder);
  await writeFile(join(agentFolder, "goose"), `#!/bin/sh\ntouch "${marker}"\n`);
  await chmod(join(agentFolder, "goose"), 0o755);
  await runCauseEffect(
    settings.set({
      enabled: true,
      addresses: [primary.baseUrl, redirecting.baseUrl],
      folders: [agentFolder],
      hiddenIds: [],
    }),
  );
  const found = await Effect.runPromise(detection.scanModelServers());
  const row = found.find((server) => server.baseUrl === primary.baseUrl);
  assert.ok(row, "The listed address is found.");
  assert.deepEqual(
    row.models.map((model) => model.id),
    ["llama-3.1-8b", "qwen2.5-coder"],
  );
  assert.ok(!found.some((server) => server.baseUrl === redirecting.baseUrl), "A redirect is not a server.");
  assert.equal(primary.seen.length, 1, "The redirect target gets only the direct request.");
  assert.equal(primary.seen[0]?.authorization, null, "A scan sends no key.");
  const agents = await Effect.runPromise(detection.scanAgents());
  const goose = agents.find((agent) => agent.command === join(agentFolder, "goose"));
  assert.ok(goose, "The agent in the listed folder is found.");
  await assert.rejects(stat(marker), { code: "ENOENT" }, "The scan does not start the agent.");
  report.scan = {
    servers: found.map((server) => ({ id: server.id, baseUrl: server.baseUrl, models: server.models.length })),
    redirectFollowed: false,
    scanSentKey: false,
    agentFound: goose.name,
    agentStarted: false,
  };

  // 2. Add the found server with a key and a header.
  await runCauseEffect(
    endpoints.save({
      id: row.id,
      name: "Local server",
      baseUrl: row.baseUrl,
      apiKey: KEY,
      headers: [HEADER],
      models: [{ id: "llama-3.1-8b", name: "llama-3.1-8b" }],
    }),
  );
  const envelope = await readFile(join(root, "custom-providers.json"), "utf8");
  assert.ok(!envelope.includes(KEY) && !envelope.includes(HEADER.value), "The file holds no plain key or header.");
  const cipherBefore = JSON.parse(envelope).providers[0].secret;

  // 3. Edit with an empty key field: the models change, the stored key and header stay.
  await runCauseEffect(
    endpoints.update({
      id: row.id,
      name: "Local server",
      baseUrl: row.baseUrl,
      models: [
        { id: "llama-3.1-8b", name: "llama-3.1-8b" },
        { id: "qwen2.5-coder", name: "qwen2.5-coder" },
      ],
    }),
  );
  const edited = endpoints.list().find((summary) => summary.id === row.id);
  assert.equal(edited?.models.length, 2);
  assert.equal(edited?.hasApiKey, true);
  const cipherAfter = JSON.parse(await readFile(join(root, "custom-providers.json"), "utf8")).providers[0].secret;
  assert.deepEqual(cipherAfter, cipherBefore, "A kept key keeps its ciphertext.");

  // 4. Load models for the saved endpoint with an empty key field: the server gets the stored key.
  // With no header rows, the saved header is not sent: the user removed it in the form.
  await Effect.runPromise(
    detection.discoverModels({ baseUrl: row.baseUrl, apiKey: null, headers: [], savedProviderId: row.id }),
  );
  const loaded = primary.seen.at(-1);
  assert.equal(loaded?.authorization, `Bearer ${KEY}`);
  assert.equal(loaded?.team, null, "A removed header row is not sent.");

  // 5. The stored key never goes to another origin.
  await Effect.runPromise(
    detection.discoverModels({ baseUrl: other.baseUrl, apiKey: null, headers: [], savedProviderId: row.id }),
  );
  assert.equal(other.seen.at(-1)?.authorization, null, "Another origin gets no stored key.");
  assert.equal(other.seen.at(-1)?.team, null, "Another origin gets no stored header.");
  await assert.rejects(
    runCauseEffect(endpoints.update({ id: row.id, name: "Local server", baseUrl: other.baseUrl, models: [] })),
    "A new address with a kept key is refused.",
  );
  // 5b. Edit shows the saved header names. A null value keeps the saved value of that name.
  const savedHeaders = endpoints.list().find((summary) => summary.id === row.id)?.headerNames;
  assert.deepEqual(savedHeaders, [HEADER.name], "The list names the saved header.");
  const editBase = { id: row.id, name: "Local server", baseUrl: row.baseUrl, models: edited?.models ?? [] };
  await runCauseEffect(endpoints.update({ ...editBase, headers: [{ name: HEADER.name, value: null }] }));
  const cipherKept = JSON.parse(await readFile(join(root, "custom-providers.json"), "utf8")).providers[0].secret;
  assert.deepEqual(cipherKept, cipherBefore, "Kept headers keep the ciphertext.");
  await Effect.runPromise(
    detection.discoverModels({
      baseUrl: row.baseUrl,
      apiKey: null,
      headers: [{ name: HEADER.name, value: "" }],
      savedProviderId: row.id,
    }),
  );
  assert.equal(primary.seen.at(-1)?.team, HEADER.value, "A kept header row loads models with the saved value.");
  await Effect.runPromise(
    detection.discoverModels({
      baseUrl: other.baseUrl,
      apiKey: null,
      headers: [{ name: HEADER.name, value: "" }],
      savedProviderId: row.id,
    }),
  );
  assert.equal(other.seen.at(-1)?.team, null, "Another origin gets no kept header value.");
  await assert.rejects(
    runCauseEffect(
      endpoints.update({
        ...editBase,
        baseUrl: other.baseUrl,
        apiKey: "sk-new",
        headers: [{ name: HEADER.name, value: null }],
      }),
    ),
    "A new address with a kept header is refused.",
  );
  await assert.rejects(
    runCauseEffect(endpoints.update({ ...editBase, headers: [{ name: "X-Unknown", value: null }] })),
    "A kept value for a name that is not saved is refused.",
  );
  await runCauseEffect(
    endpoints.update({
      ...editBase,
      headers: [
        { name: HEADER.name, value: null },
        { name: "X-Extra", value: "extra-value" },
      ],
    }),
  );
  await runCauseEffect(endpoints.update({ ...editBase, headers: [{ name: "X-Extra", value: null }] }));
  const afterRemove = endpoints.configs().find((config) => config.id === row.id);
  assert.deepEqual(
    afterRemove?.headers,
    [{ name: "X-Extra", value: "extra-value" }],
    "A removed row removes its header.",
  );
  assert.equal(afterRemove?.apiKey, KEY, "A header edit keeps the key.");
  const reopened = new CustomProviderStore({ path: join(root, "custom-providers.json"), cipher });
  await runCauseEffect(reopened.load());
  assert.deepEqual(reopened.list().find((summary) => summary.id === row.id)?.headerNames, ["X-Extra"]);
  await runCauseEffect(endpoints.update({ ...editBase, headers: [] }));
  assert.deepEqual(endpoints.list().find((summary) => summary.id === row.id)?.headerNames, [], "No rows clear them.");
  assert.equal(endpoints.configs().find((config) => config.id === row.id)?.apiKey, KEY);
  report.headers = {
    namesListed: true,
    keptCiphertextUnchanged: true,
    keptValueReachedSameOrigin: true,
    keptValueReachedOtherOrigin: false,
    newAddressWithKeptHeaderRefused: true,
    unknownKeptNameRefused: true,
    removedRowRemoved: true,
    namesSurviveReload: true,
    emptyListClears: true,
  };
  report.edit = {
    keyKeptOnEdit: true,
    ciphertextUnchanged: true,
    storedKeyReachedSameOrigin: true,
    storedKeyReachedOtherOrigin: false,
    newAddressWithKeptKeyRefused: true,
  };

  // 6. A model list gives the input kinds, the window and the max output that it says, and no more.
  const listed = await Effect.runPromise(
    detection.discoverModels({ baseUrl: catalog.baseUrl, apiKey: null, headers: [] }),
  );
  report.catalog = listed.models;
  assert.ok(isDiscoverModelsResult(listed), "The preload decoder accepts the list.");
  assert.deepEqual(listed.models, [
    { id: "gateway-vision", inputs: ["image", "pdf"], contextWindow: 200_000, maxOutput: 32_000 },
    { id: "router-model", inputs: ["pdf"], contextWindow: 131_072, maxOutput: 65_536 },
    { id: "router-full-cap", inputs: ["image"], contextWindow: 163_840 },
    { id: "vllm-model", contextWindow: 32_768 },
    { id: "text-only", inputs: [] },
    { id: "odd-model" },
    { id: "bare-model" },
  ]);

  // 6b. A list with names only gets the limits of the models.dev copy that OpenCode keeps. A model
  // that the endpoint gives a window keeps it, and a model that the copy does not have gets none.
  const cache = join(root, "cache");
  const copy = join(cache, "opencode", "models.json");
  await mkdir(join(cache, "opencode"), { recursive: true });
  await writeFile(
    copy,
    JSON.stringify({
      google: { models: { "gemini-3.8-flash": { limit: { context: 1_048_576, output: 65_536 } } } },
      "relay-a": { models: { "gemini-3.8-flash": { limit: { context: 200_000, output: 8_000 } } } },
      "relay-b": { models: { "vendor/big.model": { limit: { context: 1_000_000, output: 64_000 } } } },
      "relay-c": { models: { "big-model": { limit: { context: 1_000_000, output: 64_000 } } } },
      "relay-d": { models: { "big-model": { limit: { context: 128_000, output: 8_000 } } } },
      "relay-e": { models: { "full-cap": { limit: { context: 200_000, output: 200_000 } } } },
    }),
  );
  // A confined OpenCode on this computer can have a copy of its own. This one is the newer.
  const later = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await utimes(copy, later, later);
  const namesOnly = await fakeServer([
    "proxy/google/gemini-3.8-flash",
    "Big.Model",
    "full-cap",
    "unknown-model",
    { id: "local/big-model", context_length: 32_768 },
  ]);
  servers.push(namesOnly);
  const withCatalog = await Effect.runPromise(
    createProviderDetection({
      settings,
      customProviders: endpoints,
      customAgents: { configs: () => [] },
      probe: probeModels,
      catalog: new ModelReleaseCatalog({ XDG_CACHE_HOME: cache }, root),
    }),
  );
  detections.push(withCatalog);
  const filled = await Effect.runPromise(
    withCatalog.discoverModels({ baseUrl: namesOnly.baseUrl, apiKey: null, headers: [] }),
  );
  report.catalogLimits = filled.models;
  assert.ok(isDiscoverModelsResult(filled), "The preload decoder accepts the filled list.");
  assert.deepEqual(filled.models, [
    // The id ends in a catalog key: the maker's limits, not those of a relay.
    { id: "proxy/google/gemini-3.8-flash", contextWindow: 1_048_576, maxOutput: 65_536 },
    // By name: the window that most services give.
    { id: "Big.Model", contextWindow: 1_000_000, maxOutput: 64_000 },
    { id: "full-cap", contextWindow: 200_000 },
    { id: "unknown-model" },
    { id: "local/big-model", contextWindow: 32_768 },
  ]);

  // 6c. OpenCode can write the copy during the read. Text that is not JSON gives a list with no
  // limits; it does not make the search fail.
  await writeFile(copy, '{"google": {"models": {"gemini-3.8-fl');
  const afterTear = new Date(later.getTime() + 60 * 1000);
  await utimes(copy, afterTear, afterTear);
  const torn = await Effect.runPromise(
    withCatalog.discoverModels({ baseUrl: namesOnly.baseUrl, apiKey: null, headers: [] }),
  );
  report.tornCatalog = torn.models;
  assert.deepEqual(torn.models, [
    { id: "proxy/google/gemini-3.8-flash" },
    { id: "Big.Model" },
    { id: "full-cap" },
    { id: "unknown-model" },
    { id: "local/big-model", contextWindow: 32_768 },
  ]);

  // 7. Detection off: nothing is probed.
  const before = primary.seen.length;
  await runCauseEffect(settings.set({ ...settings.get(), enabled: false }));
  assert.deepEqual(await Effect.runPromise(detection.scanModelServers()), []);
  assert.deepEqual(await Effect.runPromise(detection.scanAgents()), []);
  assert.equal(primary.seen.length, before, "A disabled scan sends nothing.");
  const reloaded = new ProviderDetectionSettingsStore(join(root, "openbot-provider-detection-v1.json"));
  await runCauseEffect(reloaded.load());
  assert.equal(reloaded.get().enabled, false, "The switch survives a restart.");
  report.disabled = { requestsSent: 0, savedAcrossRestart: true };

  report.passed = true;
} finally {
  for (const detection of detections) await Effect.runPromise(detection.close());
  await Promise.all(servers.map((server) => server.close()));
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
