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
      ", ",
      { text: "Cline", slug: "cline" },
      ", ",
      { text: "Muse Code", slug: "muse-code" },
      ", ",
      { text: "Pi", slug: "pi" },
      " or ",
      { text: "Mercury", slug: "inception" },
      ". Or add ",
      { text: "an ACP agent", slug: "custom-agents" },
      ", an OpenAI-compatible endpoint, ",
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
      "An agent keeps its workspace and conversation when you restart the app or move it to a different provider. When a plan reaches its limit, it can move to a backup model.",
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

/** The provider of each agent in the network picture. Ada starts on Codex, as in the persist picture. */
export const LANDING_NETWORK_AGENTS: readonly { teammate: LandingTeammate; provider: ProviderLogoVariant }[] = [
  { teammate: ADA, provider: "codex" },
  { teammate: LINUS, provider: "claude" },
  { teammate: GRACE, provider: "antigravity" },
];

/** The words of the network heading appear one at a time. */
export const LANDING_NETWORK_TITLE: readonly string[] = ["Your", "agents", "talk", "to", "each", "other."];
export const LANDING_NETWORK_DESCRIPTION =
  "They ask, hand off and review. Add agents, and the team grows around the work.";
/** The name under the mark at the centre of the network picture. */
export const LANDING_NETWORK_HUB = "OpenBot";

/** What the network says in its easter eggs. Each reaction chooses one line of its list at random. */
export const LANDING_NETWORK_EGGS = {
  /** The visitor types "hello". */
  greetings: ["Hi!", "Hello.", "Hey there.", "Oh, hi.", "Good to see you.", "Hello, human.", "Welcome back."],
  /** The visitor types the Konami code. */
  konami: ["Cheat code accepted.", "Thirty extra agents.", "Achievement unlocked."],
  /** The visitor types "party". */
  party: ["Party mode.", "Who brought the confetti?", "Dance break."],
  /** The visitor types "sudo". */
  sudo: ["This incident will be reported.", "Nice try.", "You are not in the sudoers file."],
  /** The hub after quick clicks: 3, 5 and 8 in a row. 12 makes it sneeze. */
  tickle: ["That tickles.", "Hey.", "I felt that."],
  awake: ["Okay, okay. I am awake.", "Yes? Can I help you?", "I am listening."],
  busy: ["Please. I am routing messages.", "I have work to do.", "Stop that, please."],
  /** The agents answer the hub at 5 clicks. */
  wonder: ["What was that?", "Did you feel that?", "Is the hub okay?"],
  sneeze: ["Achoo!", "Ah… choo!"],
  blessings: ["Bless you.", "Gesundheit.", "Salud.", "Bless you!"],
  /** The agents wake up after the visitor leaves the page alone. */
  wake: [
    "I was not asleep.",
    "Just resting my tokens.",
    "Back to work.",
    "Who turned off the lights?",
    "Five more minutes.",
  ],
  /** Agents answer a click: a signal from the hub, or a new network that grows from an agent. */
  chats: [
    "On it.",
    "Got it. Starting now.",
    "Tests pass on my side.",
    "I can take the review.",
    "I pushed a fix.",
    "Who has the Safari task?",
    "Done. Over to you.",
    "I need one more file.",
    "Merged.",
    "The build is green.",
    "I found the bug.",
    "Can someone review my branch?",
    "Ship it.",
    "Give me five minutes.",
    "I wrote the release notes.",
  ],
  /** An agent under a still pointer. */
  hover: [
    "I only look busy.",
    "Ask me about the Safari task.",
    "I read the whole repository. Twice.",
    "My context window has room for you.",
    "Please do not close this tab.",
    "I fixed one bug and found three.",
    "I run on your computer, not in a cloud.",
  ],
} satisfies Record<string, readonly string[]>;

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
 * The landing cards, best-known product first. A comparison that is not in this
 * list comes after these, newest first.
 */
const LANDING_COMPARISON_ORDER: readonly RivalMarkName[] = [
  "grok-bot",
  "hermes-agent",
  "muse",
  "openclaw",
  "claude-cowork",
  "chatgpt-dots",
  "manus",
  "devin",
  "paperclip",
  "viktor",
  "instinct",
];

function landingRank(slug: RivalMarkName): number {
  const rank = LANDING_COMPARISON_ORDER.indexOf(slug);
  return rank === -1 ? LANDING_COMPARISON_ORDER.length : rank;
}

/**
 * Every OpenBot comparison, labelled "OpenBot vs …": each title starts with
 * that, and the part after the colon is too long for a card. The slug of each is
 * also the name of the compared product's mark. A matchup or the roundup has a
 * slug that names no mark, so it is not in this list.
 */
export const LANDING_COMPARISON_LINKS: readonly LandingComparisonLink[] = COMPARE_COLLECTION.articles
  .flatMap((article) =>
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
  )
  .toSorted((left, right) => landingRank(left.mark) - landingRank(right.mark));

/** Each offer of OpenBot for Teams has its own colour and icon, which the section sets for this id. */
export type LandingTeamsOfferId = "servers" | "environments" | "integrations" | "support";

export interface LandingTeamsOffer {
  id: LandingTeamsOfferId;
  label: string;
  title: string;
  description: string;
}

/** In reading order. Each offer is one card of the stack. */
export const LANDING_TEAMS_OFFERS: readonly LandingTeamsOffer[] = [
  {
    id: "servers",
    label: "Managed servers",
    title: "Always on",
    description: "Agents run on managed servers, not on someone’s laptop.",
  },
  {
    id: "environments",
    label: "Team environments",
    title: "Shared or personal",
    description: "One company server, one per employee, or both.",
  },
  {
    id: "integrations",
    label: "Custom integrations",
    title: "Your tools",
    description: "We connect OpenBot to your systems, APIs and workflows.",
  },
  {
    id: "support",
    label: "Implementation and support",
    title: "We launch it with you",
    description: "Setup, testing, onboarding and ongoing support.",
  },
];
