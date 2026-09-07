import type {
  AccountUsage,
  AgentModelOption,
  AgentStatus,
  AgentSubmission,
  AgentSummary,
  AttachmentSummary,
  BrowserControlState,
  BrowserTab,
  ConversationMessage,
  ConversationSnapshot,
  DirectConversationSnapshot,
  DirectThreadSummary,
  HostedSiteSummary,
  HostStatus,
  InstalledSkill,
  MarketplaceAgentDetail,
  MarketplaceAgentRoutine,
  MarketplaceAgentSkill,
  MarketplaceAgentSummary,
  MarketplaceSkillDetail,
  MarketplaceSkillSummary,
  RemoteDesktopSession,
  ServerSummary,
  SkillPackagePreview,
  SkillSubmission,
  TeamInviteSummary,
  TeamMemberSummary,
  TeamPresenceSnapshot,
  TeamSessionSummary,
  UpdateStatus,
} from "@openbot/contracts/ipc";
import type { AgentProfile } from "../data";

export const STORY_NOW = "2026-08-19T10:00:00.000Z";

export const STORY_AGENT_SUMMARIES: AgentSummary[] = [
  {
    id: "chief",
    provider: "codex",
    name: "Chief",
    title: "Chief of staff",
    description: "Coordinates projects, priorities, and next steps across the workspace.",
    notifications: true,
    model: "gpt-5.6-luna",
    reasoningEffort: "medium",
    threadId: "thread-chief",
    workspacePath: "/mock/OpenBot/Agents/chief",
    preview: "I pulled together the latest project notes and next steps.",
    updatedAt: STORY_NOW,
    avatarSeed: "chief",
    avatarHue: 245,
    avatarUrl: null,
  },
  {
    id: "research",
    provider: "claude",
    name: "Research",
    title: "Research partner",
    description: "Finds reliable sources and turns them into concise, useful briefs.",
    notifications: true,
    model: "claude-sonnet-5",
    reasoningEffort: "high",
    threadId: "thread-research",
    workspacePath: "/mock/OpenBot/Agents/research",
    preview: "Three useful sources are ready for your review.",
    updatedAt: "2026-08-18T16:32:00.000Z",
    avatarSeed: "research",
    avatarHue: 185,
    avatarUrl: null,
  },
  {
    id: "sales",
    provider: "codex",
    name: "Sales Outbound",
    title: "Outbound specialist",
    description: "Prepares thoughtful prospect research and personalized outreach.",
    notifications: true,
    model: "gpt-5.6-terra",
    reasoningEffort: "medium",
    threadId: "thread-sales",
    workspacePath: "/mock/OpenBot/Agents/sales",
    preview: "The follow-up draft is ready to send.",
    updatedAt: "2026-08-17T09:20:00.000Z",
    avatarSeed: "sales-outbound",
    avatarHue: 280,
    avatarUrl: null,
  },
];

export const STORY_AGENTS: AgentProfile[] = STORY_AGENT_SUMMARIES.map((agent, index) => ({
  id: agent.id,
  provider: agent.provider,
  name: agent.name,
  title: agent.title,
  description: agent.description,
  notifications: agent.notifications,
  model: agent.model,
  reasoningEffort: agent.reasoningEffort,
  threadId: agent.threadId,
  avatarSeed: agent.avatarSeed,
  avatarHue: agent.avatarHue,
  avatarUrl: agent.avatarUrl,
  time: index === 0 ? "10:00" : index === 1 ? "Yesterday" : "Mon",
  preview: agent.preview,
}));

