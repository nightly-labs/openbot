import type { CentralAuthState } from "@openbot/contracts/ipc";
import {
  CLIENT_BROWSER_CAPABILITY,
  type ClientBrowserPresence,
} from "@openbot/contracts/team-protocol/client-browser-v1";
import { sourceText } from "@openbot/i18n";
import type { RemoteTeamHost } from "@openbot/team-client/remote-directory";
import { useText } from "@openbot/ui/text";
import { createSignal, createStore, Match, onSettled, Show, Switch } from "solid-js";
import { AgentSettingsScreen } from "./AgentSettingsScreen";
import {
  endSession,
  readAccount,
  SignInIssue,
  saveAnalyticsAnswer,
  signInOutcome,
  startEmailSignIn,
  verifyEmailCode,
} from "./account";
import { identify, type SignInMethod, track } from "./analytics";
import { BrowserAsks, BrowserSharingScreen } from "./BrowserSharing";
import { ChannelScreen } from "./ChannelScreen";
import { ChatScreen } from "./ChatScreen";
import { type ClientBrowserLink, createClientBrowserLink } from "./client-browser-link";
import {
  clearSession,
  type ExtensionSession,
  readServerId,
  readSession,
  saveServerId,
  saveSession,
  takeChatToOpen,
} from "./extension-storage";
import { HomeScreen } from "./HomeScreen";
import { createHostConnection, type HostConnection } from "./host-connection";
import { NewAgentScreen } from "./NewAgentScreen";
import { NewChannelScreen, NewFolderScreen } from "./NewChatItemScreens";
import { SettingsScreen } from "./SettingsScreen";
import { SignInScreen } from "./SignInScreen";
import { createWorkspace, type Workspace } from "./workspace";
import { type XTarget, xSend, xStatus } from "./x-agent";
import {
  decodeXRequest,
  OPEN_X_CHAT_MESSAGE,
  OUTBOX_FLUSH_MESSAGE,
  PANEL_PORT,
  X_PANEL_MESSAGE,
  type XSendResult,
  type XStatusAnswer,
} from "./x-messages";

const EMAIL_START_KEY_LIFE_MS = 10 * 60_000;

export function App() {
  const [session, setSession] = createSignal<ExtensionSession | null>(null);
  const [login, setLogin] = createSignal<CentralAuthState>({ status: "loading" });
  let emailStart: { email: string; key: string; at: number } | null = null;
  let openTracked = false;

  function trackOpened(signedIn: boolean) {
    if (openTracked) return;
    openTracked = true;
    void track("extension_opened", { signed_in: signedIn });
  }

  async function signedIn(next: ExtensionSession, method: SignInMethod) {
    await saveSession(next);
    setSession(next);
    void track("account_sign_in_completed", { method, result: "succeeded" });
    void identify(next);
  }

  async function checkSession() {
    setLogin({ status: "loading" });
    const saved = await readSession();
    if (!saved) {
      setLogin({ status: "signed_out" });
      trackOpened(false);
      return;
    }
    try {
      const user = await readAccount(saved.token);
      if (!user) {
        await clearSession();
        setLogin({ status: "signed_out" });
        trackOpened(false);
        return;
      }
      const current = { token: saved.token, user };
      await saveSession(current);
      setSession(current);
      trackOpened(true);
      void identify(current);
    } catch {
      setLogin({
        status: "error",
        issue: { code: "auth_api_unavailable", message: sourceText("error.auth.serviceUnavailable") },
      });
    }
  }
  onSettled(() => {
    void checkSession();
  });

  function showIssue(error: unknown): void {
    if (!(error instanceof SignInIssue)) throw error;
    const issue = error.issue;
    const current = login();
    setLogin(current.status === "code_sent" ? { ...current, issue } : { status: "error", issue });
  }

  async function requestCode(email: string) {
    const attempt =
      emailStart?.email === email && Date.now() - emailStart.at < EMAIL_START_KEY_LIFE_MS
        ? emailStart
        : { email, key: crypto.randomUUID(), at: Date.now() };
    emailStart = attempt;
    try {
      const challenge = await startEmailSignIn(email, attempt.key);
      emailStart = null;
      setLogin({
        status: "code_sent",
        challengeId: challenge.challengeId,
        email,
        expiresAt: challenge.expiresAt,
        resendAvailableAt: challenge.resendAt,
        ...(challenge.developmentCode ? { developmentCode: challenge.developmentCode } : {}),
      });
    } catch (error) {
      showIssue(error);
    }
  }

  async function verify(challengeId: string, code: string, referralCode?: string) {
    try {
      await signedIn(await verifyEmailCode(challengeId, code, referralCode), "email");
    } catch (error) {
      void track("account_sign_in_completed", { method: "email", ...signInOutcome(error) });
      showIssue(error);
    }
  }

  async function signOut(reason: "user" | "session_ended") {
    const current = session();
    await track("account_sign_out", { reason });
    setSession(null);
    setLogin({ status: "signed_out" });
    await clearSession();
    if (current) await endSession(current.token);
  }

  return (
    <main class="ext-app">
      <Show
        when={session()}
        keyed
        fallback={
          <div class="ext-login">
            <SignInScreen
              login={login()}
              onRetry={checkSession}
              onRequestEmailCode={requestCode}
              onVerifyEmailCode={verify}
              onReset={async () => {
                emailStart = null;
                setLogin({ status: "signed_out" });
              }}
              onSignedIn={(next) => signedIn(next, "web")}
            />
          </div>
        }
      >
        {(current) => (
          <ServerView
            session={current}
            onSignOut={() => void signOut("user")}
            onSessionEnded={() => void signOut("session_ended")}
          />
        )}
      </Show>
    </main>
  );
}

