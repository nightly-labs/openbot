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
  SharedTable,
  SkillPackagePreview,
  SkillSubmission,
  TeamInviteSummary,
  TeamMemberSummary,
  TeamPresenceSnapshot,
  TeamSessionSummary,
  UpdateStatus,
} from "@openbot/contracts/ipc";
import type { AgentProfile } from "@openbot/ui/data";
import type { MarketplacePluginDetail } from "@openbot/ui/features/settings/marketplace-plugins";
import type { McpServerConfig } from "../features/servers/mcp-servers";

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
    access: "full",
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
    access: "full",
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
    access: "workspace",
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
  access: agent.access,
  threadId: agent.threadId,
  workspacePath: agent.workspacePath,
  avatarSeed: agent.avatarSeed,
  avatarHue: agent.avatarHue,
  avatarUrl: agent.avatarUrl,
  time: index === 0 ? "10:00" : index === 1 ? "Yesterday" : "Mon",
  preview: agent.preview,
}));

const [firstStoryAgent] = STORY_AGENTS;
if (!firstStoryAgent) throw new Error("Story agent fixtures are empty.");
/** The agent that single-agent stories show. */
export const STORY_AGENT: AgentProfile = firstStoryAgent;

export const STORY_SHARED_TABLES: SharedTable[] = [
  { name: "citations", ownerAgentId: "research", rowCount: null },
  { name: "companies", ownerAgentId: "chief", rowCount: 37 },
  { name: "handled_mail", ownerAgentId: null, rowCount: 46 },
  { name: "people", ownerAgentId: "chief", rowCount: 214 },
  { name: "sources", ownerAgentId: "research", rowCount: 688 },
  { name: "touchpoints", ownerAgentId: "chief", rowCount: 1_902 },
];

export const STORY_MODELS: AgentModelOption[] = [
  {
    provider: "codex",
    id: "gpt-6-luna",
    name: "GPT-6 Luna",
    description: "Fast and efficient for everyday agent work.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high"],
  },
  {
    provider: "codex",
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    description: "Fast and efficient for everyday agent work.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high"],
  },
  {
    provider: "codex",
    id: "gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    description: "Balanced speed and capability for involved tasks.",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["medium", "high"],
  },
  {
    provider: "codex",
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    description: "Most capable for complex, long-running work.",
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: ["medium", "high", "xhigh"],
  },
  {
    provider: "claude",
    id: "claude-opus-5-5",
    name: "Claude Opus 5.5",
    description: "Most capable Claude model for complex work.",
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: ["low", "medium", "high"],
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
    id: "grok-4.6",
    name: "Grok 4.6",
    description: "Discovered from Grok CLI over ACP.",
    defaultReasoningEffort: "medium",
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
    {
      id: "claude",
      primary: { usedPercent: 91, windowDurationMins: 300, resetsAt: 1_786_563_600 },
      secondary: { usedPercent: 64, windowDurationMins: 10_080, resetsAt: 1_787_040_000 },
    },
    {
      id: "grok",
      primary: null,
      secondary: { usedPercent: 22, windowDurationMins: 10_080, resetsAt: 1_787_040_000 },
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
    text: "Use @[Release notes](skill:skill-release-notes) to turn the latest notes into a short plan and tag @Research for the source check.",
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

const STORY_DIRECT_ALICE_THREAD: DirectThreadSummary = {
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
};

export const STORY_DIRECT_THREADS: DirectThreadSummary[] = [STORY_DIRECT_ALICE_THREAD];

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
      STORY_DIRECT_ALICE_THREAD.lastMessage,
    ],
  },
};

