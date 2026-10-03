// Runs local detection and endpoint Edit end to end on the real main-process modules: the detection
// settings file, the scan, the model probe, and the encrypted endpoint store, against fake
// OpenAI-compatible servers on this computer. A fake cipher replaces the operating system's secret
// storage, which exists only in Electron. It also scans a folder that holds a file named like a known
// agent, and proves that the scan never starts it.
// `bun scripts/provider-detection-e2e.ts`. Writes .openbot-build/provider-detection-e2e/report.json.
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { type CustomProviderCipher, CustomProviderStore } from "../src/main/custom-provider-store";
import { probeModels } from "../src/main/model-server-probe";
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

/** An OpenAI-compatible server that lists `models`, or redirects every request to `redirectTo`. */
async function fakeServer(models: string[], redirectTo?: string): Promise<FakeServer> {
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
    response.end(JSON.stringify({ object: "list", data: models.map((id) => ({ id, object: "model" })) }));
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
  edit?: {
    keyKeptOnEdit: boolean;
    ciphertextUnchanged: boolean;
    storedKeyReachedSameOrigin: boolean;
    storedKeyReachedOtherOrigin: boolean;
    newAddressWithKeptKeyRefused: boolean;
  };
  disabled?: { requestsSent: number; savedAcrossRestart: boolean };
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
  servers.push(primary, other, redirecting);

  const settings = new ProviderDetectionSettingsStore(join(root, "openbot-provider-detection-v1.json"));
  await Effect.runPromise(settings.load().pipe(Effect.mapError((error) => error.cause)));
  const endpoints = new CustomProviderStore({ path: join(root, "custom-providers.json"), cipher });
  await Effect.runPromise(endpoints.load().pipe(Effect.mapError((error) => error.cause)));
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
  await Effect.runPromise(
    settings
      .set({
        enabled: true,
        addresses: [primary.baseUrl, redirecting.baseUrl],
        folders: [agentFolder],
        hiddenIds: [],
      })
      .pipe(Effect.mapError((error) => error.cause)),
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
  await Effect.runPromise(
    endpoints
      .save({
        id: row.id,
        name: "Local server",
        baseUrl: row.baseUrl,
        apiKey: KEY,
        headers: [HEADER],
        models: [{ id: "llama-3.1-8b", name: "llama-3.1-8b" }],
      })
      .pipe(Effect.mapError((error) => error.cause)),
  );
  const envelope = await readFile(join(root, "custom-providers.json"), "utf8");
  assert.ok(!envelope.includes(KEY) && !envelope.includes(HEADER.value), "The file holds no plain key or header.");
  const cipherBefore = JSON.parse(envelope).providers[0].secret;

  // 3. Edit with an empty key field: the models change, the stored key and header stay.
  await Effect.runPromise(
    endpoints
      .update({
        id: row.id,
        name: "Local server",
        baseUrl: row.baseUrl,
        models: [
          { id: "llama-3.1-8b", name: "llama-3.1-8b" },
          { id: "qwen2.5-coder", name: "qwen2.5-coder" },
        ],
      })
      .pipe(Effect.mapError((error) => error.cause)),
  );
  const edited = endpoints.list().find((summary) => summary.id === row.id);
  assert.equal(edited?.models.length, 2);
  assert.equal(edited?.hasApiKey, true);
  const cipherAfter = JSON.parse(await readFile(join(root, "custom-providers.json"), "utf8")).providers[0].secret;
  assert.deepEqual(cipherAfter, cipherBefore, "A kept key keeps its ciphertext.");

  // 4. Load models for the saved endpoint with an empty key field: the server gets the stored key.
  await Effect.runPromise(
    detection.discoverModels({ baseUrl: row.baseUrl, apiKey: null, headers: [], savedProviderId: row.id }),
  );
  const loaded = primary.seen.at(-1);
  assert.equal(loaded?.authorization, `Bearer ${KEY}`);
  assert.equal(loaded?.team, HEADER.value);

  // 5. The stored key never goes to another origin.
  await Effect.runPromise(
    detection.discoverModels({ baseUrl: other.baseUrl, apiKey: null, headers: [], savedProviderId: row.id }),
  );
  assert.equal(other.seen.at(-1)?.authorization, null, "Another origin gets no stored key.");
  assert.equal(other.seen.at(-1)?.team, null, "Another origin gets no stored header.");
  await assert.rejects(
    Effect.runPromise(
      endpoints
        .update({ id: row.id, name: "Local server", baseUrl: other.baseUrl, models: [] })
        .pipe(Effect.mapError((error) => error.cause)),
    ),
    "A new address with a kept key is refused.",
  );
  report.edit = {
    keyKeptOnEdit: true,
    ciphertextUnchanged: true,
    storedKeyReachedSameOrigin: true,
    storedKeyReachedOtherOrigin: false,
    newAddressWithKeptKeyRefused: true,
  };

  // 6. Detection off: nothing is probed.
  const before = primary.seen.length;
  await Effect.runPromise(
    settings.set({ ...settings.get(), enabled: false }).pipe(Effect.mapError((error) => error.cause)),
  );
  assert.deepEqual(await Effect.runPromise(detection.scanModelServers()), []);
  assert.deepEqual(await Effect.runPromise(detection.scanAgents()), []);
  assert.equal(primary.seen.length, before, "A disabled scan sends nothing.");
  const reloaded = new ProviderDetectionSettingsStore(join(root, "openbot-provider-detection-v1.json"));
  await Effect.runPromise(reloaded.load().pipe(Effect.mapError((error) => error.cause)));
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
