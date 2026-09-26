import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  BrowserControlAction,
  BrowserControlDetailAction,
  BrowserControlSession,
  BrowserTab,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
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
import { useText } from "@openbot/ui/text";
import { Portal } from "@solidjs/web";
import { createEffect, createSignal, For, onSettled, Show } from "solid-js";
import BrowserLiveView, { type BrowserViewRuntime } from "./BrowserLiveView";

const BROWSER_ACTION_LABELS = {
  open: "browser.action.open",
  "list-tabs": "browser.action.listTabs",
  snapshot: "browser.action.snapshot",
  click: "browser.action.click",
  type: "browser.action.type",
  key: "browser.action.key",
  scroll: "browser.action.scroll",
  back: "browser.action.back",
  forward: "browser.action.forward",
  reload: "browser.action.reload",
  screenshot: "browser.action.screenshot",
  status: "browser.action.status",
  navigate: "browser.action.navigate",
  press: "browser.action.key",
  hover: "browser.action.hover",
  "select-option": "browser.action.selectOption",
  "set-checked": "browser.action.setChecked",
  drag: "browser.action.drag",
  "upload-files": "browser.action.uploadFiles",
  "wait-for": "browser.action.waitFor",
  evaluate: "browser.action.evaluate",
  "set-environment": "browser.action.setEnvironment",
  "recording-start": "browser.action.recordingStart",
  "recording-stop": "browser.action.recordingStop",
  "close-tab": "browser.action.closeTab",
} as const satisfies Record<BrowserControlAction | BrowserControlDetailAction, AppTextKey>;

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
  onBack: () => void;
  onEnterPip: () => void;
  /**
   * Whether the window draws the macOS traffic lights over this panel. The panel is portaled to
   * `document.body`, so it sits outside `.app-frame` and cannot read `app-frame-platform-darwin`
   * from an ancestor; the platform has to arrive as a value.
   */
  macWindowControls?: boolean;
}

export default function BrowserPanel(props: BrowserPanelProps) {
  const { t, sourceText } = useText();
  const [dismissedPopupFailures, setDismissedPopupFailures] = createSignal<ReadonlySet<string>>(new Set());
  const popupFailure = () => props.activeTab?.popupFailure;
  const actingControl = () => (props.activeControl?.phase === "acting" ? props.activeControl : undefined);
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
        {(tabId) => <BrowserLiveView runtime={props.liveViewRuntime} tabId={tabId()} active={props.open} />}
      </Show>
      <Show when={props.tabs.length === 0}>
        <div class="browser-empty-state">
          <strong>{t("browser.empty.title")}</strong>
          <span>{t("browser.empty.description")}</span>
        </div>
      </Show>
    </div>
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
        aria-label={t("browser.address.label")}
        placeholder={t("browser.address.placeholder")}
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
        },
      ]}
      aria-label={t("browser.panel.label")}
      value={props.activeTab?.id ?? "__empty"}
      activationMode="automatic"
    >
      <header class="browser-panel-header window-drag">
        <div class="browser-tabs no-drag">
          <Tabs.List class="browser-tab-strip" aria-label={t("browser.tabs.label")}>
            <For each={props.tabs} keyed={(tab) => tab.id}>
              {(tab) => {
                const control = () => {
                  const session = props.controlForTab(tab());
                  return session?.phase === "acting" ? session : undefined;
                };
                const controller = () => props.controllerForTab(tab());
                const title = () => (tab().loading ? t("common.loading") : tab().title || tab().url);
                return (
                  <div
                    role="presentation"
                    class={["browser-tab-wrap", { "browser-tab-controlled": Boolean(control()) }]}
                  >
                    <Tabs.Trigger
                      as="button"
                      value={tab().id}
                      aria-label={
                        control()
                          ? t("browser.tab.controlledBy", {
                              title: title(),
                              name: controller()?.name ?? t("browser.tab.controllerFallback"),
                            })
                          : title()
                      }
                      aria-description={props.canCloseTabs === false ? undefined : t("browser.tab.closeHint")}
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
                            title={t("browser.tab.controlStatus", {
                              name: controller()?.name ?? t("browser.tab.agentFallback"),
                              action: t(BROWSER_ACTION_LABELS[session().detailAction ?? session().action]),
                            })}
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
                          title={
                            tab().title
                              ? t("browser.tab.closeNamed", { name: tab().title })
                              : t("browser.tab.closeUnnamed")
                          }
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
              aria-label={t("browser.newTab")}
              onClick={() => {
                props.onAddressChange("https://www.google.com");
                props.onOpenAddress?.("https://www.google.com");
              }}
            >
              <PlusIcon />
            </Button>
          </Show>
        </div>
      </header>
      <Portal>
        <Show when={props.open}>
          <Button
            variant="ghost"
            size="icon-xs"
            ref={(element) => (hideButton = element)}
            class="no-drag browser-hide"
            aria-label={t("browser.hide")}
            title={t("browser.hide")}
            onClick={props.onBack}
          >
            <Minimize2 aria-hidden="true" />
          </Button>
        </Show>
      </Portal>
      <Tabs.Content forceMount value={props.activeTab?.id ?? "__empty"} class="browser-tab-panel">
        <div class="browser-toolbar">
          <Show when={props.onNavigate}>
            <Button
              variant="ghost"
              type="button"
              aria-label={t("browser.goBack")}
              class="browser-toolbar-button"
              disabled={!props.activeTab}
              onClick={() => props.activeTab && props.onNavigate?.(props.activeTab.id, "back")}
            >
              <BrowserBackIcon />
            </Button>
            <Button
              variant="ghost"
              type="button"
              aria-label={t("browser.goForward")}
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
              aria-label={t("browser.reload")}
              class="browser-toolbar-button"
              disabled={!props.activeTab}
              onClick={() => props.activeTab && props.onReload?.(props.activeTab.id)}
            >
              <BrowserReloadIcon />
            </Button>
          </Show>
          <Show when={props.onOpenAddress}>{addressBar()}</Show>
          <Show when={props.activeTab?.recording}>
            <span class="browser-recording-status" role="status" aria-label={t("browser.recording.label")}>
              <CircleDot /> {t("browser.recording.badge")}
            </span>
          </Show>
          <Show when={props.activeTab?.diagnosticErrorCount}>
            {(errorCount) => (
              <span
                class="browser-diagnostic-status"
                role="status"
                title={t("browser.diagnosticErrors", { count: errorCount() })}
                aria-label={t("browser.diagnosticErrors", { count: errorCount() })}
              >
                <TriangleAlert /> {errorCount()}
              </span>
            )}
          </Show>
          <Show when={props.canCloseTabs !== false}>
            <Button
              variant="ghost"
              type="button"
              class="browser-toolbar-button"
              aria-label={t("browser.pip.open")}
              onClick={props.onEnterPip}
            >
              <PictureInPicture2 class="browser-toolbar-icon" />
            </Button>
          </Show>
        </div>
        <Show when={popupFailure() && !dismissedPopupFailures().has(popupFailure()?.id ?? "")}>
          <Alert tone="warning" role="alert">
            <AlertContent>
              <AlertTitle>{t("browser.popupBlocked.title")}</AlertTitle>
              <AlertDescription>{sourceText(popupFailure()?.message ?? "")}</AlertDescription>
            </AlertContent>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("browser.popupBlocked.dismiss")}
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
