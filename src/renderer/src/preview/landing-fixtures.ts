import type {
  AgentSummary,
  AttachmentSummary,
  ConversationMessage,
  ConversationSnapshot,
  DirectConversationSnapshot,
  DirectThreadSummary,
  Routine,
  RoutineFlowLink,
  RoutineFlowStep,
  RoutineRun,
  RoutineSchedule,
  ServerSummary,
} from "@openbot/contracts/ipc";
import { TEAM_CURRENT_CAPABILITIES } from "@openbot/contracts/team-protocol/current";
import { TEAM_PROTOCOL_V6 } from "@openbot/contracts/team-protocol/v6";
import developmentLogoUrl from "../assets/openbot-logo-dev.png";
import productionLogoUrl from "../assets/openbot-logo-production.png";
import { STORY_PRESENCE } from "./fixtures";
import type { MockOpenBotOptions } from "./mock-openbot";

const LANDING_PREVIEW_NOW = "2026-08-21T10:00:00.000Z";

const LANDING_PREVIEW_AGENTS: AgentSummary[] = [
  {
    id: "chief",
    provider: "codex",
    name: "Chief",
    title: "Chief of staff",
    description: "Coordinates priorities, decisions, and handoffs across the team.",
    notifications: true,
    model: "gpt-5.6-luna",
    reasoningEffort: "low",
    threadId: "thread-chief",
    workspacePath: "/mock/OpenBot/Agents/chief",
    preview: "The launch plan is ready with owners, evidence, and next actions.",
    updatedAt: LANDING_PREVIEW_NOW,
    avatarSeed: "chief",
    avatarHue: 245,
    avatarUrl: null,
  },
  {
    id: "research",
    provider: "codex",
    name: "Research",
    title: "Research partner",
    description: "Finds reliable sources and turns them into concise briefs.",
    notifications: true,
    model: "gpt-5.6-luna",
    reasoningEffort: "low",
    threadId: "thread-research",
    workspacePath: "/mock/OpenBot/Agents/research",
    preview: "The source review and evidence map are complete.",
    updatedAt: "2026-08-21T09:48:00.000Z",
    avatarSeed: "research",
    avatarHue: 185,
    avatarUrl: null,
  },
  {
    id: "builder",
    provider: "codex",
    name: "Builder",
    title: "Product engineer",
    description: "Builds product changes and records clear technical decisions.",
    notifications: true,
    model: "gpt-5.6-luna",
    reasoningEffort: "low",
    threadId: "thread-builder",
    workspacePath: "/mock/OpenBot/Agents/builder",
    preview: "The implementation checklist includes tests and rollback steps.",
    updatedAt: "2026-08-21T09:36:00.000Z",
    avatarSeed: "builder",
    avatarHue: 30,
    avatarUrl: null,
  },
  {
    id: "launch",
    provider: "codex",
    name: "Launch",
    title: "Go-to-market lead",
    description: "Prepares launch assets, messaging, and release checklists.",
    notifications: true,
    model: "gpt-5.6-luna",
    reasoningEffort: "low",
    threadId: "thread-launch",
    workspacePath: "/mock/OpenBot/Agents/launch",
    preview: "The launch brief is ready for final review.",
    updatedAt: "2026-08-21T09:24:00.000Z",
    avatarSeed: "launch",
    avatarHue: 320,
    avatarUrl: null,
  },
];

export const LANDING_PREVIEW_ATTACHMENTS: AttachmentSummary[] = [
  {
    id: "landing-launch-brief",
    name: "launch-brief.md",
    size: 2_048,
    kind: "file",
    mimeType: "text/markdown",
    previewKind: "text",
    previewUrl: null,
  },
  {
    id: "landing-launch-metrics",
    name: "launch-metrics.csv",
    size: 1_024,
    kind: "file",
    mimeType: "text/csv",
    previewKind: "text",
    previewUrl: null,
  },
];

