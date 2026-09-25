import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  BrowserControlAction,
  BrowserControlDetailAction,
  BrowserControlSession,
  BrowserTab,
} from "@openbot/contracts/ipc";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertTitle,
  Button,
  buttonVariants,
  CircleDot,
  Input,
  Minimize2,
  PictureInPicture2,
  Tabs,
  TriangleAlert,
} from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import {
  BrowserBackIcon,
  BrowserControlIcon,
  BrowserForwardIcon,
  BrowserReloadIcon,
  CloseIcon,
  PlusIcon,
} from "@openbot/ui/features/conversation/ConversationIcons";
import { Portal } from "@solidjs/web";
import { createEffect, createSignal, For, onSettled, Show } from "solid-js";
import BrowserLiveView, { type BrowserViewRuntime } from "./BrowserLiveView";

const BROWSER_ACTION_LABELS: Record<BrowserControlAction | BrowserControlDetailAction, string> = {
  open: "Opening a page…",
  "list-tabs": "Checking tabs…",
  snapshot: "Reading the page…",
  click: "Clicking…",
  type: "Typing…",
  key: "Using the keyboard…",
  scroll: "Scrolling…",
  back: "Going back…",
  forward: "Going forward…",
  reload: "Reloading…",
  screenshot: "Taking a screenshot…",
  status: "Checking browser status…",
  navigate: "Navigating…",
  press: "Using the keyboard…",
  hover: "Hovering…",
  "select-option": "Selecting an option…",
  "set-checked": "Changing a control…",
  drag: "Dragging…",
  "upload-files": "Uploading files…",
  "wait-for": "Waiting for the page…",
  evaluate: "Evaluating page JavaScript…",
  "set-environment": "Changing the viewport…",
  "recording-start": "Starting recording…",
  "recording-stop": "Saving recording…",
  "close-tab": "Closing a tab…",
};

interface BrowserPanelProps {
  open: boolean;
  tabs: BrowserTab[];
  activeTab: BrowserTab | undefined;
  activeControl: BrowserControlSession | undefined;
  address: string;
  controlForTab: (tab: BrowserTab) => BrowserControlSession | undefined;
  controllerForTab: (tab: BrowserTab) => AgentProfile | undefined;
  onAddressChange: (value: string) => void;
  onAddressEditingChange: (editing: boolean) => void;
  onOpenAddress?: (address?: string) => void;
  onNavigate?: (tabId: string, direction: "back" | "forward") => void;
  onReload?: (tabId: string) => void;
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onSurface: (element: HTMLDivElement | undefined) => void;
  /** The tab to draw here, for a host whose browser is not a view on this screen. Local: `null`. */
  liveViewTabId: string | null;
  liveViewRuntime: BrowserViewRuntime;
  canCloseTabs?: boolean;
  /** False where the page cannot leave the window, such as the web app. */
  canEnterPip?: boolean;
  onBack: () => void;
  onEnterPip: () => void;
  /**
   * Whether the window draws the macOS traffic lights over this panel. The panel is portaled to
   * `document.body`, so it sits outside `.app-frame` and cannot read `app-frame-platform-darwin`
   * from an ancestor; the platform has to arrive as a value.
   */
  macWindowControls?: boolean;
}

function diagnosticErrorLabel(count: number): string {
  return `${count} browser diagnostic ${count === 1 ? "error" : "errors"}`;
}