export const STORY_MODELS: AgentModelOption[] = [
  {
    provider: "codex",
    id: "gpt-5.6-luna",
    name: "Luna",
    description: "Fast and efficient for everyday agent work.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high"],
  },
  {
    provider: "codex",
    id: "gpt-5.6-terra",
    name: "Terra",
    description: "Balanced speed and capability for involved tasks.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["medium", "high"],
  },
  {
    provider: "codex",
    id: "gpt-5.6-sol",
    name: "Sol",
    description: "Most capable for complex, long-running work.",
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: ["medium", "high", "xhigh"],
  },
  {
    provider: "claude",
    id: "claude-opus-5",
    name: "Claude Opus 5",
    description: "Most capable Claude model for complex work.",
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: ["low", "medium", "high"],
  },
  {
    provider: "claude",
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5",
    description: "Balanced Claude model for general agent work.",
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: ["low", "medium", "high"],
  },
  {
    provider: "grok",
    id: "grok-code-fast-1",
    name: "Grok Code Fast 1",
    description: "Discovered from Grok CLI over ACP.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high"],
  },
];

export const STORY_AGENT_STATUS: AgentStatus = {
  phase: "ready",
  cliVersion: "0.144.1",
  auth: { kind: "chatgpt", email: "person@example.com" },
  providers: [
    {
      id: "codex",
      state: "available",
      version: "0.144.1",
      message: null,
      email: "person@example.com",
    },
    {
      id: "claude",
      state: "available",
      version: "2.1.231",
      message: null,
      email: "person@example.com",
    },
    {
      id: "grok",
      state: "available",
      version: "0.1.0",
      message: null,
      email: null,
    },
  ],
  capabilities: { chat: "ready", browser: "ready", computerUse: "ready" },
  message: null,
  fullAccess: true,
};

export const STORY_USAGE: AccountUsage = {
  limits: [
    {
      id: "codex",
      primary: { usedPercent: 28, windowDurationMins: 300, resetsAt: 1_786_563_600 },
      secondary: { usedPercent: 41, windowDurationMins: 10_080, resetsAt: 1_787_040_000 },
    },
  ],
};

export const STORY_ATTACHMENTS: AttachmentSummary[] = [
  {
    id: "attachment-start-types",
    name: "start-types.d.ts",
    size: 6_144,
    kind: "file",
    mimeType: "text/plain",
    previewKind: "text",
    previewUrl: null,
  },
  {
    id: "attachment-agents",
    name: "AGENTS.md",
    size: 2_048,
    kind: "file",
    mimeType: "text/plain",
    previewKind: "text",
    previewUrl: null,
  },
];

export const STORY_CONVERSATION_MESSAGES: ConversationMessage[] = [
  {
    id: "message-user-1",
    author: "user",
    source: "user",
    text: "Can you turn the latest notes into a short plan and tag @Research for the source check?",
    createdAt: "2026-08-19T09:42:00.000Z",
    status: "completed",
  },
  {
    id: "message-agent-1",
    author: "assistant",
    source: "assistant",
    text: "Absolutely. I’ll structure the plan around the launch milestones and ask @Research to verify the supporting sources.\n\nThe first draft is ready here: https://openbot.run/docs",
    createdAt: "2026-08-19T09:43:00.000Z",
    status: "completed",
    attachments: STORY_ATTACHMENTS,
    reaction: "👍",
  },
  {
    id: "message-exchange",
    author: "system",
    source: "system",
    text: "",
    createdAt: "2026-08-19T09:44:00.000Z",
    status: "completed",
    exchange: {
      direction: "outgoing",
      messageId: "message-exchange",
      senderAgentId: "chief",
      recipientAgentIds: ["research", "sales"],
      replyToMessageId: null,
      deliveries: [
        {
          id: "delivery-research",
          recipientAgentId: "research",
          status: "completed",
          position: null,
          error: null,
        },
        {
          id: "delivery-sales",
          recipientAgentId: "sales",
          status: "running",
          position: 1,
          error: null,
        },
      ],
    },
  },
  {
    id: "message-agent-2",
    author: "assistant",
    source: "assistant",
    text: "I’ll keep the final plan concise, with owners and a clear next action for each milestone.",
    createdAt: "2026-08-19T09:45:00.000Z",
    status: "completed",
  },
];