const LANDING_PREVIEW_CHIEF_MESSAGES: ConversationMessage[] = [
  {
    id: "landing-chief-request",
    author: "user",
    source: "user",
    text: "Prepare the launch plan, tag @Research, and keep every decision traceable.",
    createdAt: "2026-08-21T09:42:00.000Z",
    status: "completed",
  },
  {
    id: "landing-chief-plan",
    author: "assistant",
    source: "assistant",
    text: [
      "## Launch plan",
      "",
      "I asked @Research to verify the evidence and @Builder to check the rollout path.",
      "",
      "| Workstream | Owner | Status |",
      "| --- | --- | --- |",
      "| Product QA | @Builder | Ready |",
      "| Evidence | @Research | In review |",
      "| Release | @Launch | Ready |",
      "",
      "Next: confirm the rollback owner, then publish the release note.",
    ].join("\n"),
    createdAt: "2026-08-21T09:43:00.000Z",
    status: "completed",
    attachments: LANDING_PREVIEW_ATTACHMENTS,
    reaction: "\u2705",
  },
  {
    id: "landing-chief-exchange",
    author: "system",
    source: "system",
    text: "",
    createdAt: "2026-08-21T09:44:00.000Z",
    status: "completed",
    exchange: {
      direction: "outgoing",
      messageId: "landing-chief-exchange",
      senderAgentId: "chief",
      recipientAgentIds: ["research", "builder"],
      replyToMessageId: "landing-chief-plan",
      deliveries: [
        {
          id: "landing-delivery-research",
          recipientAgentId: "research",
          status: "completed",
          position: null,
          error: null,
        },
        {
          id: "landing-delivery-builder",
          recipientAgentId: "builder",
          status: "completed",
          position: null,
          error: null,
        },
      ],
    },
  },
  {
    id: "landing-chief-ready",
    author: "assistant",
    source: "assistant",
    text: "Research verified seven of eight claims. Builder added the test and rollback steps. The final review is ready.",
    createdAt: "2026-08-21T09:45:00.000Z",
    status: "completed",
  },
];

const LANDING_PREVIEW_SNAPSHOTS: Record<string, ConversationSnapshot> = Object.fromEntries(
  LANDING_PREVIEW_AGENTS.map((agent) => [
    agent.id,
    {
      agentId: agent.id,
      threadId: agent.threadId,
      activeTurnId: null,
      revision: 1,
      messages: agent.id === "chief" ? LANDING_PREVIEW_CHIEF_MESSAGES : [],
    },
  ]),
);

const LANDING_PREVIEW_SERVERS: ServerSummary[] = [
  {
    id: "local",
    name: "Local",
    logoUrl: developmentLogoUrl,
    notificationsMuted: false,
    notificationsMutedUntil: null,
    notificationLevel: "all",
    kind: "local",
    state: "online",
    apiUrl: null,
    remoteDesktopAvailable: false,
    role: null,
    active: false,
  },
  {
    id: "team",
    name: "OpenBot team",
    logoUrl: productionLogoUrl,
    notificationsMuted: false,
    notificationsMutedUntil: null,
    notificationLevel: "all",
    kind: "remote",
    state: "online",
    apiUrl: "https://team.example.com",
    remoteDesktopAvailable: true,
    role: "owner",
    active: true,
    compatibility: {
      localAppVersion: "preview",
      hostAppVersion: "preview",
      localProtocol: { minimum: TEAM_PROTOCOL_V6, maximum: TEAM_PROTOCOL_V6 },
      hostProtocol: { minimum: TEAM_PROTOCOL_V6, maximum: TEAM_PROTOCOL_V6 },
      negotiatedProtocol: TEAM_PROTOCOL_V6,
      capabilities: [...TEAM_CURRENT_CAPABILITIES],
    },
  },
];

