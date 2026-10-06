// The text of the landing sections under the hero. The questions are in
// `landing-faq.ts`.
//
// No JSX here, for the same reason `content-collection.ts` holds none.

import type { ProviderLogoVariant } from "@openbot/brand";
import type { AvatarHue } from "@openbot/contracts/ipc";
import { RIVAL_MARK_SHAPES, type RivalMarkName } from "../components/compare/rival-mark-shapes";
import { COMPARE_COLLECTION } from "./compare";

/** Each feature has its own picture, which the section draws for this id. */
export type LandingFeatureId = "team" | "providers" | "local" | "persist" | "browser" | "queue";

/** A part of a tile's sentence: plain text, or words that link to a page under /providers. */
type LandingCopyPart = string | { readonly text: string; readonly slug: string };

export interface LandingFeature {
  id: LandingFeatureId;
  title: string;
  /** Plain text, or parts when some words link to a page. A tile's picture is decorative, so the links are here. */
  description: string | readonly LandingCopyPart[];
}

/** In reading order. The bento places each tile from its id. */
export const LANDING_FEATURES: readonly LandingFeature[] = [
  {
    id: "team",
    title: "Agents work as a team",
    description:
      "Each agent has its own name, instructions and workspace. Agents send each other messages, hand off tasks and share files.",
  },
  {
    id: "providers",
    title: "Use the AI plan you have",
    description: [
      "Run ",
      { text: "Codex", slug: "codex" },
      ", ",
      { text: "Claude Code", slug: "claude-code" },
      ", ",
      { text: "Gemini", slug: "gemini" },
      ", ",
      { text: "Grok", slug: "grok" },
      ", ",
      { text: "OpenCode", slug: "opencode" },
      ", ",
      { text: "Cursor", slug: "cursor" },
      " or ",
      { text: "Cline", slug: "cline" },
      ". Or connect an OpenAI-compatible endpoint, ",
      { text: "Ollama or LM Studio", slug: "local-models" },
      ".",
    ],
  },
  {
    id: "local",
    title: "Stored on your computer",
    description:
      "Workspaces, conversations, files and browser data stay on the computer that runs OpenBot, not on our servers.",
  },
  {
    id: "persist",
    title: "Change the provider, keep the agent",
    description:
      "An agent keeps its workspace and conversation when you restart the app or move it to a different provider.",
  },
  {
    id: "browser",
    title: "A built-in browser",
    description: "Agents open, read and control pages in a browser that is built into OpenBot.",
  },
  {
    id: "queue",
    title: "Queue the next task",
    description:
      "Send more work while an agent is busy. Messages wait in a queue that you can pause, resume or cancel.",
  },
];

export interface LandingTeammate {
  name: string;
  avatarSeed: string;
  avatarHue: AvatarHue;
}

const ADA: LandingTeammate = { name: "Ada", avatarSeed: "landing-ada", avatarHue: 245 };
const LINUS: LandingTeammate = { name: "Linus", avatarSeed: "landing-linus", avatarHue: 150 };
const GRACE: LandingTeammate = { name: "Grace", avatarSeed: "landing-grace", avatarHue: 30 };

/** The agent who moves to a different provider in the persist picture. */
export const LANDING_PERSIST_AGENT = ADA;

/** The members of the channel in the team picture. */
export const LANDING_TEAM: readonly LandingTeammate[] = [ADA, LINUS, GRACE];

export interface LandingTeamMessage {
  from: LandingTeammate;
  time: string;
  text: string;
}

/** The example conversation in the team picture: one task, handed from agent to agent. */
export const LANDING_TEAM_MESSAGES: readonly LandingTeamMessage[] = [
  { from: ADA, time: "9:12", text: "The sign-in test fails on Safari. Linus, can you take it?" },
  { from: LINUS, time: "9:26", text: "Fixed in session.ts. Grace, can you review it?" },
  { from: GRACE, time: "9:31", text: "Looks good. I merged it." },
];

/** The message that replaces the typing dots when the pointer is on the tile. */
export const LANDING_TEAM_REPLY: LandingTeamMessage = {
  from: ADA,
  time: "9:32",
  text: "Thanks. I closed the issue.",
};