type PushedScreen =
  | { kind: "chat" | "channel" | "new-agent" | "new-channel" | "new-folder" | "browser-sharing" | "settings" }
  | { kind: "agent-settings"; agentId: string };

interface ServerState {
  hosts: RemoteTeamHost[];
  hostId: string | null;
  status: "listing" | "connecting" | "ready" | "failed" | "empty";
  message: string | null;
  offline: boolean;
}

function ServerView(props: { session: ExtensionSession; onSignOut: () => void; onSessionEnded: () => void }) {
  const { t } = useText();
  const [view, setView] = createStore<ServerState>({
    hosts: [],
    hostId: null,
    status: "listing",
    message: null,
    offline: false,
  });
  const [workspace, setWorkspace] = createSignal<Workspace | null>(null);
  const [pushed, setPushed] = createSignal(false);
  const [screen, setScreen] = createSignal<PushedScreen>({ kind: "chat" });
  let connection: HostConnection | null = null;
  let capabilities: readonly string[] = [];
  let attempt = 0;
  let browserLink: ClientBrowserLink | null = null;
  const [presence, setPresence] = createSignal<ClientBrowserPresence>({ sharing: false, tabs: [] });
  const [canShare, setCanShare] = createSignal(false);

  const host = () => view.hosts.find((entry) => entry.hostId === view.hostId) ?? null;

  async function open(hostId: string) {
    const current = ++attempt;
    const target = view.hosts.find((entry) => entry.hostId === hostId);
    if (!target || !connection) return;
    workspace()?.dispose();
    setWorkspace(null);
    browserLink?.dispose();
    browserLink = null;
    setPushed(false);
    setView((draft) => {
      draft.hostId = hostId;
      draft.status = "connecting";
      draft.message = null;
      draft.offline = false;
    });
    void saveServerId(hostId);
    try {
      const granted = await connection.connect(target);
      if (current !== attempt) return;
      capabilities = granted;
      setCanShare(granted.includes(CLIENT_BROWSER_CAPABILITY));
      browserLink = createClientBrowserLink({
        request: connection.request,
        capabilities: granted,
        onPresence: setPresence,
      });
      const next = createWorkspace(connection.request, granted, connection.download, connection.transcribe);
      setWorkspace(() => next);
      setView((draft) => {
        draft.status = "ready";
      });
      await next.load();
      if (current !== attempt) return;
      void chrome.runtime.sendMessage({ kind: OUTBOX_FLUSH_MESSAGE }).catch(() => undefined);
      await openChatFromX();
    } catch (error) {
      if (current !== attempt) return;
      setView((draft) => {
        draft.status = "failed";
        draft.message =
          error instanceof Error ? error.message : t("extension.connection.offline", { server: target.name });
      });
    }
  }

  async function start() {
    try {
      connection = await createHostConnection(props.session, {
        event: (event) => {
          browserLink?.handleEvent(event);
          workspace()?.handleEvent(event);
        },
        state: (update) => {
          if (update.hostId !== view.hostId) return;
          setView((draft) => {
            draft.offline = update.state === "offline";
          });
          if (update.state !== "online") return;
          void workspace()?.reloadChat();
          browserLink?.refresh();
        },
        sessionEnded: props.onSessionEnded,
      });
      const hosts = await connection.listHosts();
      setView((draft) => {
        draft.hosts = hosts;
        draft.status = hosts.length ? "connecting" : "empty";
      });
      if (!hosts.length) return;
      const saved = await readServerId();
      await open(hosts.some((entry) => entry.hostId === saved) && saved ? saved : (hosts[0]?.hostId ?? ""));
    } catch (error) {
      setView((draft) => {
        draft.status = "failed";
        draft.message = error instanceof Error ? error.message : t("extension.connection.requestFailed");
      });
    }
  }

  async function openChatFromX() {
    const chat = await takeChatToOpen();
    if (!chat) return;
    if (chat.hostId === view.hostId && workspace()) openAgent(chat.agentId, chat.taskId);
  }

  function xTarget(): XTarget | null {
    if (view.status !== "ready" || !connection || !view.hostId) return null;
    return { hostId: view.hostId, request: connection.request, capabilities };
  }

  onSettled(() => {
    void start();
    let closed = false;
    let port: chrome.runtime.Port | null = null;
    const holdPort = () => {
      if (closed) return;
      port = chrome.runtime.connect({ name: PANEL_PORT });
      port.onMessage.addListener((message: unknown) => {
        if (message === OPEN_X_CHAT_MESSAGE && view.status === "ready") void openChatFromX();
      });
      port.onDisconnect.addListener(() => window.setTimeout(holdPort, 1_000));
    };
    holdPort();
    const fromX = (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: XStatusAnswer | XSendResult) => void,
    ) => {
      const request = decodeXRequest(message, X_PANEL_MESSAGE);
      if (!request || sender.tab || request.action === "rules") return undefined;
      const target = xTarget();
      const work: Promise<XStatusAnswer | XSendResult> =
        request.action === "status"
          ? target
            ? xStatus(target)
            : Promise.resolve({ ready: false, reason: "panel-connecting" })
          : target
            ? xSend(target, request.payload, request.clientMessageId ?? crypto.randomUUID())
            : Promise.resolve({
                ok: false,
                error: t("extension.connection.connecting", { server: host()?.name ?? "" }),
                reached: false,
              });
      void work.then(sendResponse, () =>
        sendResponse({ ok: false, error: t("extension.chat.sendFailed"), reached: true }),
      );
      return true;
    };
    chrome.runtime.onMessage.addListener(fromX);
    const leave = () => void connection?.dispose();
    window.addEventListener("pagehide", leave);
    return () => {
      chrome.runtime.onMessage.removeListener(fromX);
      closed = true;
      port?.disconnect();
      window.removeEventListener("pagehide", leave);
      browserLink?.dispose();
      workspace()?.dispose();
      void connection?.dispose();
    };
  });

  function push(kind: Exclude<PushedScreen["kind"], "agent-settings">) {
    setScreen({ kind });
    setPushed(true);
  }
  function openAgent(agentId: string, taskId: string | null = null) {
    workspace()?.openChat(agentId, taskId);
    if (screen().kind !== "chat" || !pushed()) push("chat");
  }
  function openChannel(channelId: string) {
    workspace()?.openChannel(channelId);
    push("channel");
  }
  function startThread(agentId: string, text: string) {
    const current = workspace();
    if (!current) return;
    if (current.threadsAvailable()) current.newThread(agentId);
    else current.openChat(agentId, null);
    push("chat");
    void current.send(text).catch(() => undefined);
  }
  function back() {
    setPushed(false);
  }

  return (
    <>
      <Switch>
        <Match when={view.status === "empty"}>
          <p class="ext-state">{t("extension.connection.noServers")}</p>
        </Match>
        <Match when={view.status === "failed"}>
          <div class="ext-state">
            <p>{view.message}</p>
            <button type="button" class="ext-text-button" onClick={() => (view.hostId ? open(view.hostId) : start())}>
              {t("common.retry")}
            </button>
            <button type="button" class="ext-text-button" onClick={() => props.onSignOut()}>
              {t("extension.home.signOut")}
            </button>
          </div>
        </Match>
        <Match when={workspace()}>
          {(current) => (
            <div class="ext-stack" data-pushed={pushed() ? "" : undefined}>
              <section class="ext-layer ext-home" inert={pushed()}>
                <HomeScreen
                  workspace={current()}
                  serverName={host()?.name ?? ""}
                  hosts={view.hosts}
                  hostId={view.hostId}
                  offline={view.offline}
                  onOpenAgent={(agentId) => openAgent(agentId)}
                  onOpenChannel={openChannel}
                  onCreate={(kind) =>
                    push(kind === "agent" ? "new-agent" : kind === "channel" ? "new-channel" : "new-folder")
                  }
                  onStartThread={startThread}
                  onSelectHost={(hostId) => void open(hostId)}
                  onSignOut={() => props.onSignOut()}
                  onOpenSettings={() => push("settings")}
                  sharing={presence().sharing}
                  canShare={canShare()}
                />
              </section>
              <section class="ext-layer ext-chat-layer" inert={!pushed()}>
                <Show when={screen()} keyed>
                  {(shown) => (
                    <Switch>
                      <Match when={shown.kind === "new-agent"}>
                        <NewAgentScreen
                          workspace={current()}
                          onClose={back}
                          onCreated={(agentId) => openAgent(agentId)}
                        />
                      </Match>
                      <Match when={shown.kind === "new-channel"}>
                        <NewChannelScreen workspace={current()} onClose={back} onCreated={openChannel} />
                      </Match>
                      <Match when={shown.kind === "browser-sharing"}>
                        <BrowserSharingScreen onBack={() => push("settings")} />
                      </Match>
                      <Match when={shown.kind === "settings"}>
                        <SettingsScreen
                          sharing={presence().sharing}
                          onBack={back}
                          onAnalyticsChanged={(enabled) => void saveAnalyticsAnswer(props.session.token, enabled)}
                          onOpenSharedTabs={() => push("browser-sharing")}
                        />
                      </Match>
                      <Match when={shown.kind === "new-folder"}>
                        <NewFolderScreen workspace={current()} onClose={back} onCreated={back} />
                      </Match>
                      <Match when={shown.kind === "agent-settings" ? shown.agentId : undefined}>
                        {(agentId) => (
                          <AgentSettingsScreen
                            workspace={current()}
                            settings={current().settings}
                            agentId={agentId()}
                            onClose={() => push("chat")}
                          />
                        )}
                      </Match>
                      <Match when={shown.kind === "channel"}>
                        <ChannelScreen
                          workspace={current()}
                          onBack={back}
                          onOpenAgent={(agentId) => openAgent(agentId)}
                        />
                      </Match>
                      <Match when={current().state.chat}>
                        <ChatScreen
                          workspace={current()}
                          onBack={back}
                          onOpenSettings={(agentId) => setScreen({ kind: "agent-settings", agentId })}
                          onOpen={(agentId, taskId) => openAgent(agentId, taskId)}
                        />
                      </Match>
                    </Switch>
                  )}
                </Show>
              </section>
            </div>
          )}
        </Match>
        <Match when={true}>
          <p class="ext-state" aria-live="polite">
            {host() ? t("extension.connection.connecting", { server: host()?.name ?? "" }) : null}
          </p>
        </Match>
      </Switch>
      <BrowserAsks />
    </>
  );
}
