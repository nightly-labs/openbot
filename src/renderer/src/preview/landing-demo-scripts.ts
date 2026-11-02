import type {
  AgentPromptQuestion,
  AttachmentSummary,
  ConversationPlan,
  ConversationPlanStep,
  ConversationSubagent,
} from "@openbot/contracts/ipc";
import { LANDING_LEAD_AGENT_ID, landingAttachment } from "./landing-fixtures";

export const LANDING_SCRIPT_MESSAGE_PREFIX = "landing-script:";
export const LANDING_DIRECT_SCRIPT_MESSAGE_PREFIX = "landing-direct-script:";

/** The answers to a question prompt, by question id. */
export type LandingPromptAnswers = Record<string, string[]>;

type LandingSubagent = Omit<ConversationSubagent, "startedAt" | "endedAt" | "error">;

/**
 * One step of a scene. `at` is the time in milliseconds from the start of the scene. A `prompt`
 * step and an `answer` step hold the scene until they end: the steps after them keep their spacing
 * from that point on.
 */
export type LandingSceneStep =
  | { at: number; kind: "user"; text: string }
  | { at: number; kind: "progress"; detail: string }
  | { at: number; kind: "commentary"; text: string }
  | { at: number; kind: "memory"; text: string }
  | { at: number; kind: "plan"; plan: ConversationPlan }
  | { at: number; kind: "subagents"; subagents: LandingSubagent[] }
  /** The lead sends one message to its teammates. Each one starts a turn in its own chat. */
  | { at: number; kind: "exchange"; text: string; recipientAgentIds: string[] }
  /** A teammate ends its turn: a summary comes back to the lead, the full answer stays in its chat. */
  | {
      at: number;
      kind: "teammate-reply";
      agentId: string;
      summary: string;
      answer: string;
      attachments?: AttachmentSummary[];
    }
  /** Waits for the visitor, or answers with `autoAnswers` after `autoAnswerAfter` milliseconds. */
  | {
      at: number;
      kind: "prompt";
      questions: AgentPromptQuestion[];
      autoAnswers: LandingPromptAnswers;
      autoAnswerAfter: number;
    }
  /** Streams the final answer and ends the turn. */
  | {
      at: number;
      kind: "answer";
      text: string | ((answers: LandingPromptAnswers) => string);
      attachments?: AttachmentSummary[];
    }
  | { at: number; kind: "reactions"; reactions: { emoji: string; agentId: string }[] };

export interface LandingDemoScene {
  agentId: string;
  steps: LandingSceneStep[];
}

const LAUNCH_PLAN_STEPS: Omit<ConversationPlanStep, "status">[] = [
  { id: "market", text: "Check this week's competitor launches", activeText: "Checking competitor launches" },
  { id: "banner", text: "Build the launch banner", activeText: "Building the launch banner" },
  { id: "post", text: "Draft the launch post and socials", activeText: "Drafting the launch post" },
  { id: "channels", text: "Pick the channels", activeText: "Picking the channels" },
  { id: "plan", text: "Send the launch plan", activeText: "Writing the launch plan" },
];

/** The launch plan with the first `done` steps completed and the next one in progress. */
function launchPlan(done: number): ConversationPlan {
  return {
    explanation: "Friday's launch, split across the team.",
    steps: LAUNCH_PLAN_STEPS.map((step, index) => ({
      ...step,
      status: index < done ? "completed" : index === done ? "inProgress" : "pending",
    })),
  };
}

const CHANNEL_QUESTION_ID = "channels";
const CHANNEL_OPTIONS = ["Blog and changelog", "X", "LinkedIn", "Newsletter", "Product Hunt"];
const CHANNEL_AUTO_ANSWERS = ["Blog and changelog", "X", "Newsletter"];

