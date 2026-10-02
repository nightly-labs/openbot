// The text of the landing sections under the hero. The questions are in
// `landing-faq.ts`.
//
// No JSX here, for the same reason `content-collection.ts` holds none.

import type { LandingIconName } from "../components/landing/LandingIcon";
import { COMPARE_COLLECTION } from "./compare";

export interface LandingFeature {
  icon: LandingIconName;
  title: string;
  description: string;
}

export const LANDING_FEATURES: readonly LandingFeature[] = [
  {
    icon: "users",
    title: "A team, not one chat",
    description:
      "Each agent has its own name, instructions and workspace. Agents send each other messages, hand off tasks and share files.",
  },
  {
    icon: "laptop",
    title: "Agents that stay",
    description:
      "An agent keeps its workspace and conversation when you restart the app or move it to a different provider.",
  },
  {
    icon: "cpu",
    title: "The AI you already pay for",
    description:
      "Run Codex, Claude Code, Gemini, Grok, OpenCode, Cursor or Cline. Or connect an OpenAI-compatible endpoint, Ollama or LM Studio.",
  },
  {
    icon: "lock",
    title: "Your data stays with you",
    description:
      "Workspaces, conversations, files and browser data stay on the computer that runs OpenBot, not on our servers.",
  },
];

export interface LandingStep {
  title: string;
  description: string;
}

export const LANDING_STEPS: readonly LandingStep[] = [
  {
    title: "Download OpenBot",
    description: "Install it on macOS 13 or newer, Windows 10 or newer, or Linux.",
  },
  {
    title: "Connect your AI",
    description: "Choose Codex, Claude, Gemini, Grok or another provider, with your plan, an API key or a local model.",
  },
  {
    title: "Create an agent",
    description:
      "Describe the agent in one prompt and check its instructions before you save. Then give it work: messages wait in a queue until it is free.",
  },
];

export interface LandingComparisonLink {
  slug: string;
  label: string;
}

/**
 * Every comparison, labelled "OpenBot vs …": each title starts with that, and
 * the part after the colon is too long for a link in a row.
 */
export const LANDING_COMPARISON_LINKS: readonly LandingComparisonLink[] = COMPARE_COLLECTION.articles.map(
  (article) => ({ slug: article.slug, label: article.title.split(":")[0] ?? article.title }),
);