/** The channel the team picture shows, and the line OpenBot writes when the task changes owner. */
export const LANDING_TEAM_CHANNEL = "launch";
export const LANDING_TEAM_HANDOFF = "Ada gave the task to Linus";

export interface LandingProvider {
  provider: ProviderLogoVariant;
  name: string;
}

const CODEX: LandingProvider = { provider: "codex", name: "Codex" };
const CLAUDE_CODE: LandingProvider = { provider: "claude", name: "Claude Code" };

export const LANDING_PROVIDERS: readonly LandingProvider[] = [
  CODEX,
  CLAUDE_CODE,
  { provider: "antigravity", name: "Gemini" },
  { provider: "grok", name: "Grok" },
  { provider: "opencode", name: "OpenCode" },
  { provider: "cursor", name: "Cursor" },
  { provider: "cline", name: "Cline" },
];

export interface LandingPersistReply {
  from: LandingProvider;
  time: string;
  text: string;
}

/**
 * The chat in the persist picture. Ada does a task on Codex. On hover, she moves
 * to Claude Code and continues the same task.
 */
export const LANDING_PERSIST_EARLIER: LandingPersistReply = {
  from: CODEX,
  time: "9:58",
  text: "I read the billing code. Six tables use it.",
};
export const LANDING_PERSIST_REQUEST = "Move the billing tables to their own schema.";
export const LANDING_PERSIST_BEFORE: LandingPersistReply = {
  from: CODEX,
  time: "10:04",
  text: "Done. I changed 4 files and wrote the migration.",
};
export const LANDING_PERSIST_SWITCH = `${ADA.name} now uses ${CLAUDE_CODE.name}`;
export const LANDING_PERSIST_AFTER: LandingPersistReply = {
  from: CLAUDE_CODE,
  time: "10:06",
  text: "I continue from the billing migration. Next is its test.",
};

/** What stays on the computer that runs OpenBot. */
export const LANDING_LOCAL_DATA: readonly string[] = ["Workspaces", "Conversations", "Files", "Browser data"];

/**
 * The queue picture copies the app's queue panel, which sits on top of the
 * composer. On hover, the message in the composer joins the queue.
 */
export const LANDING_QUEUE: readonly string[] = ["Summarize the support inbox", "Draft the release notes"];
export const LANDING_QUEUE_DRAFT = "Check the new sign-ups";
export const LANDING_QUEUE_HOLD = `Waiting - ${LINUS.name} is working in #${LANDING_TEAM_CHANNEL}`;
export const LANDING_QUEUE_PLACEHOLDER = `Message ${LINUS.name}`;
export const LANDING_QUEUE_STEER = "Steer";

/**
 * The browser picture copies the app's browser panel. Grace checks the sign-in
 * page that Linus fixed in the team picture. The first tab is the one she controls.
 */
export const LANDING_BROWSER_TABS: readonly string[] = ["Sign in", "Dashboard"];
export const LANDING_BROWSER_URL = "localhost:3000/sign-in";
export const LANDING_BROWSER_HEADING = "Sign in";
export const LANDING_BROWSER_FIELD = "Email";
export const LANDING_BROWSER_TYPED = "grace@acme.test";
export const LANDING_BROWSER_SUBMIT = "Continue";

/** What the folder list in the data picture shows. */
export const LANDING_LOCAL_TITLE = "On this computer";

export interface LandingComparisonLink {
  slug: string;
  /** The article title, which the card's gradient is drawn from, as on the compare pages. */
  title: string;
  label: string;
  mark: RivalMarkName;
}

function isRivalMarkName(slug: string): slug is RivalMarkName {
  return Object.hasOwn(RIVAL_MARK_SHAPES, slug);
}

/**
 * Every OpenBot comparison, labelled "OpenBot vs …": each title starts with
 * that, and the part after the colon is too long for a card. The slug of each is
 * also the name of the compared product's mark. A matchup or the roundup has a
 * slug that names no mark, so it is not in this list.
 */
export const LANDING_COMPARISON_LINKS: readonly LandingComparisonLink[] = COMPARE_COLLECTION.articles.flatMap(
  (article) =>
    isRivalMarkName(article.slug)
      ? [
          {
            slug: article.slug,
            title: article.title,
            label: article.title.split(":")[0] ?? article.title,
            mark: article.slug,
          },
        ]
      : [],
);
