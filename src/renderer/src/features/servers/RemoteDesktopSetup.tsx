import {
  LOCAL_SERVER_ID,
  REMOTE_DESKTOP_SETUP_CAPABILITY,
  type RemoteDesktopCheckState,
  type RemoteDesktopSession,
  type RemoteDesktopSetupAction,
  type RemoteDesktopSetupStatus,
  type RemoteDesktopTestStatus,
  type ServerSummary,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Alert,
  AlertContent,
  AlertDescription,
  Badge,
  Button,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Text,
} from "@openbot/ui";
import { RemoteDesktopWorkspace } from "@openbot/ui/features/remote-desktop/RemoteDesktopWorkspace";
import { useText } from "@openbot/ui/text";
import { createStore, For, onSettled, Show } from "solid-js";
import { serverSupportsCapability } from "./server-capabilities";
import { serversPort } from "./servers-port";

const CHECKS = [
  ["screenRecording", "remoteDesktop.setup.check.screenRecording"],
  ["accessibility", "remoteDesktop.setup.check.accessibility"],
  ["service", "remoteDesktop.setup.check.service"],
  ["displays", "remoteDesktop.setup.check.displays"],
  ["guiSession", "remoteDesktop.setup.check.guiSession"],
] as const satisfies readonly (readonly [string, AppTextKey])[];
const LABELS = {
  "not-checked": "remoteDesktop.setup.state.notChecked",
  checking: "remoteDesktop.setup.state.checking",
  allowed: "remoteDesktop.setup.state.allowed",
  blocked: "remoteDesktop.setup.state.blocked",
  unavailable: "remoteDesktop.setup.state.unavailable",
  failed: "remoteDesktop.setup.state.failed",
} as const satisfies Record<RemoteDesktopCheckState, AppTextKey>;

interface SetupState {
  result: RemoteDesktopSetupStatus | null;
  checking: boolean;
  checkFailed: boolean;
  busy: boolean;
  error: string | null;
  session: RemoteDesktopSession | null;
  test: RemoteDesktopTestStatus | null;
  videoOnly: boolean;
  video: boolean;
  picture: boolean;
}