const LANDING_PREVIEW_DIRECT_SNAPSHOTS: Record<string, DirectConversationSnapshot> = {
  "member-alice": {
    threadId: "direct-alice",
    otherMemberId: "member-alice",
    revision: 1,
    readState: {
      unreadCount: 1,
      firstUnreadMessageId: "landing-direct-alice-3",
      throughSequence: 2,
    },
    messages: [
      {
        id: "landing-direct-alice-1",
        threadId: "direct-alice",
        senderMemberId: "member-alice",
        recipientMemberId: "member-self",
        text: "I tightened the launch note and removed the unsupported review-time claim.",
        createdAt: "2026-08-21T09:47:00.000Z",
        sequence: 1,
      },
      {
        id: "landing-direct-alice-2",
        threadId: "direct-alice",
        senderMemberId: "member-self",
        recipientMemberId: "member-alice",
        text: "Perfect. Please keep the verified setup metric and send the final copy to Launch.",
        createdAt: "2026-08-21T09:49:00.000Z",
        sequence: 2,
      },
      {
        id: "landing-direct-alice-3",
        threadId: "direct-alice",
        senderMemberId: "member-alice",
        recipientMemberId: "member-self",
        text: "Done — the final wording is in release-note.md and Launch has the handoff.",
        createdAt: "2026-08-21T09:52:00.000Z",
        sequence: 3,
      },
    ],
  },
  "member-maya": {
    threadId: "direct-maya",
    otherMemberId: "member-maya",
    revision: 1,
    readState: {
      unreadCount: 0,
      firstUnreadMessageId: null,
      throughSequence: 3,
    },
    messages: [
      {
        id: "landing-direct-maya-1",
        threadId: "direct-maya",
        senderMemberId: "member-self",
        recipientMemberId: "member-maya",
        text: "Can you confirm support coverage for the release window?",
        createdAt: "2026-08-21T09:31:00.000Z",
        sequence: 1,
      },
      {
        id: "landing-direct-maya-2",
        threadId: "direct-maya",
        senderMemberId: "member-maya",
        recipientMemberId: "member-self",
        text: "Yes. I have the first two hours, and the EU handoff starts at 14:00 UTC.",
        createdAt: "2026-08-21T09:34:00.000Z",
        sequence: 2,
      },
      {
        id: "landing-direct-maya-3",
        threadId: "direct-maya",
        senderMemberId: "member-self",
        recipientMemberId: "member-maya",
        text: "Great. I added both owners to the rollout checklist.",
        createdAt: "2026-08-21T09:36:00.000Z",
        sequence: 3,
      },
    ],
  },
  "member-jon": {
    threadId: "direct-jon",
    otherMemberId: "member-jon",
    revision: 1,
    readState: {
      unreadCount: 0,
      firstUnreadMessageId: null,
      throughSequence: 3,
    },
    messages: [
      {
        id: "landing-direct-jon-1",
        threadId: "direct-jon",
        senderMemberId: "member-jon",
        recipientMemberId: "member-self",
        text: "The rollback drill passed on staging. Recovery took four minutes.",
        createdAt: "2026-08-21T09:12:00.000Z",
        sequence: 1,
      },
      {
        id: "landing-direct-jon-2",
        threadId: "direct-jon",
        senderMemberId: "member-self",
        recipientMemberId: "member-jon",
        text: "Nice. Any open risk before Builder closes the checklist?",
        createdAt: "2026-08-21T09:15:00.000Z",
        sequence: 2,
      },
      {
        id: "landing-direct-jon-3",
        threadId: "direct-jon",
        senderMemberId: "member-jon",
        recipientMemberId: "member-self",
        text: "Only the analytics alert. It is non-blocking and documented for the release window.",
        createdAt: "2026-08-21T09:18:00.000Z",
        sequence: 3,
      },
    ],
  },
};

const LANDING_PREVIEW_DIRECT_THREADS: DirectThreadSummary[] = Object.values(LANDING_PREVIEW_DIRECT_SNAPSHOTS).map(
  (snapshot) => {
    const lastMessage = snapshot.messages.at(-1);
    if (!lastMessage) throw new Error(`Landing direct thread ${snapshot.threadId} has no messages.`);
    return {
      threadId: snapshot.threadId,
      otherMemberId: snapshot.otherMemberId,
      lastMessage,
      unreadCount: snapshot.readState?.unreadCount ?? 0,
      updatedAt: lastMessage.createdAt,
    };
  },
);

const LANDING_PREVIEW_EMAIL = "norbertbodziony@gmail.com";
const LANDING_PREVIEW_PRESENCE = {
  ...STORY_PRESENCE,
  members: STORY_PRESENCE.members.map((member) =>
    member.id === "member-self" ? { ...member, email: LANDING_PREVIEW_EMAIL } : member,
  ),
};

// The routines of the dev seed (`scripts/seed-dev-state.ts`), with links and the steps of the last
// runs, so the Routines canvas shows what each agent was asked and what it answered.
const LANDING_ROUTINE_TIMEZONE = "UTC";

