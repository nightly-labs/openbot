// Drives the real model catalog with Claude CLI list responses, without an account or a model call.
// Checks names and unchanged ids, including the cc/ prefix, release dates, context windows and
// unknown models. Run: bun scripts/claude-model-names-smoke.ts.
// Writes .openbot-build/claude-model-names-smoke/report.json.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ModelCatalog } from "../src/backend/agent/model-catalog";
import { ClaudeAgentClient } from "../src/backend/claude-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { ResponseDecoder } from "../src/backend/protocol";
import { providerSync } from "../src/backend/provider-client-effects";
import { NO_PROVIDER_CREDENTIALS } from "../src/backend/provider-drivers";

const OUT = resolve(import.meta.dirname, "../.openbot-build/claude-model-names-smoke");
const cases = [
  { id: "cc/claude-opus-5", displayName: "Default (recommended)", expected: "Claude Opus 5" },
  { id: "cc/claude-sonnet-5", displayName: "Sonnet 5", expected: "Claude Sonnet 5" },
  { id: "cc/claude-haiku-4-5-20251001", displayName: "Haiku 4.5", expected: "Claude Haiku 4.5" },
  { id: "cc/claude-opus-5[1m]", displayName: "Opus", expected: "Claude Opus 5 (1M context)" },
  { id: "claude-fable-5-1", displayName: "Fable", expected: "Claude Fable 5.1" },
  { id: "other/claude-opus-5", displayName: "Other provider", expected: "Other provider" },
  { id: "cc/claude-preview", displayName: "Preview model", expected: "Preview model" },
];

class CatalogClient extends ClaudeAgentClient {
  override readonly request = <T>(method: string, _params: unknown, decoder: ResponseDecoder<T>) => {
    return providerSync(() => {
      assert.equal(method, "model/list");
      return decoder({ data: cases.map(({ id, displayName }) => ({ model: id, displayName })) });
    });
  };
}

const client = new CatalogClient({ executable: process.execPath, version: "smoke", source: "managed" });
const catalog = new ModelCatalog({
  client: (provider) => (provider === "claude" ? client : undefined),
  isSignedOut: () => false,
  credentials: NO_PROVIDER_CREDENTIALS,
  requestTimeoutMs: 5_000,
  recordProviderError: (_provider, error) => {
    throw error;
  },
});
const report: { passed: boolean; models: { id: string; name: string }[]; failure?: string } = {
  passed: false,
  models: [],
};

try {
  const fresh = await runCauseEffect(catalog.refresh());
  assert.ok(fresh.has("claude"));
  report.models = catalog.list().filter((model) => model.provider === "claude");
  assert.equal(report.models.length, cases.length);
  for (const { id, expected } of cases) {
    assert.equal(report.models.find((model) => model.id === id)?.name, expected, id);
  }
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await mkdir(OUT, { recursive: true });
  await writeFile(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