export function RemoteDesktopSetup(props: { server: ServerSummary; platform: "darwin" | "win32" | "linux" }) {
  const { t, format, errorMessage, sourceText } = useText();
  const [state, setState] = createStore<SetupState>({
    result: null,
    checking: false,
    checkFailed: false,
    busy: false,
    error: null,
    session: null,
    test: null,
    videoOnly: false,
    video: false,
    picture: false,
  });
  const local = () => props.server.id === LOCAL_SERVER_ID;
  const supported = () => local() || serverSupportsCapability(props.server, REMOTE_DESKTOP_SETUP_CAPABILITY);
  let disposed = false;
  let returnFromSettings = false;
  let polling = false;
  let testMount: HTMLDivElement | undefined;
  let ownedSession: RemoteDesktopSession | null = null;

  async function check(preserveError = false) {
    if (state.checking || !supported()) return;
    setState((draft) => {
      draft.checking = true;
      draft.checkFailed = false;
      if (!preserveError) draft.error = null;
    });
    try {
      const result = await serversPort().remoteDesktop.checkSetup(props.server.id);
      if (!disposed)
        setState((draft) => {
          Object.assign(draft, { result });
        });
    } catch (error) {
      if (!disposed)
        setState((draft) => {
          Object.assign(draft, {
            result: null,
            checkFailed: true,
            error: errorMessage(error, t("remoteDesktop.setup.checkFailed")),
          });
        });
    } finally {
      if (!disposed)
        setState((draft) => {
          Object.assign(draft, { checking: false });
        });
    }
  }

  async function open(action: RemoteDesktopSetupAction) {
    if (!local() || state.busy) return;
    setState((draft) => {
      Object.assign(draft, { busy: true, error: null });
    });
    try {
      returnFromSettings = action !== "reveal";
      await serversPort().remoteDesktop.openSetup(action);
    } catch (error) {
      setState((draft) => {
        Object.assign(draft, { error: errorMessage(error, t("remoteDesktop.setup.openFailed")) });
      });
    } finally {
      setState((draft) => {
        Object.assign(draft, { busy: false });
      });
    }
  }

  async function release(session: RemoteDesktopSession) {
    // Disconnect also removes a host panel when a stop request cannot reach the host.
    try {
      if (!state.videoOnly)
        await serversPort().remoteDesktop.test({ serverId: session.serverId, sessionId: session.id, action: "stop" });
    } finally {
      await serversPort().remoteDesktop.disconnect(session.id);
    }
  }

  async function finish() {
    const session = ownedSession;
    ownedSession = null;
    if (!disposed)
      setState((draft) => {
        draft.session = null;
        if (draft.test) draft.test.active = false;
      });
    if (session) {
      try {
        await release(session);
      } catch (error) {
        if (!disposed)
          setState((draft) => {
            Object.assign(draft, {
              error: errorMessage(error, t("remoteDesktop.setup.cleanupUnconfirmed")),
            });
          });
      }
    }
    if (!disposed) await check(true);
  }

  async function start() {
    if (state.busy || state.session) return;
    setState((draft) => {
      Object.assign(draft, {
        busy: true,
        error: null,
        test: null,
        videoOnly: local() && !canTest(),
        video: false,
        picture: false,
      });
    });
    try {
      const sessions = await serversPort().remoteDesktop.list();
      if (sessions.some((session) => session.serverId === props.server.id))
        throw new Error(t("remoteDesktop.setup.endSessionFirst"));
      const connection = await serversPort().remoteDesktop.connect({ serverId: props.server.id });
      if (connection.status !== "connected") throw new Error(connection.message);
      ownedSession = connection.session;
      if (disposed) {
        await release(connection.session);
        ownedSession = null;
        return;
      }
      const test = state.videoOnly
        ? null
        : await serversPort().remoteDesktop.test({
            serverId: props.server.id,
            sessionId: connection.session.id,
            action: "start",
          });
      if (disposed) {
        await release(connection.session);
        ownedSession = null;
        return;
      }
      setState((draft) => {
        Object.assign(draft, { session: connection.session, test });
      });
    } catch (error) {
      if (ownedSession) await finish();
      if (!disposed)
        setState((draft) => {
          Object.assign(draft, { error: errorMessage(error, t("remoteDesktop.setup.startFailed")) });
        });
    } finally {
      if (!disposed)
        setState((draft) => {
          Object.assign(draft, { busy: false });
        });
    }
  }

  async function poll() {
    const session = state.session;
    if (!session || polling || state.videoOnly) return;
    polling = true;
    try {
      const test = await serversPort().remoteDesktop.test({
        serverId: props.server.id,
        sessionId: session.id,
        action: "status",
      });
      if (disposed || ownedSession?.id !== session.id) return;
      setState((draft) => {
        Object.assign(draft, { test });
      });
      if (!test.active) await finish();
    } catch (error) {
      if (!disposed && ownedSession?.id === session.id) {
        setState((draft) => {
          Object.assign(draft, { error: errorMessage(error, t("remoteDesktop.setup.connectionLost")) });
        });
        await finish();
      }
    } finally {
      polling = false;
    }
  }

  onSettled(() => {
    const focus = () => {
      if (returnFromSettings) {
        returnFromSettings = false;
        void check();
      }
    };
    window.addEventListener("focus", focus);
    const interval = window.setInterval(() => void poll(), 1000);
    return () => {
      disposed = true;
      window.removeEventListener("focus", focus);
      window.clearInterval(interval);
      const session = ownedSession;
      ownedSession = null;
      if (session) void release(session).catch(() => undefined);
    };
  });

  const canTest = () =>
    state.result?.platform === "darwin" &&
    CHECKS.every(([key]) => state.result?.[key] === "allowed") &&
    !state.result.restartRequired;

  return (
    <Show when={supported()} fallback={<Text>{t("remoteDesktop.setup.hostUpdateRequired")}</Text>}>
      <Show when={!local() || props.platform === "darwin"}>
        <ItemGroup class="settings-modal-card">
          <Item>
            <ItemContent>
              <ItemTitle>{t("remoteDesktop.setup.permissions")}</ItemTitle>
              <ItemDescription>
                {state.result ? `${state.result.hostName} · ${state.result.username}` : props.server.name}
                <Show when={state.result?.checkedAt}>
                  {" · "}
                  {t("remoteDesktop.setup.checked")}{" "}
                  <time
                    datetime={state.result?.checkedAt ?? undefined}
                    title={format.date(new Date(state.result?.checkedAt ?? ""), {
                      year: "numeric",
                      month: "numeric",
                      day: "numeric",
                      hour: "numeric",
                      minute: "numeric",
                      second: "numeric",
                    })}
                  >
                    {format.date(new Date(state.result?.checkedAt ?? ""), {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </Show>
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button
                size="sm"
                variant="outline"
                loading={state.checking}
                disabled={state.busy || Boolean(state.session)}
                onClick={() => void check()}
              >
                {t("remoteDesktop.setup.checkAgain")}
              </Button>
            </ItemActions>
          </Item>
          <For each={CHECKS}>
            {([key, label]) => {
              const status = () =>
                state.checking ? "checking" : state.checkFailed ? "failed" : (state.result?.[key] ?? "not-checked");
              return (
                <Item>
                  <ItemContent>
                    <ItemTitle>{t(label)}</ItemTitle>
                  </ItemContent>
                  <ItemActions>
                    <Badge tone={status() === "allowed" ? "success" : "warning"}>
                      {status() === "allowed" && key !== "screenRecording" && key !== "accessibility"
                        ? t("remoteDesktop.setup.state.available")
                        : t(LABELS[status()])}
                    </Badge>
                    <Show when={local() && (key === "screenRecording" || key === "accessibility")}>
                      <Button
                        size="sm"
                        variant="default"
                        aria-label={t("remoteDesktop.setup.grantAccess", { name: t(label) })}
                        disabled={state.busy}
                        onClick={() => void open(key === "screenRecording" ? "screen-recording" : "accessibility")}
                      >
                        {t("remoteDesktop.setup.grant")}
                      </Button>
                    </Show>
                  </ItemActions>
                </Item>
              );
            }}
          </For>
          <Item>
            <ItemContent>
              <ItemDescription>{t("remoteDesktop.setup.grantHelp")}</ItemDescription>
              <Show when={state.result?.restartRequired}>
                <ItemDescription>{t("remoteDesktop.setup.restartRequired")}</ItemDescription>
              </Show>
              <Show when={state.result?.message}>
                <ItemDescription>{sourceText(state.result?.message ?? "")}</ItemDescription>
              </Show>
            </ItemContent>
            <Show when={local()}>
              <ItemActions>
                <Button size="sm" variant="ghost" disabled={state.busy} onClick={() => void open("reveal")}>
                  {t("remoteDesktop.setup.showInFinder")}
                </Button>
              </ItemActions>
            </Show>
          </Item>
          <Item>
            <ItemContent>
              <ItemTitle>{t("remoteDesktop.setup.liveTest")}</ItemTitle>
              <ItemDescription>
                {local() ? t("remoteDesktop.setup.liveTestLocal") : t("remoteDesktop.setup.liveTestRemote")}
              </ItemDescription>
              <Show when={state.test || state.videoOnly}>
                <ItemDescription>
                  {t("remoteDesktop.setup.testSummary", {
                    video: t(state.video ? "remoteDesktop.setup.received" : "remoteDesktop.setup.notReceived"),
                    picture: t(state.picture ? "remoteDesktop.setup.confirmed" : "remoteDesktop.setup.notConfirmed"),
                    mouse: t(
                      state.videoOnly
                        ? "remoteDesktop.setup.notTested"
                        : state.test?.mouse
                          ? "remoteDesktop.setup.received"
                          : "remoteDesktop.setup.notReceived",
                    ),
                    keyboard: t(
                      state.videoOnly
                        ? "remoteDesktop.setup.notTested"
                        : state.test?.keyboard
                          ? "remoteDesktop.setup.received"
                          : "remoteDesktop.setup.notReceived",
                    ),
                  })}
                </ItemDescription>
              </Show>
            </ItemContent>
            <ItemActions>
              <Button
                size="sm"
                variant="outline"
                disabled={(!local() && !canTest()) || state.checking}
                loading={state.busy}
                onClick={() => void start()}
              >
                {local() ? t("remoteDesktop.setup.testLocal") : t("remoteDesktop.setup.testRemote")}
              </Button>
            </ItemActions>
          </Item>
        </ItemGroup>
        <Show when={state.error}>
          <Alert tone="warning" role="alert">
            <AlertContent>
              <AlertDescription>{state.error}</AlertDescription>
            </AlertContent>
          </Alert>
        </Show>
        <div ref={testMount} />
        <Show when={state.session}>
          {(session) => (
            <RemoteDesktopWorkspace
              mount={testMount}
              viewOnly={state.videoOnly}
              visible
              platform={props.platform}
              server={props.server}
              session={session()}
              connecting={false}
              connectionError={null}
              connectionErrorCode={null}
              onHide={() => void finish()}
              onDisconnect={finish}
              onRetry={finish}
              onSelectDisplay={async () => {}}
              onViewerState={(value) => {
                if (value === "connected")
                  setState((draft) => {
                    Object.assign(draft, { video: true });
                  });
                if (value === "error") {
                  setState((draft) => {
                    Object.assign(draft, { error: t("remoteDesktop.setup.videoFailed") });
                  });
                  void finish();
                }
              }}
              testControls={
                <>
                  <Show
                    when={state.videoOnly}
                    fallback={
                      <Text>
                        {t("remoteDesktop.setup.inputInstructions", {
                          code: state.test?.code ?? "",
                          mouse: t(state.test?.mouse ? "remoteDesktop.setup.received" : "remoteDesktop.setup.waiting"),
                          keyboard: t(
                            state.test?.keyboard ? "remoteDesktop.setup.received" : "remoteDesktop.setup.waiting",
                          ),
                        })}
                      </Text>
                    }
                  >
                    <Text>{t("remoteDesktop.setup.videoOnly")}</Text>
                  </Show>
                  <Button
                    size="sm"
                    disabled={!state.video || state.picture}
                    onClick={() =>
                      setState((draft) => {
                        Object.assign(draft, { picture: true });
                      })
                    }
                  >
                    {state.picture
                      ? t("remoteDesktop.setup.pictureConfirmed")
                      : state.videoOnly
                        ? t("remoteDesktop.setup.seeDesktop")
                        : t("remoteDesktop.setup.seeTestPanel")}
                  </Button>
                  <Button size="sm" onClick={() => void finish()}>
                    {t("remoteDesktop.setup.finishTest")}
                  </Button>
                </>
              }
            />
          )}
        </Show>
      </Show>
    </Show>
  );
}