export const STORY_SNAPSHOTS: Record<string, ConversationSnapshot> = Object.fromEntries(
  STORY_AGENT_SUMMARIES.map((agent) => [
    agent.id,
    {
      agentId: agent.id,
      threadId: agent.threadId,
      activeTurnId: null,
      revision: 1,
      messages: agent.id === "chief" ? STORY_CONVERSATION_MESSAGES : [],
    },
  ]),
);

export const STORY_PRESENCE: TeamPresenceSnapshot = {
  serverId: "team",
  updatedAt: STORY_NOW,
  members: [
    {
      id: "member-self",
      username: "norbert",
      email: "person@example.com",
      name: "Norbert",
      role: "owner",
      createdAt: "2026-01-10T08:00:00.000Z",
      disabled: false,
      online: true,
      typingAgentId: null,
    },
    {
      id: "member-alice",
      username: "alice",
      email: "alice@example.com",
      name: "Alice Chen",
      role: "admin",
      createdAt: "2026-02-01T08:00:00.000Z",
      disabled: false,
      online: true,
      typingAgentId: "chief",
    },
    {
      id: "member-jon",
      username: "jon",
      email: "jon@example.com",
      name: "Jon Bell",
      role: "member",
      createdAt: "2026-03-15T08:00:00.000Z",
      disabled: false,
      online: false,
      typingAgentId: null,
    },
    {
      id: "member-maya",
      username: "maya",
      email: "maya@example.com",
      name: "Maya Singh",
      role: "member",
      createdAt: "2026-04-11T08:00:00.000Z",
      disabled: false,
      online: true,
      typingAgentId: null,
    },
  ],
};

export const STORY_DIRECT_THREADS: DirectThreadSummary[] = [
  {
    threadId: "direct-alice",
    otherMemberId: "member-alice",
    lastMessage: {
      id: "direct-message-alice",
      threadId: "direct-alice",
      senderMemberId: "member-alice",
      recipientMemberId: "member-self",
      text: "The launch notes look good — can you review the last section?",
      createdAt: "2026-08-19T09:30:00.000Z",
      sequence: 2,
    },
    unreadCount: 2,
    updatedAt: "2026-08-19T09:30:00.000Z",
  },
];

export const STORY_DIRECT_SNAPSHOTS: Record<string, DirectConversationSnapshot> = {
  "member-alice": {
    threadId: "direct-alice",
    otherMemberId: "member-alice",
    revision: 1,
    readState: {
      unreadCount: 1,
      firstUnreadMessageId: "direct-message-alice",
      throughSequence: 1,
    },
    messages: [
      {
        id: "direct-message-hello",
        threadId: "direct-alice",
        senderMemberId: "member-self",
        recipientMemberId: "member-alice",
        text: "I’m reviewing the launch notes now.",
        createdAt: "2026-08-19T09:21:00.000Z",
        sequence: 1,
      },
      STORY_DIRECT_THREADS[0].lastMessage,
    ],
  },
};

export const STORY_SERVERS: ServerSummary[] = [
  {
    id: "local",
    name: "Local",
    logoUrl: null,
    kind: "local",
    state: "online",
    apiUrl: null,
    remoteDesktopAvailable: false,
    role: null,
    active: true,
  },
  {
    id: "team",
    name: "OpenBot team",
    logoUrl: null,
    kind: "remote",
    state: "online",
    apiUrl: "https://team.example.com",
    remoteDesktopAvailable: true,
    role: "owner",
    active: false,
  },
];

export const STORY_BROWSER_TABS: BrowserTab[] = [
  {
    id: "browser-tab-docs",
    title: "OpenBot documentation",
    url: "https://openbot.run/docs",
    loading: false,
    ownerThreadId: "thread-chief",
    ownerAgentId: "chief",
  },
];

export const STORY_BROWSER_CONTROL: BrowserControlState = {
  sessions: [
    {
      id: "browser-session-1",
      threadId: "thread-chief",
      turnId: "turn-1",
      callId: "call-1",
      tabId: "browser-tab-docs",
      action: "snapshot",
      phase: "waiting",
      startedAt: STORY_NOW,
    },
  ],
};

