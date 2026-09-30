import { installPointerFocusGuard } from "@openbot/ui/pointer-focus";
import { render } from "@solidjs/web";
import { ComputerUseHighlightSurface } from "./features/computer-use/ComputerUseHighlightSurface";
import { ComputerUsePermissionHelp, permissionFromQuery } from "./features/computer-use/ComputerUsePermissionHelp";
import { DynamicIslandSurface } from "./features/dynamic-island/DynamicIslandSurface";
import { I18nProvider } from "./i18n-context";
import "./styles.css";

// The helper windows have an entry of their own, so they do not load `App`. There is one Dynamic
// Island window for each display, and with `App` each one used twice the memory.
const root = document.getElementById("root");

if (!root) {
  throw new Error("Renderer root element was not found.");
}

installPointerFocusGuard();

const query = new URLSearchParams(window.location.search);
const surface = query.get("surface");
// The helper windows are not inside `App`, so each gets the language setting of its own. They use
// the same preload and the same trusted-origin IPC gate as the main window, and main already sends
// every language change to every window.
render(() => {
  if (surface === "dynamic-island")
    return (
      <I18nProvider>
        <DynamicIslandSurface />
      </I18nProvider>
    );
  if (surface === "computer-use-highlight")
    return (
      <I18nProvider>
        <ComputerUseHighlightSurface />
      </I18nProvider>
    );
  if (surface === "computer-use-permission-help")
    return (
      <I18nProvider>
        <ComputerUsePermissionHelp
          permission={permissionFromQuery(window.location.search)}
          sunshine={query.get("application") === "sunshine"}
        />
      </I18nProvider>
    );
  throw new Error(`Unknown helper surface: ${String(surface)}.`);
}, root);