export default function BrowserPanel(props: BrowserPanelProps) {
  const [dismissedPopupFailures, setDismissedPopupFailures] = createSignal<ReadonlySet<string>>(new Set());
  const popupFailure = () => props.activeTab?.popupFailure;
  const actingControl = () => (props.activeControl?.phase === "acting" ? props.activeControl : undefined);
  /**
   * The shape of the host's page. A live view takes that shape rather than the window's, so the page
   * fills its surface instead of sitting between bars.
   */
  const [frameSize, setFrameSize] = createSignal<{ width: number; height: number } | undefined>(undefined, {
    equals: (previous, next) => previous?.width === next?.width && previous?.height === next?.height,
  });
  const live = () => props.liveViewTabId !== null;
  let hideButton: HTMLButtonElement | undefined;
  let panel: HTMLElement | undefined;
  let surfaceElement: HTMLDivElement | undefined;
  createEffect(
    () => props.open,
    (open) => {
      props.onSurface(undefined);
      if (!open) return;
      let disposed = false;
      onSettled(() => {
        hideButton?.focus();
        // Chromium is a native child view. Attach it only after the CSS panel settles.
        const animations = panel?.getAnimations() ?? [];
        const showSurface = () => {
          if (!disposed) props.onSurface(surfaceElement);
        };
        if (animations.length === 0) showSurface();
        else void Promise.all(animations.map((animation) => animation.finished)).then(showSurface, () => undefined);
      });
      return () => {
        disposed = true;
      };
    },
  );

  const surface = () => (
    <div class="browser-surface" ref={(element) => (surfaceElement = element)}>
      <Show when={props.liveViewTabId}>
        {(tabId) => (
          <BrowserLiveView
            runtime={props.liveViewRuntime}
            tabId={tabId()}
            active={props.open}
            onFrameSize={setFrameSize}
          />
        )}
      </Show>
      <Show when={props.tabs.length === 0}>
        <div class="browser-empty-state">
          <strong>Open a page</strong>
          <span>The agent can browse here while it works.</span>
        </div>
      </Show>
    </div>
  );

  const hideBrowserButton = () => (
    <Button
      variant="ghost"
      size="icon-xs"
      ref={(element) => (hideButton = element)}
      class="no-drag browser-hide"
      aria-label="Hide browser"
      title="Hide browser"
      onClick={props.onBack}
    >
      <Minimize2 aria-hidden="true" />
    </Button>
  );

  const addressBar = () => (
    <form
      class="browser-address-bar"
      onSubmit={(event) => {
        event.preventDefault();
        props.onOpenAddress?.();
      }}
    >
      <Input
        value={props.address}
        aria-label="Browser address"
        placeholder="Search Google or enter a URL"
        maxlength={INPUT_LIMITS.browserUrl}
        onValueChange={props.onAddressChange}
        onFocus={() => props.onAddressEditingChange(true)}
        onBlur={() => props.onAddressEditingChange(false)}
      />
    </form>
  );

  return (
    <Tabs.Root
      as="aside"
      ref={(element) => (panel = element)}
      hidden={!props.open}
      aria-hidden={props.open ? undefined : "true"}
      inert={!props.open}
      id="browser-expanded-panel"
      class={[
        "browser-panel browser-panel-expanded",
        {
          "browser-panel-controlled": Boolean(actingControl()),
          "browser-panel-mac-controls": props.macWindowControls === true,
          "browser-panel-live": live(),
        },
      ]}
      style={
        live() && frameSize()
          ? `--browser-frame-width: ${frameSize()?.width}; --browser-frame-height: ${frameSize()?.height};`
          : undefined
      }
      aria-label="Browser"
      value={props.activeTab?.id ?? "__empty"}
      activationMode="automatic"
    >
      <header class="browser-panel-header window-drag">
        <div class="browser-tabs no-drag">
          <Tabs.List class="browser-tab-strip" aria-label="Browser tabs">
            <For each={props.tabs} keyed={(tab) => tab.id}>
              {(tab) => {
                const control = () => {
                  const session = props.controlForTab(tab());
                  return session?.phase === "acting" ? session : undefined;
                };
                const controller = () => props.controllerForTab(tab());
                const title = () => (tab().loading ? "Loading…" : tab().title || tab().url);
                return (
                  <div
                    role="presentation"
                    class={["browser-tab-wrap", { "browser-tab-controlled": Boolean(control()) }]}
                  >
                    <Tabs.Trigger
                      as="button"
                      value={tab().id}
                      aria-label={control() ? `${title()}, controlled by ${controller()?.name ?? "agent"}` : title()}
                      aria-description={
                        props.canCloseTabs === false ? undefined : "Press Delete or Control/Command W to close"
                      }
                      class={buttonVariants({ variant: "ghost", class: "browser-tab" })}
                      // Only user interaction activates a native tab. Collection registration can
                      // temporarily make the controlled selection absent and suggest the first tab.
                      onClick={() => props.onActivateTab(tab().id)}
                      onFocus={() => props.activeTab?.id !== tab().id && props.onActivateTab(tab().id)}
                      onPointerDown={(event) => {
                        if (props.canCloseTabs === false) return;
                        if (event.button !== 1) return;
                        event.preventDefault();
                        event.stopPropagation();
                        props.onCloseTab(tab().id);
                      }}
                      onKeyDown={(event) => {
                        if (props.canCloseTabs === false || event.key !== "Delete") return;
                        event.preventDefault();
                        props.onCloseTab(tab().id);
                      }}
                    >
                      <Show when={control()}>
                        {(session) => (
                          <span
                            class="browser-tab-control browser-tab-control-acting"
                            title={`${controller()?.name ?? "Agent"}: ${BROWSER_ACTION_LABELS[session().detailAction ?? session().action]}`}
                          >
                            <BrowserControlIcon />
                          </span>
                        )}
                      </Show>
                      <span class="browser-tab-title">{title()}</span>
                      <Show when={props.canCloseTabs !== false}>
                        <span
                          class="browser-tab-close"
                          aria-hidden="true"
                          title={`Close ${tab().title || "browser tab"}`}
                          onPointerDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (event.button === 1) props.onCloseTab(tab().id);
                          }}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            props.onCloseTab(tab().id);
                          }}
                        >
                          <CloseIcon />
                        </span>
                      </Show>
                    </Tabs.Trigger>
                  </div>
                );
              }}
            </For>
          </Tabs.List>
          <Show when={props.onOpenAddress}>
            <Button
              variant="ghost"
              type="button"
              class="browser-new-tab"
              aria-label="New browser tab"
              onClick={() => {
                props.onAddressChange("https://www.google.com");
                props.onOpenAddress?.("https://www.google.com");
              }}
            >
              <PlusIcon />
            </Button>
          </Show>
        </div>
        <Show when={props.open && live()}>{hideBrowserButton()}</Show>
      </header>
      {/* A live view is a card inside the window, so its hide button belongs to its own header. The
       * full-bleed panel pins it to the window corner instead. */}
      <Show when={props.open && !live()}>
        <Portal>{hideBrowserButton()}</Portal>
      </Show>
      <Tabs.Content forceMount value={props.activeTab?.id ?? "__empty"} class="browser-tab-panel">
        <div class="browser-toolbar">
          <Show when={props.onNavigate}>
            <Button
              variant="ghost"
              type="button"
              aria-label="Go back"
              class="browser-toolbar-button"
              disabled={!props.activeTab}
              onClick={() => props.activeTab && props.onNavigate?.(props.activeTab.id, "back")}
            >
              <BrowserBackIcon />
            </Button>
            <Button
              variant="ghost"
              type="button"
              aria-label="Go forward"
              class="browser-toolbar-button"
              disabled={!props.activeTab}
              onClick={() => props.activeTab && props.onNavigate?.(props.activeTab.id, "forward")}
            >
              <BrowserForwardIcon />
            </Button>
          </Show>
          <Show when={props.onReload}>
            <Button
              variant="ghost"
              type="button"
              aria-label="Reload page"
              class="browser-toolbar-button"
              disabled={!props.activeTab}
              onClick={() => props.activeTab && props.onReload?.(props.activeTab.id)}
            >
              <BrowserReloadIcon />
            </Button>
          </Show>
          <Show when={props.onOpenAddress}>{addressBar()}</Show>
          <Show when={props.activeTab?.recording}>
            <span class="browser-recording-status" role="status" aria-label="Browser recording active">
              <CircleDot /> REC
            </span>
          </Show>
          <Show when={props.activeTab?.diagnosticErrorCount}>
            {(errorCount) => (
              <span
                class="browser-diagnostic-status"
                role="status"
                title={diagnosticErrorLabel(errorCount())}
                aria-label={diagnosticErrorLabel(errorCount())}
              >
                <TriangleAlert /> {errorCount()}
              </span>
            )}
          </Show>
          <Show when={props.canEnterPip !== false}>
            <Button
              variant="ghost"
              type="button"
              class="browser-toolbar-button"
              aria-label="Open browser Picture in Picture"
              onClick={props.onEnterPip}
            >
              <PictureInPicture2 class="browser-toolbar-icon" />
            </Button>
          </Show>
        </div>
        <Show when={popupFailure() && !dismissedPopupFailures().has(popupFailure()?.id ?? "")}>
          <Alert tone="warning" role="alert">
            <AlertContent>
              <AlertTitle>Popup blocked</AlertTitle>
              <AlertDescription>{popupFailure()?.message}</AlertDescription>
            </AlertContent>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Dismiss popup message"
              onClick={() => {
                const failure = popupFailure();
                if (failure) setDismissedPopupFailures((ids) => new Set([...ids, failure.id]));
              }}
            >
              <CloseIcon />
            </Button>
          </Alert>
        </Show>
        {surface()}
      </Tabs.Content>
    </Tabs.Root>
  );
}
