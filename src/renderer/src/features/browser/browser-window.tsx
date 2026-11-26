import type { BrowserTab, BrowserWindowAction, BrowserWindowModel } from "@openbot/contracts/ipc";
import BrowserFullView from "@openbot/ui/features/browser/BrowserFullView";
import { useText } from "@openbot/ui/text";
import { render } from "@solidjs/web";
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import "../../styles.css";
import { syncAppearance } from "../../appearance-choice";
import { I18nProvider } from "../../i18n-context";
import { browserPort } from "./browser-port";

const EMPTY_MODEL: BrowserWindowModel = {
  tabs: [],
  activeTabId: null,
  details: [],
  history: [],
  canReopen: false,
  canCloseTabs: true,
  liveViewTabId: null,
  liveViewClipboard: false,
  shortcuts: null,
};

function BrowserWindowPage() {
  const { t } = useText();
  const browser = browserPort().browser;
  const [model, setModel] = createSignal<BrowserWindowModel>(EMPTY_MODEL);
  const details = createMemo(() => new Map(model().details.map((entry) => [entry.tabId, entry])));
  const activeTab = () => model().tabs.find((tab) => tab.id === model().activeTabId);
  let modelRevision = 0;

  const applyModel = (next: BrowserWindowModel) => {
    modelRevision += 1;
    setModel(next);
  };
  const removeModelListener = browser.onWindowModel(applyModel);
  const requestedAtRevision = modelRevision;
  void browser.getWindowModel().then((next) => {
    if (next && modelRevision === requestedAtRevision) applyModel(next);
  });

  const send = (action: BrowserWindowAction) => browser.sendWindowAction(action);
  const detail = (tab: BrowserTab) => details().get(tab.id);

  let surface: HTMLDivElement | undefined;
  let observer: ResizeObserver | undefined;
  let boundsFrame: number | undefined;
  const syncBounds = () => {
    if (!surface?.isConnected) return;
    const bounds = surface.getBoundingClientRect();
    void browser.setVisible({
      visible: true,
      target: "picture-in-picture",
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    });
  };
  const scheduleBoundsSync = () => {
    if (boundsFrame !== undefined) cancelAnimationFrame(boundsFrame);
    boundsFrame = requestAnimationFrame(() => {
      boundsFrame = undefined;
      syncBounds();
    });
  };
  const stopObserving = () => {
    observer?.disconnect();
    observer = undefined;
    window.removeEventListener("resize", scheduleBoundsSync);
    if (boundsFrame !== undefined) cancelAnimationFrame(boundsFrame);
    boundsFrame = undefined;
  };
  const setSurface = (element: HTMLDivElement | undefined) => {
    stopObserving();
    surface = element;
    if (!element) {
      void browser.setVisible({ visible: false, target: "picture-in-picture" });
      return;
    }
    observer = new ResizeObserver(scheduleBoundsSync);
    observer.observe(element);
    window.addEventListener("resize", scheduleBoundsSync);
    syncBounds();
  };

  createEffect(
    () => activeTab()?.title || t("browser.panel.label"),
    (title) => {
      document.title = title;
    },
  );

  onCleanup(() => {
    removeModelListener();
    stopObserving();
  });

  return (
    <BrowserFullView
      open
      detached
      macWindowControls={false}
      shortcuts={model().shortcuts ?? undefined}
      tabs={model().tabs}
      activeTab={activeTab()}
      history={model().history}
      canReopen={model().canReopen}
      canCloseTabs={model().canCloseTabs}
      controlForTab={(tab) => detail(tab)?.control}
      controllerForTab={(tab) => detail(tab)?.controller}
      ownerForTab={(tab) => detail(tab)?.owner}
      profileForTab={(tab) => detail(tab)?.profile}
      onActivateTab={(tabId) => void send({ type: "activate", tabId })}
      onCloseTabs={(tabIds) => void send({ type: "close", tabIds: [...tabIds] })}
      onNewTab={(afterId) => send(afterId === undefined ? { type: "new-tab" } : { type: "new-tab", afterId })}
      onDuplicateTab={(tabId) => void send({ type: "duplicate", tabId })}
      onMoveTab={(tabId, index) => void send({ type: "move", tabId, index })}
      onReopenTab={() => void send({ type: "reopen" })}
      onReload={(tabId) => void send({ type: "reload", tabId })}
      onStop={(tabId) => void send({ type: "stop", tabId })}
      onNavigate={(tabId, direction) => void send({ type: "navigate", tabId, direction })}
      onOpenAddress={(url, tabId) =>
        void send(tabId === undefined ? { type: "open-address", url } : { type: "open-address", url, tabId })
      }
      onSurface={setSurface}
      liveViewTabId={model().liveViewTabId}
      liveViewRuntime={browser}
      liveViewClipboard={model().liveViewClipboard}
      canEnterPip={false}
      canOpenWindow={false}
      onBack={() => void browser.dockWindow()}
      onEnterPip={() => undefined}
      onHttpSignIn={(tabId, answer) =>
        browser.answerHttpSignIn(answer ? { tabId, ...answer } : { tabId, cancel: true })
      }
    />
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Browser window root element was not found.");
syncAppearance();
render(
  () => (
    <I18nProvider>
      <BrowserWindowPage />
    </I18nProvider>
  ),
  root,
);
