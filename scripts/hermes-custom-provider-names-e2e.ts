import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { translateFor } from "@openbot/i18n";
import { redactText } from "@openbot/logging";
import { Effect } from "effect";
import { groupPickerModels, pickerModels } from "../packages/ui/src/components/provider-model-options";
import { ModelCatalog } from "../src/backend/agent/model-catalog";
import { creationModel } from "../src/backend/agent/model-choice";
import type { AgentClient } from "../src/backend/agent-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { installFakeAgent, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/hermes-custom-provider-names-e2e");
const TIMEOUT_MS = 10_000;
const ARENA = "custom:arena:claude-fable-5-1";
const ANTHROPIC = "anthropic:claude-fable-5-1";
const QUERIES = ["arena", "fable", "lab r&d", "llama3:8b", "ollama", "gpt-oss-20b", "east • west · lab 9"] as const;

type Group = { name: string; models: { id: string; name: string }[] };

function only(groups: Group[] | undefined, label: string, id: string, name: string): boolean {
  const group = groups?.[0];
  const model = group?.models[0];
  return (
    groups?.length === 1 &&
    group?.name === label &&
    group.models.length === 1 &&
    model?.id === id &&
    model.name === name
  );
}

const driver = requireProviderDriver("hermes");

async function checkPicker(client: AgentClient) {
  client.start();
  const catalog = new ModelCatalog({
    client: () => client,
    isSignedOut: () => false,
    requestTimeoutMs: TIMEOUT_MS,
    recordProviderError: () => undefined,
    startSettingsChanged: () => Effect.void,
  });
  const { models } = await runCauseEffect(catalog.read(client, driver.catalog ?? {}, TIMEOUT_MS));
  const picker = pickerModels(models, undefined, translateFor("en"));
  const searches = Object.fromEntries(
    QUERIES.map((query) => [
      query,
      groupPickerModels(picker, query).map((group) => ({
        name: group.name,
        models: group.models.map(({ id, name }) => ({ id, name })),
      })),
    ]),
  );
  const versioned = models.filter(({ id }) => id === "anthropic:model-4" || id === "custom:east-west:model-3");
  const selectedModel = creationModel({ provider: "hermes" }, versioned)?.model.id ?? null;
  const fable = searches.fable ?? [];
  const checks = {
    fixture: models.length === 8 && models.some(({ id }) => id === ARENA) && models.some(({ id }) => id === ANTHROPIC),
    providerSearch: only(searches.arena, "Arena", ARENA, "claude-fable-5-1"),
    distinctGroups:
      fable.length === 2 &&
      only(
        fable.filter(({ name }) => name === "Anthropic"),
        "Anthropic",
        ANTHROPIC,
        "claude-fable-5-1",
      ) &&
      only(
        fable.filter(({ name }) => name === "Arena"),
        "Arena",
        ARENA,
        "claude-fable-5-1",
      ),
    configuredLabel: only(searches["lab r&d"], "Lab R&D", "custom:lab-key:qwen2.5:7b", "qwen2.5:7b"),
    colonIdGuard: only(searches["llama3:8b"], "", "custom:llama3:8b", "llama3:8b"),
    qualifiedGuard: only(searches.ollama, "Ollama", "custom:ollama:mistral:latest", "mistral:latest"),
    noDescriptionGuard: only(searches["gpt-oss-20b"], "", "custom:spare:gpt-oss-20b", "gpt-oss-20b"),
    numericSelection: selectedModel === "anthropic:model-4",
    punctuatedLabel: only(
      searches["east • west · lab 9"],
      "East • West · Lab 9",
      "custom:east-west:model-3",
      "model-3",
    ),
    providerDescriptionScope: !models.some(({ description }) => description.includes("Synthetic provider detail")),
  };
  return { checks, searches, selectedModel };
}

const report: {
  passed: boolean;
  cases: Array<{ client: string } & Awaited<ReturnType<typeof checkPicker>>>;
  error?: string;
} = { passed: false, cases: [] };
const clients: AgentClient[] = [];
await mkdir(OUT, { recursive: true });
const root = await mkdtemp(join(OUT, "run-"));
try {
  process.env.HOME = join(root, "home");
  process.env.HERMES_HOME = join(root, "hermes-home");
  await mkdir(process.env.HOME);
  await mkdir(process.env.HERMES_HOME);
  const executable = join(root, "bin", "hermes");
  await installFakeAgent(executable, "hermes-custom-provider-names");
  const cli = { executable, version: "0.22.3", source: "managed" } as const;
  assert.ok(driver.createProfileClient);
  for (const [name, createClient] of [
    ["createClient", driver.createClient],
    ["createProfileClient", driver.createProfileClient],
  ] as const) {
    const client = createClient(cli, TIMEOUT_MS, NO_PROVIDER_CREDENTIALS);
    clients.push(client);
    report.cases.push({ client: name, ...(await checkPicker(client)) });
  }
  report.passed = report.cases.every(({ checks }) => Object.values(checks).every(Boolean));
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  report.error = redactText(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await stopClients(clients);
  await rm(root, { recursive: true, force: true });
  const path = join(OUT, "report.json");
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${report.passed ? "passed" : "failed"}: ${path}\n`);
}