export const STORY_HOST_STATUS: HostStatus = {
  phase: "online",
  configured: true,
  enabledOnLaunch: true,
  serverId: "team",
  serverName: "OpenBot team",
  logoUrl: null,
  apiUrl: "https://team.example.com",
  apiOnline: true,
  remoteDesktopReady: true,
  remoteDesktopUnattended: true,
  remoteDesktopActiveSessions: 1,
  remoteDesktopMaxSessions: 4,
  message: null,
};

export const STORY_TEAM_MEMBERS: TeamMemberSummary[] = STORY_PRESENCE.members.map((member) => ({
  id: member.id,
  username: member.username,
  email: member.email,
  name: member.name,
  role: member.role,
  createdAt: member.createdAt,
  disabled: member.disabled,
}));

export const STORY_INVITES: TeamInviteSummary[] = [
  {
    id: "invite-1",
    role: "member",
    expiresAt: "2026-08-29T10:00:00.000Z",
    usedAt: null,
    email: "new-person@example.com",
  },
];

export const STORY_SESSIONS: TeamSessionSummary[] = [
  {
    id: "session-1",
    memberId: "member-alice",
    username: "alice",
    createdAt: "2026-08-18T10:00:00.000Z",
    expiresAt: "2026-09-18T10:00:00.000Z",
  },
];

export const STORY_REMOTE_DESKTOP_SESSION: RemoteDesktopSession = {
  id: "remote-desktop-1",
  serverId: "team",
  viewerUrl: "https://team.example.com/v1/remote-screen/sessions/remote-desktop-1/viewer",
  viewerGrant: "story-viewer-grant",
  displays: [{ id: "display-1", label: "Main display", width: 1920, height: 1080, primary: true }],
  selectedDisplayId: "display-1",
  phase: "connected",
  transport: "p2p",
  errorCode: null,
  message: null,
  createdAt: STORY_NOW,
  grantExpiresAt: "2026-08-19T10:01:00.000Z",
};

export const STORY_UPDATE_STATUS: UpdateStatus = {
  phase: "available",
  currentVersion: "0.1.11",
  availableVersion: "0.2.0",
  progress: null,
  checkedAt: STORY_NOW,
  message: null,
  errorCode: null,
};

export const STORY_APP_INFO = {
  name: "OpenBot",
  version: "0.1.11",
  platform: "darwin" as const,
  variant: "production" as const,
};

/**
 * The marketplace surfaces. Storybook and the preview both reach the modal through
 * `mock-openbot.ts`, so an empty list here reads as "the marketplace is empty" rather than "the
 * preview never wired this up" — which is what the three stubs it replaced looked like.
 */
export const STORY_MARKETPLACE_SKILLS: MarketplaceSkillSummary[] = [
  {
    id: "skill-release-notes",
    slug: "release-notes",
    name: "Release notes",
    description: "Turns a range of commits into a changelog a reader outside the team can follow.",
    category: "documents",
    creatorName: "OpenBot",
    version: 4,
    installs: 1_284,
    featured: true,
    iconUrl: null,
    updatedAt: "2026-08-17T09:12:00.000Z",
  },
  {
    id: "skill-sql-review",
    slug: "sql-review",
    name: "SQL review",
    description: "Reads a migration and reports the queries it makes slower, with the plan for each.",
    category: "data-analytics",
    creatorName: "Marta Nowak",
    version: 2,
    installs: 862,
    featured: true,
    iconUrl: null,
    updatedAt: "2026-08-15T14:40:00.000Z",
  },
  {
    id: "skill-design-audit",
    slug: "design-audit",
    name: "Design audit",
    description: "Checks a screen against the design system and lists the tokens it steps outside.",
    category: "design",
    creatorName: "Studio Kappa",
    version: 7,
    installs: 517,
    featured: false,
    iconUrl: null,
    updatedAt: "2026-08-11T11:05:00.000Z",
  },
  {
    id: "skill-inbox-triage",
    slug: "inbox-triage",
    name: "Inbox triage",
    description: "Sorts a morning inbox into what needs a reply today and what can wait.",
    category: "productivity",
    creatorName: "Jules Fournier",
    version: 1,
    installs: 344,
    featured: false,
    iconUrl: null,
    updatedAt: "2026-08-09T07:30:00.000Z",
  },
  {
    id: "skill-source-check",
    slug: "source-check",
    name: "Source check",
    description: "Follows every citation in a draft and flags the ones that do not say what is claimed.",
    category: "research",
    creatorName: "OpenBot",
    version: 3,
    installs: 209,
    featured: false,
    iconUrl: null,
    updatedAt: "2026-08-04T16:20:00.000Z",
  },
  {
    id: "skill-nightly-backup",
    slug: "nightly-backup",
    name: "Nightly backup",
    description: "Copies a workspace to an external volume and reports what changed since last night.",
    category: "automation",
    creatorName: "Ravi Menon",
    version: 5,
    installs: 156,
    featured: false,
    iconUrl: null,
    updatedAt: "2026-07-28T22:00:00.000Z",
  },
];

