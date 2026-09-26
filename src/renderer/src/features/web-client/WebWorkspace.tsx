import {
  type AccountUsage,
  type AddedAgent,
  type AgentEvent,
  type AgentModelOption,
  type AgentStatus,
  MCP_SERVERS_CAPABILITY,
  type ServerSummary,
} from "@openbot/contracts/ipc";
import {
  clearStorage,
  deleteStoredFile,
  getAgentAdminSettings,
  getStorageUsage,
  updateAgentAdminSettings,
} from "@openbot/team-client/team-admin-requests";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertTitle,
  Button,
  buttonVariants,
  toast,
} from "@openbot/ui";
import { AccountDock } from "@openbot/ui/features/account/AccountDock";
import { computeAgentAvatarMoods } from "@openbot/ui/features/agents/agent-avatar-mood";
import { JoinServerDialog } from "@openbot/ui/features/servers/JoinServerDialog";
import { ServerRail } from "@openbot/ui/features/servers/ServerRail";
import { Sidebar } from "@openbot/ui/features/sidebar/Sidebar";
import { computeSidebarAgentStates } from "@openbot/ui/features/sidebar/sidebar-agent-states";
import { createEffect, createMemo, createSignal, Loading, Show } from "solid-js";
import { toAgentMessage } from "../../app-message-projection";
import { AgentTemplateInstall, ServerSettingsModal, SkillsMarketplaceModal } from "../../lazy-views";
import { createRemoteAgentAdmin, updateRemoteAgent } from "../agents/remote-agent-admin";
import { Conversation, createConversationController } from "../conversation/Conversation";
import { ConversationControllerProvider } from "../conversation/conversation-controller-context";
import type { FilesPort } from "../files/files-port";
import { canManageStorage, serverHasStorage } from "../files/storage-usage";
import { remoteAdminServer, serverCanAdminister } from "../servers/server-capabilities";
import { MARKETPLACE_PLUGINS } from "../settings/marketplace-plugin-catalog";
import { WebAgentSettings } from "./WebAgentSettings";
import { WebMobileNavigation, type WebMobilePane } from "./WebMobileNavigation";
import { createWebWorkspace, type WebRuntimeFactory } from "./web-client-context";
import { createWebConversationRuntime } from "./web-conversation-runtime";
import { createWebFileSaver } from "./web-file-download";
import { createWebAgentTemplateCalls, createWebMarketplaceCalls } from "./web-marketplace";
import { createWebProviderSettings } from "./web-provider-admin";
import { createWebServerSettings } from "./web-server-settings";

