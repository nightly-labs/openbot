import { installPointerFocusGuard } from "@openbot/ui/pointer-focus";
import { type JSX, render } from "@solidjs/web";
import { ComputerUseHighlightSurface } from "./features/computer-use/ComputerUseHighlightSurface";
import { ComputerUsePermissionHelp, permissionFromQuery } from "./features/computer-use/ComputerUsePermissionHelp";
import { DynamicIslandSurface } from "./features/dynamic-island/DynamicIslandSurface";
import { I18nProvider } from "./i18n-context";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Renderer root element was not found.");
}

installPointerFocusGuard();

const query = new URLSearchParams(window.location.search);

// The helper windows are not inside `App`, so each gets the language setting of its own. They use
// the same preload and the same trusted-origin IPC gate as the main window, and main already sends
// every language change to every window.
function helperSurface(surface: string | null): (() => JSX.Element) | undefined {
  if (surface === "dynamic-island") return () => <DynamicIslandSurface />;
  if (surface === "computer-use-highlight") return () => <ComputerUseHighlightSurface />;
  if (surface === "computer-use-permission-help")
    return () => (
      <ComputerUsePermissionHelp
        permission={permissionFromQuery(window.location.search)}
        sunshine={query.get("application") === "sunshine"}
      />
    );
  return undefined;
}

const Helper = helperSurface(query.get("surface"));
if (Helper) {
  render(
    () => (
      <I18nProvider>
        <Helper />
      </I18nProvider>
    ),
    root,
  );
} else {
  // Only the main window loads `App`. A static import put the whole app in the heap of each
  // Dynamic Island window, and there is one for each display.
  // Copying a selection with a formula in it gives its LaTeX source, not the typeset glyphs twice.
  void Promise.all([import("./App"), import("katex/contrib/copy-tex")]).then(([{ App }]) =>
    render(() => <App />, root),
  );
}
