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
import { createStore, For, onSettled, Show } from "solid-js";
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
} from "../../components/ui";
import { errorMessage } from "../../error-message";
import { RemoteDesktopWorkspace } from "../remote-desktop/RemoteDesktopWorkspace";
import { serverSupportsCapability } from "./server-capabilities";

const CHECKS = [
  ["screenRecording", "Screen Recording"],
  ["accessibility", "Accessibility"],
  ["service", "Sunshine service"],
  ["displays", "Display availability"],
  ["guiSession", "macOS user session"],
] as const;
const LABELS: Record<RemoteDesktopCheckState, string> = {
  "not-checked": "Not checked",
  checking: "Checking…",
  allowed: "Allowed",
  blocked: "Blocked",
  unavailable: "Unavailable",
  failed: "Check failed",
};

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
      const result = await window.openbot.remoteDesktop.checkSetup(props.server.id);
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
            error: errorMessage(error, "Could not check remote desktop setup."),
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
      await window.openbot.remoteDesktop.openSetup(action);
    } catch (error) {
      setState((draft) => {
        Object.assign(draft, { error: errorMessage(error, "Could not open macOS setup.") });
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
        await window.openbot.remoteDesktop.test({ serverId: session.serverId, sessionId: session.id, action: "stop" });
    } finally {
      await window.openbot.remoteDesktop.disconnect(session.id);
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
              error: errorMessage(error, "The test connection ended before cleanup was confirmed."),
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
      const sessions = await window.openbot.remoteDesktop.list();
      if (sessions.some((session) => session.serverId === props.server.id))
        throw new Error("End this computer's remote desktop session before you start a test.");
      const connection = await window.openbot.remoteDesktop.connect({ serverId: props.server.id });
      if (connection.status !== "connected") throw new Error(connection.message);
      ownedSession = connection.session;
      if (disposed) {
        await release(connection.session);
        ownedSession = null;
        return;
      }
      const test = state.videoOnly
        ? null
        : await window.openbot.remoteDesktop.test({
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
          Object.assign(draft, { error: errorMessage(error, "Could not start the remote desktop test.") });
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
      const test = await window.openbot.remoteDesktop.test({
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
          Object.assign(draft, { error: errorMessage(error, "The test connection was lost.") });
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
    <Show
      when={supported()}
      fallback={<Text>Update OpenBot on the host to check permissions and test remote desktop.</Text>}
    >
      <Show when={!local() || props.platform === "darwin"}>
        <ItemGroup class="settings-modal-card">
          <Item>
            <ItemContent>
              <ItemTitle>Permissions</ItemTitle>
              <ItemDescription>
                {state.result ? `${state.result.hostName} · ${state.result.username}` : props.server.name}
                <Show when={state.result?.checkedAt}>
                  {" · Checked "}
                  <time
                    datetime={state.result?.checkedAt ?? undefined}
                    title={new Date(state.result?.checkedAt ?? "").toLocaleString()}
                  >
                    {new Date(state.result?.checkedAt ?? "").toLocaleTimeString([], {
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
                Check again
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
                    <ItemTitle>{label}</ItemTitle>
                  </ItemContent>
                  <ItemActions>
                    <Badge tone={status() === "allowed" ? "success" : "warning"}>
                      {status() === "allowed" && key !== "screenRecording" && key !== "accessibility"
                        ? "Available"
                        : LABELS[status()]}
                    </Badge>
                    <Show when={local() && (key === "screenRecording" || key === "accessibility")}>
                      <Button
                        size="sm"
                        variant="default"
                        aria-label={`Grant ${label} access`}
                        disabled={state.busy}
                        onClick={() => void open(key === "screenRecording" ? "screen-recording" : "accessibility")}
                      >
                        Grant
                      </Button>
                    </Show>
                  </ItemActions>
                </Item>
              );
            }}
          </For>
          <Item>
            <ItemContent>
              <ItemDescription>
                Keep the Sunshine account logged in on the Mac. In that account, grant access in System Settings →
                Privacy &amp; Security. Grant opens a helper window. Drag Sunshine.app into the permission list.
              </ItemDescription>
              <Show when={state.result?.restartRequired}>
                <ItemDescription>
                  Sunshine needs a restart. End active remote desktop sessions, then check again. Active sessions will
                  not be restarted.
                </ItemDescription>
              </Show>
              <Show when={state.result?.message}>
                <ItemDescription>{state.result?.message}</ItemDescription>
              </Show>
            </ItemContent>
            <Show when={local()}>
              <ItemActions>
                <Button size="sm" variant="ghost" disabled={state.busy} onClick={() => void open("reveal")}>
                  Show Sunshine in Finder
                </Button>
              </ItemActions>
            </Show>
          </Item>
          <Item>
            <ItemContent>
              <ItemTitle>Live connection test</ItemTitle>
              <ItemDescription>
                {local()
                  ? "Test the picture, mouse, and keyboard on this Mac."
                  : "The test opens a temporary panel on the host. Other remote sessions must end first. Input stays inside the panel."}
              </ItemDescription>
              <Show when={state.test || state.videoOnly}>
                <ItemDescription>
                  Video: {state.video ? "received" : "not received"} · Picture:{" "}
                  {state.picture ? "confirmed" : "not confirmed"} · Mouse:{" "}
                  {state.videoOnly ? "not tested" : state.test?.mouse ? "received" : "not received"} · Keyboard:{" "}
                  {state.videoOnly ? "not tested" : state.test?.keyboard ? "received" : "not received"}
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
                {local() ? "Test on this Mac" : "Test remote desktop"}
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
                    Object.assign(draft, { error: "The test video connection failed." });
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
                        Click the host target, then type {state.test?.code}. Mouse:{" "}
                        {state.test?.mouse ? "received" : "waiting"}. Keyboard:{" "}
                        {state.test?.keyboard ? "received" : "waiting"}.
                      </Text>
                    }
                  >
                    <Text>Video test only. Mouse and keyboard testing needs the updated Sunshine runtime.</Text>
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
                      ? "Picture confirmed"
                      : state.videoOnly
                        ? "I can see my desktop"
                        : "I can see the test panel"}
                  </Button>
                  <Button size="sm" onClick={() => void finish()}>
                    Finish test
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
