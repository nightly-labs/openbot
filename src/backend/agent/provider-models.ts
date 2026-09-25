import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentModelOption } from "@openbot/contracts/ipc";
import { isFreeOpencodeModel } from "@openbot/contracts/ipc";
import type { AgentProvider } from "./../agent-client";

/**
 * A model name the contract guards accept. `isAgentModelOption` bounds the name, and both the IPC
 * and the Team API list decoders reject the whole array when one option fails, so a name that is one
 * character too long does not shorten a label - it empties the model picker.
 */
export function modelDisplayName(name: string): string {
  return name.slice(0, INPUT_LIMITS.modelName);
}

/**
 * OpenCode models a stored key does not buy, dropped while OpenBot supplies the key.
 *
 * The stored key is an OpenCode Go key: it buys `opencode-go/` and the free tier, not OpenCode
 * Zen. OpenCode reports both products as one catalog although they are two products on two
 * endpoints -- `opencode.ai/zen/v1` and `opencode.ai/zen/go/v1` -- so a stored key also lists
 * Zen models that answer every prompt with "Invalid API key.".
 *
 * The drop applies only while OpenBot is the one supplying the key. With no key stored, a Zen
 * model can only come from the user's own OpenCode sign-in, and that one does buy it.
 *
 * Free is decided by id and display name, after the name is resolved: `isFreeOpencodeModel`
 * is what the picker badges a model with, so the badge and the catalog cannot disagree about
 * what costs money.
 */
export function isOpencodeModelUnusableWithStoredKey(id: string, name: string): boolean {
  const lower = id.toLowerCase();
  if (lower.startsWith("opencode-go/")) return false;
  return lower.startsWith("opencode/") && !isFreeOpencodeModel(id, name);
}

/**
 * Which OpenCode model a new agent runs, as the tier its catalog leads with.
 *
 * A provider with no `defaultProviderModel` falls back to the first model of its catalog, so list
 * position is the default. OpenCode reports the third-party services the user signed in to before
 * its own, so that fallback used to land on `openai/gpt-5.3-codex-spark` and the agent's first
 * message failed with "Token refresh failed: 401" although the free models needed no account.
 *
 * The order is free first, Muse ahead of the rest of the free tier, so nobody is billed for a model
 * they did not choose. Below the free tier come OpenCode's own paid models -- the `opencode-go/`
 * family the stored key buys, and any `opencode/` model behind the user's own OpenCode sign-in --
 * and last the models behind a separate sign-in, whose token OpenBot can neither see nor refresh. That tail matters only for a catalog with no free tier
 * at all; it is the difference between a bad default and an unusable one.
 * Inside one tier the newest version leads, which still keeps a free model first.
 */
function opencodeModelRank(model: AgentModelOption): 0 | 1 | 2 | 3 {
  // Names, not ids, because the price is a naming convention and `isFreeOpencodeModel` is what
  // the picker badges a model with. An id reaches here as the name anyway when the CLI sends no
  // display name, and both spellings carry the same two words.
  if (isFreeOpencodeModel(model.id, model.name)) return /\bmuse\b/i.test(model.name) ? 0 : 1;
  const id = model.id.toLowerCase();
  return id.startsWith("opencode/") || id.startsWith("opencode-go/") ? 2 : 3;
}

export const PREFERRED_MODEL_ORDER: ReadonlyMap<AgentProvider, (model: AgentModelOption) => number> = new Map([
  ["opencode", opencodeModelRank],
]);

/** The first version number in a model name: `[5, 6]` for `GPT-5.6 Sol`, `null` for `gpt-reserve`. */
function modelVersion(name: string): number[] | null {
  const match = /\d+(?:\.\d+)*/u.exec(name);
  return match ? match[0].split(".").map(Number) : null;
}

/**
 * Newest version first, so the picker leads with the latest model. A name with no version goes
 * last, and equal versions compare equal so the CLI's own order stays between them.
 */
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

/**
 * The product name of a Claude model, from its id, or `null` for an id that does not read as one.
 *
 * Claude Code lists a model by the part it plays in that CLI - "Default (recommended)", "Opus" -
 * so its display name says which pick it is there, not which model an agent runs here. The picker
 * puts all three providers side by side, and the other two name a model in full, so the same
 * sentence has to be true of this one: the id carries it, with a release stamp the picker has no
 * use for. `claude-haiku-4-5-20251001` is Claude Haiku 4.5, and `claude-fable-5-1[1m]` is the 1M
 * context window of Claude Fable 5.1.
 */
export function claudeModelName(id: string): string | null {
  const parsed = /^([a-z0-9-]+?)(?:\[([a-z0-9]+)\])?$/u.exec(id.trim().toLowerCase());
  if (!parsed) return null;
  const [, base = "", variant] = parsed;
  const parts = base.split("-");
  if (parts.shift() !== "claude") return null;
  const family = parts.shift();
  if (!family || !/^[a-z]+$/u.test(family)) return null;
  // Eight digits are the build date, which names a release of the model rather than the model.
  const version = parts.filter((part) => !/^\d{8}$/u.test(part));
  if (!version.length || version.some((part) => !/^\d+$/u.test(part))) return null;
  const name = `Claude ${family[0]?.toUpperCase()}${family.slice(1)} ${version.join(".")}`;
  return variant ? `${name} (${variant.toUpperCase()} context)` : name;
}

export const FALLBACK_MODELS: AgentModelOption[] = [
  {
    provider: "codex",
    id: "gpt-6-luna",
    name: "GPT-6 Luna",
    description: "Fast and efficient for everyday agent work.",
    // `DEFAULT_REASONING_EFFORT`, not the `medium` the Codex CLI reports: this is the model a new
    // agent starts on, and the two have to say the same thing.
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
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    provider: "codex",
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    description: "Most capable for complex, long-running work.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
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