function launchPlanAnswer(answers: LandingPromptAnswers): string {
  const picked = answers[CHANNEL_QUESTION_ID]?.filter((channel) => CHANNEL_OPTIONS.includes(channel)) ?? [];
  const channels = picked.length > 0 ? picked : CHANNEL_AUTO_ANSWERS;
  return [
    "## Friday's launch plan",
    "",
    "The team is ready. Nobody else launches on Friday, so we keep the 10:00 slot.",
    "",
    "| Channel | Copy | Visual | Scheduled |",
    "| --- | --- | --- | --- |",
    ...channels.map((channel) => `| ${channel} | ✓ | ✓ | ${channel === "Product Hunt" ? "—" : "✓"} |`),
    "",
    "```mermaid",
    "flowchart LR",
    "  Scout[Scout: market check] --> Atlas",
    "  Forge[Forge: launch banner] --> Atlas",
    "  Pulse[Pulse: post and socials] --> Atlas",
    "  Atlas --> Launch((Friday 10:00))",
    "```",
    "",
    "Open item: you approve the banner in PR #418.",
  ].join("\n");
}

const ATLAS_SCENE: LandingDemoScene = {
  agentId: LANDING_LEAD_AGENT_ID,
  steps: [
    { at: 300, kind: "user", text: "Plan Friday's launch with the team: the banner, the launch post and the socials." },
    { at: 900, kind: "progress", detail: "Reading launch-brief.md" },
    { at: 1_300, kind: "commentary", text: "Reading the launch brief and this week's team updates." },
    { at: 1_800, kind: "memory", text: "Launches go out on Friday at 10:00 CET, after the Thursday review." },
    { at: 2_200, kind: "plan", plan: launchPlan(0) },
    {
      at: 2_700,
      kind: "subagents",
      subagents: [
        {
          id: "retros",
          title: "Read the last three launch retros",
          agentType: "Explore",
          prompt: "List what went wrong in the last three launches.",
          status: "running",
          steps: [{ id: "retros-1", kind: "read", text: "retros/0.47-launch.md" }],
        },
        {
          id: "blockers",
          title: "Collect the open launch blockers",
          agentType: "Explore",
          prompt: "Find every open issue that blocks the launch.",
          status: "running",
          steps: [{ id: "blockers-1", kind: "search", text: "label:launch-blocker is:open" }],
        },
      ],
    },
    {
      at: 3_200,
      kind: "exchange",
      text: "@Scout check this week's competitor launches. @Forge build the launch banner. @Pulse draft the launch post and the socials.",
      recipientAgentIds: ["scout", "forge", "pulse"],
    },
    {
      at: 3_900,
      kind: "subagents",
      subagents: [
        {
          id: "retros",
          title: "Read the last three launch retros",
          agentType: "Explore",
          prompt: "List what went wrong in the last three launches.",
          status: "completed",
          steps: [
            { id: "retros-1", kind: "read", text: "retros/0.47-launch.md" },
            { id: "retros-2", kind: "text", text: "Two of three launches posted the socials late." },
          ],
        },
        {
          id: "blockers",
          title: "Collect the open launch blockers",
          agentType: "Explore",
          prompt: "Find every open issue that blocks the launch.",
          status: "running",
          steps: [
            { id: "blockers-1", kind: "search", text: "label:launch-blocker is:open" },
            { id: "blockers-2", kind: "read", text: "Issue #409: banner copy needs approval" },
          ],
        },
      ],
    },
    {
      at: 4_700,
      kind: "teammate-reply",
      agentId: "scout",
      summary: "Nobody else launches on Friday. Two rivals ship on Tuesday, so our slot is clear.",
      answer: [
        "## Launch week check",
        "",
        "| Product | Next launch | Clash with Friday |",
        "| --- | --- | --- |",
        "| Relay | Tuesday | No |",
        "| Crewdesk | Tuesday | No |",
        "| Taskline | Not announced | Low |",
        "",
        "Sources: the Relay changelog, the Crewdesk events page and Taskline's last three launch posts.",
      ].join("\n"),
      attachments: [landingAttachment("launch-week", "launch-week-check.md", 2_816)],
    },
    { at: 5_000, kind: "plan", plan: launchPlan(1) },
    {
      at: 5_300,
      kind: "subagents",
      subagents: [
        {
          id: "retros",
          title: "Read the last three launch retros",
          agentType: "Explore",
          prompt: "List what went wrong in the last three launches.",
          status: "completed",
          steps: [
            { id: "retros-1", kind: "read", text: "retros/0.47-launch.md" },
            { id: "retros-2", kind: "text", text: "Two of three launches posted the socials late." },
          ],
        },
        {
          id: "blockers",
          title: "Collect the open launch blockers",
          agentType: "Explore",
          prompt: "Find every open issue that blocks the launch.",
          status: "completed",
          steps: [
            { id: "blockers-1", kind: "search", text: "label:launch-blocker is:open" },
            { id: "blockers-2", kind: "read", text: "Issue #409: banner copy needs approval" },
            { id: "blockers-3", kind: "text", text: "One blocker: the banner copy." },
          ],
        },
      ],
    },
    {
      at: 5_900,
      kind: "teammate-reply",
      agentId: "forge",
      summary: "The launch banner is in PR #418. It passes the checks at desktop and phone widths.",
      answer: [
        "The launch banner is ready in **PR #418**.",
        "",
        "- It reads the release name from the shared contract.",
        "- It fits at 1440 px and at 390 px.",
        "- All 52 checks pass.",
      ].join("\n"),
    },
    { at: 6_200, kind: "plan", plan: launchPlan(2) },
    {
      at: 6_900,
      kind: "teammate-reply",
      agentId: "pulse",
      summary: "The launch post and three social drafts are ready. Engagement peaks from 9:30 to 11:00 on Friday.",
      answer: [
        "The launch post and three social drafts are ready.",
        "",
        "| Draft | Length | Best time |",
        "| --- | --- | --- |",
        "| Launch post | 420 words | Friday 10:00 |",
        "| X thread | 5 posts | Friday 10:05 |",
        "| LinkedIn | 1 post | Friday 10:30 |",
      ].join("\n"),
      attachments: [landingAttachment("social-drafts", "social-drafts.md", 3_584)],
    },
    { at: 7_200, kind: "plan", plan: launchPlan(3) },
    {
      at: 7_600,
      kind: "prompt",
      questions: [
        {
          id: CHANNEL_QUESTION_ID,
          header: "Channels",
          question: "Which channels should the launch use?",
          isSecret: false,
          multiSelect: true,
          options: CHANNEL_OPTIONS.map((label) => ({
            label,
            description:
              label === "Product Hunt" ? "Needs a hunter, so it can only go out next week." : "The draft is ready.",
          })),
        },
      ],
      autoAnswers: { [CHANNEL_QUESTION_ID]: CHANNEL_AUTO_ANSWERS },
      autoAnswerAfter: 2_800,
    },
    { at: 8_100, kind: "plan", plan: launchPlan(4) },
    { at: 8_400, kind: "progress", detail: "Writing the launch plan" },
    {
      at: 8_800,
      kind: "answer",
      text: launchPlanAnswer,
      attachments: [
        landingAttachment("launch-plan", "launch-plan.md", 5_120),
        landingAttachment("social-drafts", "social-drafts.md", 3_584),
      ],
    },
    { at: 9_000, kind: "plan", plan: launchPlan(LAUNCH_PLAN_STEPS.length) },
    {
      at: 9_600,
      kind: "reactions",
      reactions: [
        { emoji: "🚀", agentId: "forge" },
        { emoji: "🔥", agentId: "pulse" },
        { emoji: "👏", agentId: "scout" },
      ],
    },
  ],
};

