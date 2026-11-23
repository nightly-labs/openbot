import { installPointerFocusGuard } from "@openbot/ui/pointer-focus";
import { render } from "@solidjs/web";
import { syncAppearance } from "./appearance-choice";
import "./dev-worktree";
import { AgentDockSurface } from "./features/agent-dock/AgentDockSurface";
import { BrowserDockSurface } from "./features/browser/BrowserDockSurface";
import { ComputerUseHighlightSurface } from "./features/computer-use/ComputerUseHighlightSurface";
import { ComputerUsePermissionHelp, permissionFromQuery } from "./features/computer-use/ComputerUsePermissionHelp";
import { DynamicIslandSurface } from "./features/dynamic-island/DynamicIslandSurface";
import { I18nProvider } from "./i18n-context";
import { syncLogoColor } from "./logo-color";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Renderer root element was not found.");
}

installPointerFocusGuard();

const query = new URLSearchParams(window.location.search);
const surface = query.get("surface");
if (surface) document.documentElement.dataset.surface = surface;
if (surface !== "dynamic-island") syncAppearance({ sweep: false });
syncLogoColor();
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
