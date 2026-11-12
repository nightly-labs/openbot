// The parts of the landing sections that do not change with the language: ids, agents, providers,
// times and links. The text is in the `sitePage.landing.*` catalog keys, which
// `landing-page-text.ts` reads.
//
// No JSX here, for the same reason `content-collection.ts` holds none.

import type { ProviderLogoVariant } from "@openbot/brand";
import type { AvatarHue } from "@openbot/contracts/ipc";
import { RIVAL_MARK_SHAPES, type RivalMarkName } from "../components/compare/rival-mark-shapes";
import { COMPARE_COLLECTION } from "./compare";

/** Each feature has its own picture, which the section draws for this id. */
export type LandingFeatureId = "team" | "providers" | "local" | "multiplayer" | "workflows" | "persist";

/** In reading order. The bento places each tile from its id. */
export const LANDING_FEATURE_IDS: readonly LandingFeatureId[] = [
  "team",
  "providers",
  "local",
  "workflows",
  "multiplayer",
  "persist",
];

export interface LandingTeammate {
  name: string;
  avatarSeed: string;
  avatarHue: AvatarHue;
}

/** Also the agent who moves to a different provider in the persist picture. */
export const ADA: LandingTeammate = { name: "Ada", avatarSeed: "landing-ada", avatarHue: 245 };
export const LINUS: LandingTeammate = { name: "Linus", avatarSeed: "landing-linus", avatarHue: 150 };
const GRACE: LandingTeammate = { name: "Grace", avatarSeed: "landing-grace", avatarHue: 30 };
const ALAN: LandingTeammate = { name: "Alan", avatarSeed: "landing-alan", avatarHue: 185 };

/** The members of the channel in the team picture. */
export const LANDING_TEAM: readonly LandingTeammate[] = [ADA, LINUS, GRACE];

/** Who sends each message of the team picture, and when. The text is `picture.team.messages`. */
export interface LandingTeamSender {
  from: LandingTeammate;
  time: string;
}

/** The example conversation in the team picture: one task, handed from agent to agent. */
export const LANDING_TEAM_SENDERS: readonly LandingTeamSender[] = [
  { from: ADA, time: "9:12" },
  { from: LINUS, time: "9:26" },
  { from: GRACE, time: "9:31" },
];

/** The message that replaces the typing dots when the pointer is on the tile. */
export const LANDING_TEAM_REPLY_SENDER: LandingTeamSender = { from: ADA, time: "9:32" };

/** How a drawn face wears its hair. */
export type LandingHair = "long" | "short" | "curly";

/** One more detail that makes a drawn face easy to tell apart at a small size. */
type LandingFaceDetail = "none" | "glasses" | "freckles";

/**
 * A person in the multiplayer picture. A person has a drawn face, not an agent avatar. `id` selects
 * the colours of the face in the stylesheet.
 */
export interface LandingPerson {
  id: "maya" | "sam" | "theo";
  name: string;
  hair: LandingHair;
  detail: LandingFaceDetail;
}

const MAYA: LandingPerson = { id: "maya", name: "Maya", hair: "long", detail: "none" };
const SAM: LandingPerson = { id: "sam", name: "Sam", hair: "short", detail: "glasses" };

/** Who sends each message of the multiplayer picture, and when. The text is `picture.multiplayer.messages`. */
export type LandingMultiplayerSender =
  | { kind: "person"; from: LandingPerson; time: string }
  | { kind: "agent"; from: LandingTeammate; time: string };

/** People and agents in one channel: Maya asks Ada, and Ada hands the result to Sam. */
export const LANDING_MULTIPLAYER_SENDERS: readonly LandingMultiplayerSender[] = [
  { kind: "person", from: MAYA, time: "11:02" },
  { kind: "agent", from: ADA, time: "11:05" },
  { kind: "person", from: SAM, time: "11:09" },
];

