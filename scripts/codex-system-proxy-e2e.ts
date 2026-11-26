import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { CODEX_API_URL, createProviderSystemProxy, GROK_API_URL } from "../src/main/provider-system-proxy";

const out = resolve(import.meta.dirname, "../.openbot-build/codex-system-proxy-e2e");
const root = await mkdtemp(join(tmpdir(), "codex-system-proxy-"));
const executable = join(root, "codex");
const record = join(root, "environment.json");
const cases = {
  childEnvironment: false,
  providerOverride: false,
  restart: false,
  proxy: false,
  direct: false,
  inherited: false,
  resolverFailure: false,
  grokUrl: false,
};
const original = "http://127.0.0.1:7990";
let current = original;
function clientFor(variables: Record<string, string>) {
  return requireProviderDriver("codex").createClient({ executable, version: "0.200.0", source: "system" }, 30_000, {
    ...NO_PROVIDER_CREDENTIALS,
    codexProxyEnvironment: () => ({ HTTPS_PROXY: current, NO_PROXY: "localhost" }),
    accountEnvironment: { HOME: root, CODEX_HOME: root, RECORD: record },
    providerEnvironment: () => variables,
  });
}
async function checkSpawn(client: ReturnType<typeof clientFor>, expected: string) {
  try {
    client.start();
    const deadline = Date.now() + 10_000;
    while (!(await Bun.file(record).exists())) {
      assert.ok(Date.now() < deadline, "No record from the Codex child process.");
      await delay(20);
    }
    assert.deepEqual(JSON.parse(await readFile(record, "utf8")), { HTTPS_PROXY: expected, NO_PROXY: "localhost" });
    await rename(record, `${record}.previous`);
  } finally {
    await runCauseEffect(client.stop());
  }
}
async function resolved(rules: string, environment: NodeJS.ProcessEnv) {
  const proxy = createProviderSystemProxy(CODEX_API_URL, async () => rules, environment);
  await Effect.runPromise(proxy.refresh);
  return proxy.environment();
}
try {
  await writeFile(
    executable,
    [
      "#!/bin/sh",
      `printf '{"HTTPS_PROXY":"%s","NO_PROXY":"%s"}' "$HTTPS_PROXY" "$NO_PROXY" > "$RECORD.tmp"`,
      'mv "$RECORD.tmp" "$RECORD"',
      "exec cat >/dev/null",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  const client = clientFor({});
  await checkSpawn(client, original);
  cases.childEnvironment = true;
  current = "http://127.0.0.1:7991";
  await checkSpawn(client, current);
  cases.restart = true;
  const override = "http://127.0.0.1:7992";
  await checkSpawn(clientFor({ HTTPS_PROXY: override }), override);
  cases.providerOverride = true;
  const rules = "PROXY 127.0.0.1:7990";
  const expected = await resolved(rules, {});
  assert.equal(expected.HTTPS_PROXY, original);
  assert.ok(expected.NO_PROXY?.split(",").includes("localhost"));
  cases.proxy = true;
  assert.deepEqual(await resolved("DIRECT", {}), {});
  cases.direct = true;
  assert.deepEqual(await resolved(rules, { https_proxy: override }), {});
  cases.inherited = true;
  let fail = false;
  const cached = createProviderSystemProxy(
    CODEX_API_URL,
    async () => {
      if (fail) throw new Error("Proxy lookup failed.");
      return rules;
    },
    {},
  );
  await Effect.runPromise(cached.refresh);
  fail = true;
  await Effect.runPromise(cached.refresh);
  assert.deepEqual(cached.environment(), expected);
  cases.resolverFailure = true;
  const urls: string[] = [];
  await Effect.runPromise(
    createProviderSystemProxy(
      GROK_API_URL,
      async (url) => {
        urls.push(url);
        return "DIRECT";
      },
      {},
    ).refresh,
  );
  assert.deepEqual(urls, ["https://cli-chat-proxy.grok.com/"]);
  cases.grokUrl = true;
} finally {
  await rm(root, { recursive: true, force: true });
  const report = JSON.stringify({ passed: Object.values(cases).every(Boolean), cases });
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "report.json"), `${report}\n`);
  process.stdout.write(`${report}\n`);
}
