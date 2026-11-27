import type { ProviderLogoVariant } from "@openbot/brand";
import type { AvatarHue } from "@openbot/contracts/ipc";
import { RIVAL_MARK_SHAPES, type RivalMarkName } from "../components/compare/rival-mark-shapes";
import { COMPARE_COLLECTION } from "./compare";

export type LandingFeatureId = "team" | "providers" | "local" | "multiplayer" | "workflows" | "persist";

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

export const ADA: LandingTeammate = { name: "Ada", avatarSeed: "landing-ada", avatarHue: 245 };
export const LINUS: LandingTeammate = { name: "Linus", avatarSeed: "landing-linus", avatarHue: 150 };
const GRACE: LandingTeammate = { name: "Grace", avatarSeed: "landing-grace", avatarHue: 30 };
const ALAN: LandingTeammate = { name: "Alan", avatarSeed: "landing-alan", avatarHue: 185 };

export const LANDING_TEAM: readonly LandingTeammate[] = [ADA, LINUS, GRACE];

export interface LandingTeamSender {
  from: LandingTeammate;
  time: string;
}

export const LANDING_TEAM_SENDERS: readonly LandingTeamSender[] = [
  { from: ADA, time: "9:12" },
  { from: LINUS, time: "9:26" },
  { from: GRACE, time: "9:31" },
];

export const LANDING_TEAM_REPLY_SENDER: LandingTeamSender = { from: ADA, time: "9:32" };

export type LandingHair = "long" | "short" | "curly";

type LandingFaceDetail = "none" | "glasses" | "freckles";

export interface LandingPerson {
  id: "maya" | "sam" | "theo";
  name: string;
  hair: LandingHair;
  detail: LandingFaceDetail;
}

const MAYA: LandingPerson = { id: "maya", name: "Maya", hair: "long", detail: "none" };
const SAM: LandingPerson = { id: "sam", name: "Sam", hair: "short", detail: "glasses" };

export type LandingMultiplayerSender =
  | { kind: "person"; from: LandingPerson; time: string }
  | { kind: "agent"; from: LandingTeammate; time: string };

export const LANDING_MULTIPLAYER_SENDERS: readonly LandingMultiplayerSender[] = [
  { kind: "person", from: MAYA, time: "11:02" },
  { kind: "agent", from: ADA, time: "11:05" },
  { kind: "person", from: SAM, time: "11:09" },
];

export const LANDING_MULTIPLAYER_PEOPLE: readonly LandingPerson[] = [MAYA, SAM];
export const LANDING_MULTIPLAYER_AGENTS: readonly LandingTeammate[] = [ADA, LINUS];
export const LANDING_MULTIPLAYER_INVITED: LandingPerson = {
  id: "theo",
  name: "Theo",
  hair: "curly",
  detail: "freckles",
};

type LandingWorkflowAgentId = "issues" | "usage" | "report" | "charts";
export type LandingWorkflowStepId = "trigger" | LandingWorkflowAgentId | "approval";

export interface LandingWorkflowAgent {
  id: LandingWorkflowAgentId;
  teammate: LandingTeammate;
  provider: ProviderLogoVariant;
  column: 1 | 2;
  lane: 0 | 1;
  runMs: number;
}

export const LANDING_WORKFLOW_AGENTS: readonly LandingWorkflowAgent[] = [
  { id: "issues", teammate: ADA, provider: "codex", column: 1, lane: 0, runMs: 700 },
  { id: "usage", teammate: GRACE, provider: "antigravity", column: 1, lane: 1, runMs: 1000 },
  { id: "report", teammate: LINUS, provider: "claude", column: 2, lane: 0, runMs: 820 },
  { id: "charts", teammate: ALAN, provider: "grok", column: 2, lane: 1, runMs: 560 },
];

export const LANDING_WORKFLOW_EDGES: readonly (readonly [LandingWorkflowStepId, LandingWorkflowStepId])[] = [
  ["trigger", "issues"],
  ["trigger", "usage"],
  ["issues", "report"],
  ["usage", "report"],
  ["usage", "charts"],
  ["report", "approval"],
  ["charts", "approval"],
];

export const LANDING_NETWORK_AGENTS: readonly { teammate: LandingTeammate; provider: ProviderLogoVariant }[] = [
  { teammate: ADA, provider: "codex" },
  { teammate: LINUS, provider: "claude" },
  { teammate: GRACE, provider: "antigravity" },
];

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

export interface LandingPersistSender {
  from: LandingProvider;
  time: string;
}

export const LANDING_PERSIST_SENDERS = {
  earlier: { from: CODEX, time: "9:58" },
  before: { from: CODEX, time: "10:04" },
  after: { from: CLAUDE_CODE, time: "10:06" },
} satisfies Record<string, LandingPersistSender>;

export interface LandingComparisonLink {
  slug: string;
  title: string;
  label: string;
  mark: RivalMarkName;
}

function isRivalMarkName(slug: string): slug is RivalMarkName {
  return Object.hasOwn(RIVAL_MARK_SHAPES, slug);
}

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

export type LandingTeamsOfferId = "servers" | "environments" | "integrations" | "support";

export const LANDING_TEAMS_OFFER_IDS: readonly LandingTeamsOfferId[] = [
  "servers",
  "environments",
  "integrations",
  "support",
];