/** The members of the multiplayer channel. On hover, the invited person joins the stack. */
export const LANDING_MULTIPLAYER_PEOPLE: readonly LandingPerson[] = [MAYA, SAM];
export const LANDING_MULTIPLAYER_AGENTS: readonly LandingTeammate[] = [ADA, LINUS];
export const LANDING_MULTIPLAYER_INVITED: LandingPerson = {
  id: "theo",
  name: "Theo",
  hair: "curly",
  detail: "freckles",
};

/** The agent steps of the workflow picture. The text of each step is `picture.workflows.<id>`. */
type LandingWorkflowAgentId = "issues" | "usage" | "report" | "charts";
export type LandingWorkflowStepId = "trigger" | LandingWorkflowAgentId | "approval";

export interface LandingWorkflowAgent {
  id: LandingWorkflowAgentId;
  teammate: LandingTeammate;
  provider: ProviderLogoVariant;
  /** The column of the step: the first two agents run at the same time, then the next two. */
  column: 1 | 2;
  /** 0 is the top lane, 1 is the bottom lane. */
  lane: 0 | 1;
  /** How long the step runs in the hover animation, in milliseconds. */
  runMs: number;
}

/**
 * A weekly report with steps that run at the same time: Ada and Grace collect the facts, then Linus
 * writes the report from both, while Alan draws the charts from Grace's numbers.
 */
export const LANDING_WORKFLOW_AGENTS: readonly LandingWorkflowAgent[] = [
  { id: "issues", teammate: ADA, provider: "codex", column: 1, lane: 0, runMs: 700 },
  { id: "usage", teammate: GRACE, provider: "antigravity", column: 1, lane: 1, runMs: 1000 },
  { id: "report", teammate: LINUS, provider: "claude", column: 2, lane: 0, runMs: 820 },
  { id: "charts", teammate: ALAN, provider: "grok", column: 2, lane: 1, runMs: 560 },
];

/** Each step starts when all the steps before it are done. */
export const LANDING_WORKFLOW_EDGES: readonly (readonly [LandingWorkflowStepId, LandingWorkflowStepId])[] = [
  ["trigger", "issues"],
  ["trigger", "usage"],
  ["issues", "report"],
  ["usage", "report"],
  ["usage", "charts"],
  ["report", "approval"],
  ["charts", "approval"],
];

/** The provider of each agent in the network picture. Ada starts on Codex, as in the persist picture. */
export const LANDING_NETWORK_AGENTS: readonly { teammate: LandingTeammate; provider: ProviderLogoVariant }[] = [
  { teammate: ADA, provider: "codex" },
  { teammate: LINUS, provider: "claude" },
  { teammate: GRACE, provider: "antigravity" },
];

/** The name under the mark at the centre of the network picture. */
export const LANDING_NETWORK_HUB = "OpenBot";

export interface LandingProvider {
  provider: ProviderLogoVariant;
  name: string;
}

const CODEX: LandingProvider = { provider: "codex", name: "Codex" };
export const CLAUDE_CODE: LandingProvider = { provider: "claude", name: "Claude Code" };

export const LANDING_PROVIDERS: readonly LandingProvider[] = [
  CODEX,
  CLAUDE_CODE,
  { provider: "antigravity", name: "Gemini" },
  { provider: "grok", name: "Grok" },
  { provider: "opencode", name: "OpenCode" },
  { provider: "cursor", name: "Cursor" },
  { provider: "cline", name: "Cline" },
];

/** The provider of a reply in the persist picture, and when it came. The text is `picture.persist`. */
export interface LandingPersistSender {
  from: LandingProvider;
  time: string;
}

/**
 * The chat in the persist picture. Ada does a task on Codex. On hover, she moves
 * to Claude Code and continues the same task.
 */
export const LANDING_PERSIST_SENDERS = {
  earlier: { from: CODEX, time: "9:58" },
  before: { from: CODEX, time: "10:04" },
  after: { from: CLAUDE_CODE, time: "10:06" },
} satisfies Record<string, LandingPersistSender>;

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

/** In reading order. Each offer is one card of the stack. */
export const LANDING_TEAMS_OFFER_IDS: readonly LandingTeamsOfferId[] = [
  "servers",
  "environments",
  "integrations",
  "support",
];
