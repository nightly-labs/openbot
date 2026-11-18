import { installPointerFocusGuard } from "@openbot/ui/pointer-focus";
import { render } from "@solidjs/web";
import { syncAppearance } from "./appearance-choice";
// A dev build shows the color and the branch of its worktree.
import "./dev-worktree";
import { AgentDockSurface } from "./features/agent-dock/AgentDockSurface";
import { BrowserDockSurface } from "./features/browser/BrowserDockSurface";
import { ComputerUseHighlightSurface } from "./features/computer-use/ComputerUseHighlightSurface";
import { ComputerUsePermissionHelp, permissionFromQuery } from "./features/computer-use/ComputerUsePermissionHelp";
import { DynamicIslandSurface } from "./features/dynamic-island/DynamicIslandSurface";
import { I18nProvider } from "./i18n-context";
import { syncLogoColor } from "./logo-color";
import "./styles.css";

// The helper windows have an entry of their own, so they do not load `App`. There is one Dynamic
// Island window for each display, and with `App` each one used twice the memory. The browser dock
// overlay is a view of the main window, not a window, but it has no `App` either.
const root = document.getElementById("root");

if (!root) {
  throw new Error("Renderer root element was not found.");
}

installPointerFocusGuard();

const query = new URLSearchParams(window.location.search);
const surface = query.get("surface");
// The surface styles size the page by this attribute. A `:has()` rule on the page root would restyle the
// whole page on each change, and the main window loads the same styles.
if (surface) document.documentElement.dataset.surface = surface;
// The Dynamic Island imitates the camera housing, so it stays dark in the light theme. The other
// helper windows change the theme at once, with no sweep.
if (surface !== "dynamic-island") syncAppearance({ sweep: false });
syncLogoColor();
// The helper windows are not inside `App`, so each gets the language setting of its own. They use
// the same preload and the same trusted-origin IPC gate as the main window, and main already sends
// every language change to every window.
render(() => {
  if (surface === "dynamic-island")
    return (
      <I18nProvider waitForLanguage>
        <DynamicIslandSurface />
      </I18nProvider>
    );
  if (surface === "browser-dock")
    return (
      <I18nProvider waitForLanguage>
        <BrowserDockSurface />
      </I18nProvider>
    );
  if (surface === "agent-dock")
    return (
      <I18nProvider waitForLanguage>
        <AgentDockSurface />
      </I18nProvider>
    );
  if (surface === "computer-use-highlight")
    return (
      <I18nProvider waitForLanguage>
        <ComputerUseHighlightSurface />
      </I18nProvider>
    );
  if (surface === "computer-use-permission-help")
    return (
      <I18nProvider waitForLanguage>
        <ComputerUsePermissionHelp
          permission={permissionFromQuery(window.location.search)}
          sunshine={query.get("application") === "sunshine"}
        />
      </I18nProvider>
    );
  throw new Error(`Unknown helper surface: ${String(surface)}.`);
}, root);