function landingRoutine(
  agentId: string,
  id: string,
  fields: Pick<Routine, "name" | "instruction" | "active"> & { schedule: RoutineSchedule; nextRunAt: string },
): Routine {
  const createdAt = "2026-08-03T08:00:00.000Z";
  return {
    id,
    agentId,
    name: fields.name,
    instruction: fields.instruction,
    active: fields.active,
    timezone: LANDING_ROUTINE_TIMEZONE,
    trigger: {
      id: `${id}-trigger`,
      routineId: id,
      schedule: fields.schedule,
      nextRunAt: fields.nextRunAt,
      createdAt,
      updatedAt: createdAt,
    },
    createdAt,
    updatedAt: createdAt,
  };
}

function landingRoutineRun(
  routine: Routine,
  id: string,
  fields: Pick<RoutineRun, "kind" | "scheduledFor" | "status" | "error" | "updatedAt">,
): RoutineRun {
  return {
    id,
    routineId: routine.id,
    agentId: routine.agentId,
    triggerId: fields.kind === "scheduled" ? routine.trigger.id : null,
    deliveryId: `${id}-delivery`,
    routineName: routine.name,
    instruction: routine.instruction,
    createdAt: fields.scheduledFor,
    ...fields,
  };
}

/** The message a linked agent gets, in the template of `handoffText` in `src/backend/routine-flows/routine-flows.ts`. */
function landingHandoff(routineName: string, from: string, answer: string, instruction: string): string {
  return `The routine "${routineName}" continues with you.\n\n${from} answered:\n\n${answer}\n\n${instruction}`;
}

const MORNING_BRIEF = landingRoutine("chief", "landing-routine-morning-brief", {
  name: "Morning launch brief",
  instruction: "Summarize launch progress, blockers, owners, and the next decision in five bullets.",
  active: true,
  schedule: { kind: "weekdays", time: "09:00" },
  nextRunAt: "2026-08-24T09:00:00.000Z",
});
const FRIDAY_REVIEW = landingRoutine("chief", "landing-routine-friday-review", {
  name: "Friday launch review",
  instruction: "Prepare the weekly launch review with decisions, risks, and unresolved ownership gaps.",
  active: true,
  schedule: { kind: "weekly", weekday: 5, time: "16:00" },
  nextRunAt: "2026-08-21T16:00:00.000Z",
});
const SOURCE_CHECK = landingRoutine("research", "landing-routine-source-check", {
  name: "Daily source check",
  instruction: "Recheck open launch claims against primary sources and report only material changes.",
  active: true,
  schedule: { kind: "daily", time: "08:30" },
  nextRunAt: "2026-08-22T08:30:00.000Z",
});
const DEPENDENCY_CHECK = landingRoutine("builder", "landing-routine-dependency-check", {
  name: "Dependency health check",
  instruction: "Review dependency health and prepare a short risk report without changing the codebase.",
  active: false,
  schedule: { kind: "weekly", weekday: 1, time: "10:00" },
  nextRunAt: "2026-08-24T10:00:00.000Z",
});
const READINESS_PULSE = landingRoutine("launch", "landing-routine-readiness-pulse", {
  name: "Release readiness pulse",
  instruction: "Check release assets, messaging, and approvals, then list anything blocking publication.",
  active: true,
  schedule: { kind: "weekdays", time: "15:30" },
  nextRunAt: "2026-08-21T15:30:00.000Z",
});

const MORNING_BRIEF_RUN = landingRoutineRun(MORNING_BRIEF, "landing-run-morning-brief", {
  kind: "scheduled",
  scheduledFor: "2026-08-21T09:00:00.000Z",
  status: "succeeded",
  error: null,
  updatedAt: "2026-08-21T09:06:00.000Z",
});
const FRIDAY_REVIEW_RUN = landingRoutineRun(FRIDAY_REVIEW, "landing-run-friday-review", {
  kind: "manual",
  scheduledFor: "2026-08-21T09:20:00.000Z",
  status: "succeeded",
  error: null,
  updatedAt: "2026-08-21T09:23:00.000Z",
});
const SOURCE_CHECK_RUN = landingRoutineRun(SOURCE_CHECK, "landing-run-source-check", {
  kind: "scheduled",
  scheduledFor: "2026-08-21T08:30:00.000Z",
  status: "failed",
  error: "One source was temporarily unavailable.",
  updatedAt: "2026-08-21T08:33:00.000Z",
});

const LANDING_PREVIEW_ROUTINES: Record<string, Routine[]> = {
  chief: [MORNING_BRIEF, FRIDAY_REVIEW],
  research: [SOURCE_CHECK],
  builder: [DEPENDENCY_CHECK],
  launch: [READINESS_PULSE],
};

