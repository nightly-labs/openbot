import { readdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { agentProviderDescriptor } from "@openbot/contracts/agent-providers";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { bf16Models } from "./bf16-catalog";
import { BF16_MODELS } from "./bf16-models";
import { createPiKeyExtension } from "./pi-key-providers";

describe("bf16 catalog", () => {
  it("keeps active tool-calling models and smart routers while dropping inactive or non-tool models", () => {
    const models = bf16Models([
      {
        id: "deepseek/deepseek-v4.1-flash-uncensored",
        name: "DeepSeek V4.1 Flash (Uncensored)",
        context_window: 1_048_576,
        max_output_tokens: 130_000,
        supports_reasoning: true,
        supports_tools: true,
        supports_vision: true,
        supported_parameters: ["tools", "reasoning_effort"],
        bf16: {
          status: "active",
          pricing_usd_per_1m: { input: "0.26", cached_input: "0.045", output: "1.00" },
        },
      },
      {
        id: "bf16/auto",
        bf16: { family: "router", modification_method: "smart_router" },
      },
      {
        id: "inactive/model",
        supports_tools: true,
        bf16: { status: "deprecated" },
      },
      {
        id: "no-tools/model",
        supports_tools: false,
        bf16: { status: "active" },
      },
    ]);

    expect(models.map((model) => model.id)).toEqual(["bf16/auto", "deepseek/deepseek-v4.1-flash-uncensored"]);
    expect(models[1]).toMatchObject({
      id: "deepseek/deepseek-v4.1-flash-uncensored",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 1_048_576,
      maxTokens: 130_000,
      cost: { input: 0.26, output: 1, cacheRead: 0.045, cacheWrite: 0 },
      compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: true },
    });
  });

  it("bundles the default bf16 model with valid Pi metadata", () => {
    const defaultId = agentProviderDescriptor("bf16").defaultModel;
    const match = BF16_MODELS.find((model) => model.id === defaultId);
    expect(match).toBeDefined();
    expect(match?.contextWindow).toBeGreaterThanOrEqual(128_000);
    expect(match?.input).toContain("image");
  });

  it("writes a key-free Pi extension and sidecar model list for bf16", async () => {
    const fakeKey = ["sk", "bf16", "v1", "unit-test-secret"].join("-");
    const ext = await Effect.runPromise(createPiKeyExtension("bf16", fakeKey));
    try {
      expect(ext.environment.OPENBOT_PI_BF16_API_KEY).toBe(fakeKey);
      expect(ext.environment.OPENBOT_PI_BF16_MODELS).toBeTruthy();
      expect(ext.secrets).toContain(fakeKey);

      const folder = dirname(ext.path);
      const files = await readdir(folder);
      expect(files).toContain("bf16.mjs");
      expect(files).toContain("bf16-models.json");

      for (const file of files) {
        const content = await readFile(`${folder}/${file}`, "utf8");
        expect(content).not.toContain(fakeKey);
      }

      const extensionSource = await readFile(ext.path, "utf8");
      expect(extensionSource).toContain("https://api.bf16.ai/v1");
      expect(extensionSource).toContain("delete process.env.OPENBOT_PI_BF16_API_KEY");
    } finally {
      await Effect.runPromise(ext.close());
    }
  });
});
