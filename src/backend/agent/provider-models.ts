import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentModelOption } from "@openbot/contracts/ipc";
import { isFreeOpencodeModel, OPENCODE_RECOMMENDED_FREE_MODELS } from "@openbot/contracts/ipc";
import type { AgentProvider } from "./../agent-client";
import type { ModelListResponse } from "./../protocol";

export function modelDisplayName(name: string): string {
  return name.slice(0, INPUT_LIMITS.modelName);
}

function opencodeModelRank(model: AgentModelOption): number {
  const recommended = OPENCODE_RECOMMENDED_FREE_MODELS.length;
  if (isFreeOpencodeModel(model.id, model.name)) {
    const place = OPENCODE_RECOMMENDED_FREE_MODELS.indexOf(model.id.toLowerCase());
    return place >= 0 ? place : recommended;
  }
  const id = model.id.toLowerCase();
  return id.startsWith("opencode/") || id.startsWith("opencode-go/") ? recommended + 1 : recommended + 2;
}

export const PREFERRED_MODEL_ORDER: ReadonlyMap<AgentProvider, (model: AgentModelOption) => number> = new Map([
  ["opencode", opencodeModelRank],
]);

function modelVersion(name: string): number[] | null {
  const match = /(?<![\d.])\d+(?:\.\d+)*(?![\d.]|[bkmt]\b)/iu.exec(name);
  return match ? match[0].split(".").map(Number) : null;
}

