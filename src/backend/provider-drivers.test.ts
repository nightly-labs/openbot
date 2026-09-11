// @vitest-environment node

import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentClient } from "./agent-client";
import type { AgentCliInfo } from "./cli";
import type { CustomProviderConfig } from "./opencode-config";
import { requireProviderDriver } from "./provider-drivers";

// The env a driver builds only becomes real at spawn, and `provider-runtime.test.ts` replaces the
// whole client with a fake, which reads no config at all. So this proves it where it happens: a
// stand-in `opencode` records the environment it was actually started with.

const UNSET = "unset";
let root: string | null = null;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = null;
});

interface SpawnCapture {
  argv: string;
  config: string | null;
}

/** Starts a client against a stand-in CLI that reports its own argv and OpenCode config, then exits. */
async function captureSpawn(create: (cli: AgentCliInfo) => AgentClient): Promise<SpawnCapture> {
  root = await mkdtemp(join(tmpdir(), "openbot-provider-drivers-"));
  const capture = join(root, "spawn.txt");
  const executable = join(root, "opencode");
  // `${VAR+x}` is empty for a variable that is set but blank, and absent for one that is not set at
  // all. The difference matters: an empty config layer is not the same as no layer.
  await writeFile(
    executable,
    `#!/bin/sh
{
  printf '%s\\n' "$*"
  if [ -n "\${OPENCODE_CONFIG_CONTENT+x}" ]; then printf '%s' "$OPENCODE_CONFIG_CONTENT"; else printf '%s' '${UNSET}'; fi
} > '${capture}'
`,
  );
  await chmod(executable, 0o755);

  const client = create({ executable, version: "1.18.27" });
  const exited = new Promise<void>((resolve) => {
    client.once("exit", () => resolve());
  });
  client.start();
  await exited;
  await client.stop();

  const [argv = "", payload = ""] = (await readFile(capture, "utf8")).split("\n");
  return { argv, config: payload === UNSET ? null : payload };
}

function provider(overrides: Partial<CustomProviderConfig> = {}): CustomProviderConfig {
  return {
    id: "studio-local",
    name: "Studio Local",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKey: "test-key",
    models: [{ id: "qwen3-coder:30b", name: "Qwen3 Coder 30B" }],
    headers: [],
    ...overrides,
  };
}

const openCode = requireProviderDriver("opencode");

describe("the OpenCode driver", () => {
  it("starts the ACP process with the custom provider config", async () => {
    const capture = await captureSpawn((cli) =>
      openCode.createClient(cli, 30_000, { customProviders: () => [provider()] }),
    );
    expect(capture.argv).toBe("acp");
    expect(JSON.parse(capture.config ?? "")).toEqual({
      provider: {
        "studio-local": {
          npm: "@ai-sdk/openai-compatible",
          name: "Studio Local",
          options: { baseURL: "http://127.0.0.1:11434/v1", apiKey: "test-key" },
          models: { "qwen3-coder:30b": { name: "Qwen3 Coder 30B" } },
        },
      },
    });
  });

  it("reads the providers at spawn, not when the client is built", async () => {
    // One `opencode acp` process serves the whole app, so a saved endpoint can only reach it through
    // a respawn of a client that was built long before the save.
    const providers: CustomProviderConfig[] = [];
    const capture = await captureSpawn((cli) => {
      const client = openCode.createClient(cli, 30_000, { customProviders: () => providers });
      providers.push(provider());
      return client;
    });
    expect(capture.config).toContain("studio-local");
  });

  it("keeps the deny-all layer while a profile client carries a provider", async () => {
    // Profile generation must not let the model act. Both layers travel on one environment variable,
    // so a custom provider that replaced the layer rather than joining it would give a one-shot
    // prompt full permissions.
    const capture = await captureSpawn(
      (cli) =>
        openCode.createProfileClient?.(cli, 30_000, { customProviders: () => [provider()] }) ??
        openCode.createClient(cli, 30_000, { customProviders: () => [provider()] }),
    );
    const config = JSON.parse(capture.config ?? "");
    expect(config.permission).toEqual({ "*": "deny" });
    expect(Object.keys(config.provider)).toEqual(["studio-local"]);
  });

  it("sets no config variable at all without a custom provider", async () => {
    const capture = await captureSpawn((cli) => openCode.createClient(cli, 30_000, { customProviders: () => [] }));
    expect(capture.config).toBeNull();
  });
});
