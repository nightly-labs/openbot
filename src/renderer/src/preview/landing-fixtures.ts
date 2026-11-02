import type {
  AccountUsage,
  AgentContextState,
  AgentProviderStatus,
  AgentRuntimeSnapshot,
  AgentStatus,
  AttachmentSummary,
  ChannelMessage,
  ClientAgentSummary,
  ConversationMessage,
  ConversationReadState,
  ConversationSnapshot,
  DirectConversationSnapshot,
  DirectMessage,
  DirectThreadSummary,
  Routine,
  RoutineFlowLink,
  RoutineFlowStep,
  RoutineRun,
  RoutineSchedule,
  ServerSummary,
  SidebarLayoutSnapshot,
  TeamPresenceSnapshot,
  UpdateStatus,
} from "@openbot/contracts/ipc";
import { SIDEBAR_UNASSIGNED_SECTION_ID } from "@openbot/contracts/ipc";
import { TEAM_CURRENT_CAPABILITIES } from "@openbot/contracts/team-protocol/current";
import { TEAM_PROTOCOL_V6 } from "@openbot/contracts/team-protocol/v6";
import developmentLogoUrl from "../assets/openbot-logo-dev.png";
import productionLogoUrl from "../assets/openbot-logo-production.png";
import { STORY_AGENT_STATUS, STORY_PRESENCE } from "./fixtures";
import type { MockChannelSeed } from "./mock-channels";
import type { MockOpenBotOptions } from "./mock-openbot";

/*
 * The app demo on the home page: four agents, each on a different provider, that plan a launch
 * together. Every time is an offset from the moment the page opens, so the demo always shows today.
 */

const LANDING_PREVIEW_EMAIL = "norbertbodziony@gmail.com";
const MINUTE_MS = 60_000;

export const LANDING_LEAD_AGENT_ID = "atlas";

export function landingAttachment(
  id: string,
  name: string,
  size: number,
  mimeType = "text/markdown",
): AttachmentSummary {
  return { id: `landing-${id}`, name, size, kind: "file", mimeType, previewKind: "text", previewUrl: null };
}

const LANDING_CONTEXT_WINDOWS: Record<string, number> = {
  atlas: 200_000,
  scout: 1_000_000,
  forge: 400_000,
  pulse: 256_000,
};

/** The tokens in each agent's context window before and after its demo scene. */
export const LANDING_CONTEXT_TOKENS: Record<string, { before: number; after: number }> = {
  atlas: { before: 41_200, after: 96_800 },
  scout: { before: 118_000, after: 212_000 },
  forge: { before: 64_500, after: 121_000 },
  pulse: { before: 22_400, after: 58_600 },
};

function landingContextState(agentId: string, usedTokens: number): AgentContextState {
  const share = (part: number) => Math.round(usedTokens * part);
  return {
    agentId,
    threadId: `thread-${agentId}`,
    usage: {
      usedTokens,
      windowTokens: LANDING_CONTEXT_WINDOWS[agentId] ?? 200_000,
      autoCompactAt: 0.9,
      nativeManaged: true,
      categories: [
        { category: "systemPrompt", tokens: share(0.08) },
        { category: "memoryFiles", tokens: share(0.06) },
        { category: "tools", tokens: share(0.14) },
        { category: "skills", tokens: share(0.04) },
        { category: "toolResults", tokens: share(0.32) },
        { category: "messages", tokens: share(0.36) },
      ],
    },
    compaction: null,
  };
}

/** A runtime snapshot with no turn running. It carries the context meter of each agent. */
export function landingRuntimeSnapshot(
  agents: readonly ClientAgentSummary[],
  contextTokens: Record<string, number>,
): AgentRuntimeSnapshot {
  return {
    contextStates: agents.map((agent) => landingContextState(agent.id, contextTokens[agent.id] ?? 0)),
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      notifications: agent.notifications,
      preview: agent.preview,
      updatedAt: agent.updatedAt,
      avatarSeed: agent.avatarSeed,
      avatarHue: agent.avatarHue ?? null,
      avatarUrl: agent.avatarUrl ?? null,
    })),
    activeTurns: [],
    work: [],
    latestMessages: [],
    attentionComplete: true,
    pendingPrompts: [],
    pendingApprovals: [],
    pendingBrowserTakeovers: [],
    failedTurns: [],
  };
}