const STORY_SKILL_INSTRUCTIONS: Record<string, string> = {
  "skill-release-notes":
    "Read the commits in the given range. Group them by what a reader would notice, not by\ndirectory. Drop anything a user cannot see. Write one line per change in the past tense.",
  "skill-sql-review":
    "Read the migration and the queries in the same change. For each query the migration touches,\nreport the plan before and after and name the index that would keep it fast.",
  "skill-design-audit":
    "Compare every colour, spacing and radius in the screen against the design tokens. List each\nvalue that is not a token, with the token that is closest to it.",
  "skill-inbox-triage":
    "Sort the inbox into reply today, reply this week, and no reply needed. Say in one line why\neach message landed where it did.",
  "skill-source-check":
    "Open every citation. Quote the sentence that supports the claim, or say the source does not\nsupport it.",
  "skill-nightly-backup":
    "Copy the workspace to the configured volume. Report the files added, changed and removed\nsince the previous run, and the total time taken.",
};

export const STORY_MARKETPLACE_SKILL_DETAILS: Record<string, MarketplaceSkillDetail> = Object.fromEntries(
  STORY_MARKETPLACE_SKILLS.map((skill) => [
    skill.id,
    {
      ...skill,
      versionId: `${skill.id}-v${skill.version}`,
      bundleSha256: `${skill.slug.replaceAll("-", "")}00112233445566778899aabbccddeeff00112233445566778899aabbcc`.slice(
        0,
        64,
      ),
      files: ["SKILL.md", "README.md", `scripts/${skill.slug}.ts`],
      instructions: STORY_SKILL_INSTRUCTIONS[skill.id] ?? "",
    },
  ]),
);

export const STORY_INSTALLED_SKILLS: Record<string, InstalledSkill[]> = {
  chief: [
    {
      skillId: "skill-release-notes",
      slug: "release-notes",
      name: "Release notes",
      installedVersion: 4,
      availableVersion: 4,
      state: "installed",
    },
    {
      skillId: "skill-inbox-triage",
      slug: "inbox-triage",
      name: "Inbox triage",
      installedVersion: 1,
      availableVersion: 1,
      state: "modified",
    },
  ],
  research: [
    {
      skillId: "skill-source-check",
      slug: "source-check",
      name: "Source check",
      installedVersion: 2,
      availableVersion: 3,
      state: "update-available",
    },
  ],
};

