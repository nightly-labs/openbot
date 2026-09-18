// @vitest-environment node
import type { AgentModelOption, AgentProviderId, AgentReasoningEffort } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import {
  DEVELOPMENT_DEFAULT_MODEL,
  DEVELOPMENT_DEFAULT_PROVIDER,
  DEVELOPMENT_DEFAULT_REASONING_EFFORT,
  developmentStartingModel,
} from "./development-defaults";

function model(
  id: string,
  provider: AgentProviderId = DEVELOPMENT_DEFAULT_PROVIDER,
  supportedReasoningEfforts: AgentReasoningEffort[] = ["low", "medium", "high"],
): AgentModelOption {
  return {
    provider,
    id,
    name: id,
    description: "",
    defaultReasoningEffort: "low",
    supportedReasoningEfforts,
  };
}

const available = () => true;
const unavailable = () => false;

describe("development default model", () => {
  it("starts a development build on the asked-for model and effort", () => {
    const chosen = developmentStartingModel({
      enabled: true,
      models: [model("opencode/muse-spark-1.3-contributor-free"), model(DEVELOPMENT_DEFAULT_MODEL)],
      providerAvailable: available,
    });

    expect(chosen?.id).toBe(DEVELOPMENT_DEFAULT_MODEL);
    expect(chosen?.defaultReasoningEffort).toBe(DEVELOPMENT_DEFAULT_REASONING_EFFORT);
  });

  it("leaves a packaged build on the built-in default", () => {
    expect(
      developmentStartingModel({
        enabled: false,
        models: [model(DEVELOPMENT_DEFAULT_MODEL)],
        providerAvailable: available,
      }),
    ).toBeNull();
  });

  it("falls back when the catalog does not list the model", () => {
    // The free tier is what an OpenCode with no Go key lists, and it is not this model.
    expect(
      developmentStartingModel({
        enabled: true,
        models: [model("opencode/muse-spark-1.3-contributor-free")],
        providerAvailable: available,
      }),
    ).toBeNull();
  });

  it("falls back when OpenCode is listed but has no credential", () => {
    expect(
      developmentStartingModel({
        enabled: true,
        models: [model(DEVELOPMENT_DEFAULT_MODEL)],
        providerAvailable: unavailable,
      }),
    ).toBeNull();
  });

  it("keeps the model's own effort when it does not support the asked-for one", () => {
    const chosen = developmentStartingModel({
      enabled: true,
      models: [model(DEVELOPMENT_DEFAULT_MODEL, DEVELOPMENT_DEFAULT_PROVIDER, ["low"])],
      providerAvailable: available,
    });

    expect(chosen?.defaultReasoningEffort).toBe("low");
  });

  it("does not take the model of another provider that shares the id", () => {
    expect(
      developmentStartingModel({
        enabled: true,
        models: [model(DEVELOPMENT_DEFAULT_MODEL, "codex")],
        providerAvailable: available,
      }),
    ).toBeNull();
  });
});