type LandingAgentFields = Pick<
  ClientAgentSummary,
  "id" | "provider" | "name" | "title" | "description" | "model" | "reasoningEffort" | "preview"
>;

function landingAgents(at: (minutesAgo: number) => string): ClientAgentSummary[] {
  const agent = (
    fields: LandingAgentFields,
    hue: NonNullable<ClientAgentSummary["avatarHue"]>,
    minutesAgo: number,
  ): ClientAgentSummary => ({
    ...fields,
    notifications: true,
    threadId: `thread-${fields.id}`,
    workspacePath: `/mock/OpenBot/Agents/${fields.id}`,
    updatedAt: at(minutesAgo),
    avatarSeed: fields.id,
    avatarHue: hue,
    avatarUrl: null,
  });
  return [
    agent(
      {
        id: "atlas",
        provider: "claude",
        name: "Atlas",
        title: "Team lead",
        description: "Plans the work, splits it across the team, and keeps every decision in one place.",
        model: "claude-opus-5-5",
        reasoningEffort: "high",
        preview: "Three things need you today: the pricing PR, the competitor brief, and the launch day.",
      },
      30,
      94,
    ),
    agent(
      {
        id: "scout",
        provider: "antigravity",
        name: "Scout",
        title: "Research",
        description: "Searches the web, checks every claim against a source, and writes short briefs.",
        model: "gemini-3.1-pro",
        reasoningEffort: "high",
        preview: "Two competitors changed their prices this week. The brief is attached.",
      },
      215,
      78,
    ),
    agent(
      {
        id: "forge",
        provider: "codex",
        name: "Forge",
        title: "Builder",
        description: "Writes and ships the code, runs the tests, and opens the pull requests.",
        model: "gpt-6-luna",
        reasoningEffort: "medium",
        preview: "PR #412 is ready: the pricing page reads its limits from the shared contract.",
      },
      150,
      66,
    ),
    agent(
      {
        id: "pulse",
        provider: "grok",
        name: "Pulse",
        title: "Signals",
        description: "Watches social and market signals and reports what changed and why it matters.",
        model: "grok-4.6",
        reasoningEffort: "medium",
        preview: "Mentions of agent teams are up 34% this week.",
      },
      280,
      58,
    ),
  ];
}

function landingHistory(at: (minutesAgo: number) => string): Record<string, ConversationMessage[]> {
  const user = (id: string, text: string, minutesAgo: number): ConversationMessage => ({
    id: `landing-${id}`,
    author: "user",
    source: "user",
    text,
    createdAt: at(minutesAgo),
    status: "completed",
  });
  const reply = (
    id: string,
    text: string,
    minutesAgo: number,
    fields: Pick<ConversationMessage, "attachments" | "reaction"> = {},
  ): ConversationMessage => ({
    id: `landing-${id}`,
    author: "assistant",
    source: "assistant",
    itemType: "final_answer",
    text,
    createdAt: at(minutesAgo),
    status: "completed",
    ...fields,
  });
  return {
    atlas: [
      user("atlas-morning", "Morning! What needs me today?", 95),
      reply(
        "atlas-morning-reply",
        [
          "Three things need you today:",
          "",
          "1. **Review** Forge's pricing-page PR #412.",
          "2. **Read** Scout's competitor brief. Two prices changed.",
          "3. **Pick** the launch day. Friday works for the whole team.",
        ].join("\n"),
        94,
        { reaction: "👍" },
      ),
    ],
    scout: [
      user("scout-pricing", "Track what changed in competitor pricing this week.", 80),
      reply(
        "scout-pricing-reply",
        "Two competitors changed their prices this week. Both raised their team plans by $5 per seat. The sources and the full table are in the brief.",
        78,
        { attachments: [landingAttachment("competitor-brief", "competitor-brief.md", 4_096)] },
      ),
    ],
    forge: [
      user("forge-pricing", "Fix the plan limits on the pricing page.", 70),
      reply(
        "forge-pricing-reply",
        "PR #412 is ready: the pricing page reads its limits from the shared contract, so the two can no longer differ. All 48 tests pass.",
        66,
      ),
    ],
    pulse: [
      user("pulse-week", "What are people saying about agent teams this week?", 60),
      reply(
        "pulse-week-reply",
        "Mentions of agent teams are up 34% this week. The top request is agents that keep their context when you switch tools or models.",
        58,
        { reaction: "🔥" },
      ),
    ],
  };
}