export const STORY_SERVERS: ServerSummary[] = [
  {
    id: "local",
    name: "Local",
    logoUrl: null,
    notificationsMuted: false,
    notificationsMutedUntil: null,
    notificationLevel: "all",
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
    notificationsMuted: false,
    notificationsMutedUntil: null,
    notificationLevel: "all",
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
    // The three toolbar chips each read one of these. Left unset, the preview and every story render a
    // toolbar with no chips at all, which is the one arrangement the product never shows for a tab an
    // agent is actually driving.
    environment: {
      viewport: { mode: "custom", width: 390, height: 844, deviceScaleFactor: 3, preset: "mobile" },
      colorScheme: "dark",
      reducedMotion: false,
    },
    recording: true,
    diagnosticErrorCount: 2,
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
      // `snapshot` is the coarse action the Team API v1 wire carries; the detail is what the tooltip
      // shows, and it is the field the v1 projection strips.
      detailAction: "select-option",
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
  remoteDesktopScreenRecordingDenied: false,
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
    permanent: false,
    useCount: 0,
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
// Self-contained sample artwork keeps preview icons available without network requests.
function skillPreviewIcon(symbol: string, background: string): string {
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><rect width="80" height="80" rx="18" fill="${background}"/><text x="40" y="43" text-anchor="middle" dominant-baseline="middle" font-size="42">${symbol}</text></svg>`,
  )}`;
}

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
    iconUrl: skillPreviewIcon("📝", "#7255ce"),
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
    iconUrl: skillPreviewIcon("🗄️", "#2463a6"),
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
    iconUrl: skillPreviewIcon("🎨", "#be4d86"),
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
    iconUrl: skillPreviewIcon("📬", "#e88124"),
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
    iconUrl: skillPreviewIcon("🔎", "#268477"),
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
    iconUrl: skillPreviewIcon("💾", "#526178"),
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
      ...(skill.id === "skill-release-notes"
        ? {
            examplePrompt:
              "Turn the latest commits into release notes. Group the changes and explain what users can do now.",
          }
        : {}),
    },
  ]),
);

export const STORY_INSTALLED_SKILLS: Record<string, InstalledSkill[]> = {
  chief: [
    {
      skillId: "openbot-skill-creator",
      slug: "openbot-skill-creator",
      name: "openbot-skill-creator",
      description: "Create or revise a reusable local OpenBot skill.",
      installedVersion: 1,
      availableVersion: 1,
      state: "installed",
      enabled: true,
      origin: "managed",
    },
    {
      skillId: "openbot-site-hosting",
      slug: "openbot-site-hosting",
      name: "openbot-site-hosting",
      installedVersion: 1,
      availableVersion: 1,
      state: "installed",
      enabled: true,
      origin: "managed",
    },
    {
      skillId: "skill-release-notes",
      slug: "release-notes",
      name: "Release notes",
      installedVersion: 4,
      availableVersion: 4,
      state: "installed",
      enabled: true,
      origin: "marketplace",
      description: "Turns a range of commits into a changelog a reader outside the team can follow.",
    },
    {
      skillId: "skill-inbox-triage",
      slug: "inbox-triage",
      name: "Inbox triage",
      installedVersion: 1,
      availableVersion: 1,
      state: "modified",
      enabled: true,
      origin: "marketplace",
      description: "Sorts a morning inbox into what needs a reply today and what can wait.",
    },
    {
      skillId: "skill-source-check",
      slug: "source-check",
      name: "Source check",
      installedVersion: 2,
      availableVersion: 3,
      state: "update-available",
      enabled: false,
      origin: "marketplace",
      description: "Follows every citation in a draft and flags the ones that do not say what is claimed.",
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
      description: "Follows every citation in a draft and flags the ones that do not say what is claimed.",
    },
  ],
};

