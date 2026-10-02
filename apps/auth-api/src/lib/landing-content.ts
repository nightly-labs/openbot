// The text of the landing sections under the hero. The questions are in
// `landing-faq.ts`.
//
// No JSX here, for the same reason `content-collection.ts` holds none.

import type { ProviderLogoVariant } from "@openbot/brand";
import type { AvatarHue } from "@openbot/contracts/ipc";
import { RIVAL_MARK_SHAPES, type RivalMarkName } from "../components/compare/rival-mark-shapes";
import { COMPARE_COLLECTION } from "./compare";

/** Each feature has its own picture, which the section draws for this id. */
export type LandingFeatureId = "team" | "providers" | "persist" | "local";

export interface LandingFeature {
  id: LandingFeatureId;
  title: string;
  description: string;
}

export const LANDING_FEATURES: readonly LandingFeature[] = [
  {
    id: "team",
    title: "A team, not one chat",
    description:
      "Each agent has its own name, instructions and workspace. Agents send each other messages, hand off tasks and share files.",
  },
  {
    id: "providers",
    title: "The AI you already pay for",
    description:
      "Run Codex, Claude Code, Gemini, Grok, OpenCode, Cursor or Cline. Or connect an OpenAI-compatible endpoint, Ollama or LM Studio.",
  },
  {
    id: "persist",
    title: "Agents that stay",
    description:
      "An agent keeps its workspace and conversation when you restart the app or move it to a different provider.",
  },
  {
    id: "local",
    title: "Your data stays with you",
    description:
      "Workspaces, conversations, files and browser data stay on the computer that runs OpenBot, not on our servers.",
  },
];

export interface LandingTeammate {
  name: string;
  avatarSeed: string;
  avatarHue: AvatarHue;
  message: string;
}

/** The example conversation in the team picture: one task, handed from agent to agent. */
export const LANDING_TEAM: readonly LandingTeammate[] = [
  { name: "Ada", avatarSeed: "landing-ada", avatarHue: 245, message: "I found the cause. Linus, the fix is yours." },
  { name: "Linus", avatarSeed: "landing-linus", avatarHue: 150, message: "Fix is ready. Grace, can you review it?" },
  { name: "Grace", avatarSeed: "landing-grace", avatarHue: 30, message: "Approved. I sent the notes to the team." },
];

export interface LandingProvider {
  provider: ProviderLogoVariant;
  name: string;
}

export const LANDING_PROVIDERS: readonly LandingProvider[] = [
  { provider: "codex", name: "Codex" },
  { provider: "claude", name: "Claude Code" },
  { provider: "antigravity", name: "Gemini" },
  { provider: "grok", name: "Grok" },
  { provider: "opencode", name: "OpenCode" },
  { provider: "cursor", name: "Cursor" },
  { provider: "cline", name: "Cline" },
];

/** What an agent keeps when it moves to a different provider. */
export const LANDING_KEPT_STATE: readonly string[] = ["Workspace", "Conversation", "Name and instructions"];

/** What stays on the computer that runs OpenBot. */
export const LANDING_LOCAL_DATA: readonly string[] = ["Workspaces", "Conversations", "Files", "Browser data"];

/** Each step has its own picture, which the section draws for this id. */
export type LandingStepId = "download" | "connect" | "create";

export interface LandingStep {
  id: LandingStepId;
  title: string;
  description: string;
}

export const LANDING_STEPS: readonly LandingStep[] = [
  {
    id: "download",
    title: "Download OpenBot",
    description: "Install it on macOS 13 or newer, Windows 10 or newer, or Linux.",
  },
  {
    id: "connect",
    title: "Connect your AI",
    description: "Choose Codex, Claude, Gemini, Grok or another provider, with your plan, an API key or a local model.",
  },
  {
    id: "create",
    title: "Create an agent",
    description:
      "Describe the agent in one prompt and check its instructions before you save. Then give it work: messages wait in a queue until it is free.",
  },
];

/** The example prompt in the last step's picture. */
export const LANDING_EXAMPLE_PROMPT = "An agent that reads my inbox each morning and drafts the replies";

export interface LandingComparisonLink {
  slug: string;
  label: string;
  mark: RivalMarkName;
}

function isRivalMarkName(slug: string): slug is RivalMarkName {
  return Object.hasOwn(RIVAL_MARK_SHAPES, slug);
}

/**
 * Every comparison, labelled "OpenBot vs …": each title starts with that, and
 * the part after the colon is too long for a card. Each slug is also the name
 * of the compared product's mark.
 */
export const LANDING_COMPARISON_LINKS: readonly LandingComparisonLink[] = COMPARE_COLLECTION.articles.flatMap(
  (article) =>
    isRivalMarkName(article.slug)
      ? [{ slug: article.slug, label: article.title.split(":")[0] ?? article.title, mark: article.slug }]
      : [],
);
