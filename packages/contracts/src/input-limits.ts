export const INPUT_LIMITS = {
  identifier: 128,
  email: 254,
  accountName: 120,
  profileNameMin: 3,
  profileName: 20,
  serverNameMin: 6,
  serverName: 32,
  inviteUrl: 4_096,
  hostname: 253,
  browserUrl: 8_192,
  avatarUrl: 2_048,
  browserActionText: 50_000,
  agentName: 80,
  // Model names come from a CLI's `displayName`, which nothing bounds, and the released Team v1
  // adapter already accepts 160 — so the agent-name limit would reject a model list a shipped peer
  // is entitled to send.
  modelName: 160,
  // A provider service tier id, such as Codex `priority`.
  serviceTier: 64,
  agentTitle: 120,
  agentDescription: 2_000,
  // The smallest choice of the app setting `AGENT_MEMORY_LIMITS`.
  agentMemories: 64,
  agentSkills: 32,
  sharedTables: 64,
  sharedTableName: 64,
  // Half the default agent cap. A channel packet is rebuilt every turn and the memories block is paid in
  // full each time, against `ChannelHistory.prepare`'s hard character budget.
  channelMemories: 32,
  // The facts of one messaging connection. Like a channel packet, every external message pays for the
  // whole block, so the cap matches the channel one.
  messagingMemories: 32,
  agentMemoryText: 500,
  agentRoutines: 64,
  routineName: 80,
  routineInstruction: 100_000,
  routineRunsPage: 100,
  // Handoffs inside one routine. A flow wider than this is no longer readable on one canvas.
  routineFlowLinks: 50,
  // One workflow graph. Far more than one canvas shows at a readable zoom; the wire codec keeps its
  // own copies of these numbers.
  workflowNodes: 200,
  workflowEdges: 400,
  workflowNodeFields: 32,
  workflowNodeText: 20_000,
  workflowStrokes: 500,
  workflowStrokePoints: 2_000,
  workflowTitle: 160,
  // The JSON of one saved graph. A workflow and its triggers must fit one WebRTC frame (1.5 MiB of
  // body) when a member reads it.
  workflowGraphBytes: 1024 * 1024,
  workflowRunsPage: 50,
  // The input of one step: the outputs of the steps before it, joined.
  workflowStepInput: 32_000,
  // The body of a webhook that starts a workflow, as the first step reads it.
  workflowWebhookPayload: 64_000,
  // The reason an agent gives when it reports that its routine run failed.
  routineFailureReason: 500,
  // Open waits of one agent. A wait is a request the agent has not finished, and more than this many
  // at once is a loop that opens waits, not work.
  agentWaits: 20,
  agentWaitNote: 500,
  // Tasks of one agent in one list: the open ones, then the newest closed ones.
  agentTasks: 50,
  agentTaskTitle: 120,
  agentTaskProgress: 500,
  agentTaskError: 2_000,
  // The text a local script adds to a routine run through the automation server.
  automationPayload: 4_000,
  // The longest range the routine calendar reads: a six-week month view, with one day before it and
  // two after it for the viewer's time zone.
  routineCalendarDays: 44,
  routineCron: 255,
  messageText: 100_000,
  directMessageText: 20_000,
  // A side question carries its earlier questions and answers, because nothing on the host keeps them.
  sideQuestionTurns: 20,
  sideQuestionAnswer: 32_000,
  /** The start of each earlier side question and answer that the prompt reads. */
  sideQuestionEarlierText: 4_000,
  promptQuestions: 32,
  promptOptions: 5,
  promptHeader: 120,
  promptQuestion: 2_000,
  promptOptionLabel: 120,
  promptOptionDescription: 2_000,
  promptAnswersPerQuestion: 32,
  promptAnswerText: 100_000,
  promptAnswersTotalText: 100_000,
  attachments: 10,
  draftAttachments: 50,
  messageRecipients: 32,
  attachmentName: 255,
  mimeType: 255,
  path: 4_096,
  agents: 100,
  sidebarSections: 100,
  sidebarSectionName: 40,
  browserTabs: 25,
  browserCoordinate: 100_000,
  browserDimension: 16_384,
  // MCP server configuration. `identifier` covers the id and `path` covers the working directory.
  // The two value bounds are equal today and kept apart on purpose: an environment value and an
  // HTTP header are different things, and only one of them has a protocol that bounds it.
  mcpServers: 32,
  mcpServerName: 80,
  mcpCommand: 4_096,
  mcpArgs: 64,
  mcpArgValue: 4_096,
  mcpEnvVariables: 64,
  mcpEnvName: 255,
  mcpEnvValue: 8_192,
  mcpHeaders: 32,
  mcpHeaderValue: 8_192,
  mcpUrl: 2_048,
  mcpToolCount: 10_000,
  mcpErrorText: 2_000,
  // A sign-in app (`mcp-sign-in-app-v1`). Generous for every provider checked; the wire codec keeps
  // its own copies of these numbers.
  mcpClientId: 1_024,
  mcpClientSecret: 4_096,
  mcpScope: 2_048,
  // A relayed sign-in (`sign-in-relay-v1`): the page address and the callback the browser came back to.
  signInRelayAddress: 8_192,
  teamMembers: 100,
  activeInvites: 100,
  // Permanent links accept unlimited joins until revoked, so a leaked link is open
  // enrollment. The cap stays small; single-use invitations keep the larger budget.
  maxPermanentInvites: 5,
  sessionsPerMember: 10,
} as const;

// Active members of one host with no plan and no entitled license of its owner, owner included: the
// owner and two others. A plan sets its own limit (`memberLimitForPlan`), and a license gives its users.
// `INPUT_LIMITS.teamMembers` stays the wire cap for stored members.
export const DEFAULT_TEAM_MEMBER_LIMIT = 3;

export const ATTACHMENT_LIMITS = {
  fileBytes: 100 * 1024 * 1024,
  totalBytes: 250 * 1024 * 1024,
} as const;

export const AVATAR_IMAGE_LIMITS = {
  sourceBytes: 10 * 1024 * 1024,
  storedBytes: 512 * 1024,
  outputPixels: 512,
} as const;
