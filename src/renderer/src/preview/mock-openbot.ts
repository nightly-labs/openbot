import {
  type AccountUsage,
  type AgentEvent,
  type AgentMemory,
  type AgentModelOption,
  type AgentProviderId,
  type AgentStatus,
  type AgentSubmission,
  type AgentSummary,
  type AgentTemplatePublication,
  type AnalyticsPreference,
  type AppInfo,
  type AppLanguagePreference,
  type ApprovalAutomationPreference,
  type AppSetupState,
  type AttachmentImportEvent,
  type CentralAuthState,
  type ComputerUseState,
  type ConversationMessage,
  type ConversationSnapshot,
  type CustomProviderSummary,
  composedCustomModelId,
  createMcpServerId,
  DEFAULT_APPROVAL_AUTOMATION_PREFERENCE,
  DEFAULT_DYNAMIC_ISLAND_PREFERENCE,
  type DirectConversationSnapshot,
  type DirectMessageRealtimeEvent,
  type DirectTypingRealtimeEvent,
  type DynamicIslandPreference,
  type DynamicIslandPresentation,
  type FilePreview,
  type HostedSiteSummary,
  type HostStatus,
  type MacPermissionId,
  normalizeMcpConfig,
  type OpenAttachmentInput,
  type OpenBotDesktopApi,
  type OpenSharedFileInput,
  type OpenWorkspaceFileInput,
  type QueueDelivery,
  type QueueSnapshot,
  type RemoteDesktopSession,
  type ReorderQueueInput,
  type RespondToPromptInput,
  type Routine,
  type RoutineRun,
  type RoutineSchedule,
  type SendMessageInput,
  type SetAgentAvatarInput,
  type SetMessageReactionInput,
  type SharedTable,
  SIDEBAR_PEOPLE_SECTION_ID,
  SIDEBAR_UNASSIGNED_SECTION_ID,
  type SidebarLayoutSnapshot,
  type SteerQueuedMessageInput,
  type TeamPresenceSnapshot,
  type UpdateAgentInput,
  type UpdateQueuedMessageInput,
  type UpdateStatus,
} from "@openbot/contracts/ipc";
import { AGENT_IMPORT_PREVIEW, AGENT_IMPORT_SKILL } from "../../stories/agent-import-fixtures";
import { filePreviewForPath } from "../../stories/file-previews";
import { toggleChannelMember } from "../features/channels/channels-draft";
import {
  STORY_AGENT_TEMPLATE_DETAIL,
  STORY_AGENT_TEMPLATE_PUBLICATION,
  storyAgentTemplatePreview,
} from "./agent-template-fixtures";
import {
  STORY_AGENT_STATUS,
  STORY_AGENT_SUBMISSIONS,
  STORY_AGENT_SUMMARIES,
  STORY_APP_INFO,
  STORY_HOSTED_SITES,
  STORY_MARKETPLACE_AGENT_DETAILS,
  STORY_MARKETPLACE_AGENTS,
  STORY_MCP_SERVERS,
  STORY_MODELS,
  STORY_SHARED_TABLES,
  STORY_SNAPSHOTS,
  STORY_UPDATE_STATUS,
  STORY_USAGE,
} from "./fixtures";
import { mockAgentAnalytics, mockHostAnalytics } from "./mock-agent-analytics";
import { createMockAuth, type MockAuthOptions } from "./mock-auth";
import { createMockBrowser, type MockBrowserOptions } from "./mock-browser";
import { createMockChannels } from "./mock-channels";
import { createMockProviderRuntimes, type MockProviderRuntimeOptions } from "./mock-provider-runtimes";
import { applySidebarLayoutAction } from "./mock-sidebar-layout";
import { createMockSkills, type MockSkillsOptions } from "./mock-skills";
import { createMockStorage } from "./mock-storage";
import { clone, type Listener, type MockRuntime, matchesQuery } from "./mock-support";
import { createMockTeam, type MockTeamOptions } from "./mock-team";

export interface MockOpenBotOptions
  extends MockProviderRuntimeOptions,
    MockAuthOptions,
    MockBrowserOptions,
    MockTeamOptions,
    MockSkillsOptions {
  appInfo?: AppInfo;
  analyticsPreference?: AnalyticsPreference;
  languagePreference?: AppLanguagePreference;
  setupState?: AppSetupState;
  agentStatus?: AgentStatus;
  usage?: AccountUsage;
  agents?: AgentSummary[];
  models?: AgentModelOption[];
  snapshots?: Record<string, ConversationSnapshot>;
  updateStatus?: UpdateStatus;
  memories?: Record<string, AgentMemory[]>;
  tables?: SharedTable[];
  routines?: Record<string, Routine[]>;
  customProviders?: CustomProviderSummary[];
}

/** Custom models compose as `<provider>/<model>`; preview builds `listModels()` from these. */
function mockCustomProviderModels(provider: CustomProviderSummary): AgentModelOption[] {
  return provider.models.map((model) => ({
    provider: "opencode",
    id: composedCustomModelId(provider.id, model.id),
    name: `${provider.name}/${model.name}`,
    description: `Served by ${provider.baseUrl}.`,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high"],
  }));
}

export interface MockOpenBotControls {
  api: OpenBotDesktopApi;
  emitAgentEvent: (event: AgentEvent) => void;
  onLatestConversationOpened: (listener: (agentId: string) => void) => () => void;
  onLatestDirectConversationOpened: (listener: (memberId: string) => void) => () => void;
  readConversationSnapshot: (agentId: string) => ConversationSnapshot;
  updateConversationSnapshot: (
    agentId: string,
    update: (snapshot: ConversationSnapshot) => void,
  ) => ConversationSnapshot;
  readDirectConversationSnapshot: (memberId: string) => DirectConversationSnapshot;
  updateDirectConversationSnapshot: (
    memberId: string,
    update: (snapshot: DirectConversationSnapshot) => void,
  ) => DirectConversationSnapshot;
  emitConversationDelta: (
    event: Omit<Extract<AgentEvent, { type: "conversation-delta" }>, "type" | "revision">,
  ) => void;
  setQueueSnapshot: (agentId: string, deliveries: QueueDelivery[]) => QueueSnapshot;
  emitAuthState: (state: CentralAuthState) => void;
  emitPresence: (snapshot: TeamPresenceSnapshot) => void;
  emitDirectMessage: (event: DirectMessageRealtimeEvent) => void;
  emitDirectTyping: (event: DirectTypingRealtimeEvent) => void;
  emitInvite: (inviteUrl: string) => void;
  emitHostStatus: (status: HostStatus) => void;
  emitRemoteDesktopSessions: (sessions: RemoteDesktopSession[]) => void;
  dispose: () => void;
}

/** Preview file fixtures; a path with no fixture keeps the unsupported shape. */
function mockFilePreview(path: string, fallbackName: string): FilePreview {
  return (
    filePreviewForPath(path) ?? {
      name: path.split("/").at(-1) ?? fallbackName,
      size: 0,
      mimeType: "application/octet-stream",
      previewKind: "none",
      bytes: null,
    }
  );
}

/** What each story server answers with when it is tested, so a story reads the same way twice. */
const MOCK_MCP_TOOL_COUNTS: Record<string, number> = { "Local SQLite": 12, Linear: 1, Figma: 6 };