function landingServers(): ServerSummary[] {
  return [
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
}

/** The two teammates of the demo: Alice and Maya. */
const LANDING_MEMBER_IDS = new Set(["member-self", "member-alice", "member-maya"]);

function landingPresence(at: (minutesAgo: number) => string): TeamPresenceSnapshot {
  return {
    ...STORY_PRESENCE,
    updatedAt: at(0),
    members: STORY_PRESENCE.members
      .filter((member) => LANDING_MEMBER_IDS.has(member.id))
      .map((member) => ({
        ...member,
        typingAgentId: null,
        ...(member.id === "member-self" ? { email: LANDING_PREVIEW_EMAIL } : {}),
      })),
  };
}

type LandingDirectLine = [sender: "self" | "other", text: string, minutesAgo: number];

function landingDirectSnapshots(at: (minutesAgo: number) => string): Record<string, DirectConversationSnapshot> {
  const thread = (
    memberId: string,
    threadId: string,
    lines: LandingDirectLine[],
    unreadCount: number,
  ): DirectConversationSnapshot => {
    const messages: DirectMessage[] = lines.map(([sender, text, minutesAgo], index) => ({
      id: `landing-${threadId}-${index + 1}`,
      threadId,
      senderMemberId: sender === "self" ? "member-self" : memberId,
      recipientMemberId: sender === "self" ? memberId : "member-self",
      text,
      createdAt: at(minutesAgo),
      sequence: index + 1,
    }));
    return {
      threadId,
      otherMemberId: memberId,
      revision: 1,
      readState: {
        unreadCount,
        firstUnreadMessageId: unreadCount > 0 ? (messages.at(-unreadCount)?.id ?? null) : null,
        throughSequence: messages.length - unreadCount,
      },
      messages,
    };
  };
  return {
    "member-alice": thread(
      "member-alice",
      "direct-alice",
      [
        ["other", "Atlas says Friday works for everyone. Should I book the launch slot?", 34],
        ["self", "Yes, please. I will ask Atlas for the full plan this morning.", 31],
        ["other", "Booked for 10:00. I can own the launch post too.", 12],
      ],
      1,
    ),
    "member-maya": thread(
      "member-maya",
      "direct-maya",
      [
        ["self", "Can you cover support during the launch window?", 52],
        ["other", "Yes. Pulse will flag anything urgent to me first.", 49],
      ],
      0,
    ),
  };
}

function landingDirectThreads(snapshots: Record<string, DirectConversationSnapshot>): DirectThreadSummary[] {
  return Object.values(snapshots).map((snapshot) => {
    const lastMessage = snapshot.messages.at(-1);
    if (!lastMessage) throw new Error(`Landing direct thread ${snapshot.threadId} has no messages.`);
    return {
      threadId: snapshot.threadId,
      otherMemberId: snapshot.otherMemberId,
      lastMessage,
      unreadCount: snapshot.readState?.unreadCount ?? 0,
      updatedAt: lastMessage.createdAt,
    };
  });
}

function landingAgentStatus(): AgentStatus {
  const row = (id: AgentProviderStatus["id"], version: string): AgentProviderStatus => ({
    id,
    state: "available" as const,
    version,
    message: null,
    email: LANDING_PREVIEW_EMAIL,
  });
  return {
    ...STORY_AGENT_STATUS,
    auth: { kind: "chatgpt", email: LANDING_PREVIEW_EMAIL },
    providers: [row("claude", "2.1.231"), row("antigravity", "1.3.0"), row("codex", "0.144.1"), row("grok", "0.1.0")],
  };
}

function landingUsage(nowMs: number): AccountUsage {
  const resetsIn = (hours: number) => Math.round((nowMs + hours * 60 * MINUTE_MS) / 1_000);
  return {
    limits: [
      {
        id: "claude",
        primary: { usedPercent: 34, windowDurationMins: 300, resetsAt: resetsIn(3) },
        secondary: { usedPercent: 21, windowDurationMins: 10_080, resetsAt: resetsIn(96) },
      },
      {
        id: "antigravity",
        primary: { usedPercent: 18, windowDurationMins: 300, resetsAt: resetsIn(4) },
        secondary: null,
      },
      {
        id: "codex",
        primary: { usedPercent: 27, windowDurationMins: 300, resetsAt: resetsIn(2) },
        secondary: { usedPercent: 40, windowDurationMins: 10_080, resetsAt: resetsIn(120) },
      },
      {
        id: "grok",
        primary: null,
        secondary: { usedPercent: 12, windowDurationMins: 10_080, resetsAt: resetsIn(140) },
      },
    ],
  };
}

function landingUpdateStatus(at: (minutesAgo: number) => string): UpdateStatus {
  return {
    phase: "idle",
    currentVersion: "0.49.0",
    availableVersion: null,
    progress: null,
    checkedAt: at(5),
    message: null,
    errorCode: null,
  };
}

type LandingRoutines = Required<
  Pick<MockOpenBotOptions, "routines" | "routineRuns" | "routineFlowLinks" | "routineFlowSteps">
>;

/**
 * The routines, with links and the steps of the last run, so the Routines canvas shows what each
 * agent was asked and what it answered. They use the visitor's time zone, so the app does not offer
 * to move them.
 */
function landingRoutines(at: (minutesAgo: number) => string, timezone: string): LandingRoutines {
  const createdAt = at(14 * 24 * 60);
  const routine = (
    agentId: string,
    id: string,
    fields: Pick<Routine, "name" | "instruction" | "active"> & { schedule: RoutineSchedule; nextRunInMinutes: number },
  ): Routine => ({
    id,
    agentId,
    name: fields.name,
    instruction: fields.instruction,
    active: fields.active,
    timezone,
    trigger: {
      id: `${id}-trigger`,
      routineId: id,
      schedule: fields.schedule,
      nextRunAt: at(-fields.nextRunInMinutes),
      createdAt,
      updatedAt: createdAt,
    },
    createdAt,
    updatedAt: createdAt,
  });
  const run = (target: Routine, id: string, minutesAgo: number, durationMinutes: number): RoutineRun => ({
    id,
    routineId: target.id,
    agentId: target.agentId,
    triggerId: target.trigger.id,
    deliveryId: `${id}-delivery`,
    routineName: target.name,
    instruction: target.instruction,
    kind: "scheduled",
    status: "succeeded",
    error: null,
    scheduledFor: at(minutesAgo),
    createdAt: at(minutesAgo),
    updatedAt: at(minutesAgo - durationMinutes),
  });
  /** The message a linked agent gets, in the template of `handoffText` in `src/backend/routine-flows/routine-flows.ts`. */
  const handoff = (routineName: string, from: string, answer: string, instruction: string) =>
    `The routine "${routineName}" continues with you.\n\n${from} answered:\n\n${answer}\n\n${instruction}`;

  const brief = routine("atlas", "landing-routine-morning-brief", {
    name: "Morning launch brief",
    instruction: "Summarize launch progress, blockers, owners, and the next decision in five bullets.",
    active: true,
    schedule: { kind: "weekdays", time: "09:00" },
    nextRunInMinutes: 22 * 60,
  });
  const review = routine("atlas", "landing-routine-friday-review", {
    name: "Friday launch review",
    instruction: "Prepare the weekly launch review with decisions, risks, and open owners.",
    active: true,
    schedule: { kind: "weekly", weekday: 5, time: "16:00" },
    nextRunInMinutes: 3 * 24 * 60,
  });
  const scan = routine("scout", "landing-routine-competitor-scan", {
    name: "Daily competitor scan",
    instruction: "Check competitor pricing and release pages, and report only what changed since yesterday.",
    active: true,
    schedule: { kind: "daily", time: "08:30" },
    nextRunInMinutes: 21 * 60,
  });
  const dependencies = routine("forge", "landing-routine-dependency-check", {
    name: "Dependency health check",
    instruction: "Review dependency health and prepare a short risk report without changing the codebase.",
    active: false,
    schedule: { kind: "weekly", weekday: 1, time: "10:00" },
    nextRunInMinutes: 5 * 24 * 60,
  });
  const signals = routine("pulse", "landing-routine-signals-digest", {
    name: "Signals digest",
    instruction: "List the three biggest changes in mentions, sentiment, and requests since the last digest.",
    active: true,
    schedule: { kind: "weekdays", time: "15:30" },
    nextRunInMinutes: 5 * 60,
  });

  const briefRun = run(brief, "landing-run-morning-brief", 120, 6);
  const scanRun = run(scan, "landing-run-competitor-scan", 150, 3);

  const toScout = "Check each claim in the brief against a primary source. Mark it confirmed, changed, or unverified.";
  const toPulse = "Add what people say about each item this week, with the strongest signal first.";
  const scoutToForge = "Do not change code yet. List the changes the changed claims need, smallest first.";
  const atlasAnswer = [
    "- Progress: the pricing page fix is in review, and the launch post has a draft.",
    "- Blocker: the demo video needs one more review.",
    "- Owners: Forge has the PR, Scout has the comparison table, Pulse has the launch post.",
    "- Risk: two competitor prices in the table are from last month.",
    "- Next decision: launch on Friday at 10:00, or wait for the video.",
  ].join("\n");
  const scoutAnswer = [
    "- Pricing page fix in review: confirmed, PR #412.",
    "- Competitor prices: changed. Both raised their team plans by $5 per seat on Tuesday.",
    "- Demo video: confirmed in the review thread.",
  ].join("\n");
  const pulseAnswer = [
    "1. Agent teams: mentions up 34%, mostly positive.",
    "2. Context that survives a model switch: the top request.",
    "3. Pricing: two threads compare per-seat prices.",
  ].join("\n");
  const forgeAnswer = [
    "1. Change the two competitor prices in `pricing-table.json`.",
    "2. Run the pricing page tests again.",
    "No other change is needed for the claims in this brief.",
  ].join("\n");

  const step = (
    id: string,
    agentId: string,
    input: string,
    output: string,
    minutesAgo: number,
    delivered: boolean,
  ): RoutineFlowStep => ({
    id: `landing-step-${id}`,
    runId: briefRun.id,
    agentId,
    deliveryId: delivered ? `landing-step-${id}-delivery` : null,
    input,
    output,
    status: "succeeded",
    error: null,
    createdAt: at(minutesAgo),
    updatedAt: at(minutesAgo - 2),
  });
  const link = (id: string, fromAgentId: string, toAgentId: string, instruction: string): RoutineFlowLink => ({
    id: `landing-link-${id}`,
    routineId: brief.id,
    fromAgentId,
    toAgentId,
    instruction,
    createdAt,
  });

  return {
    routines: { atlas: [brief, review], scout: [scan], forge: [dependencies], pulse: [signals] },
    routineRuns: { [brief.id]: [briefRun], [scan.id]: [scanRun] },
    routineFlowLinks: [
      link("brief-scout", "atlas", "scout", toScout),
      link("brief-pulse", "atlas", "pulse", toPulse),
      link("scout-forge", "scout", "forge", scoutToForge),
    ],
    routineFlowSteps: [
      step("brief-atlas", "atlas", brief.instruction, atlasAnswer, 120, false),
      step("brief-scout", "scout", handoff(brief.name, "Atlas", atlasAnswer, toScout), scoutAnswer, 118, true),
      step("brief-pulse", "pulse", handoff(brief.name, "Atlas", atlasAnswer, toPulse), pulseAnswer, 118, true),
      step("brief-forge", "forge", handoff(brief.name, "Scout", scoutAnswer, scoutToForge), forgeAnswer, 116, true),
    ],
  };
}

const LANDING_CHANNEL_ID = "channel-launch";

type LandingChannelLine = [author: "member-self" | "atlas" | "pulse" | "scout", text: string, minutesAgo: number];

/** The launch channel: you and the agents plan Friday together. */
function landingChannels(at: (minutesAgo: number) => string): MockChannelSeed[] {
  const authors = {
    "member-self": { kind: "member", id: "member-self", name: "Norbert" },
    atlas: { kind: "agent", id: "atlas", name: "Atlas" },
    pulse: { kind: "agent", id: "pulse", name: "Pulse" },
    scout: { kind: "agent", id: "scout", name: "Scout" },
  } as const;
  const lines: LandingChannelLine[] = [
    ["member-self", "The launch is on Friday at 10:00. Let's keep the launch updates in this channel.", 52],
    ["atlas", "Got it. I will split the work across the team and post the plan here when it is ready.", 51],
    ["pulse", "I will watch what people say on launch day and post a summary at 12:00.", 49],
    ["scout", "Nobody else launches on Friday morning. I will post here if that changes.", 47],
  ];
  const messages: ChannelMessage[] = lines.map(([authorId, text, minutesAgo], index) => {
    const author = authors[authorId];
    const id = `landing-launch-${index + 1}`;
    return {
      id,
      channelId: LANDING_CHANNEL_ID,
      sequence: index + 1,
      author,
      taskId: null,
      superseded: false,
      message: {
        id,
        author: author.kind === "member" ? "user" : "assistant",
        ...(author.kind === "agent" ? { itemType: "final_answer" } : {}),
        text,
        createdAt: at(minutesAgo),
        status: "completed",
      },
    };
  });
  return [
    {
      channel: {
        id: LANDING_CHANNEL_ID,
        name: "launch",
        title: "Friday launch",
        instructions: "Plan and run Friday's launch.",
        members: [{ agentId: "atlas" }, { agentId: "scout" }, { agentId: "forge" }, { agentId: "pulse" }],
        leadAgentId: "atlas",
        archived: false,
        revision: 1,
        createdAt: at(60),
      },
      messages,
    },
  ];
}

/** Two sections: the launch work, and the research that feeds it. */
function landingSidebarLayout(): SidebarLayoutSnapshot {
  return {
    revision: 1,
    sections: [
      { id: "section-launch", name: "Launch" },
      { id: "section-research", name: "Research" },
    ],
    order: ["section-launch", "section-research", SIDEBAR_UNASSIGNED_SECTION_ID],
    agentAssignments: {
      [LANDING_CHANNEL_ID]: "section-launch",
      atlas: "section-launch",
      forge: "section-launch",
      pulse: "section-launch",
      scout: "section-research",
    },
    agentOrder: [LANDING_CHANNEL_ID, "atlas", "forge", "pulse", "scout"],
  };
}

/** Each chat starts read through its last message, so a reply that lands later shows as unread. */
function landingConversationReads(
  snapshots: Record<string, ConversationSnapshot>,
): Record<string, ConversationReadState> {
  return Object.fromEntries(
    Object.values(snapshots).map((snapshot) => [
      snapshot.agentId,
      { unreadCount: 0, firstUnreadMessageId: null, throughMessageId: snapshot.messages.at(-1)?.id ?? null },
    ]),
  );
}

export function createLandingPreviewOptions(now: Date): MockOpenBotOptions {
  const nowMs = now.getTime();
  const at = (minutesAgo: number) => new Date(nowMs - minutesAgo * MINUTE_MS).toISOString();
  const agents = landingAgents(at);
  const history = landingHistory(at);
  const snapshots: Record<string, ConversationSnapshot> = Object.fromEntries(
    agents.map((agent) => [
      agent.id,
      {
        agentId: agent.id,
        threadId: agent.threadId,
        activeTurnId: null,
        revision: 1,
        messages: history[agent.id] ?? [],
      },
    ]),
  );
  const directSnapshots = landingDirectSnapshots(at);
  const contextBefore = Object.fromEntries(
    Object.entries(LANDING_CONTEXT_TOKENS).map(([agentId, tokens]) => [agentId, tokens.before]),
  );
  return {
    authState: {
      status: "signed_in",
      user: { id: "user-1", email: LANDING_PREVIEW_EMAIL, name: "Norbert", avatarUrl: null },
    },
    agentStatus: landingAgentStatus(),
    usage: landingUsage(nowMs),
    updateStatus: landingUpdateStatus(at),
    storyForeignAgent: false,
    agents,
    snapshots,
    conversationReads: landingConversationReads(snapshots),
    runtimeSnapshot: landingRuntimeSnapshot(agents, contextBefore),
    servers: landingServers(),
    directThreads: landingDirectThreads(directSnapshots),
    directSnapshots,
    presence: landingPresence(at),
    channels: landingChannels(at),
    sidebarLayout: landingSidebarLayout(),
    browserTabs: [],
    browserControlState: { sessions: [] },
    remoteDesktopSessions: [],
    // The team server serves every capability, `host-update-v1` too; it is up to date, so no update notice shows.
    hostUpdate: {
      phase: "idle",
      currentVersion: "0.49.0",
      availableVersion: null,
      progress: null,
      errorCode: null,
      remoteUpdates: "allowed",
      autoDownload: true,
      autoInstall: false,
      restart: null,
    },
    ...landingRoutines(at, Intl.DateTimeFormat().resolvedOptions().timeZone),
  };
}