const LANDING_PREVIEW_ROUTINE_RUNS: Record<string, RoutineRun[]> = {
  [MORNING_BRIEF.id]: [MORNING_BRIEF_RUN],
  [FRIDAY_REVIEW.id]: [FRIDAY_REVIEW_RUN],
  [SOURCE_CHECK.id]: [SOURCE_CHECK_RUN],
};

const BRIEF_TO_RESEARCH =
  "Check every claim in the brief against a primary source. Mark each one confirmed, changed, or unverified.";
const BRIEF_TO_LAUNCH = "Turn the brief into today's release checklist, with one owner for each item.";
const RESEARCH_TO_BUILDER = "Do not change code yet. List the changes that the changed claims need, smallest first.";
const REVIEW_TO_LAUNCH = "Draft the stakeholder update from this review, in under 150 words.";

const LANDING_PREVIEW_ROUTINE_LINKS: RoutineFlowLink[] = [
  {
    id: "landing-link-brief-research",
    routineId: MORNING_BRIEF.id,
    fromAgentId: "chief",
    toAgentId: "research",
    instruction: BRIEF_TO_RESEARCH,
    createdAt: "2026-08-03T08:05:00.000Z",
  },
  {
    id: "landing-link-brief-launch",
    routineId: MORNING_BRIEF.id,
    fromAgentId: "chief",
    toAgentId: "launch",
    instruction: BRIEF_TO_LAUNCH,
    createdAt: "2026-08-03T08:06:00.000Z",
  },
  {
    id: "landing-link-research-builder",
    routineId: MORNING_BRIEF.id,
    fromAgentId: "research",
    toAgentId: "builder",
    instruction: RESEARCH_TO_BUILDER,
    createdAt: "2026-08-03T08:07:00.000Z",
  },
  {
    id: "landing-link-review-launch",
    routineId: FRIDAY_REVIEW.id,
    fromAgentId: "chief",
    toAgentId: "launch",
    instruction: REVIEW_TO_LAUNCH,
    createdAt: "2026-08-10T08:00:00.000Z",
  },
];

const BRIEF_CHIEF_ANSWER = [
  "- Progress: the landing page, pricing copy, and release notes are done; the demo video is in review.",
  "- Blocker: the Windows installer signature fails on the build machine.",
  "- Owners: Builder has the installer, Launch has the video, Research has the comparison table.",
  "- Risk: the comparison table cites two competitor prices from July.",
  "- Next decision: ship on Tuesday without Windows, or wait for the signed installer.",
].join("\n");
const BRIEF_RESEARCH_ANSWER = [
  "- Landing page, pricing copy, release notes: confirmed in the repository.",
  "- Demo video in review: confirmed in the review thread.",
  "- Competitor prices: changed. One competitor raised its Pro plan from $20 to $25 on August 18.",
  "- Windows signature failure: unverified. The last build log is from yesterday.",
].join("\n");
const BRIEF_LAUNCH_ANSWER = [
  "1. Approve the demo video (Launch, by 12:00).",
  "2. Update the comparison table price (Research, by 13:00).",
  "3. Fix the Windows installer signature (Builder, by 15:00).",
  "4. Decide the Tuesday ship scope (Chief, at the 16:00 review).",
].join("\n");
const BRIEF_BUILDER_ANSWER = [
  "1. Change the competitor Pro price in `pricing-table.json` from 20 to 25.",
  "2. Run the Windows build again to get a current signature log.",
  "No other change is needed for the claims in this brief.",
].join("\n");
const REVIEW_CHIEF_ANSWER = [
  "Decisions: ship on Tuesday; Windows follows when the installer is signed.",
  "Risks: the competitor price change reaches the table late; the video needs one more review.",
  "Ownership gaps: nobody owns the launch-day support inbox.",
].join("\n");

