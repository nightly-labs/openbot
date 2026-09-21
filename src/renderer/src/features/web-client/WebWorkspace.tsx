import type { AccountUsage, AgentEvent, AgentModelOption, AgentStatus, ServerSummary } from "@openbot/contracts/ipc";
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
import { JoinServerDialog } from "@openbot/ui/features/servers/JoinServerDialog";
import { ServerRail } from "@openbot/ui/features/servers/ServerRail";
import { Sidebar } from "@openbot/ui/features/sidebar/Sidebar";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import { toAgentMessage } from "../../app-message-projection";
import { computeAgentAvatarMoods } from "../agents/agent-avatar-mood";
import { Conversation, createConversationController } from "../conversation/Conversation";
import { ConversationControllerProvider } from "../conversation/conversation-controller-context";
import { computeSidebarAgentStates } from "../sidebar/sidebar-agent-states";
import { WebAgentSettings } from "./WebAgentSettings";
import { WebMobileNavigation, type WebMobilePane } from "./WebMobileNavigation";
import { createWebWorkspace, type WebRuntimeFactory } from "./web-client-context";
import { createWebConversationRuntime } from "./web-conversation-runtime";

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
  accountFetch: typeof fetch;
  onSessionCheck: () => Promise<void>;
  onLogout: () => Promise<void>;
  createRuntime?: WebRuntimeFactory;
}) {
  const workspace = createWebWorkspace(props);
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
  const runtime = createWebConversationRuntime(workspace.runtime, () => workspace.state.host?.hostId ?? "");
  const [accountUsage, setAccountUsage] = createSignal<AccountUsage | null>(null);
  let usageGeneration = 0;
  const [models, setModels] = createSignal<AgentModelOption[]>([]);
  const [status, setStatus] = createSignal<AgentStatus>(CONNECTING_STATUS);
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
  }));
  const sidebarAgentStates = createMemo(() => computeSidebarAgentStates(sidebarActivity()));
  const sidebarAgentMoods = createMemo(() =>
    computeAgentAvatarMoods({
      ...sidebarActivity(),
      failedTurns: {},
      pendingPrompts: Object.fromEntries(workspace.state.prompts.map((prompt) => [prompt.agentId, prompt])),
      pendingApprovals: Object.fromEntries(workspace.state.approvals.map((approval) => [approval.agentId, approval])),
    }),
  );
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
      setModels([]);
      setStatus(CONNECTING_STATUS);
      if (host && state === "online") {
        void workspace.run(async () => {
          const nextStatus = await workspace.runtime.status();
          const nextModels = await workspace.runtime.models();
          if (active) {
            setStatus(nextStatus);
            setModels(nextModels);
          }
        });
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
        />
        <Sidebar
          serverName={workspace.state.host?.name ?? "OpenBot"}
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
          marketplaceSupported={false}
          onDeleteAgent={workspace.deleteAgent}
          compact={false}
          onExpand={() => {}}
          onOpenMarketplace={() => {}}
        />
        <AccountDock
          remoteClient
          account={{ id: props.accountId, email: props.accountEmail ?? "", name: null, avatarUrl: null }}
          appInfo={{ name: "OpenBot", version: "web", platform: "darwin", variant: "production" }}
          agentStatus={status()}
          accountUsage={accountUsage()}
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
              agent={workspace.selected()}
              agents={workspace.profiles()}
              modelOptions={models()}
              messages={messages()}
              unreadCount={0}
              firstUnreadMessageId={null}
              loaded={Boolean(workspace.conversation()?.page)}
              hasOlder={workspace.conversation()?.page?.pageInfo.hasOlder}
              loadingOlder={workspace.conversation()?.loading}
              activeTurnId={workspace.conversation()?.page?.activeTurnId}
              globalOverlayOpen={joinOpen()}
              settingsRequest={settingsRequest()}
              messageFocusRequest={null}
              queue={undefined}
              browserRuntime={workspace.runtime.browser}
              browserTabs={workspace.state.browserTabs}
              activeBrowserTabId={workspace.state.activeBrowserTabId}
              browserVisibilitySuspended={workspace.state.status !== "online"}
              browserControlState={workspace.state.browserControlState}
              server={server()}
              presence={{ serverId: server()?.id ?? null, members: [], updatedAt: "" }}
              currentUserEmail={props.accountEmail ?? ""}
              browserEnabled={browserEnabled()}
              remoteDesktopEnabled={false}
              remoteDesktopSessionActive={false}
              remoteDesktopVisible={false}
              prompt={prompt()}
              approval={workspace.state.approvals.find(
                (item) =>
                  item.agentId === workspace.state.selectedId && item.threadId === workspace.selected()?.threadId,
              )}
              browserTakeover={browserTakeover()}
              onSelectAgent={(id) => {
                setMobilePane("conversation");
                void select(id);
              }}
              onUpdateAgent={async (agentId, updates) => {
                await workspace.runtime.updateAgent({ agentId, ...updates });
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
                const item = workspace.state.approvals.find(
                  (approval) => approval.agentId === workspace.state.selectedId,
                );
                if (!item) return false;
                await workspace.approve({ requestId: item.requestId, decision });
                return true;
              }}
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
      </div>
    </ConversationControllerProvider>
  );
}
