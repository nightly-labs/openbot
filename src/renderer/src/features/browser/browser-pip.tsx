import type { BrowserDisplayState } from "@openbot/contracts/ipc";
import BrowserLiveView from "@openbot/ui/features/browser/BrowserLiveView";
import { useText } from "@openbot/ui/text";
import { render } from "@solidjs/web";
import { createSignal, onCleanup, onSettled, Show } from "solid-js";
import "../../styles.css";
import { syncAppearance } from "../../appearance-choice";
import { I18nProvider } from "../../i18n-context";
import { browserPort } from "./browser-port";

/** Main opens the window on a host's tab with `view=live`: the page is drawn here, not placed over it. */
const page = new URLSearchParams(window.location.search);
const liveView = page.get("view") === "live";
const liveViewClipboard = page.get("clipboard") === "1";

function BrowserPictureInPicture() {
  const { t } = useText();
  const [state, setState] = createSignal<BrowserDisplayState>({ tabs: [], activeTabId: null });
  let surface: HTMLDivElement | undefined;
  let stateRevision = 0;
  let boundsFrame: number | undefined;

  const applyState = (next: BrowserDisplayState) => {
    stateRevision += 1;
    setState(next);
  };

  const syncBounds = () => {
    if (!surface) return;
    const bounds = surface.getBoundingClientRect();
    void browserPort().browser.setVisible({
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

  const removeDisplayState = browserPort().browser.onDisplayState(applyState);

  onSettled(() => {
    const requestedAtRevision = stateRevision;
    void browserPort()
      .browser.getDisplayState()
      .then((next) => {
        if (stateRevision === requestedAtRevision) applyState(next);
      });
    const observer = new ResizeObserver(scheduleBoundsSync);
    if (surface) observer.observe(surface);
    window.addEventListener("resize", scheduleBoundsSync);
    scheduleBoundsSync();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleBoundsSync);
    };
  });

  onCleanup(() => {
    if (boundsFrame !== undefined) cancelAnimationFrame(boundsFrame);
    removeDisplayState();
    void browserPort().browser.setVisible({ visible: false, target: "picture-in-picture" });
  });

  return (
    <aside class="browser-pip-window" aria-label={t("browser.pip.window")}>
      <div class="browser-surface browser-pip-surface" ref={surface}>
        <Show when={liveView && state().activeTabId}>
          {(tabId) => (
            <BrowserLiveView runtime={browserPort().browser} tabId={tabId()} active clipboard={liveViewClipboard} />
          )}
        </Show>
        <Show when={state().tabs.length === 0}>
          <div class="browser-empty-state">
            <strong>{t("browser.empty.title")}</strong>
            <span>{t("browser.empty.description")}</span>
          </div>
        </Show>
      </div>
    </aside>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Browser Picture in Picture root element was not found.");
syncAppearance();
render(
  () => (
    <I18nProvider>
      <BrowserPictureInPicture />
    </I18nProvider>
  ),
  root,
);
