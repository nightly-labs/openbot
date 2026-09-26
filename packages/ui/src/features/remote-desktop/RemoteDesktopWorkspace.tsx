import type { RemoteDesktopErrorCode, RemoteDesktopSession, ServerSummary } from "@openbot/contracts/ipc";
import { ArrowLeft, Button, Monitor, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@openbot/ui";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { useText } from "@openbot/ui/text";
import { type JSX, Portal } from "@solidjs/web";
import { createEffect, createMemo, createSignal, onSettled, Show } from "solid-js";
import { z } from "zod";

interface RemoteDesktopWorkspaceProps {
  mount?: HTMLElement;
  testControls?: JSX.Element;
  viewOnly?: boolean;
  onViewerState?: (state: ViewerState) => void;
  visible: boolean;
  platform: "darwin" | "win32" | "linux";
  server: ServerSummary;
  session: RemoteDesktopSession | undefined;
  connecting: boolean;
  connectionError: string | null;
  connectionErrorCode: RemoteDesktopErrorCode | null;
  onHide: () => void;
  onDisconnect: () => Promise<void>;
  onRetry: () => Promise<void>;
  onSelectDisplay: (serverId: string, displayId: string) => Promise<void>;
}

type ViewerState = "idle" | "connecting" | "connected" | "error";
type RemoteDisplay = RemoteDesktopSession["displays"][number];
const viewerMessageSchema = z.object({
  source: z.literal("openbot-moonlight"),
  type: z.literal("viewer-state"),
  sessionId: z.string().min(1),
  state: z.enum(["connecting", "connected", "error"]),
  transport: z.enum(["p2p", "relay"]).optional(),
  message: z.string().optional(),
});

export function RemoteDesktopWorkspace(props: RemoteDesktopWorkspaceProps) {
  const { t, errorMessage } = useText();
  const [viewerState, setViewerState] = createSignal<ViewerState>("idle");
  const [viewerError, setViewerError] = createSignal<string | null>(null);
  const [actionBusy, setActionBusy] = createSignal<"retry" | "disconnect" | "display" | null>(null);
  let workspaceElement: HTMLElement | undefined;
  let viewerFrame: HTMLIFrameElement | undefined;
  let activeSessionId = "";

  const viewerSource = createMemo(() => {
    const session = props.session;
    return session ? `${session.viewerUrl}#${session.viewerGrant}` : undefined;
  });
  const effectiveState = createMemo<ViewerState>(() => {
    if (props.connectionError) return "error";
    if (props.connecting) return "connecting";
    return viewerState();
  });
  // The host's own word for why it refused, when it gave one. It decides which failure the overlay
  // describes: a missing screen recording grant is a setup step on the host that no retry reaches on
  // its own, unlike a connection that failed or a host that is too old to share a screen at all.
  const failureCode = createMemo<RemoteDesktopErrorCode | null>(
    () => props.connectionErrorCode ?? props.session?.errorCode ?? null,
  );
  const displays = createMemo(() => props.session?.displays ?? []);
  const selectedDisplay = createMemo(() =>
    displays().find((display) => display.id === props.session?.selectedDisplayId),
  );
  createEffect(
    () => props.visible,
    (visible) => {
      if (!workspaceElement) return;
      workspaceElement.inert = !visible;
      if (visible) requestAnimationFrame(() => workspaceElement?.focus());
    },
  );

  createEffect(
    () => ({ session: props.session, connecting: props.connecting, connectionError: props.connectionError }),
    ({ session, connecting, connectionError }) => {
      if (!session) {
        if (!connecting) {
          activeSessionId = "";
          setViewerState(connectionError ? "error" : "idle");
        }
        return;
      }
      if (session.id !== activeSessionId) {
        activeSessionId = session.id;
        setViewerError(null);
        setViewerState(
          session.phase === "connected" ? "connected" : session.phase === "error" ? "error" : "connecting",
        );
      } else if (session.phase === "connected" || session.phase === "error") {
        setViewerState(session.phase);
      }
    },
  );

  const receiveViewerState = (event: MessageEvent) => {
    const session = props.session;
    if (!session || event.source !== viewerFrame?.contentWindow || event.origin !== new URL(session.viewerUrl).origin) {
      return;
    }
    const parsed = viewerMessageSchema.safeParse(event.data);
    if (!parsed.success || parsed.data.sessionId !== session.id) return;
    setViewerState(parsed.data.state);
    props.onViewerState?.(parsed.data.state);
    setViewerError(
      parsed.data.state === "error" ? errorMessage(parsed.data.message, t("remoteDesktop.controlFailed")) : null,
    );
  };
  onSettled(() => {
    window.addEventListener("message", receiveViewerState);
    return () => window.removeEventListener("message", receiveViewerState);
  });

  async function retry() {
    if (actionBusy()) return;
    setActionBusy("retry");
    setViewerError(null);
    setViewerState("connecting");
    try {
      await props.onRetry();
    } catch (error) {
      setViewerState("error");
      setViewerError(errorMessage(error, t("remoteDesktop.startFailed")));
    } finally {
      setActionBusy(null);
    }
  }

  async function disconnect() {
    if (actionBusy()) return;
    setActionBusy("disconnect");
    setViewerError(null);
    try {
      await props.onDisconnect();
    } catch (error) {
      setViewerState("error");
      setViewerError(errorMessage(error, t("remoteDesktop.disconnectFailed")));
      setActionBusy(null);
    }
  }

  async function selectDisplay(displayId: string) {
    if (actionBusy()) return;
    setActionBusy("display");
    setViewerState("connecting");
    setViewerError(null);
    try {
      await props.onSelectDisplay(props.server.id, displayId);
    } catch (error) {
      setViewerState("error");
      setViewerError(errorMessage(error, t("remoteDesktop.switchDisplayFailed")));
    } finally {
      setActionBusy(null);
    }
  }

  return (
    <Portal mount={props.mount}>
      <main
        ref={(element) => (workspaceElement = element)}
        class={[
          "remote-desktop-workspace",
          `remote-desktop-workspace-${props.platform}`,
          { "remote-desktop-workspace-visible": props.visible },
        ]}
        aria-hidden={props.visible ? undefined : "true"}
        aria-label={t("remoteDesktop.workspaceLabel")}
        tabindex={-1}
      >
        <header class="window-drag remote-desktop-header">
          <Show when={!props.testControls}>
            <Show when={displays().length > 1}>
              <div class="no-drag remote-desktop-display-controls">
                <Select<RemoteDisplay>
                  class="remote-desktop-display-select"
                  options={displays()}
                  optionValue="id"
                  optionTextValue="label"
                  value={selectedDisplay()}
                  disabled={actionBusy() !== null}
                  onChange={(display) => display && void selectDisplay(display.id)}
                  itemComponent={(item) => <SelectItem item={item.item}>{item.item.rawValue.label}</SelectItem>}
                >
                  <SelectTrigger size="sm" aria-label={t("remoteDesktop.displayLabel")}>
                    <SelectValue<RemoteDisplay>>
                      {(state) => state.selectedOption()?.label ?? t("remoteDesktop.selectDisplay")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent class="remote-desktop-display-select-content" />
                </Select>
              </div>
            </Show>
            <div class="no-drag remote-desktop-actions">
              <Button type="button" class="remote-desktop-back-button" size="sm" variant="ghost" onClick={props.onHide}>
                <ArrowLeft size={14} aria-hidden="true" />
                {t("remoteDesktop.backToOpenBot")}
              </Button>
              <Button
                type="button"
                class="remote-desktop-disconnect-button"
                size="sm"
                variant="ghost"
                disabled={actionBusy() !== null}
                loading={actionBusy() === "disconnect"}
                onClick={() => void disconnect()}
              >
                {t("remoteDesktop.disconnect")}
              </Button>
            </div>
          </Show>
          <Show when={props.testControls}>
            <div class="no-drag remote-desktop-actions">{props.testControls}</div>
          </Show>
        </header>
        <div class="remote-desktop-stage">
          <Show when={viewerSource()}>
            {(source) => (
              <iframe
                ref={(element) => (viewerFrame = element)}
                class="remote-desktop-viewer"
                title={t("remoteDesktop.viewerTitle")}
                inert={props.viewOnly}
                tabindex={props.viewOnly ? -1 : undefined}
                src={source()}
                sandbox="allow-scripts allow-forms allow-same-origin allow-pointer-lock"
                allow="fullscreen; keyboard-map"
                onLoad={() => setViewerState("connecting")}
                onError={() => {
                  setViewerState("error");
                  setViewerError(t("remoteDesktop.viewerLoadFailed"));
                  props.onViewerState?.("error");
                }}
              />
            )}
          </Show>
          <Show when={props.server.state !== "online"}>
            <DesktopEmptyState
              title={t("remoteDesktop.hostOfflineTitle")}
              message={t("remoteDesktop.hostOfflineMessage")}
            />
          </Show>
          <Show when={effectiveState() === "connecting"}>
            <div class="remote-desktop-overlay" role="status">
              <AgentAvatar
                seed={`${props.server.id}:remote-desktop-connecting`}
                hue={215}
                mood="connecting"
                class="remote-desktop-connecting-avatar"
              />
              <strong>{t("common.connecting")}</strong>
            </div>
          </Show>
          <Show when={effectiveState() === "error" || props.session?.errorCode}>
            <div class="remote-desktop-overlay remote-desktop-error" role="alert">
              <Show
                when={failureCode() === "host_permissions_required"}
                fallback={
                  <>
                    <strong>{t("remoteDesktop.openFailed")}</strong>
                    <span>
                      {errorMessage(
                        viewerError() ?? props.connectionError ?? props.session?.message,
                        t("remoteDesktop.controlFailed"),
                      )}
                    </span>
                  </>
                }
              >
                <strong>{t("remoteDesktop.notSharingTitle", { name: props.server.name })}</strong>
                <span>{t("remoteDesktop.notSharingDescription")}</span>
              </Show>
              <Button variant="outline" type="button" loading={actionBusy() === "retry"} onClick={() => void retry()}>
                {t("common.tryAgain")}
              </Button>
            </div>
          </Show>
        </div>
      </main>
    </Portal>
  );
}

function DesktopEmptyState(props: { title: string; message: string }) {
  return (
    <div class="remote-desktop-overlay">
      <span class="remote-desktop-empty-mark">
        <Monitor aria-hidden="true" />
      </span>
      <strong>{props.title}</strong>
      <span>{props.message}</span>
    </div>
  );
}
