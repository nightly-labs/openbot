import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  BrowserControlAction,
  BrowserControlDetailAction,
  BrowserControlSession,
  BrowserPreview,
  BrowserTab,
} from "@openbot/contracts/ipc";
import { createEffect, For, onSettled, Show } from "solid-js";
import {
  ArrowLeft,
  Button,
  buttonVariants,
  CircleDot,
  Input,
  PictureInPicture2,
  Tabs,
  TriangleAlert,
  X,
} from "../../components/ui";
import type { AgentProfile } from "../../data";
import {
  BrowserBackIcon,
  BrowserControlIcon,
  BrowserForwardIcon,
  BrowserReloadIcon,
  CloseIcon,
  PlusIcon,
} from "./ConversationIcons";

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
  preview?: BrowserPreview | null;
  tabs: BrowserTab[];
  activeTab: BrowserTab | undefined;
  activeControl: BrowserControlSession | undefined;
  address: string;
  controlForTab: (tab: BrowserTab) => BrowserControlSession | undefined;
  controllerForTab: (tab: BrowserTab) => AgentProfile | undefined;
  onAddressChange: (value: string) => void;
  onAddressEditingChange: (editing: boolean) => void;
  onOpenAddress: (address?: string) => void;
  onNavigate: (tabId: string, direction: "back" | "forward") => void;
  onReload: (tabId: string) => void;
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onSurface: (element: HTMLDivElement | undefined) => void;
  onBack: () => void;
  onEnterPip: () => void;
}

function diagnosticErrorLabel(count: number): string {
  return `${count} browser diagnostic ${count === 1 ? "error" : "errors"}`;
}

export default function BrowserPanel(props: BrowserPanelProps) {
  const actingControl = () => (props.activeControl?.phase === "acting" ? props.activeControl : undefined);
  let backButton: HTMLButtonElement | undefined;
  let panel: HTMLElement | undefined;
  let surfaceElement: HTMLDivElement | undefined;
  createEffect(
    () => props.open,
    (open) => {
      props.onSurface(undefined);
      if (!open) return;
      let disposed = false;
      onSettled(() => {
        backButton?.focus();
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
      <Show when={props.preview}>
        {(preview) => <img class="browser-motion-preview" src={preview().dataUrl} alt="" />}
      </Show>
      <Show when={props.tabs.length === 0}>
        <div class="browser-empty-state">
          <strong>Open a page</strong>
          <span>The agent can browse here while it works.</span>
        </div>
      </Show>
    </div>
  );

  const addressBar = () => (
    <form
      class="browser-address-bar"
      onSubmit={(event) => {
        event.preventDefault();
        props.onOpenAddress();
      }}
    >
      <Input
        value={props.address}
        aria-label="Browser address"
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
      class={["browser-panel browser-panel-expanded", { "browser-panel-controlled": Boolean(actingControl()) }]}
      aria-label="Browser"
      value={props.activeTab?.id ?? "__empty"}
      onChange={props.onActivateTab}
      activationMode="automatic"
    >
      <header class="browser-panel-header window-drag">
        <Button
          ref={(element) => (backButton = element)}
          variant="ghost"
          size="sm"
          class="no-drag browser-return"
          onClick={props.onBack}
        >
          <ArrowLeft aria-hidden="true" /> Back to conversation
        </Button>
        <div class="browser-tabs no-drag">
          <Tabs.List class="browser-tab-strip" aria-label="Browser tabs">
            <For each={props.tabs}>
              {(tab) => {
                const control = () => {
                  const session = props.controlForTab(tab);
                  return session?.phase === "acting" ? session : undefined;
                };
                const controller = () => props.controllerForTab(tab);
                const title = () => (tab.loading ? "Loading…" : tab.title || tab.url);
                return (
                  <div
                    role="presentation"
                    class={["browser-tab-wrap", { "browser-tab-controlled": Boolean(control()) }]}
                  >
                    <Tabs.Trigger
                      as="button"
                      value={tab.id}
                      aria-label={control() ? `${title()}, controlled by ${controller()?.name ?? "agent"}` : title()}
                      aria-description="Press Delete or Control/Command W to close"
                      class={buttonVariants({ variant: "ghost", class: "browser-tab" })}
                      onPointerDown={(event) => {
                        if (event.button !== 1) return;
                        event.preventDefault();
                        event.stopPropagation();
                        props.onCloseTab(tab.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Delete") return;
                        event.preventDefault();
                        props.onCloseTab(tab.id);
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
                      <span
                        class="browser-tab-close"
                        aria-hidden="true"
                        title={`Close ${tab.title || "browser tab"}`}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          if (event.button === 1) props.onCloseTab(tab.id);
                        }}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          props.onCloseTab(tab.id);
                        }}
                      >
                        <CloseIcon />
                      </span>
                    </Tabs.Trigger>
                  </div>
                );
              }}
            </For>
          </Tabs.List>
          <Button
            variant="ghost"
            type="button"
            class="browser-new-tab"
            aria-label="New browser tab"
            onClick={() => {
              props.onAddressChange("https://www.google.com");
              props.onOpenAddress("https://www.google.com");
            }}
          >
            <PlusIcon />
          </Button>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          class="no-drag browser-hide"
          aria-label="Hide browser"
          title="Hide browser"
          onClick={props.onBack}
        >
          <X aria-hidden="true" />
        </Button>
      </header>
      <Tabs.Content forceMount value={props.activeTab?.id ?? "__empty"} class="browser-tab-panel">
        <div class="browser-toolbar">
          <Button
            variant="ghost"
            type="button"
            aria-label="Go back"
            class="browser-toolbar-button"
            disabled={!props.activeTab}
            onClick={() => props.activeTab && props.onNavigate(props.activeTab.id, "back")}
          >
            <BrowserBackIcon />
          </Button>
          <Button
            variant="ghost"
            type="button"
            aria-label="Go forward"
            class="browser-toolbar-button"
            disabled={!props.activeTab}
            onClick={() => props.activeTab && props.onNavigate(props.activeTab.id, "forward")}
          >
            <BrowserForwardIcon />
          </Button>
          <Button
            variant="ghost"
            type="button"
            aria-label="Reload page"
            class="browser-toolbar-button"
            disabled={!props.activeTab}
            onClick={() => props.activeTab && props.onReload(props.activeTab.id)}
          >
            <BrowserReloadIcon />
          </Button>
          {addressBar()}
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
          <Button
            variant="ghost"
            type="button"
            class="browser-toolbar-button"
            aria-label="Open browser Picture in Picture"
            onClick={props.onEnterPip}
          >
            <PictureInPicture2 class="browser-toolbar-icon" />
          </Button>
        </div>
        {surface()}
      </Tabs.Content>
    </Tabs.Root>
  );
}