export const STORY_SKILL_SUBMISSIONS: SkillSubmission[] = [
  {
    id: "submission-standup",
    skillId: "skill-standup-digest",
    slug: "standup-digest",
    name: "Standup digest",
    description: "Collects yesterday's activity into the three lines a standup actually needs.",
    category: "productivity",
    version: 1,
    status: "pending",
    rejectionNote: null,
    iconUrl: null,
    createdAt: "2026-08-18T08:15:00.000Z",
  },
  {
    id: "submission-source-check",
    skillId: "skill-source-check",
    slug: "source-check",
    name: "Source check",
    description: "Follows every citation in a draft and flags the ones that do not say what is claimed.",
    category: "research",
    version: 3,
    status: "approved",
    rejectionNote: null,
    iconUrl: null,
    createdAt: "2026-08-04T16:20:00.000Z",
  },
  {
    id: "submission-mail-merge",
    skillId: "skill-mail-merge",
    slug: "mail-merge",
    name: "Mail merge",
    description: "Fills a template from a spreadsheet and sends the result to each row.",
    category: "automation",
    version: 1,
    status: "rejected",
    rejectionNote: "Sends mail without a confirmation step. Add one and resubmit.",
    iconUrl: null,
    createdAt: "2026-07-30T12:00:00.000Z",
  },
];

export const STORY_SKILL_PACKAGE_PREVIEW: SkillPackagePreview = {
  draftId: "draft-standup-digest",
  name: "Standup digest",
  description: "Collects yesterday's activity into the three lines a standup actually needs.",
  slug: "standup-digest",
  files: ["SKILL.md", "README.md", "scripts/digest.ts"],
  size: 18_432,
};

export const STORY_MARKETPLACE_AGENTS: MarketplaceAgentSummary[] = [
  {
    id: "listing-release-manager",
    name: "Release Manager",
    title: "Ships the release",
    description: "Cuts the tag, writes the notes, and watches the rollout until it is green.",
    creatorName: "OpenBot",
    version: 6,
    installs: 731,
    featured: true,
    avatarSeed: "release-manager",
    avatarHue: 30,
    avatarUrl: null,
    skillCount: 2,
    routineCount: 2,
    activeRoutineCount: 1,
    updatedAt: "2026-08-16T10:45:00.000Z",
  },
  {
    id: "listing-desk-researcher",
    name: "Desk Researcher",
    title: "Reads so you do not have to",
    description: "Turns a question into a brief with sources you can check in an afternoon.",
    creatorName: "Marta Nowak",
    version: 3,
    installs: 488,
    featured: true,
    avatarSeed: "desk-researcher",
    avatarHue: 215,
    avatarUrl: null,
    skillCount: 1,
    routineCount: 1,
    activeRoutineCount: 1,
    updatedAt: "2026-08-12T13:10:00.000Z",
  },
  {
    id: "listing-ops-watch",
    name: "Ops Watch",
    title: "Keeps an eye on the stack",
    description: "Checks the backups ran, the certificates are current, and the disks have room.",
    creatorName: "Ravi Menon",
    version: 2,
    installs: 173,
    featured: false,
    avatarSeed: "ops-watch",
    avatarHue: 320,
    avatarUrl: null,
    skillCount: 1,
    routineCount: 3,
    activeRoutineCount: 3,
    updatedAt: "2026-08-02T06:00:00.000Z",
  },
];

const STORY_MARKETPLACE_AGENT_CONTENTS: Record<
  string,
  { skills: MarketplaceAgentSkill[]; routines: MarketplaceAgentRoutine[] }