const CONNECTING_STATUS: AgentStatus = {
  phase: "starting",
  cliVersion: null,
  auth: { kind: "unknown" },
  capabilities: { chat: "unavailable", browser: "unavailable", computerUse: "unavailable" },
  message: null,
  fullAccess: true,
};
export function WebWorkspace(props: {
  accountId: string;
  accountEmail?: string;
  accountName?: string | null;
  accountAvatarUrl?: string | null;
  accountFetch: typeof fetch;
  onSessionCheck: () => Promise<void>;
  onLogout: () => Promise<void>;
  createRuntime?: WebRuntimeFactory;
  /** A shared agent that a `/app?agent=<id>` link named. The dialog installs it only on a press. */
  agentTemplateId?: string | null;
  onAgentTemplateClose?: () => void;
}) {
  const [status, setStatus] = createSignal<AgentStatus>(CONNECTING_STATUS);
  const [models, setModels] = createSignal<AgentModelOption[]>([]);
  /** Bumped on each host change, so a model list read for the previous host is dropped. */
  let modelsGeneration = 0;
  const workspace = createWebWorkspace(props, {
    onStatus: (next) => {
      setStatus(next);
      // As in the desktop app: a ready status can follow a provider sign-in or a new endpoint, so
      // the models are read again.
      if (next.phase !== "ready") return;
      const generation = modelsGeneration;
      workspace.runtime.models().then(
        (list) => {
          if (generation === modelsGeneration) setModels(list);
        },
        () => undefined,
      );
    },
  });
  const controller = createConversationController({ onTypingChange: () => {} }, false);
  createEffect(
    () => ({ host: workspace.state.host?.hostId, revocation: workspace.state.revocationRevision }),
    () => {
      controller.setDrafts({});
      controller.setComposerErrors({});
      controller.setConversationErrors({});
      controller.setEditingDraftBackup(null);
      controller.setEditingOriginalAttachmentIds([]);
      controller.setEditingPendingSave(null);
      controller.setEditingAgentId(null);
      controller.setEditingServerId(null);
      controller.setEditingEditId(null);
      controller.setEditingDeliveryId(null);
    },
  );
  const [accountUsage, setAccountUsage] = createSignal<AccountUsage | null>(null);
  let usageGeneration = 0;
  const [joinOpen, setJoinOpen] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  const [mobilePane, setMobilePane] = createSignal<WebMobilePane>("conversation");
  const [settingsRequest, setSettingsRequest] = createSignal<{ agentId: string; nonce: number } | null>(null);
  const servers = createMemo<ServerSummary[]>(() =>
    workspace.state.hosts.map((host) => ({
      id: host.hostId,
      name: host.name,
      kind: "remote",
      role: host.role,
      apiUrl: null,
      logoUrl: null,
      active: host.hostId === workspace.state.host?.hostId,
      state: host.hostId === workspace.state.host?.hostId ? workspace.state.status : "offline",
      notificationsMuted: false,
      notificationsMutedUntil: null,
      notificationLevel: "all",
      remoteDesktopAvailable: false,
      compatibility: {
        localAppVersion: "web",
        hostAppVersion: null,
        localProtocol: { minimum: 3, maximum: 3 },
        hostProtocol: null,
        negotiatedProtocol: 3,
        capabilities: workspace.state.capabilities,
      },
    })),
  );
  const server = createMemo(() => servers().find((item) => item.active));
  /** The admin requests of the connected host. A call for another server is refused, not redirected. */
  function hostRequest(serverId?: string): TeamApiRequest {
    const admin = workspace.runtime.admin;
    const current = server();
    if (!admin || !current || (serverId !== undefined && serverId !== current.id))
      throw new Error("Connect to this server first.");
    return admin.request;
  }
  const providerSettings = createWebProviderSettings({
    server: () => (workspace.runtime.admin ? server() : undefined),
    request: hostRequest,
    status,
    setStatus,
    readStatus: () => workspace.runtime.status(),
  });
  const runtime = createWebConversationRuntime(
    workspace.runtime,
    () => workspace.state.host?.hostId ?? "",
    workspace.runtime.admin ? () => hostRequest() : undefined,
  );
  const remoteAgentAdmin = createRemoteAgentAdmin(
    () => {
      const current = server();
      const agent = workspace.selected();
      return current && agent ? { server: current, agentId: agent.id } : null;
    },
    () => ({
      getAgentAdminSettings: (agentId, serverId) => getAgentAdminSettings(hostRequest(serverId), agentId),
      updateAgentAdminSettings: (input, serverId) => updateAgentAdminSettings(hostRequest(serverId), input),
    }),
  );
  /** The Team API agent summary has no access, so the agent shows the host's answer. */
  const conversationAgent = createMemo(() => {
    const agent = workspace.selected();
    const settings = remoteAgentAdmin.settings();
    return agent && settings ? { ...agent, access: settings.access } : agent;
  });
  const serverSettings = createWebServerSettings({
    server,
    admin: () => workspace.runtime.admin,
    presence: () => workspace.state.presence,
    refreshHosts: () => workspace.refreshHosts(),
  });
  const marketplaceCalls = createWebMarketplaceCalls(props.accountFetch, hostRequest);
  const agentTemplateCalls = createWebAgentTemplateCalls(props.accountFetch, hostRequest);
  const [marketplaceOpen, setMarketplaceOpen] = createSignal(false);
  /* As in the desktop app: an owner or admin installs on the host's agents, and a member browses. */
  const manageSkills = createMemo(() => serverCanAdminister(server(), "skills-admin-v1"));
  /* As in the desktop app: a managed agent whose composer is free to take another line. */
  const composerFree = createMemo(
    () =>
      manageSkills() &&
      status().phase === "ready" &&
      !creating() &&
      !controller.submitting() &&
      !controller.selectionSending() &&
      controller.voicePhase() === "idle" &&
      !controller.editingDeliveryId(),
  );
  /** Adds a marketplace example to an agent's draft, then opens that agent's conversation. */
  function appendMarketplaceExample(agentId: string, append: (target: { serverId: string; agentId: string }) => void) {
    const target = server();
    if (
      !serverCanAdminister(target, "skills-admin-v1") ||
      !workspace.state.agents.some((agent) => agent.id === agentId)
    )
      return;
    append({ serverId: target.id, agentId });
    setMarketplaceOpen(false);
    setMobilePane("conversation");
    if (agentId !== workspace.state.selectedId) void select(agentId);
  }
  const saveFile = createWebFileSaver();
  const storageCalls: FilesPort = {
    agent: { listAgents: () => workspace.runtime.listAgents() },
    storage: {
      // The host names previews with the desktop `openbot-attachment:` scheme, as it does in chat.
      getUsage: async (input, serverId) => {
        const usage = await getStorageUsage(hostRequest(serverId), input);
        return { ...usage, files: usage.files.map((file) => ({ ...file, previewUrl: null })) };
      },
      deleteFile: (input, serverId) => deleteStoredFile(hostRequest(serverId), input),
      clear: (input, serverId) => clearStorage(hostRequest(serverId), input),
      // A stored file is an attachment. The browser has no app to open it in, so it downloads.
      openFile: async (input, serverId) => {
        hostRequest(serverId);
        saveFile(await workspace.runtime.download(input.fileId));
      },
    },
  };
  async function openServerSettings(serverId: string, trigger: HTMLElement | null): Promise<void> {
    if (server()?.id !== serverId || workspace.state.status !== "online") {
      const host = workspace.state.hosts.find((item) => item.hostId === serverId);
      if (!host) return;
      await workspace.connect(host);
      if (server()?.id !== serverId || workspace.state.status !== "online") return;
    }
    serverSettings.open(trigger);
  }
  const sidebarActivity = createMemo(() => ({
    agentIds: workspace.state.agents.map((agent) => agent.id),
    activeTurns: Object.fromEntries(
      Object.entries(workspace.state.conversations).map(([id, conversation]) => [
        id,
        workspace.state.status === "online" ? (conversation.page?.activeTurnId ?? null) : null,
      ]),
    ),
    queues: {},
    unreadReplies: {},
    recentReplies: {},
    failedTurns: {},
    pendingPrompts: Object.fromEntries(workspace.state.prompts.map((prompt) => [prompt.agentId, prompt])),
    pendingApprovals: Object.fromEntries(workspace.state.approvals.map((approval) => [approval.agentId, approval])),
  }));
  const sidebarAgentStates = createMemo(() => computeSidebarAgentStates(sidebarActivity()));
  const sidebarAgentMoods = createMemo(() => computeAgentAvatarMoods(sidebarActivity()));
  const browserEnabled = createMemo(
    () =>
      workspace.state.status === "online" &&
      workspace.state.capabilities.includes("browser-control") &&
      workspace.state.capabilities.includes("browser-view"),
  );
  const browserTakeover = createMemo(() => {
    const agent = workspace.selected();
    if (!agent) return undefined;
    return workspace.state.takeovers.find(
      (request) => request.agentId === agent.id && request.threadId === agent.threadId,
    );
  });
  const approval = createMemo(() =>
    workspace.state.approvals.find(
      (item) => item.agentId === workspace.state.selectedId && item.threadId === workspace.selected()?.threadId,
    ),
  );
  /** "Always allow", for an owner or admin whose host answered. The grant is written on the host. */
  const alwaysAllowApproval = createMemo(() => {
    const agent = workspace.selected();
    const item = approval();
    if (!agent || !item || !remoteAgentAdmin.settings()) return undefined;
    return async () => {
      await remoteAgentAdmin.update({ agentId: agent.id, autoApprove: true });
      if (approval()?.requestId !== item.requestId) return false;
      await workspace.approve({ requestId: item.requestId, decision: "accept" });
      return true;
    };
  });
  const setAgentAutoApprove = createMemo(() => {
    const agent = workspace.selected();
    if (!agent || !remoteAgentAdmin.settings()) return undefined;
    return (autoApprove: boolean) => remoteAgentAdmin.update({ agentId: agent.id, autoApprove });
  });
  const prompt = createMemo<Extract<AgentEvent, { type: "prompt" }> | undefined>(() => {
    if (workspace.state.status !== "online") return;
    const page = workspace.conversation()?.page;
    if (!page?.threadId) return;
    const pending = workspace.state.prompts.find(
      (item) => item.agentId === page.agentId && item.threadId === page.threadId,
    );
    if (pending) return pending;
    const message = page.messages.findLast(
      (item) => item.turnId === page.activeTurnId && item.questionPrompt && !item.questionPrompt.resolution,
    );
    if (!message?.questionPrompt || !page.activeTurnId) return;
    return {
      type: "prompt",
      agentId: page.agentId,
      threadId: page.threadId,
      turnId: page.activeTurnId,
      requestId: message.questionPrompt.requestId,
      questions: message.questionPrompt.questions,
    };
  });
  const messages = createMemo(() =>
    (workspace.conversation()?.page?.messages ?? []).map((value) => {
      const message = toAgentMessage(value, workspace.state.selectedId ?? undefined);
      return {
        ...message,
        attachments: message.attachments?.map((attachment) => ({ ...attachment, previewUrl: null })),
      };
    }),
  );
  createEffect(
    () => workspace.state.error,
    (error) => {
      if (error) toast.error(error);
    },
  );
  createEffect(
    () => ({ host: workspace.state.host?.hostId, state: workspace.state.status }),
    ({ host, state }) => {
      let active = true;
      usageGeneration += 1;
      setAccountUsage(null);
      setCreating(false);
      modelsGeneration += 1;
      setModels([]);
      setStatus(CONNECTING_STATUS);
      if (host && state === "online") {
        // Not through `workspace.run`: it drops a task while another runs, and the reconnect that
        // made the host online is still running here.
        void Promise.all([workspace.runtime.status(), workspace.runtime.models()]).then(
          ([nextStatus, nextModels]) => {
            if (!active) return;
            setStatus(nextStatus);
            setModels(nextModels);
          },
          (error: unknown) => {
            if (active) toast.error(error instanceof Error ? error.message : "The host status could not be read.");
          },
        );
      }
      return () => {
        active = false;
      };
    },
  );
  async function refreshUsage(): Promise<AccountUsage> {
    const readUsage = workspace.runtime.accountUsage;
    if (!readUsage || workspace.state.status !== "online") throw new Error("Connect to your host to view usage.");
    const generation = ++usageGeneration;
    const usage = await readUsage();
    if (generation === usageGeneration) setAccountUsage(usage);
    return usage;
  }
  async function select(id: string) {
    setCreating(false);
    await workspace.select(id);
  }
  async function openAddedAgent(agent: AddedAgent) {
    setMobilePane("conversation");
    await workspace.run(async () => {
      await workspace.refresh();
      await select(agent.id);
    });
  }
  const unavailable = async (): Promise<never> => {
    throw new Error("This action is available in the desktop app.");
  };
  return (
    <ConversationControllerProvider controller={controller}>
      <div
        class="app-frame app-frame-with-server-rail web-app-frame"
        data-web-mobile-pane={mobilePane()}
        style="--left-panel-width: 280px"
      >
        <ServerRail
          servers={servers()}
          onSelect={(id) => {
            const host = workspace.state.hosts.find((item) => item.hostId === id);
            if (host) void workspace.connect(host);
          }}
          onReorder={() => {}}
          onAdd={() => setJoinOpen(true)}
          onOpenSettings={(id, trigger) => void openServerSettings(id, trigger)}
        />
        <Sidebar
          serverName={workspace.state.host?.name ?? "OpenBot"}
          onOpenServerSettings={(trigger) => {
            const host = workspace.state.host;
            if (host) void openServerSettings(host.hostId, trigger);
          }}
          agents={workspace.profiles()}
          activeAgentId={workspace.state.selectedId ?? ""}
          people={[]}
          directThreads={[]}
          activeDirectMemberId={null}
          agentStates={sidebarAgentStates()}
          agentMoods={sidebarAgentMoods()}
          layout={workspace.state.sidebarLayout}
          layoutMutable={workspace.state.status === "online" && workspace.state.capabilities.includes("sidebar-layout")}
          collapsedSectionIds={workspace.state.sidebarCollapsedSectionIds}
          onMutateLayout={workspace.mutateSidebarLayout}
          onToggleSection={workspace.toggleSidebarSection}
          pinnedItems={workspace.state.pinnedIds.map((id) => ({ kind: "agent", id }))}
          peopleOrder={[]}
          onPin={(item) => workspace.togglePinned(item.id)}
          onUnpin={(item) => workspace.togglePinned(item.id)}
          onReorderPinned={workspace.reorderPinnedSidebarItems}
          onReorderPeople={() => {}}
          onSelectAgent={(id) => {
            setMobilePane("conversation");
            void select(id);
          }}
          onSelectPerson={() => {}}
          onCreateAgent={() => {
            setMobilePane("conversation");
            setCreating(true);
          }}
          createSupported={workspace.state.status === "online" && workspace.state.host !== null}
          onEditAgent={(id) => {
            setMobilePane("conversation");
            void select(id);
            setSettingsRequest({ agentId: id, nonce: Date.now() });
          }}
          duplicateSupported={
            workspace.state.status === "online" && workspace.state.capabilities.includes("agent-duplication")
          }
          duplicatingAgentIds={new Set(workspace.state.duplicatingAgentIds)}
          onDuplicateAgent={workspace.duplicateAgent}
          deleteSupported={
            workspace.state.status === "online" &&
            Boolean(workspace.state.host) &&
            workspace.state.host?.role !== "member"
          }
          marketplaceSupported={workspace.state.status === "online"}
          onDeleteAgent={workspace.deleteAgent}
          compact={false}
          onExpand={() => {}}
          onOpenMarketplace={() => setMarketplaceOpen(true)}
        />
        <AccountDock
          remoteClient
          account={{
            id: props.accountId,
            email: props.accountEmail ?? "",
            name: props.accountName ?? null,
            avatarUrl: props.accountAvatarUrl ?? null,
          }}
          appInfo={{ name: "OpenBot", version: "web", platform: "darwin", variant: "production" }}
          agentStatus={status()}
          accountUsage={accountUsage()}
          usageProvider={workspace.selected()?.provider ?? null}
          usageModel={workspace.selected()?.model ?? null}
          usageTargetKey={
            workspace.runtime.accountUsage && workspace.state.status === "online"
              ? (workspace.state.host?.hostId ?? null)
              : null
          }
          usageRefreshRevision={0}
          usageReady={workspace.state.status === "online"}
          updateStatus={{
            phase: "unsupported",
            currentVersion: "web",
            availableVersion: null,
            progress: null,
            checkedAt: null,
            message: null,
            errorCode: null,
          }}
          compact={false}
          withServerRail
          onRefreshUsage={refreshUsage}
          onUpdateAction={unavailable}
          onLogout={props.onLogout}
          onOpenExternal={unavailable}
          onOpenPermissions={() => {}}
          onOpenSettings={() => {}}
          onOpenSkills={() => {}}
        />
        <WebMobileNavigation activePane={mobilePane()} onChange={setMobilePane} />
        <div class="usage-workspace-content">
          <Show
            when={!creating()}
            fallback={
              <WebAgentSettings
                runtime={workspace.runtime}
                capabilities={workspace.state.capabilities}
                onClose={() => setCreating(false)}
                onSaved={async () => {
                  await workspace.refresh();
                  setCreating(false);
                }}
              />
            }
          >
            <Conversation
              runtime={runtime}
              onOpenMarketplace={() => setMarketplaceOpen(true)}
              notice={
                <>
                  <Show when={workspace.state.status !== "online"}>
                    <Alert class="web-connection-notice" role="status">
                      <AlertContent>
                        <AlertTitle>
                          {workspace.state.host
                            ? workspace.state.status === "connecting"
                              ? "Connecting to your computer"
                              : "Your computer is disconnected"
                            : workspace.state.hostsLoading
                              ? "Finding your computers"
                              : workspace.state.hostsError
                                ? "Could not load your computers"
                                : "Connect your computer"}
                        </AlertTitle>
                        <AlertDescription>
                          {workspace.state.host
                            ? (workspace.state.error ??
                              "Keep OpenBot open on your computer. Your draft stays here while you reconnect.")
                            : (workspace.state.hostsError ??
                              "Install and open OpenBot on your computer, then sign in with the same email and enable remote access. You can also join a computer with an invitation.")}
                        </AlertDescription>
                        <AlertActions>
                          <Show when={!workspace.state.host}>
                            <a
                              class={buttonVariants({ variant: "outline", size: "sm" })}
                              href="/#download"
                              target="_blank"
                              rel="noreferrer"
                            >
                              Download OpenBot
                            </a>
                            <Button variant="outline" size="sm" onClick={() => setJoinOpen(true)}>
                              Join with invitation
                            </Button>
                          </Show>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={workspace.state.hostsLoading || workspace.state.status === "connecting"}
                            onClick={() =>
                              void workspace.run(async () => {
                                if (workspace.state.host) await workspace.connect(workspace.state.host);
                                else await workspace.refreshHosts();
                              })
                            }
                          >
                            {workspace.state.host ? "Reconnect" : "Refresh hosts"}
                          </Button>
                        </AlertActions>
                      </AlertContent>
                    </Alert>
                  </Show>
                  <Show when={workspace.state.status === "online" && workspace.conversation()?.uncertain}>
                    <Alert class="web-connection-notice" tone="warning" role="status">
                      <AlertContent>
                        <AlertTitle>Check whether your message arrived</AlertTitle>
                        <AlertDescription>
                          The connection ended before delivery was confirmed. Refresh and check the conversation before
                          sending again. Your message will not be sent again automatically.
                        </AlertDescription>
                        <AlertActions>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={workspace.state.busy}
                            onClick={() => void workspace.run(workspace.refresh)}
                          >
                            Refresh conversation
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={workspace.state.busy}
                            onClick={() => {
                              workspace.acknowledgeSend();
                              const key = `${server()?.id}:${workspace.state.selectedId}`;
                              controller.setComposerErrors((current) => {
                                const next = { ...current };
                                delete next[key];
                                return next;
                              });
                            }}
                          >
                            I checked the conversation
                          </Button>
                        </AlertActions>
                      </AlertContent>
                    </Alert>
                  </Show>
                </>
              }
              agentStatus={workspace.state.status === "online" ? status() : CONNECTING_STATUS}
              agent={conversationAgent()}
              agents={workspace.profiles()}
              modelOptions={models()}
              messages={messages()}
              unreadCount={0}
              firstUnreadMessageId={null}
              loaded={Boolean(workspace.conversation()?.page)}
              hasOlder={workspace.conversation()?.page?.pageInfo.hasOlder}
              loadingOlder={workspace.conversation()?.loading}
              activeTurnId={workspace.conversation()?.page?.activeTurnId}
              globalOverlayOpen={joinOpen() || serverSettings.state.open}
              settingsRequest={settingsRequest()}
              messageFocusRequest={null}
              queue={undefined}
              browserRuntime={workspace.runtime.browser}
              browserTabs={workspace.state.browserTabs}
              activeBrowserTabId={workspace.state.activeBrowserTabId}
              browserVisibilitySuspended={workspace.state.status !== "online"}
              browserControlState={workspace.state.browserControlState}
              server={server()}
              presence={workspace.state.presence ?? { serverId: server()?.id ?? null, members: [], updatedAt: "" }}
              currentUserEmail={props.accountEmail ?? ""}
              browserEnabled={browserEnabled()}
              remoteDesktopEnabled={false}
              remoteDesktopSessionActive={false}
              remoteDesktopVisible={false}
              prompt={prompt()}
              approval={approval()}
              browserTakeover={browserTakeover()}
              onSelectAgent={(id) => {
                setMobilePane("conversation");
                void select(id);
              }}
              onUpdateAgent={async (agentId, updates) => {
                await updateRemoteAgent(remoteAgentAdmin, { agentId, ...updates }, workspace.runtime.updateAgent);
                await workspace.refresh();
              }}
              onSetAgentAvatar={async (agentId, image) => {
                await workspace.runtime.setAvatar(agentId, image);
                await workspace.refresh();
              }}
              onSendMessage={async (text, attachments, replyTo, target) => {
                const id = target?.agentId ?? workspace.state.selectedId;
                if (!id || (target && target.serverId !== server()?.id) || id !== workspace.state.selectedId)
                  return false;
                const sent = await workspace.send(text, attachments, replyTo);
                if (!sent)
                  controller.setComposerErrors((current) => ({
                    ...current,
                    [`${server()?.id}:${id}`]: workspace.state.error ?? "Check the conversation before sending again.",
                  }));
                return sent;
              }}
              onMarkRead={async () => {}}
              onLoadOlder={() => void workspace.older()}
              onLoadLatest={workspace.refresh}
              onSearchMessages={async (query) => {
                const id = workspace.state.selectedId;
                if (!id) return { messageIds: [], total: 0 };
                const result = await workspace.runtime.search(id, query);
                return { messageIds: result.results.map((item) => item.message.id), total: result.total };
              }}
              onOpenSearchMessage={(messageId) => workspace.run(() => workspace.openSearchMessage(messageId))}
              onTypingChange={() => {}}
              onAnswerPrompt={async (answers) => {
                const question = prompt();
                if (!question) return false;
                await workspace.answer({ requestId: question.requestId, answers });
                return true;
              }}
              onRespondToApproval={async (decision) => {
                const item = approval();
                if (!item) return false;
                await workspace.approve({ requestId: item.requestId, decision });
                return true;
              }}
              onAlwaysAllowApproval={alwaysAllowApproval()}
              agentAutoApproves={remoteAgentAdmin.settings()?.autoApprove ?? false}
              agentAutoApproveLocked={remoteAgentAdmin.settings()?.autoApproveLocked ?? false}
              onSetAgentAutoApprove={setAgentAutoApprove()}
              onRespondToBrowserTakeover={(decision) => workspace.respondToBrowserTakeover(decision)}
              onCancelQueuedMessage={() => {}}
              onSteerQueuedMessage={() => {}}
              onUpdateQueuedMessage={unavailable}
              onReorderQueue={() => {}}
              onActivateBrowserTab={workspace.activateBrowserTab}
              onCloseBrowserTab={() => {}}
              onOpenRemoteDesktop={unavailable}
              onStop={() => {
                const page = workspace.conversation()?.page;
                if (page?.activeTurnId)
                  void workspace.run(() => workspace.runtime.stop(page.agentId, page.activeTurnId ?? ""));
              }}
            />
          </Show>
        </div>
        <Show when={joinOpen()}>
          <JoinServerDialog
            inviteUrl=""
            accountEmail={props.accountEmail ?? ""}
            onClose={() => setJoinOpen(false)}
            onPreview={({ inviteUrl }) => workspace.runtime.previewInvite(inviteUrl)}
            onJoin={({ inviteUrl }) => workspace.joinInvite(inviteUrl)}
          />
        </Show>
        <Show when={marketplaceOpen()}>
          <Loading>
            <SkillsMarketplaceModal
              open={true}
              calls={marketplaceCalls}
              agents={manageSkills() ? workspace.state.agents : []}
              activeAgentId={manageSkills() ? (workspace.state.selectedId ?? "") : ""}
              hostServerId={remoteAdminServer(server(), "skills-admin-v1")?.id}
              agentServerId={remoteAdminServer(server(), "agent-install-v1")?.id}
              onOpenChange={setMarketplaceOpen}
              onAgentInstalled={async (agent) => {
                setMarketplaceOpen(false);
                await openAddedAgent(agent);
              }}
              plugins={MARKETPLACE_PLUGINS}
              pluginServerId={
                manageSkills() && serverCanAdminister(server(), MCP_SERVERS_CAPABILITY) ? server()?.id : undefined
              }
              pluginHostName={manageSkills() ? remoteAdminServer(server(), MCP_SERVERS_CAPABILITY)?.name : undefined}
              onTrySkill={
                composerFree()
                  ? (agentId, skill) =>
                      appendMarketplaceExample(agentId, (target) => controller.appendSkillExample(target, skill))
                  : undefined
              }
              onRunPluginPrompt={
                composerFree()
                  ? (agentId, prompt) =>
                      appendMarketplaceExample(agentId, (target) => controller.appendPluginPrompt(target, prompt.text))
                  : undefined
              }
            />
          </Loading>
        </Show>
        <Show when={props.agentTemplateId}>
          {(templateId) => (
            <Loading>
              <AgentTemplateInstall
                templateId={templateId()}
                server={remoteAdminServer(server(), "agent-install-v1")}
                calls={agentTemplateCalls}
                onClose={() => props.onAgentTemplateClose?.()}
                onInstalled={openAddedAgent}
              />
            </Loading>
          )}
        </Show>
        <Show when={serverSettings.state.open && server()}>
          {(target) => (
            <Loading>
              <ServerSettingsModal
                open={serverSettings.state.open}
                onOpenChange={serverSettings.setOpen}
                restoreFocusTarget={serverSettings.restoreTarget()}
                platform="darwin"
                remoteDesktopSupported={false}
                server={target()}
                hostStatus={null}
                members={serverSettings.state.members}
                invites={serverSettings.state.invites}
                loading={serverSettings.state.loading}
                loadError={serverSettings.state.error}
                onRetry={serverSettings.refresh}
                onSaveIdentity={serverSettings.saveIdentity}
                // Publication and screen recording belong to the computer that runs the server.
                onSetPublished={unavailable}
                onCreateInvite={serverSettings.createInvite}
                onUpdateMember={serverSettings.updateMember}
                onRemoveMember={serverSettings.removeMember}
                onRevokeInvite={serverSettings.revokeInvite}
                onOpenScreenRecordingSettings={unavailable}
                onRecheckScreenRecording={unavailable}
                mcpServers={
                  serverCanAdminister(target(), MCP_SERVERS_CAPABILITY) ? serverSettings.state.mcp : undefined
                }
                mcpLoadError={serverSettings.state.mcpError}
                onMcpSectionShown={() => void serverSettings.refreshMcp()}
                onRetryMcpServers={() => void serverSettings.refreshMcp()}
                onSaveMcpServer={serverSettings.saveMcpServer}
                onRemoveMcpServer={serverSettings.removeMcpServer}
                onSetMcpServerEnabled={serverSettings.setMcpServerEnabled}
                onTestMcpServer={serverSettings.testMcpServer}
                storage={
                  serverHasStorage(target())
                    ? {
                        hostName: target().name,
                        canManage: canManageStorage(target()),
                        calls: storageCalls,
                        onOpenAgent: (agentId) => {
                          serverSettings.setOpen(false);
                          setMobilePane("conversation");
                          void select(agentId);
                        },
                        onShowMessage: (agentId, messageId) => {
                          serverSettings.setOpen(false);
                          setMobilePane("conversation");
                          void workspace.run(async () => {
                            await select(agentId);
                            await workspace.openSearchMessage(messageId);
                          });
                        },
                      }
                    : undefined
                }
                providers={providerSettings()}
              />
            </Loading>
          )}
        </Show>
      </div>
    </ConversationControllerProvider>
  );
}