export function compareModelVersions(left: AgentModelOption, right: AgentModelOption): number {
  const a = modelVersion(left.name);
  const b = modelVersion(right.name);
  if (!a || !b) return Number(!a) - Number(!b);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (b[index] ?? 0) - (a[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

const MODEL_VARIANT_PARTS = new Set([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "thinking",
  "latest",
  "preview",
]);

function modelFamily(id: string): string | null {
  const [, base = "", window = ""] = /^(.*?)(\[[^\]]*\])?$/u.exec(id.trim().toLowerCase()) ?? [];
  const parts = base
    .split(/[-_/]/u)
    .filter((part) => /[a-z]/u.test(part) && !MODEL_VARIANT_PARTS.has(part) && !/^v?\d[\d.]*$/u.test(part));
  return parts.length > 0 ? `${parts.join("-")}${window}` : null;
}

export function newestOfFamily(models: readonly AgentModelOption[], modelId: string): AgentModelOption | null {
  const family = modelFamily(modelId);
  if (!family) return null;
  const variant = modelVariant(modelId);
  const sameVariant = (model: AgentModelOption) => Number(modelVariant(model.id) !== variant);
  return (
    models
      .filter((model) => modelFamily(model.id) === family)
      .map((model) => ({ model, version: { ...model, name: model.name.slice(model.name.lastIndexOf("/") + 1) } }))
      .sort(
        (left, right) =>
          compareModelVersions(left.version, right.version) || sameVariant(left.model) - sameVariant(right.model),
      )[0]?.model ?? null
  );
}

function modelVariant(id: string): string {
  return id
    .toLowerCase()
    .split(/[-_/]/u)
    .filter((part) => MODEL_VARIANT_PARTS.has(part))
    .sort()
    .join("-");
}

export function claudeModelName(id: string): string | null {
  const parsed = /^([a-z0-9-]+?)(?:\[([a-z0-9]+)\])?$/u.exec(id.trim().toLowerCase());
  if (!parsed) return null;
  const [, base = "", variant] = parsed;
  const parts = base.split("-");
  if (parts.shift() !== "claude") return null;
  const family = parts.shift();
  if (!family || !/^[a-z]+$/u.test(family)) return null;
  const version = parts.filter((part) => !/^\d{8}$/u.test(part));
  if (!version.length || version.some((part) => !/^\d+$/u.test(part))) return null;
  const name = `Claude ${family[0]?.toUpperCase()}${family.slice(1)} ${version.join(".")}`;
  return variant ? `${name} (${variant.toUpperCase()} context)` : name;
}

export const OPENCODE_FREE_MODEL_FALLBACKS: AgentModelOption[] = [
  {
    provider: "opencode",
    id: "opencode/beam-free",
    name: "Beam Free",
    description: "Free OpenCode model.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    provider: "opencode",
    id: "opencode/big-pickle",
    name: "Big Pickle",
    description: "Free OpenCode model.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["medium"],
    reasoningEffortConfigurable: false,
  },
  {
    provider: "opencode",
    id: "opencode/glm-5.3-flash-free",
    name: "GLM-5.3-Flash Free",
    description: "Free OpenCode model.",
    defaultReasoningEffort: "low",
    supportedReasoningEfforts: ["low", "high", "max"],
  },
  {
    provider: "opencode",
    id: "opencode/deepseek-v4.1-flash-free",
    name: "DeepSeek V4.1 Flash Free",
    description: "Free OpenCode model.",
    defaultReasoningEffort: "low",
    supportedReasoningEfforts: ["low", "high", "max"],
  },
  {
    provider: "opencode",
    id: "opencode/flint-40b-free",
    name: "Flint 40B Free",
    description: "Free OpenCode model.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    provider: "opencode",
    id: "opencode/iceman-free",
    name: "Iceman Free",
    description: "Free OpenCode model.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["medium"],
    reasoningEffortConfigurable: false,
  },
  {
    provider: "opencode",
    id: "opencode/inkling-2-small-free",
    name: "Inkling 2 Small Free",
    description: "Free OpenCode model.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["none", "minimal", "low", "medium", "high", "max"],
  },
  {
    provider: "opencode",
    id: "opencode/longcat-2.5-free",
    name: "LongCat 2.5 Free",
    description: "Free OpenCode model.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["medium"],
    reasoningEffortConfigurable: false,
  },
  {
    provider: "opencode",
    id: "opencode/mimo-v2.6-flash-free",
    name: "MiMo-V2.6-Flash Free",
    description: "Free OpenCode model.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["medium"],
    reasoningEffortConfigurable: false,
  },
  {
    provider: "opencode",
    id: "opencode/minimax-m3.1-flash-free",
    name: "MiniMax M3.1 Flash Free",
    description: "Free OpenCode model.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    provider: "opencode",
    id: "opencode/nemotron-3.5-lightning-free",
    name: "Nemotron 3.5 Lightning Free",
    description: "Free OpenCode model.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["medium"],
    reasoningEffortConfigurable: false,
  },
  {
    provider: "opencode",
    id: "opencode/nemotron-3.5-super-vl-free",
    name: "Nemotron 3.5 Super VL Free",
    description: "Free OpenCode model.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["none", "minimal", "low", "medium", "high", "xhigh"],
  },
];

export const FALLBACK_MODELS: AgentModelOption[] = [
  {
    provider: "codex",
    id: "gpt-6-luna",
    name: "GPT-6 Luna",
    description: "Fast and efficient for everyday agent work.",
    defaultReasoningEffort: "low",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    provider: "codex",
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    description: "Older fast and efficient model.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    provider: "codex",
    id: "gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    description: "Balanced speed and capability for involved tasks.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
  },
  {
    provider: "codex",
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    description: "Most capable for complex, long-running work.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
  },
  {
    provider: "claude",
    id: "claude-haiku-5-5",
    name: "Claude Haiku 5.5",
    description: "",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["medium"],
  },
  {
    provider: "claude",
    id: "claude-opus-5-5",
    name: "Claude Opus 5.5",
    description: "Most capable Claude model for complex work.",
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    provider: "claude",
    id: "claude-fable-5",
    name: "Claude Fable 5",
    description: "Fast Claude model for everyday agent work.",
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    provider: "claude",
    id: "claude-opus-5",
    name: "Claude Opus 5",
    description: "Most capable Claude model for complex work.",
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    provider: "claude",
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5",
    description: "Balanced Claude model for general agent work.",
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
  },
];

export function modelsAfterOpenCodeDiscoveryFailure(previous: AgentModelOption[]): AgentModelOption[] {
  return previous.length ? previous : OPENCODE_FREE_MODEL_FALLBACKS;
}

export function serviceTierFields(server: ModelListResponse["data"][number]): {
  fastServiceTier?: string;
  ultrafastServiceTier?: string;
} {
  const named = (name: string) =>
    server.serviceTiers?.find((candidate) => candidate.name?.trim().toLowerCase() === name)?.id;
  const usable = (tier: string | undefined): tier is string =>
    tier !== undefined && tier.length <= INPUT_LIMITS.serviceTier;
  const fast = named("fast") ?? (server.additionalSpeedTiers?.includes("fast") ? "fast" : undefined);
  const ultrafast = named("ultrafast");
  if (!usable(fast)) return {};
  return { fastServiceTier: fast, ...(usable(ultrafast) ? { ultrafastServiceTier: ultrafast } : {}) };
}