> = {
  "listing-release-manager": {
    skills: [
      {
        skillId: "skill-release-notes",
        versionId: "skill-release-notes-v4",
        slug: "release-notes",
        name: "Release notes",
        version: 4,
      },
      {
        skillId: "skill-sql-review",
        versionId: "skill-sql-review-v2",
        slug: "sql-review",
        name: "SQL review",
        version: 2,
      },
    ],
    routines: [
      {
        name: "Draft the release notes",
        instruction: "Summarise everything merged since the last tag and post the draft in the thread.",
        active: true,
        schedule: { kind: "weekly", weekday: 4, time: "16:00" },
      },
      {
        name: "Watch the rollout",
        instruction: "Check the release job every hour on release day and report the first failure.",
        active: false,
        schedule: { kind: "daily", time: "09:00" },
      },
    ],
  },
  "listing-desk-researcher": {
    skills: [
      {
        skillId: "skill-source-check",
        versionId: "skill-source-check-v3",
        slug: "source-check",
        name: "Source check",
        version: 3,
      },
    ],
    routines: [
      {
        name: "Morning reading list",
        instruction: "Collect what changed overnight in the areas I follow and rank it by relevance.",
        active: true,
        schedule: { kind: "daily", time: "07:30" },
      },
    ],
  },
  "listing-ops-watch": {
    skills: [
      {
        skillId: "skill-nightly-backup",
        versionId: "skill-nightly-backup-v5",
        slug: "nightly-backup",
        name: "Nightly backup",
        version: 5,
      },
    ],
    routines: [
      {
        name: "Backup check",
        instruction: "Confirm last night's backup completed and report the size delta.",
        active: true,
        schedule: { kind: "daily", time: "08:00" },
      },
      {
        name: "Certificate expiry",
        instruction: "List certificates expiring within thirty days.",
        active: true,
        schedule: { kind: "weekly", weekday: 1, time: "08:15" },
      },
      {
        name: "Disk headroom",
        instruction: "Report any volume above eighty percent used.",
        active: true,
        schedule: { kind: "daily", time: "08:30" },
      },
    ],
  },
};

export const STORY_MARKETPLACE_AGENT_DETAILS: Record<string, MarketplaceAgentDetail> = Object.fromEntries(
  STORY_MARKETPLACE_AGENTS.map((agent) => [
    agent.id,
    {
      ...agent,
      versionId: `${agent.id}-v${agent.version}`,
      skills: STORY_MARKETPLACE_AGENT_CONTENTS[agent.id]?.skills ?? [],
      routines: STORY_MARKETPLACE_AGENT_CONTENTS[agent.id]?.routines ?? [],
    },
  ]),
);

export const STORY_AGENT_SUBMISSIONS: AgentSubmission[] = [
  {
    id: "agent-submission-chief",
    listingId: "listing-chief-of-staff",
    name: "Chief",
    title: "Chief of staff",
    description: "Coordinates projects, priorities, and next steps across the workspace.",
    version: 2,
    status: "pending",
    rejectionNote: null,
    avatarSeed: "chief",
    avatarHue: 245,
    avatarUrl: null,
    skillCount: 2,
    routineCount: 1,
    activeRoutineCount: 1,
    createdAt: "2026-08-18T09:00:00.000Z",
  },
  {
    id: "agent-submission-ops",
    listingId: "listing-ops-watch",
    name: "Ops Watch",
    title: "Keeps an eye on the stack",
    description: "Checks the backups ran, the certificates are current, and the disks have room.",
    version: 2,
    status: "approved",
    rejectionNote: null,
    avatarSeed: "ops-watch",
    avatarHue: 320,
    avatarUrl: null,
    skillCount: 1,
    routineCount: 3,
    activeRoutineCount: 3,
    createdAt: "2026-08-02T06:00:00.000Z",
  },
];

export const STORY_HOSTED_SITES: HostedSiteSummary[] = [
  {
    id: "site-launch-notes",
    hostname: "launch-notes.openbot.site",
    url: "https://launch-notes.openbot.site",
    title: "Launch notes",
    description: "The public changelog for the 0.2 release.",
    framework: "astro",
    status: "active",
    fileCount: 42,
    size: 3_145_728,
    expiresAt: null,
    updatedAt: "2026-08-18T18:30:00.000Z",
  },
  {
    id: "site-design-review",
    hostname: "design-review.openbot.site",
    url: "https://design-review.openbot.site",
    title: "Design review",
    description: "A one-page mockup shared with the design studio.",
    framework: "vanilla",
    status: "active",
    fileCount: 8,
    size: 512_000,
    expiresAt: "2026-09-18T18:30:00.000Z",
    updatedAt: "2026-08-14T12:00:00.000Z",
  },
];