export function createMockOpenBot(options: MockOpenBotOptions = {}): MockOpenBotControls {
  const appInfo = clone(options.appInfo ?? STORY_APP_INFO);
  let setupState = clone<AppSetupState>(
    options.setupState ?? { completed: true, preferredProvider: "codex", preferredModel: null },
  );
  const grantedComputerUsePermissions = new Set<MacPermissionId>();
  const computerUseState = (): ComputerUseState => {
    const permissions = (["screen-recording", "accessibility"] as const).map((id) => ({
      id,
      granted: grantedComputerUsePermissions.has(id),
    }));
    return {
      status: permissions.every(({ granted }) => granted) ? "ready" : "permissions-required",
      permissions,
      message: null,
    };
  };
  let analyticsPreference = clone<AnalyticsPreference>(options.analyticsPreference ?? { enabled: true });
  let approvalAutomation = clone<ApprovalAutomationPreference>(DEFAULT_APPROVAL_AUTOMATION_PREFERENCE);
  let languagePreference = clone<AppLanguagePreference>(options.languagePreference ?? { language: "system" });
  const languageListeners = new Set<(preference: AppLanguagePreference) => void>();
  let dynamicIslandPreference: DynamicIslandPreference = { ...DEFAULT_DYNAMIC_ISLAND_PREFERENCE };
  let dynamicIslandPresentation: DynamicIslandPresentation = { serverId: "local", mode: "idle" };
  const agentStatus = clone(options.agentStatus ?? STORY_AGENT_STATUS);
  let agents = clone(options.agents ?? STORY_AGENT_SUMMARIES);
  let mcpServers = clone(STORY_MCP_SERVERS);
  let sidebarLayout: SidebarLayoutSnapshot = {
    revision: 0,
    sections: [],
    order: [SIDEBAR_PEOPLE_SECTION_ID, SIDEBAR_UNASSIGNED_SECTION_ID],
    agentAssignments: {},
    agentOrder: [],
  };
  const models = clone(options.models ?? STORY_MODELS);
  const snapshots = clone(options.snapshots ?? STORY_SNAPSHOTS);
  let updateStatus = clone(options.updateStatus ?? STORY_UPDATE_STATUS);
  const usage = clone(options.usage ?? STORY_USAGE);
  let agentCounter = agents.length;
  let hostedSites = clone(STORY_HOSTED_SITES);
  // The same two endpoints the model-picker stories invent, so preview shows one list everywhere.
  let customProviders = clone(
    options.customProviders ?? [
      {
        id: "studio-local",
        name: "Studio Local",
        baseUrl: "http://127.0.0.1:11434/v1",
        hasApiKey: false,
        models: [
          { id: "qwen3-coder:30b", name: "Qwen3 Coder 30B" },
          { id: "gpt-oss:120b", name: "GPT-OSS 120B" },
        ],
      },
      {
        id: "house-router",
        name: "House Router",
        baseUrl: "https://models.example.com/v1",
        hasApiKey: true,
        models: [{ id: "glm-5-air", name: "GLM-5 Air" }],
      },
    ],
  );
  let marketplaceAgentSubmissions = clone(STORY_AGENT_SUBMISSIONS);
  const agentTemplatePublications = new Map<string, AgentTemplatePublication>();
  let messageCounter = 10;

  /** Which providers have a key saved. The preview holds the flag only, like the real boundary. */
  const providerApiKeys = new Set<AgentProviderId>();

  const agentListeners = new Set<Listener<AgentEvent>>();
  const updateListeners = new Set<Listener<UpdateStatus>>();
  const attachmentListeners = new Set<Listener<AttachmentImportEvent>>();
  const latestConversationListeners = new Set<Listener<string>>();
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const emit = <T>(listeners: Set<Listener<T>>, value: T) => {
    for (const listener of listeners) listener(clone(value));
  };
  const schedule = (callback: () => void, delay = 24) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
  };
  const runtime: MockRuntime = { emit, schedule };
  const emptyQueue = (agentId: string): QueueSnapshot => ({ agentId, deliveries: [] });
  const queueEdits = new Map<string, { agentId: string; delivery: QueueDelivery }>();
  const queues = new Map<string, QueueSnapshot>(agents.map((agent) => [agent.id, emptyQueue(agent.id)]));
  const memories = new Map<string, AgentMemory[]>(Object.entries(clone(options.memories ?? {})));
  let tables: SharedTable[] = clone(options.tables ?? STORY_SHARED_TABLES);
  const routines = new Map<string, Routine[]>(Object.entries(clone(options.routines ?? {})));
  const routineRuns = new Map<string, RoutineRun[]>();

  function emitAgentEvent(event: AgentEvent): void {
    emit(agentListeners, event);
  }

  function getSnapshot(agentId: string): ConversationSnapshot {
    return (
      snapshots[agentId] ?? {
        agentId,
        threadId: `thread-${agentId}`,
        activeTurnId: null,
        revision: 0,
        messages: [],
      }
    );
  }

  function updateSnapshot(agentId: string, update: (snapshot: ConversationSnapshot) => void): void {
    const snapshot = getSnapshot(agentId);
    update(snapshot);
    snapshot.revision += 1;
    snapshots[agentId] = snapshot;
    emitAgentEvent({ type: "conversation", snapshot });
  }

  function readConversationSnapshot(agentId: string): ConversationSnapshot {
    return clone(getSnapshot(agentId));
  }

  function updateConversationSnapshot(
    agentId: string,
    update: (snapshot: ConversationSnapshot) => void,
  ): ConversationSnapshot {
    updateSnapshot(agentId, update);
    return readConversationSnapshot(agentId);
  }

  function emitConversationDelta(
    event: Omit<Extract<AgentEvent, { type: "conversation-delta" }>, "type" | "revision">,
  ): void {
    const snapshot = getSnapshot(event.agentId);
    snapshot.revision += 1;
    snapshots[event.agentId] = snapshot;
    emitAgentEvent({ ...event, type: "conversation-delta", revision: snapshot.revision });
  }

  function setQueueSnapshot(agentId: string, deliveries: QueueDelivery[]): QueueSnapshot {
    const snapshot = { agentId, deliveries: clone(deliveries) };
    queues.set(agentId, snapshot);
    emitAgentEvent({ type: "queue-changed", snapshot });
    return clone(snapshot);
  }

  function createAgentSummary(input: Partial<AgentSummary> = {}): AgentSummary {
    agentCounter += 1;
    const id = input.id ?? `mock-agent-${agentCounter}`;
    return {
      id,
      provider: input.provider ?? "codex",
      name: input.name ?? "New agent",
      title: input.title ?? "Generalist agent",
      description: input.description ?? "A new agent ready to help with focused work.",
      notifications: input.notifications ?? true,
      model: input.model ?? "gpt-5.6-luna",
      reasoningEffort: input.reasoningEffort ?? "medium",
      access: input.access ?? "full",
      threadId: input.threadId ?? `thread-${id}`,
      workspacePath: input.workspacePath ?? `/mock/OpenBot/Agents/${id}`,
      preview: input.preview ?? "No messages yet",
      updatedAt: input.updatedAt ?? null,
      avatarSeed: input.avatarSeed ?? id,
      avatarHue: input.avatarHue ?? null,
      avatarUrl: input.avatarUrl ?? null,
      ...(input.marketplaceSource ? { marketplaceSource: input.marketplaceSource } : {}),
    };
  }

  function createRoutineRecord(input: {
    agentId: string;
    name: string;
    instruction: string;
    active: boolean;
    timezone: string;
    schedule: RoutineSchedule;
  }): Routine {
    const now = new Date().toISOString();
    const routineId = crypto.randomUUID();
    return {
      id: routineId,
      agentId: input.agentId,
      name: input.name.trim(),
      instruction: input.instruction.trim(),
      active: input.active,
      timezone: input.timezone,
      trigger: {
        id: crypto.randomUUID(),
        routineId,
        schedule: input.schedule,
        nextRunAt: new Date(Date.now() + 3_600_000).toISOString(),
        createdAt: now,
        updatedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    };
  }

  const mockChannels = createMockChannels(
    emitAgentEvent,
    (agentId) => agents.find((entry) => entry.id === agentId)?.name ?? agentId,
  );
  const mockProviderRuntimes = createMockProviderRuntimes(options, runtime);
  const mockAuth = createMockAuth(options, runtime);
  const mockSkills = createMockSkills(options);
  const { installedSkills, readInstalledSkills } = mockSkills;
  const mockBrowser = createMockBrowser(options, runtime, emitAgentEvent);
  const mockTeam = createMockTeam(options, runtime, emitAgentEvent, () => agents);

  const api: OpenBotDesktopApi = {
    getAppInfo: async () => clone(appInfo),
    getSetupState: async () => clone(setupState),
    saveSetup: async ({ preferredProvider, preferredModel }) => {
      setupState = { completed: true, preferredProvider, preferredModel };
      return clone(setupState);
    },
    getAnalyticsPreference: async () => clone(analyticsPreference),
    setAnalyticsPreference: async ({ enabled }) => {
      analyticsPreference = { enabled };
      return clone(analyticsPreference);
    },
    getApprovalAutomation: async () => clone(approvalAutomation),
    setApprovalAutomation: async ({ turbo, agentId, autoApprove }) => {
      approvalAutomation = {
        ...approvalAutomation,
        turbo: turbo ?? approvalAutomation.turbo,
        autoApproveOverrides:
          agentId !== undefined && autoApprove !== undefined
            ? { ...approvalAutomation.autoApproveOverrides, [agentId]: autoApprove }
            : approvalAutomation.autoApproveOverrides,
      };
      return clone(approvalAutomation);
    },
    getAppLanguagePreference: async () => clone(languagePreference),
    setAppLanguagePreference: async ({ language }) => {
      languagePreference = { language };
      // The real setting is owned by the main process, which tells every window. A preview that only
      // answered the call would show a Settings row that changes while the rest of the app does not.
      for (const listener of languageListeners) listener(clone(languagePreference));
      return clone(languagePreference);
    },
    onAppLanguagePreference: (listener) => {
      languageListeners.add(listener);
      return () => languageListeners.delete(listener);
    },
    onOpenSettings: () => () => undefined,
    dynamicIsland: {
      getPreference: async () => clone(dynamicIslandPreference),
      setPreference: async (preference) => {
        dynamicIslandPreference = { ...preference };
        return clone(dynamicIslandPreference);
      },
      publishPresentation: async (presentation) => {
        dynamicIslandPresentation = clone(presentation);
      },
      getPresentation: async () => clone(dynamicIslandPresentation),
      onPreference: () => () => undefined,
      onPresentation: () => () => undefined,
      onGeometry: () => () => undefined,
      performAction: async () => undefined,
      performHaptic: async () => undefined,
      onAction: () => () => undefined,
      setInteractive: async () => undefined,
    },
    computerUse: {
      getState: async () => computerUseState(),
      // The preview grants the permission the pane was opened for, because the panel's whole job is
      // to show the answer changing. A mock that always reported the same state would make every
      // story of this panel look identical.
      openPermissionPane: async (permission) => {
        grantedComputerUsePermissions.add(permission);
        return computerUseState();
      },
      // The help window belongs to the desktop app. The preview has no second window to close, and
      // the panel never waits on the answer.
      closePermissionHelp: async () => undefined,
      // No bundle to drag in a browser, so the window draws its steps and nothing else.
      getPermissionApp: async () => null,
      startPermissionAppDrag: async () => undefined,
      revealPermissionApp: async () => undefined,
      // The rim is drawn over another application's window, which the preview has none of, so this
      // subscribes to a stream that never carries anything.
      onHighlightPlacement: () => () => undefined,
    },
    openExternal: async () => undefined,
    connectProvider: async () => clone(agentStatus),
    updateProviderCli: async () => clone(agentStatus),
    refreshAgentProviders: async () => clone(agentStatus),
    // A code that never completes: the preview has no provider to finish the sign-in, so this shows
    // the waiting screen and leaves it there.
    startProviderCodeLogin: async () => ({
      kind: "code",
      userCode: "KTQ4-B62MX",
      verificationUrl: "https://auth.openai.com/codex/device",
      expiresAt: Date.now() + 10 * 60_000,
    }),
    cancelProviderCodeLogin: async () => clone(agentStatus),
    setProviderApiKey: async ({ provider, key }) => {
      if (!key.trim()) throw new Error("A provider key is required.");
      providerApiKeys.add(provider);
      return clone(agentStatus);
    },
    clearProviderApiKey: async (provider) => {
      providerApiKeys.delete(provider);
      return clone(agentStatus);
    },
    getProviderApiKeyState: async (provider) => ({
      provider,
      status: providerApiKeys.has(provider) ? "saved" : "missing",
    }),
    providerRuntimes: mockProviderRuntimes.providerRuntimes,
    openUrl: async () => undefined,
    voice: {
      getModelStatus: async () => ({ phase: "ready", progress: 100, message: null }),
      prepareModel: async () => ({ phase: "ready", progress: 100, message: null }),
      transcribe: async () => ({ text: "Mock voice transcript" }),
      onModelStatus: () => () => undefined,
    },
    auth: mockAuth.auth,
    skills: mockSkills.skills,
    hostedSites: {
      list: async () => clone(hostedSites),
      chooseDirectory: async () => "/mock/OpenBot/Sites/launch-notes",
      publish: async (input) => {
        const hostname = `${input.title.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-")}.openbot.site`;
        const site: HostedSiteSummary = {
          id: `site-${hostedSites.length + 1}`,
          hostname,
          url: `https://${hostname}`,
          title: input.title,
          description: input.description,
          framework: "vanilla",
          status: "active",
          fileCount: 12,
          size: 786_432,
          expiresAt: null,
          updatedAt: new Date().toISOString(),
        };
        hostedSites = [site, ...hostedSites];
        return clone(site);
      },
      replace: async (input) => {
        const existing = hostedSites.find((site) => site.id === input.siteId);
        if (!existing) throw new Error("Site not found");
        const replaced: HostedSiteSummary = {
          ...existing,
          title: input.title,
          description: input.description,
          updatedAt: new Date().toISOString(),
        };
        hostedSites = hostedSites.map((site) => (site.id === input.siteId ? replaced : site));
        return clone(replaced);
      },
      delete: async ({ siteId }) => {
        hostedSites = hostedSites.filter((site) => site.id !== siteId);
      },
    },
    customProviders: {
      list: async () => clone(customProviders),
      /**
       * Keeps only `hasApiKey`, like the real store: the key is dropped on arrival, so no preview
       * state and no story snapshot can hold one.
       *
       * The ready `status` event is what makes the new models appear, exactly as in the app, so
       * preview exercises the refresh path rather than a shortcut.
       */
      save: async (input) => {
        if (customProviders.some((provider) => provider.id === input.id)) {
          throw new Error("An endpoint with this provider ID is already saved. Remove it first, or use another ID.");
        }
        customProviders = [
          ...customProviders,
          {
            id: input.id,
            name: input.name,
            baseUrl: input.baseUrl,
            hasApiKey: input.apiKey !== null,
            models: input.models.map((model) => ({ id: model.id, name: model.name })),
          },
        ];
        emitAgentEvent({ type: "status", status: clone(agentStatus) });
        return { providers: clone(customProviders), restart: "restarted" };
      },
      delete: async ({ id }) => {
        customProviders = customProviders.filter((provider) => provider.id !== id);
        emitAgentEvent({ type: "status", status: clone(agentStatus) });
        return { providers: clone(customProviders), restart: "restarted" };
      },
    },
    agentTemplates: {
      // One published template per local agent. The preview shows the agent's own identity with the
      // fixture skills and routines, so every state of the dialog has content.
      preview: async (agentId) => {
        const agent = agents.find((candidate) => candidate.id === agentId);
        if (!agent) throw new Error("Choose a local agent first.");
        return clone({
          ...storyAgentTemplatePreview(agent.id, agentTemplatePublications.get(agent.id) ?? null),
          name: agent.name,
          title: agent.title,
          description: agent.description,
          avatarSeed: agent.avatarSeed,
          avatarHue: agent.avatarHue,
          avatarUrl: agent.avatarUrl,
          updatedAt: agent.updatedAt,
        });
      },
      publish: async ({ agentId }) => {
        if (!agents.some((candidate) => candidate.id === agentId)) throw new Error("Choose a local agent first.");
        const publication = { ...STORY_AGENT_TEMPLATE_PUBLICATION, publishedAt: new Date().toISOString() };
        agentTemplatePublications.set(agentId, publication);
        return clone(publication);
      },
      unpublish: async (agentId) => {
        agentTemplatePublications.delete(agentId);
      },
      get: async (templateId) => {
        if (templateId !== STORY_AGENT_TEMPLATE_DETAIL.id) throw new Error("This shared agent is no longer published.");
        return clone(STORY_AGENT_TEMPLATE_DETAIL);
      },
      install: async () => {
        const agent = agents[0];
        if (!agent) throw new Error("Agent not found");
        return clone({ agent });
      },
      // The preview is never opened by a link, so there is nothing pending and nothing to push.
      takePendingLink: async () => null,
      onOpenLink: (listener) => {
        void listener;
        return () => undefined;
      },
    },
    marketplaceAgents: {
      list: async (query) => {
        const matches = STORY_MARKETPLACE_AGENTS.filter(
          (agent) =>
            matchesQuery(`${agent.name} ${agent.title} ${agent.description} ${agent.creatorName}`, query?.query) &&
            (!query?.category || (agent.category ?? "other") === query.category) &&
            (query?.featured !== true || agent.featured),
        );
        const start = Number(query?.cursor ?? 0);
        const end = start + (query?.limit ?? 50);
        return clone({
          agents: matches.slice(start, end),
          nextCursor: end < matches.length ? String(end) : null,
        });
      },
      get: async (listingId) => {
        const detail = STORY_MARKETPLACE_AGENT_DETAILS[listingId];
        if (!detail) throw new Error("Agent not found");
        return clone(detail);
      },
      listMine: async () => clone(marketplaceAgentSubmissions),
      preview: async (agentId) => {
        const agent = agents.find((candidate) => candidate.id === agentId);
        if (!agent) throw new Error("Agent not found");
        return clone({
          agentId: agent.id,
          name: agent.name,
          title: agent.title,
          description: agent.description,
          avatarSeed: agent.avatarSeed,
          avatarHue: agent.avatarHue,
          avatarUrl: agent.avatarUrl,
          skills: readInstalledSkills(agent.id).map((skill) => ({
            skillId: skill.skillId,
            versionId: `${skill.skillId}-v${skill.installedVersion}`,
            slug: skill.slug,
            name: skill.name,
            version: skill.installedVersion,
          })),
          routines: (routines.get(agent.id) ?? []).map((routine) => ({
            name: routine.name,
            instruction: routine.instruction,
            active: routine.active,
            schedule: routine.trigger.schedule,
          })),
        });
      },
      submit: async (input) => {
        const agent = agents.find((candidate) => candidate.id === input.agentId);
        if (!agent) throw new Error("Agent not found");
        const submission: AgentSubmission = {
          id: `agent-submission-${agent.id}-${marketplaceAgentSubmissions.length + 1}`,
          showCreatorAvatar: input.showCreatorAvatar ?? false,
          category: input.category ?? "other",
          listingId: input.listingId ?? `listing-${agent.id}`,
          name: agent.name,
          title: agent.title,
          description: agent.description,
          version: 1,
          status: "pending",
          rejectionNote: null,
          avatarSeed: agent.avatarSeed,
          avatarHue: agent.avatarHue,
          avatarUrl: agent.avatarUrl,
          skillCount: readInstalledSkills(agent.id).length,
          routineCount: (routines.get(agent.id) ?? []).length,
          activeRoutineCount: (routines.get(agent.id) ?? []).filter((routine) => routine.active).length,
          createdAt: new Date().toISOString(),
        };
        marketplaceAgentSubmissions = [submission, ...marketplaceAgentSubmissions];
        return clone(submission);
      },
      install: async ({ listingId, agentId, timezone }) => {
        const detail = STORY_MARKETPLACE_AGENT_DETAILS[listingId];
        if (!detail) throw new Error("Agent not found");
        // Installing over an existing agent updates it in place, the way the real service does:
        // a second install of the same listing has to change the agent, not add a second copy.
        const existing = agentId ? agents.find((candidate) => candidate.id === agentId) : undefined;
        if (agentId && !existing) throw new Error("The installed agent no longer exists.");
        if (existing && existing.marketplaceSource?.listingId !== detail.id) {
          throw new Error("This local agent was installed from a different marketplace agent.");
        }
        const previousRoutineIds = existing?.marketplaceSource?.routineIds ?? [];
        const previousSkillIds = existing?.marketplaceSource?.skillIds ?? [];
        const target =
          existing ??
          createAgentSummary({
            name: detail.name,
            title: detail.title,
            description: detail.description,
            avatarSeed: detail.avatarSeed,
            avatarHue: detail.avatarHue,
          });
        const created = detail.routines.map((routine) =>
          createRoutineRecord({
            agentId: target.id,
            name: routine.name,
            instruction: routine.instruction,
            active: routine.active,
            timezone,
            schedule: routine.schedule,
          }),
        );
        const agent: AgentSummary = {
          ...target,
          name: detail.name,
          title: detail.title,
          description: detail.description,
          avatarSeed: detail.avatarSeed,
          avatarHue: detail.avatarHue,
          marketplaceSource: {
            listingId: detail.id,
            versionId: detail.versionId,
            version: detail.version,
            skillIds: detail.skills.map((skill) => skill.skillId),
            routineIds: created.map((routine) => routine.id),
          },
        };
        agents = existing
          ? agents.map((candidate) => (candidate.id === agent.id ? agent : candidate))
          : [...agents, agent];
        if (!existing) queues.set(agent.id, emptyQueue(agent.id));
        // Reinstalling drops only the skills this listing installed and has since dropped. A
        // skill the user installed themselves is not the marketplace's to remove.
        const listingSkillIds = new Set(detail.skills.map((skill) => skill.skillId));
        const kept = readInstalledSkills(agent.id).filter(
          (skill) => !listingSkillIds.has(skill.skillId) && !previousSkillIds.includes(skill.skillId),
        );
        installedSkills.set(agent.id, [
          ...detail.skills.map((skill) => ({
            skillId: skill.skillId,
            slug: skill.slug,
            name: skill.name,
            installedVersion: skill.version,
            availableVersion: skill.version,
            state: "installed" as const,
          })),
          ...kept,
        ]);
        routines.set(agent.id, [
          ...created,
          ...(routines.get(agent.id) ?? []).filter((routine) => !previousRoutineIds.includes(routine.id)),
        ]);
        emitAgentEvent({ type: "agents-changed", agents });
        emitAgentEvent({ type: "routines-changed", agentId: agent.id });
        return clone({ agent });
      },
    },
    agent: {
      getStatus: async () => clone(agentStatus),
      getHostAnalytics: async (input) => mockHostAnalytics(input, agents),
      getAnalytics: async (input) => {
        const agent = agents.find((entry) => entry.id === input.agentId);
        if (!agent) throw new Error("Agent not found.");
        return mockAgentAnalytics(input, agent);
      },
      getUsage: async (agentId) => {
        if (!agentId) return clone(usage);
        const agent = agents.find((candidate) => candidate.id === agentId);
        return clone({
          limits: agent ? usage.limits.filter((limit) => limit.id === agent.provider) : [],
        });
      },
      // A saved endpoint's models are composed here, not stored, so a removal drops them the way a
      // respawned OpenCode would: it lists what its config names and nothing else.
      listModels: async () => clone([...models, ...customProviders.flatMap(mockCustomProviderModels)]),
      listAgents: async () => clone(agents),
      listInstalledSkills: async (agentId) => clone(readInstalledSkills(agentId)),
      ...mockChannels,
      listMcpServers: async () => clone(mcpServers),
      saveMcpServer: async ({ config }) => {
        const normalized = normalizeMcpConfig(config);
        const existing = mcpServers.findIndex((server) => server.id === normalized.id);
        if (existing < 0) mcpServers = [...mcpServers, { ...normalized, id: normalized.id || createMcpServerId() }];
        else mcpServers = mcpServers.map((server, index) => (index === existing ? normalized : server));
        return clone(mcpServers);
      },
      removeMcpServer: async ({ mcpServerId }) => {
        mcpServers = mcpServers.filter((server) => server.id !== mcpServerId);
        return clone(mcpServers);
      },
      setMcpServerEnabled: async ({ mcpServerId, enabled }) => {
        mcpServers = mcpServers.map((server) => (server.id === mcpServerId ? { ...server, enabled } : server));
        return clone(mcpServers);
      },
      /**
       * A test takes a moment, so the panel shows its connecting state before the answer lands. A
       * command that is not on this machine fails, the way the real probe reports a missing one.
       */
      testMcpServer: async ({ config }) => {
        await new Promise((resolve) => schedule(() => resolve(null), 400));
        const command = config.command.split(" ")[0] ?? "";
        if (config.transport === "stdio" && command.startsWith("bunx"))
          return { toolCount: 0, error: `Command not found: ${command}` };
        return { toolCount: MOCK_MCP_TOOL_COUNTS[config.name] ?? 4, error: null };
      },
      getSidebarLayout: async () => clone(sidebarLayout),
      mutateSidebarLayout: async (action) => {
        sidebarLayout = applySidebarLayoutAction(sidebarLayout, action);
        emitAgentEvent({ type: "sidebar-layout-changed", layout: sidebarLayout });
        return clone(sidebarLayout);
      },
      generateProfile: async (input) => ({
        name: input.draft?.name ?? "Research partner",
        title: input.draft?.title ?? "Research assistant",
        description: input.prompt.slice(0, 2000),
        avatarSeed: input.draft?.avatarSeed ?? "profile:research",
        avatarHue: input.draft?.avatarHue ?? 215,
        sectionId: input.draft?.sectionId ?? null,
      }),
      saveProfile: async (input) => {
        const agent = input.agentId
          ? await api.agent.updateAgent({ agentId: input.agentId, ...input.draft })
          : await api.agent.createAgent({ ...input.draft, initialMessage: input.initialMessage ?? "Hello" });
        const updated = await api.agent.updateAgent({ agentId: agent.id, ...input.draft });
        await api.agent.setAvatar({ agentId: agent.id, image: null });
        const layout = await api.agent.mutateSidebarLayout({
          type: "assign",
          agentId: agent.id,
          sectionId: input.draft.sectionId,
        });
        return { agent: { ...updated, avatarUrl: null }, layout };
      },
      createAgent: async (input) => {
        const agent = createAgentSummary({
          name: input.name,
          title: "",
          description: input.description,
          avatarSeed: input.avatarSeed,
          avatarHue: input.avatarHue,
          ...(input.provider === undefined ? {} : { provider: input.provider }),
          ...(input.model === undefined ? {} : { model: input.model }),
          ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }),
        });
        agents = [...agents, agent];
        queues.set(agent.id, emptyQueue(agent.id));
        emitAgentEvent({ type: "agents-changed", agents });
        try {
          await api.agent.sendMessage({ agentId: agent.id, text: input.initialMessage, attachmentDraftIds: [] });
          return clone(agent);
        } catch (error) {
          agents = agents.filter((candidate) => candidate.id !== agent.id);
          queues.delete(agent.id);
          delete snapshots[agent.id];
          emitAgentEvent({ type: "agents-changed", agents });
          throw error;
        }
      },
      duplicateAgent: async (agentId) => {
        const source = agents.find((agent) => agent.id === agentId);
        if (!source) throw new Error("Agent not found");
        const agent = {
          ...createAgentSummary({
            ...source,
            id: undefined,
            name: `${source.name} copy`,
            preview: "",
            updatedAt: null,
            workspacePath: undefined,
          }),
          threadId: null,
        };
        agents = [...agents, agent];
        queues.set(agent.id, emptyQueue(agent.id));
        snapshots[agent.id] = {
          agentId: agent.id,
          threadId: null,
          messages: [],
          activeTurnId: null,
          revision: 0,
        };
        memories.set(
          agent.id,
          (memories.get(agentId) ?? []).map((memory) => ({
            ...memory,
            id: crypto.randomUUID(),
            agentId: agent.id,
            sourceTurnId: null,
          })),
        );
        routines.set(
          agent.id,
          (routines.get(agentId) ?? []).map((routine) => {
            const routineId = crypto.randomUUID();
            return {
              ...routine,
              id: routineId,
              agentId: agent.id,
              trigger: {
                ...routine.trigger,
                id: crypto.randomUUID(),
                routineId,
                nextRunAt: new Date().toISOString(),
              },
            };
          }),
        );
        const sourceSectionId = sidebarLayout.agentAssignments[agentId] ?? null;
        const orderWithoutAgent = sidebarLayout.agentOrder.filter((agentId) => agentId !== agent.id);
        const sourceIndex = orderWithoutAgent.indexOf(agentId);
        const beforeAgentId = sourceIndex < 0 ? null : (orderWithoutAgent[sourceIndex + 1] ?? null);
        sidebarLayout = applySidebarLayoutAction(sidebarLayout, {
          type: "move-agent",
          agentId: agent.id,
          sectionId: sourceSectionId,
          beforeAgentId,
        });
        emitAgentEvent({ type: "agents-changed", agents });
        emitAgentEvent({ type: "sidebar-layout-changed", layout: sidebarLayout });
        return clone({ agent, layout: sidebarLayout });
      },
      updateAgent: async (input: UpdateAgentInput) => {
        const current = agents.find((agent) => agent.id === input.agentId);
        if (!current) throw new Error("Agent not found");
        const { agentId: _agentId, ...updates } = input;
        const updated = { ...current, ...updates };
        agents = agents.map((agent) => (agent.id === updated.id ? updated : agent));
        emitAgentEvent({ type: "agents-changed", agents });
        return clone(updated);
      },
      setAvatar: async (input: SetAgentAvatarInput) => {
        const current = agents.find((agent) => agent.id === input.agentId);
        if (!current) throw new Error("Agent not found");
        const updated = {
          ...current,
          avatarUrl: input.image ? `mock-avatar://${input.agentId}` : null,
        };
        agents = agents.map((agent) => (agent.id === updated.id ? updated : agent));
        emitAgentEvent({ type: "agents-changed", agents });
        return clone(updated);
      },
      deleteAgent: async (agentId) => {
        agents = agents.filter((agent) => agent.id !== agentId);
        queues.delete(agentId);
        memories.delete(agentId);
        routines.delete(agentId);
        // The host takes a deleted agent out of every channel it was a member of.
        for (const channel of await mockChannels.listChannels()) {
          if (!channel.members.some((member) => member.agentId === agentId)) continue;
          const draft = {
            name: channel.name,
            title: channel.title,
            instructions: channel.instructions,
            members: channel.members,
            leadAgentId: channel.leadAgentId,
          };
          toggleChannelMember(draft, agentId, false);
          await mockChannels.channelCommand({
            type: "save",
            operationId: crypto.randomUUID(),
            channelId: channel.id,
            draft,
            update: true,
          });
        }
        emitAgentEvent({ type: "agents-changed", agents });
      },
      listMemories: async (agentId) => clone(memories.get(agentId) ?? []),
      createMemory: async (input) => {
        const now = new Date().toISOString();
        const memory: AgentMemory = {
          id: crypto.randomUUID(),
          agentId: input.agentId,
          text: input.text.trim(),
          origin: "manual",
          sourceTurnId: null,
          createdAt: now,
          updatedAt: now,
        };
        memories.set(input.agentId, [...(memories.get(input.agentId) ?? []), memory]);
        emitAgentEvent({ type: "memories-changed", agentId: input.agentId });
        return clone(memory);
      },
      updateMemory: async (input) => {
        const current = memories.get(input.agentId)?.find((memory) => memory.id === input.memoryId);
        if (!current) throw new Error("Memory not found");
        const updated = { ...current, text: input.text.trim(), updatedAt: new Date().toISOString() };
        memories.set(
          input.agentId,
          (memories.get(input.agentId) ?? []).map((memory) => (memory.id === input.memoryId ? updated : memory)),
        );
        emitAgentEvent({ type: "memories-changed", agentId: input.agentId });
        return clone(updated);
      },
      deleteMemory: async (input) => {
        memories.set(
          input.agentId,
          (memories.get(input.agentId) ?? []).filter((memory) => memory.id !== input.memoryId),
        );
        emitAgentEvent({ type: "memories-changed", agentId: input.agentId });
      },
      clearMemories: async (agentId) => {
        memories.delete(agentId);
        emitAgentEvent({ type: "memories-changed", agentId });
      },
      listTables: async () => clone(tables),
      deleteTable: async (input) => {
        tables = tables.filter((table) => table.name !== input.name);
      },
      listRoutines: async (agentId) => clone(routines.get(agentId) ?? []),
      createRoutine: async (input) => {
        const routine = createRoutineRecord(input);
        routines.set(input.agentId, [routine, ...(routines.get(input.agentId) ?? [])]);
        emitAgentEvent({ type: "routines-changed", agentId: input.agentId });
        return clone(routine);
      },
      updateRoutine: async (input) => {
        const current = routines.get(input.agentId)?.find((routine) => routine.id === input.routineId);
        if (!current) throw new Error("Routine not found");
        const updated: Routine = {
          ...current,
          ...(input.name === undefined ? {} : { name: input.name.trim() }),
          ...(input.instruction === undefined ? {} : { instruction: input.instruction.trim() }),
          ...(input.active === undefined ? {} : { active: input.active }),
          ...(input.schedule === undefined
            ? {}
            : {
                trigger: {
                  id: crypto.randomUUID(),
                  routineId: current.id,
                  schedule: input.schedule,
                  nextRunAt: new Date(Date.now() + 3_600_000).toISOString(),
                  createdAt: current.createdAt,
                  updatedAt: new Date().toISOString(),
                },
              }),
          updatedAt: new Date().toISOString(),
        };
        routines.set(
          input.agentId,
          (routines.get(input.agentId) ?? []).map((routine) => (routine.id === current.id ? updated : routine)),
        );
        emitAgentEvent({ type: "routines-changed", agentId: input.agentId });
        return clone(updated);
      },
      deleteRoutine: async (input) => {
        routines.set(
          input.agentId,
          (routines.get(input.agentId) ?? []).filter((routine) => routine.id !== input.routineId),
        );
        emitAgentEvent({ type: "routines-changed", agentId: input.agentId });
      },
      testRoutine: async (input) => {
        const routine = routines.get(input.agentId)?.find((candidate) => candidate.id === input.routineId);
        if (!routine) throw new Error("Routine not found");
        const now = new Date().toISOString();
        const run: RoutineRun = {
          id: crypto.randomUUID(),
          routineId: routine.id,
          agentId: input.agentId,
          triggerId: null,
          kind: "manual",
          scheduledFor: now,
          routineName: routine.name,
          instruction: routine.instruction,
          deliveryId: crypto.randomUUID(),
          status: "queued",
          error: null,
          createdAt: now,
          updatedAt: now,
        };
        routineRuns.set(routine.id, [run, ...(routineRuns.get(routine.id) ?? [])]);
        emitAgentEvent({ type: "routines-changed", agentId: input.agentId });
        return clone(run);
      },
      listRoutineRuns: async (input) => clone((routineRuns.get(input.routineId) ?? []).slice(0, input.limit)),
      readConversation: async (agentId) => ({
        ...clone(getSnapshot(agentId)),
        readState: { unreadCount: 0, firstUnreadMessageId: null, throughMessageId: null },
      }),
      readConversationPage: async (input) => {
        if (!input.anchor || input.anchor.type === "latest") {
          emit(latestConversationListeners, input.agentId);
        }
        const snapshot = clone(getSnapshot(input.agentId));
        const messages = snapshot.messages.slice(-Math.min(input.limit ?? 50, 100));
        return {
          ...snapshot,
          messages,
          references: {},
          pageInfo: { hasOlder: snapshot.messages.length > messages.length, olderCursor: null },
          readState: { unreadCount: 0, firstUnreadMessageId: null, throughMessageId: null },
        };
      },
      searchConversationMessages: async (input) => {
        const query = input.query.trim().toLocaleLowerCase();
        const results = agents.flatMap((agent) =>
          getSnapshot(agent.id)
            .messages.filter((message) => message.text.toLocaleLowerCase().includes(query))
            .map((message) => ({ agentId: agent.id, message: clone(message) })),
        );
        return { results: results.slice(0, input.limit ?? 100), total: results.length, nextCursor: null };
      },
      listConversationReads: async () => ({}),
      markConversationRead: async (input) => ({
        unreadCount: 0,
        firstUnreadMessageId: null,
        throughMessageId: input.throughMessageId,
      }),
      chooseAttachments: async (_input) => [],
      onAttachmentImport: (listener) => {
        attachmentListeners.add(listener);
        return () => attachmentListeners.delete(listener);
      },
      discardDraftAttachment: async () => undefined,
      downloadAttachments: async () => {
        throw new Error("ZIP downloads are available in the desktop app.");
      },
      openAttachment: async (_input: OpenAttachmentInput) => undefined,
      openSharedFile: async (_input: OpenSharedFileInput) => undefined,
      openWorkspaceFile: async (_input: OpenWorkspaceFileInput) => undefined,
      previewSharedFile: async (input: OpenSharedFileInput) => mockFilePreview(input.path, "shared-file"),
      previewWorkspaceFile: async (input: OpenWorkspaceFileInput) => mockFilePreview(input.path, "workspace-file"),
      sendMessage: async (input: SendMessageInput) => {
        const messageId = `mock-message-${messageCounter++}`;
        const deliveryId = `mock-delivery-${messageCounter++}`;
        const turnId = `mock-turn-${messageCounter++}`;
        const createdAt = new Date().toISOString();
        const userMessage: ConversationMessage = {
          id: messageId,
          turnId,
          author: "user",
          source: "user",
          text: input.text,
          createdAt,
          status: "completed",
          replyToMessageId: input.replyToMessageId ?? null,
        };
        const delivery: QueueDelivery = {
          id: deliveryId,
          messageId,
          recipientAgentId: input.agentId,
          sender: { kind: "user" },
          text: input.text,
          attachments: [],
          replyToMessageId: input.replyToMessageId ?? null,
          status: "running",
          position: null,
          turnId,
          error: null,
          createdAt,
        };
        updateSnapshot(input.agentId, (snapshot) => {
          snapshot.activeTurnId = turnId;
          snapshot.messages = [...snapshot.messages, userMessage];
        });
        queues.set(input.agentId, { agentId: input.agentId, deliveries: [delivery] });
        emitAgentEvent({
          type: "queue-changed",
          snapshot: queues.get(input.agentId) ?? emptyQueue(input.agentId),
        });
        emitAgentEvent({
          type: "turn-started",
          agentId: input.agentId,
          threadId: getSnapshot(input.agentId).threadId ?? `thread-${input.agentId}`,
          turnId,
        });
        emitAgentEvent({
          type: "turn-progress",
          agentId: input.agentId,
          threadId: getSnapshot(input.agentId).threadId ?? `thread-${input.agentId}`,
          turnId,
          detail: "Reviewing your request…",
        });

        schedule(() => {
          const assistantMessage: ConversationMessage = {
            id: `mock-reply-${messageCounter++}`,
            turnId,
            author: "assistant",
            source: "assistant",
            text: `Mock reply from ${agents.find((agent) => agent.id === input.agentId)?.name ?? "agent"}: I received “${input.text}” and added it to the working context.`,
            createdAt: new Date().toISOString(),
            status: "completed",
          };
          updateSnapshot(input.agentId, (snapshot) => {
            snapshot.activeTurnId = null;
            snapshot.messages = [...snapshot.messages, assistantMessage];
          });
          queues.set(input.agentId, {
            agentId: input.agentId,
            deliveries: [{ ...delivery, status: "completed" }],
          });
          emitAgentEvent({
            type: "queue-changed",
            snapshot: queues.get(input.agentId) ?? emptyQueue(input.agentId),
          });
          emitAgentEvent({
            type: "turn-completed",
            agentId: input.agentId,
            threadId: getSnapshot(input.agentId).threadId ?? `thread-${input.agentId}`,
            turnId,
            status: "completed",
          });
        }, 80);

        return {
          messageId,
          deliveries: [{ id: deliveryId, recipientAgentId: input.agentId, status: "running", position: null }],
        };
      },
      setMessageReaction: async (input: SetMessageReactionInput) => {
        updateSnapshot(input.agentId, (snapshot) => {
          const message = snapshot.messages.find((candidate) => candidate.id === input.messageId);
          if (message) {
            message.reaction = input.emoji;
            message.reactions = [
              ...(message.reactions ?? []).filter((reaction) => reaction.actor.kind !== "user"),
              ...(input.emoji ? [{ emoji: input.emoji, actor: { kind: "user" as const } }] : []),
            ];
          }
        });
      },
      listQueue: async (agentId) => clone(queues.get(agentId) ?? emptyQueue(agentId)),
      acknowledgeFailedTurn: async () => undefined,
      cancelQueuedMessage: async (input) => {
        const queue = queues.get(input.agentId) ?? emptyQueue(input.agentId);
        queue.deliveries = queue.deliveries.map((delivery) =>
          delivery.id === input.deliveryId ? { ...delivery, status: "cancelled" } : delivery,
        );
        queues.set(input.agentId, queue);
        emitAgentEvent({ type: "queue-changed", snapshot: queue });
      },
      steerQueuedMessage: async (input: SteerQueuedMessageInput) => {
        const queue = queues.get(input.agentId) ?? emptyQueue(input.agentId);
        queue.deliveries = queue.deliveries.map((delivery) =>
          delivery.id === input.deliveryId
            ? { ...delivery, status: "running", turnId: input.expectedTurnId, position: null }
            : delivery,
        );
        queues.set(input.agentId, queue);
        emitAgentEvent({ type: "queue-changed", snapshot: queue });
      },
      editQueuedMessage: async (input) => {
        const queue = queues.get(input.agentId) ?? emptyQueue(input.agentId);
        if (input.action === "begin") {
          const existing = queueEdits.get(input.editId);
          const delivery =
            existing?.delivery ??
            queue.deliveries.find((item) => item.id === input.deliveryId && item.status === "queued");
          if (!delivery || (existing && existing.agentId !== input.agentId))
            throw new Error("This queued message is no longer available.");
          queueEdits.set(input.editId, { agentId: input.agentId, delivery });
          // The host keeps a held delivery listed and marks it, so every device keeps the row.
          queue.deliveries = queue.deliveries.map((item) =>
            item.id === delivery.id ? { ...item, editing: true } : item,
          );
          queues.set(input.agentId, queue);
          emitAgentEvent({ type: "queue-changed", snapshot: structuredClone(queue) });
          return structuredClone(queue);
        }
        const held = queueEdits.get(input.editId);
        if (!held || held.agentId !== input.agentId || held.delivery.id !== input.deliveryId)
          throw new Error("This edit is no longer available.");
        if (input.action === "retain-attachments") return structuredClone(queue);
        queueEdits.delete(input.editId);
        const delivery =
          input.action === "save"
            ? {
                ...held.delivery,
                text: input.text,
                attachments: held.delivery.attachments.filter((item) => input.keepAttachmentIds.includes(item.id)),
              }
            : held.delivery;
        queue.deliveries = queue.deliveries.some((item) => item.id === delivery.id)
          ? queue.deliveries.map((item) => (item.id === delivery.id ? { ...delivery, editing: false } : item))
          : [...queue.deliveries, { ...delivery, editing: false }];
        queues.set(input.agentId, queue);
        emitAgentEvent({ type: "queue-changed", snapshot: structuredClone(queue) });
        return structuredClone(queue);
      },
      updateQueuedMessage: async (input: UpdateQueuedMessageInput) => {
        const queue = queues.get(input.agentId) ?? emptyQueue(input.agentId);
        queue.deliveries = queue.deliveries.map((delivery) =>
          delivery.id === input.deliveryId ? { ...delivery, text: input.text } : delivery,
        );
        queues.set(input.agentId, queue);
        emitAgentEvent({ type: "queue-changed", snapshot: queue });
      },
      reorderQueue: async (input: ReorderQueueInput) => {
        const queue = queues.get(input.agentId) ?? emptyQueue(input.agentId);
        const byId = new Map(queue.deliveries.map((delivery) => [delivery.id, delivery]));
        queue.deliveries = input.deliveryIds.flatMap((deliveryId, index) => {
          const delivery = byId.get(deliveryId);
          return delivery ? [{ ...delivery, position: index + 1 }] : [];
        });
        queues.set(input.agentId, queue);
        emitAgentEvent({ type: "queue-changed", snapshot: queue });
      },
      interrupt: async (input) => {
        emitAgentEvent({
          type: "turn-completed",
          agentId: input.agentId,
          threadId: getSnapshot(input.agentId).threadId ?? `thread-${input.agentId}`,
          turnId: input.turnId,
          status: "interrupted",
        });
      },
      respondToPrompt: async (_input: RespondToPromptInput) => undefined,
      respondToApproval: async () => undefined,
      respondToBrowserSecret: async (input) => {
        for (const listener of agentListeners)
          listener({ type: "browser-takeover-resolved", requestId: input.requestId, agentId: input.agentId });
      },
      respondToBrowserTakeover: async () => undefined,
      onEvent: (listener) => {
        agentListeners.add(listener);
        return () => agentListeners.delete(listener);
      },
      onScopedEvent: (listener) => {
        const scopedListener = (event: AgentEvent) => listener({ serverId: "local", event });
        agentListeners.add(scopedListener);
        return () => agentListeners.delete(scopedListener);
      },
    },
    browser: mockBrowser.browser,
    update: {
      getStatus: async () => clone(updateStatus),
      check: async () => {
        updateStatus = { ...updateStatus, phase: "up-to-date", availableVersion: null };
        emit(updateListeners, updateStatus);
        return clone(updateStatus);
      },
      download: async () => {
        updateStatus = { ...updateStatus, phase: "downloading", progress: 0 };
        emit(updateListeners, updateStatus);
        const downloadSteps = [
          { delay: 350, expectedPhase: "downloading", phase: "downloading", progress: 28 },
          { delay: 700, expectedPhase: "downloading", phase: "downloading", progress: 64 },
          { delay: 1_050, expectedPhase: "downloading", phase: "ready", progress: 100 },
        ] as const;
        for (const step of downloadSteps) {
          schedule(() => {
            if (updateStatus.phase !== step.expectedPhase) return;
            updateStatus = { ...updateStatus, phase: step.phase, progress: step.progress };
            emit(updateListeners, updateStatus);
          }, step.delay);
        }
        return clone(updateStatus);
      },
      install: async () => {
        updateStatus = { ...updateStatus, phase: "installing" };
        emit(updateListeners, updateStatus);
      },
      getPreference: async () => ({ autoDownload: true }),
      setPreference: async (input) => ({ ...input }),
      onEvent: (listener) => {
        updateListeners.add(listener);
        return () => updateListeners.delete(listener);
      },
    },
    notifications: {
      getPreference: async () => ({ desktopNotifications: true }),
      setPreference: async (input) => ({ ...input }),
      test: async () => undefined,
      openSettings: async () => undefined,
      onOpened: () => () => undefined,
    },
    maintenance: {
      exportData: async () => ({ saved: true }),
      exportDiagnostics: async () => ({ saved: true }),
    },
    servers: mockTeam.servers,
    plugins: {
      // The preview is never opened by a link, so there is nothing pending and nothing to push.
      takePendingListing: async () => null,
      onOpenListing: (listener) => {
        void listener;
        return () => undefined;
      },
    },
    host: mockTeam.host,
    storage: createMockStorage(),
    agentImport: {
      choose: async () => clone(AGENT_IMPORT_PREVIEW),
      apply: async ({ token, keys, channelKeys }) => {
        if (token !== AGENT_IMPORT_PREVIEW.token) throw new Error("The export is no longer open. Choose it again.");
        const selected = AGENT_IMPORT_PREVIEW.agents.filter((agent) => keys.includes(agent.key));
        const imported = selected.map((agent) =>
          createAgentSummary({ name: agent.name, title: agent.title, description: agent.description }),
        );
        agents = [...agents, ...imported];
        emitAgentEvent({ type: "agents-changed", agents });
        // Channels follow the main process: the members that imported, and at least one of them.
        const agentIds = new Map(selected.map((agent, index) => [agent.key, imported[index]?.id ?? ""]));
        const channels = [];
        const skippedChannels = [];
        for (const source of AGENT_IMPORT_PREVIEW.channels.filter((channel) => channelKeys.includes(channel.key))) {
          const members = source.memberKeys.flatMap((key) => {
            const agentId = agentIds.get(key);
            return agentId ? [{ agentId }] : [];
          });
          if (members.length === 0) {
            skippedChannels.push({
              key: source.key,
              name: source.name,
              reason: "None of its agents were imported.",
            });
            continue;
          }
          const channel = await api.agent.channelCommand({
            type: "save",
            operationId: crypto.randomUUID(),
            channelId: crypto.randomUUID(),
            draft: {
              name: source.name,
              title: source.title,
              instructions: "",
              members,
              leadAgentId: source.leadKey ? (agentIds.get(source.leadKey) ?? null) : null,
            },
          });
          channels.push({ id: channel.id, name: channel.name });
        }
        return clone({ agents: imported, skipped: [], channels, skippedChannels, warnings: [] });
      },
      discard: async () => undefined,
      readSkill: async () => AGENT_IMPORT_SKILL,
      saveSkill: async () => ({ saved: true }),
    },
    remoteDesktop: mockTeam.remoteDesktop,
  };

  return {
    api,
    emitAgentEvent,
    onLatestConversationOpened: (listener) => {
      latestConversationListeners.add(listener);
      return () => latestConversationListeners.delete(listener);
    },
    onLatestDirectConversationOpened: mockTeam.onLatestDirectConversationOpened,
    readConversationSnapshot,
    updateConversationSnapshot,
    readDirectConversationSnapshot: mockTeam.readDirectConversationSnapshot,
    updateDirectConversationSnapshot: mockTeam.updateDirectConversationSnapshot,
    emitConversationDelta,
    setQueueSnapshot,
    emitAuthState: mockAuth.emitAuthState,
    emitPresence: mockTeam.emitPresence,
    emitDirectMessage: mockTeam.emitDirectMessage,
    emitDirectTyping: mockTeam.emitDirectTyping,
    emitInvite: mockTeam.emitInvite,
    emitHostStatus: mockTeam.emitHostStatus,
    emitRemoteDesktopSessions: mockTeam.emitRemoteDesktopSessions,
    dispose: () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      mockProviderRuntimes.dispose();
      mockAuth.dispose();
      mockBrowser.dispose();
      mockTeam.dispose();
      agentListeners.clear();
      updateListeners.clear();
      attachmentListeners.clear();
      latestConversationListeners.clear();
      void appInfo;
    },
  };
}