const LANDING_PREVIEW_ROUTINE_STEPS: RoutineFlowStep[] = [
  {
    id: "landing-step-brief-chief",
    runId: MORNING_BRIEF_RUN.id,
    agentId: "chief",
    deliveryId: null,
    input: MORNING_BRIEF.instruction,
    output: BRIEF_CHIEF_ANSWER,
    status: "succeeded",
    error: null,
    createdAt: "2026-08-21T09:00:00.000Z",
    updatedAt: "2026-08-21T09:02:00.000Z",
  },
  {
    id: "landing-step-brief-research",
    runId: MORNING_BRIEF_RUN.id,
    agentId: "research",
    deliveryId: "landing-step-brief-research-delivery",
    input: landingHandoff(MORNING_BRIEF.name, "Chief", BRIEF_CHIEF_ANSWER, BRIEF_TO_RESEARCH),
    output: BRIEF_RESEARCH_ANSWER,
    status: "succeeded",
    error: null,
    createdAt: "2026-08-21T09:02:00.000Z",
    updatedAt: "2026-08-21T09:04:00.000Z",
  },
  {
    id: "landing-step-brief-launch",
    runId: MORNING_BRIEF_RUN.id,
    agentId: "launch",
    deliveryId: "landing-step-brief-launch-delivery",
    input: landingHandoff(MORNING_BRIEF.name, "Chief", BRIEF_CHIEF_ANSWER, BRIEF_TO_LAUNCH),
    output: BRIEF_LAUNCH_ANSWER,
    status: "succeeded",
    error: null,
    createdAt: "2026-08-21T09:02:00.000Z",
    updatedAt: "2026-08-21T09:03:00.000Z",
  },
  {
    id: "landing-step-brief-builder",
    runId: MORNING_BRIEF_RUN.id,
    agentId: "builder",
    deliveryId: "landing-step-brief-builder-delivery",
    input: landingHandoff(MORNING_BRIEF.name, "Research", BRIEF_RESEARCH_ANSWER, RESEARCH_TO_BUILDER),
    output: BRIEF_BUILDER_ANSWER,
    status: "succeeded",
    error: null,
    createdAt: "2026-08-21T09:04:00.000Z",
    updatedAt: "2026-08-21T09:06:00.000Z",
  },
  {
    id: "landing-step-review-chief",
    runId: FRIDAY_REVIEW_RUN.id,
    agentId: "chief",
    deliveryId: null,
    input: FRIDAY_REVIEW.instruction,
    output: REVIEW_CHIEF_ANSWER,
    status: "succeeded",
    error: null,
    createdAt: "2026-08-21T09:20:00.000Z",
    updatedAt: "2026-08-21T09:22:00.000Z",
  },
  {
    id: "landing-step-review-launch",
    runId: FRIDAY_REVIEW_RUN.id,
    agentId: "launch",
    deliveryId: "landing-step-review-launch-delivery",
    input: landingHandoff(FRIDAY_REVIEW.name, "Chief", REVIEW_CHIEF_ANSWER, REVIEW_TO_LAUNCH),
    output: null,
    status: "failed",
    error: "The provider plan limit was reached before Launch answered.",
    createdAt: "2026-08-21T09:22:00.000Z",
    updatedAt: "2026-08-21T09:23:00.000Z",
  },
];

export const LANDING_PREVIEW_OPTIONS = {
  authState: {
    status: "signed_in",
    user: {
      id: "user-1",
      email: LANDING_PREVIEW_EMAIL,
      name: "Norbert",
      avatarUrl: null,
    },
  },
  agents: LANDING_PREVIEW_AGENTS,
  snapshots: LANDING_PREVIEW_SNAPSHOTS,
  servers: LANDING_PREVIEW_SERVERS,
  directThreads: LANDING_PREVIEW_DIRECT_THREADS,
  directSnapshots: LANDING_PREVIEW_DIRECT_SNAPSHOTS,
  presence: LANDING_PREVIEW_PRESENCE,
  browserTabs: [],
  browserControlState: { sessions: [] },
  remoteDesktopSessions: [],
  // The team server serves every capability, `host-update-v1` too; it is up to date, so no update notice shows.
  hostUpdate: {
    phase: "idle",
    currentVersion: "0.24.0",
    availableVersion: null,
    progress: null,
    errorCode: null,
    remoteUpdates: "allowed",
    autoDownload: true,
    autoInstall: false,
    restart: null,
  },
  routines: LANDING_PREVIEW_ROUTINES,
  routineRuns: LANDING_PREVIEW_ROUTINE_RUNS,
  routineFlowLinks: LANDING_PREVIEW_ROUTINE_LINKS,
  routineFlowSteps: LANDING_PREVIEW_ROUTINE_STEPS,
} satisfies MockOpenBotOptions;