const SCOUT_SCENE: LandingDemoScene = {
  agentId: "scout",
  steps: [
    { at: 200, kind: "user", text: "Could anything steal our news on Friday?" },
    { at: 600, kind: "progress", detail: "Searching the web: launch events this Friday" },
    { at: 1_100, kind: "commentary", text: "Searched 14 sources: changelogs, event pages and launch posts." },
    { at: 1_600, kind: "progress", detail: "Reading 6 pages" },
    {
      at: 2_100,
      kind: "answer",
      text: [
        "Only one event is close, and it does not clash.",
        "",
        "| Event | Day | Risk | Source |",
        "| --- | --- | --- | --- |",
        "| Relay pricing update | Tuesday | Low | Relay changelog |",
        "| DevTools Summit keynote | Thursday | Medium | Summit schedule |",
        "| Crewdesk webinar | Friday 17:00 | Low | Crewdesk events page |",
        "",
        "I will check again on Thursday evening and tell Atlas if anything moves.",
      ].join("\n"),
    },
  ],
};

const FORGE_SCENE: LandingDemoScene = {
  agentId: "forge",
  steps: [
    { at: 200, kind: "user", text: "Show me the launch banner before it ships." },
    { at: 600, kind: "progress", detail: "Editing site/sections/launch-banner.html" },
    { at: 1_100, kind: "commentary", text: "Built the banner and checked it at 1440 px and 390 px." },
    { at: 1_600, kind: "progress", detail: "Ran the site checks: 52 passed" },
    {
      at: 2_100,
      kind: "answer",
      text: [
        "Here is the banner from PR #418:",
        "",
        "```html",
        '<section style="font-family:system-ui;padding:28px;border-radius:16px;color:#f5f3ff;background:linear-gradient(120deg,#4338ca,#9333ea 55%,#db2777)">',
        '  <p style="margin:0;font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.8">Launch week</p>',
        '  <h2 style="margin:8px 0 6px;font-size:28px">Version 2.0 is here</h2>',
        '  <p style="margin:0 0 18px;opacity:.85">Shared workspaces, offline mode and sync that is twice as fast.</p>',
        '  <a href="#" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#fff;color:#4338ca;font-weight:600;text-decoration:none">See what is new</a>',
        "</section>",
        "```",
        "",
        "Approve the PR and I will merge it on Friday at 9:45.",
      ].join("\n"),
    },
  ],
};