export const STORY_MCP_SERVERS: McpServerConfig[] = [
  {
    id: "mcp-sqlite",
    name: "Local SQLite",
    transport: "stdio",
    enabled: true,
    command: "openai-dev-mcp",
    args: ["serve-sqlite", "--database", "./openbot.db"],
    env: [{ key: "SQLITE_READONLY", value: "1" }],
    envPassthrough: ["HOME"],
    workingDirectory: "~/code",
    url: "",
    headers: [],
  },
  {
    id: "mcp-linear",
    name: "Linear",
    transport: "http",
    enabled: true,
    command: "",
    args: [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: "https://mcp.linear.app/mcp",
    headers: [{ key: "Authorization", value: "Bearer ***" }],
  },
  {
    id: "mcp-figma",
    name: "Figma",
    transport: "http",
    enabled: false,
    command: "",
    args: [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: "https://mcp.figma.com/mcp",
    headers: [],
  },
  {
    id: "mcp-playwright",
    name: "Playwright",
    transport: "stdio",
    enabled: true,
    command: "bunx @playwright/mcp",
    args: [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: "",
    headers: [],
  },
];

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
    category: "coding",
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
    category: "research",
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
    id: "listing-migration-pilot",
    category: "coding",
    name: "Migration Pilot",
    title: "Moves a codebase one step at a time",
    description: "Plans a framework upgrade, lands it file by file, and keeps the build green.",
    creatorName: "Ines Duarte",
    version: 2,
    installs: 318,
    featured: false,
    avatarSeed: "migration-pilot",
    avatarHue: 100,
    avatarUrl: null,
    skillCount: 2,
    routineCount: 1,
    activeRoutineCount: 0,
    updatedAt: "2026-08-07T08:20:00.000Z",
  },
  {
    id: "listing-test-writer",
    category: "coding",
    name: "Test Writer",
    title: "Covers what the change broke",
    description: "Reads a diff and writes the test that would have caught the bug.",
    creatorName: "Ada",
    version: 5,
    installs: 276,
    featured: false,
    avatarSeed: "test-writer",
    avatarHue: 150,
    avatarUrl: null,
    skillCount: 1,
    routineCount: 0,
    activeRoutineCount: 0,
    updatedAt: "2026-08-05T15:40:00.000Z",
  },
  {
    id: "listing-build-doctor",
    category: "coding",
    name: "Build Doctor",
    title: "Finds why the pipeline is red",
    description: "Reads the failed job, names the first real error, and proposes the fix.",
    creatorName: "Kettle Labs",
    version: 3,
    installs: 214,
    featured: false,
    avatarSeed: "build-doctor",
    avatarHue: 0,
    avatarUrl: null,
    skillCount: 1,
    routineCount: 1,
    activeRoutineCount: 1,
    updatedAt: "2026-08-03T09:05:00.000Z",
  },
  {
    id: "listing-api-designer",
    category: "coding",
    name: "API Designer",
    title: "Keeps a contract honest",
    description: "Reviews an endpoint against its callers and flags every breaking change.",
    creatorName: "Priya Raman",
    version: 2,
    installs: 188,
    featured: false,
    avatarSeed: "api-designer",
    avatarHue: 245,
    avatarUrl: null,
    skillCount: 2,
    routineCount: 0,
    activeRoutineCount: 0,
    updatedAt: "2026-07-30T11:25:00.000Z",
  },
  {
    id: "listing-perf-hunter",
    category: "coding",
    name: "Perf Hunter",
    title: "Explains where the time goes",
    description: "Profiles a slow path, points at the cost, and measures the change after it.",
    creatorName: "Tom Weaver",
    version: 1,
    installs: 143,
    featured: false,
    avatarSeed: "perf-hunter",
    avatarHue: 320,
    avatarUrl: null,
    skillCount: 1,
    routineCount: 1,
    activeRoutineCount: 0,
    updatedAt: "2026-07-26T16:50:00.000Z",
  },
  {
    id: "listing-design-critic",
    category: "design",
    name: "Design Critic",
    title: "Reads a screen the way a reviewer does",
    description: "Checks a layout against the design system and names what to change first.",
    creatorName: "Studio Kappa",
    version: 4,
    installs: 402,
    featured: false,
    avatarSeed: "design-critic",
    avatarHue: 280,
    avatarUrl: null,
    skillCount: 1,
    routineCount: 0,
    activeRoutineCount: 0,
    updatedAt: "2026-08-14T09:20:00.000Z",
  },
  {
    id: "listing-code-reviewer",
    category: "coding",
    name: "Code Reviewer",
    title: "Reviews the diff before the team does",
    description: "Reads a branch, flags the risky lines, and writes the review comment for each one.",
    creatorName: "Ravi Menon",
    version: 9,
    installs: 1204,
    featured: false,
    avatarSeed: "code-reviewer",
    avatarHue: 150,
    avatarUrl: null,
    skillCount: 2,
    routineCount: 1,
    activeRoutineCount: 0,
    updatedAt: "2026-08-19T15:05:00.000Z",
  },
  {
    id: "listing-inbox-triage",
    category: "productivity",
    name: "Inbox Triage",
    title: "Sorts the morning mail",
    description: "Splits the inbox into what needs a reply today and what can wait for the week.",
    creatorName: "Jules Fournier",
    version: 2,
    installs: 318,
    featured: false,
    avatarSeed: "inbox-triage",
    avatarHue: 55,
    avatarUrl: null,
    skillCount: 1,
    routineCount: 1,
    activeRoutineCount: 1,
    updatedAt: "2026-08-09T07:45:00.000Z",
  },
  {
    id: "listing-query-analyst",
    category: "data-analytics",
    name: "Query Analyst",
    title: "Answers with the numbers behind it",
    description: "Turns a question into a query, runs it, and explains what the result does not cover.",
    creatorName: "Marta Nowak",
    version: 5,
    installs: 657,
    featured: false,
    avatarSeed: "query-analyst",
    avatarHue: 185,
    avatarUrl: null,
    skillCount: 1,
    routineCount: 0,
    activeRoutineCount: 0,
    updatedAt: "2026-08-11T11:30:00.000Z",
  },
  {
    id: "listing-contract-reader",
    category: "documents",
    name: "Contract Reader",
    title: "Finds the clause that matters",
    description: "Reads a long agreement and reports the dates, the duties, and the ways out.",
    creatorName: "OpenBot",
    version: 3,
    installs: 245,
    featured: false,
    avatarSeed: "contract-reader",
    avatarHue: 245,
    avatarUrl: null,
    skillCount: 0,
    routineCount: 0,
    activeRoutineCount: 0,
    updatedAt: "2026-08-07T14:00:00.000Z",
  },
  {
    id: "listing-lab-assistant",
    name: "Lab Assistant",
    title: "Keeps the experiment log",
    description: "Records what was tried, what it produced, and what is still worth a run.",
    creatorName: "Ada",
    version: 1,
    installs: 88,
    featured: false,
    avatarSeed: "lab-assistant",
    avatarHue: 100,
    avatarUrl: null,
    skillCount: 0,
    routineCount: 0,
    activeRoutineCount: 0,
    updatedAt: "2026-07-28T10:10:00.000Z",
  },
  {
    id: "listing-ops-watch",
    category: "automation",
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
  "listing-design-critic": {
    skills: [
      {
        skillId: "skill-design-audit",
        versionId: "skill-design-audit-v2",
        slug: "design-audit",
        name: "Design audit",
        version: 2,
      },
    ],
    routines: [],
  },
  "listing-code-reviewer": {
    skills: [
      {
        skillId: "skill-sql-review",
        versionId: "skill-sql-review-v2",
        slug: "sql-review",
        name: "SQL review",
        version: 2,
      },
      {
        skillId: "skill-release-notes",
        versionId: "skill-release-notes-v4",
        slug: "release-notes",
        name: "Release notes",
        version: 4,
      },
    ],
    routines: [
      {
        name: "Review the open branches",
        instruction: "Read every branch opened since yesterday and post one review comment each.",
        active: false,
        schedule: { kind: "daily", time: "10:00" },
      },
    ],
  },
  "listing-inbox-triage": {
    skills: [
      {
        skillId: "skill-inbox-triage",
        versionId: "skill-inbox-triage-v1",
        slug: "inbox-triage",
        name: "Inbox triage",
        version: 1,
      },
    ],
    routines: [
      {
        name: "Morning triage",
        instruction: "Sort the overnight mail and report what needs an answer today.",
        active: true,
        schedule: { kind: "daily", time: "08:00" },
      },
    ],
  },
  "listing-query-analyst": {
    skills: [
      {
        skillId: "skill-sql-review",
        versionId: "skill-sql-review-v2",
        slug: "sql-review",
        name: "SQL review",
        version: 2,
      },
    ],
    routines: [],
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

/**
 * The plugin listing, while plugins are still being designed. A plugin is one developer's bundle:
 * the MCP server it publishes, shown as an app, and the skills that drive it. The example follows a
 * real server (`mcp.aave.com`) so the page is reviewed against the lengths a published listing
 * really has, rather than against text written to fit the layout.
 */
export const STORY_MARKETPLACE_PLUGIN_AAVE: MarketplacePluginDetail = {
  id: "plugin-aave",
  slug: "aave",
  name: "Aave",
  tagline: "Aave data and transactions",
  description:
    "Aave helps users explore live Aave V3 and V4 markets, review wallet positions and DAO governance, " +
    "simulate lending actions, and prepare non-custodial transactions. Every transaction is returned " +
    "unsigned: the plugin reads the markets and writes the call, and the wallet stays with the user.",
  category: "data-analytics",
  creatorName: "avara.xyz",
  creatorAvatarUrl: null,
  iconUrl: skillPreviewIcon("👻", "#6b5ce7"),
  version: "1.0.0",
  installs: 2_410,
  featured: true,
  updatedAt: "2026-09-02T11:30:00.000Z",
  shareUrl: "https://openbot.run/plugins/aave",
  prompts: [
    { id: "prompt-stablecoin-yield", text: "Where can I earn the most on stablecoins across Aave right now?" },
    { id: "prompt-usdc-rates", text: "Which pays more for USDC right now, Aave V3 or V4 on Ethereum?" },
    {
      id: "prompt-health-factor",
      text: "What's the health factor of 0x0a42b2f3a0d54157dbd7cc346335a4f1909fc02c, and how far from liquidation?",
    },
  ],
  apps: [
    {
      id: "app-aave-mcp",
      name: "Aave",
      description:
        "Live V3 and V4 markets, wallet positions, DAO governance, and prepared transactions, over one MCP server.",
      iconUrl: skillPreviewIcon("👻", "#6b5ce7"),
      server: { name: "aave", transport: "http", url: "https://mcp.aave.com/mcp" },
    },
  ],
  skills: [
    {
      id: "plugin-skill-account-activity",
      versionId: "plugin-skill-account-activity-v1",
      slug: "account-activity",
      description:
        "An Aave account's history — past supplies, borrows, repays, withdrawals and collateral changes, and how net worth moved with them.",
    },
    {
      id: "plugin-skill-deleverage",
      versionId: "plugin-skill-deleverage-v1",
      slug: "deleverage",
      description:
        'Reduce the risk on an Aave position — "reduce my risk", "unwind", "get my health factor up", "I\'m close to liquidation".',
    },
    {
      id: "plugin-skill-safe-transactions",
      versionId: "plugin-skill-safe-transactions-v1",
      slug: "safe-transactions",
      description:
        "Prepare an Aave state change — supply, borrow, withdraw, repay, or any other prepare_* action — when asked to act rather than to read.",
    },
    {
      id: "plugin-skill-tx-confirmation",
      versionId: "plugin-skill-tx-confirmation-v1",
      slug: "tx-confirmation",
      description:
        'Confirm what an Aave transaction did after the user signed it — "did it go through", "was my supply counted".',
    },
    {
      id: "plugin-skill-yield-analysis",
      versionId: "plugin-skill-yield-analysis-v1",
      slug: "yield-analysis",
      description:
        "Compare Aave yields and rates — best APY for an asset, rates across chains or between V3 and V4, APY history.",
    },
  ],
  websiteUrl: "https://aave.com",
  privacyPolicyUrl: "https://aave.com/privacy",
  termsUrl: "https://aave.com/terms",
};

/**
 * The rest of the listing, so the catalog is reviewed as a list: several categories, publishers of
 * different name lengths, and a plugin that publishes no app.
 */
export const STORY_MARKETPLACE_PLUGINS: MarketplacePluginDetail[] = [
  STORY_MARKETPLACE_PLUGIN_AAVE,
  {
    id: "plugin-linear",
    slug: "linear",
    name: "Linear",
    tagline: "Issues, cycles and project status",
    description:
      "Read and write Linear from a conversation: find the issues assigned to a team, open one with the " +
      "right labels and estimate, move it through a cycle, and answer what is left before a project ships.",
    category: "productivity",
    creatorName: "linear.app",
    creatorAvatarUrl: null,
    iconUrl: skillPreviewIcon("📐", "#2f2f46"),
    version: "2.3.1",
    installs: 5_180,
    featured: true,
    updatedAt: "2026-08-28T09:10:00.000Z",
    shareUrl: "https://openbot.run/plugins/linear",
    prompts: [
      { id: "prompt-linear-cycle", text: "What is still open in the current cycle, and who is it on?" },
      { id: "prompt-linear-file", text: "File a bug for the crash I just described, on the Desktop team." },
      { id: "prompt-linear-project", text: "Is the Billing project on track for its target date?" },
    ],
    apps: [
      {
        id: "app-linear-mcp",
        name: "Linear",
        description: "Issues, projects, cycles and comments, over the Linear MCP server.",
        iconUrl: skillPreviewIcon("📐", "#2f2f46"),
        server: {
          name: "linear",
          transport: "http",
          url: "https://mcp.linear.app/mcp",
          auth: [
            { id: "oauth", kind: "link", label: "Sign in" },
            {
              id: "api-key",
              kind: "key",
              label: "API key",
              fields: [
                {
                  id: "token",
                  label: "API key",
                  header: "Authorization",
                  prefix: "Bearer ",
                  placeholder: "lin_api_…",
                  hint: "Settings · Security & access · Personal API keys.",
                },
              ],
              docsUrl: "https://linear.app/settings/api",
              docsLabel: "Get an API key",
            },
          ],
        },
      },
    ],
    skills: [
      {
        id: "plugin-skill-issue-triage",
        versionId: "plugin-skill-issue-triage-v1",
        slug: "issue-triage",
        description: "Turn a described problem into an issue with the right team, labels, priority and estimate.",
      },
      {
        id: "plugin-skill-cycle-review",
        versionId: "plugin-skill-cycle-review-v1",
        slug: "cycle-review",
        description: "Summarise a cycle — what shipped, what slipped, and what is unassigned with days left.",
      },
    ],
    websiteUrl: "https://linear.app",
    privacyPolicyUrl: "https://linear.app/privacy",
    termsUrl: "https://linear.app/terms",
  },
  {
    id: "plugin-figma",
    slug: "figma",
    name: "Figma",
    tagline: "Frames, variables and design comments",
    description:
      "Read a Figma file the way a developer reads it: the frames in a page, the variables a component " +
      "binds to, and the comments still waiting for an answer. Nothing in the file is changed.",
    category: "design",
    creatorName: "figma.com",
    creatorAvatarUrl: null,
    iconUrl: skillPreviewIcon("🎨", "#d4452c"),
    version: "0.9.4",
    installs: 3_060,
    featured: false,
    updatedAt: "2026-09-08T16:45:00.000Z",
    shareUrl: "https://openbot.run/plugins/figma",
    prompts: [
      { id: "prompt-figma-frames", text: "What frames are on the Settings page of this file?" },
      { id: "prompt-figma-tokens", text: "Which colour variables does the button component bind to?" },
    ],
    apps: [
      {
        id: "app-figma-mcp",
        name: "Figma",
        description: "Files, pages, frames, variables and comments, read-only, over the Figma MCP server.",
        iconUrl: skillPreviewIcon("🎨", "#d4452c"),
        server: {
          name: "figma",
          transport: "http",
          url: "https://mcp.figma.com/mcp",
          auth: [
            {
              id: "token",
              kind: "key",
              label: "Personal access token",
              fields: [
                {
                  id: "token",
                  label: "Personal access token",
                  header: "X-Figma-Token",
                  placeholder: "figd_…",
                  hint: "Settings · Security · Personal access tokens.",
                },
              ],
              docsUrl: "https://www.figma.com/developers/api#access-tokens",
              docsLabel: "Get a token",
            },
          ],
        },
      },
    ],
    skills: [
      {
        id: "plugin-skill-design-handoff",
        versionId: "plugin-skill-design-handoff-v1",
        slug: "design-handoff",
        description: "Describe a frame for implementation — its layers, spacing, and the variables it uses.",
      },
    ],
    websiteUrl: "https://figma.com",
    privacyPolicyUrl: "https://figma.com/privacy",
    termsUrl: null,
  },
  {
    id: "plugin-changelog-writer",
    slug: "changelog-writer",
    name: "Changelog writer",
    tagline: "Release notes from merged work",
    description:
      "A plugin of skills only: no server to connect and nothing to authorise. It turns merged pull " +
      "requests into release notes in the voice a product already uses.",
    category: "documents",
    creatorName: "Marta Kowalczyk",
    creatorAvatarUrl: null,
    iconUrl: null,
    version: "1.2.0",
    installs: 640,
    featured: false,
    updatedAt: "2026-07-19T08:00:00.000Z",
    shareUrl: "https://openbot.run/plugins/changelog-writer",
    prompts: [{ id: "prompt-changelog", text: "Write the release notes for everything merged since the last tag." }],
    apps: [],
    skills: [
      {
        id: "plugin-skill-release-notes",
        versionId: "plugin-skill-release-notes-v1",
        slug: "release-notes",
        description: "Group merged work by what it changes for a reader, and write it in the product's own voice.",
      },
      {
        id: "plugin-skill-upgrade-notes",
        versionId: "plugin-skill-upgrade-notes-v1",
        slug: "upgrade-notes",
        description: "Call out the changes a reader must act on before upgrading, and what happens if they do not.",
      },
    ],
    websiteUrl: null,
    privacyPolicyUrl: null,
    termsUrl: null,
  },
];

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