const PULSE_SCENE: LandingDemoScene = {
  agentId: "pulse",
  steps: [
    { at: 200, kind: "user", text: "How did people react to the teaser?" },
    { at: 600, kind: "progress", detail: "Searching X: posts about the teaser in the last 24 hours" },
    { at: 1_100, kind: "commentary", text: "Read 212 posts and replies about the teaser." },
    { at: 1_600, kind: "progress", detail: "Grouping the posts by topic" },
    {
      at: 2_100,
      kind: "answer",
      text: [
        "The teaser is doing well. Most replies ask about offline mode.",
        "",
        "| Signal | Posts | Change |",
        "| --- | --- | --- |",
        "| Offline mode questions | 84 | ↑ 3× |",
        "| Shared workspaces | 51 | ↑ 40% |",
        "| Pricing worries | 9 | ↓ 20% |",
        "",
        "I suggest that the X thread answers the offline question in the first post.",
      ].join("\n"),
      attachments: [landingAttachment("teaser-signals", "teaser-signals.csv", 6_144, "text/csv")],
    },
  ],
};

export const LANDING_DEMO_SCENES: Record<string, LandingDemoScene> = {
  [ATLAS_SCENE.agentId]: ATLAS_SCENE,
  [SCOUT_SCENE.agentId]: SCOUT_SCENE,
  [FORGE_SCENE.agentId]: FORGE_SCENE,
  [PULSE_SCENE.agentId]: PULSE_SCENE,
};

/** What each agent answers when the visitor types a message. */
export const LANDING_TYPED_REPLIES: Record<string, { progress: string; answer: string }> = {
  atlas: {
    progress: "Checking Friday's launch plan",
    answer: "Got it. I added this to Friday's launch plan, and I will check it with the team at Thursday's review.",
  },
  scout: {
    progress: "Searching the web",
    answer: "Noted. I will add this to today's competitor scan and send you the sources.",
  },
  forge: {
    progress: "Reading the repository",
    answer: "On it. I will make the change in a branch and send you the PR when the checks pass.",
  },
  pulse: {
    progress: "Searching X",
    answer: "Good call. I will watch the reactions to this and tell you if anything changes before Friday.",
  },
};

export interface LandingDirectDemoScript {
  memberId: string;
  question: string;
  answer: string;
  followUp: string;
  finalAnswer: string;
}

export const LANDING_DIRECT_DEMO_SCRIPTS: Record<string, LandingDirectDemoScript> = {
  "member-alice": {
    memberId: "member-alice",
    question: "Atlas sent the launch plan. Can you take the launch post?",
    answer: "Yes. Pulse's draft is good, so I only need to add the customer quote.",
    followUp: "Great. Can it be ready for Thursday's review?",
    finalAnswer: "It will be ready on Wednesday. I will ask Atlas to add it to the review.",
  },
  "member-maya": {
    memberId: "member-maya",
    question: "Are you still good to cover support from 10:00 to 12:00 on Friday?",
    answer: "Yes. Pulse sends me anything urgent first, and Forge is on call for bugs.",
    followUp: "Do you need anything from me before then?",
    finalAnswer: "Only the final launch post, so the support replies match it.",
  },
};
