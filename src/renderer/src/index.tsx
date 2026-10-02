import { installPointerFocusGuard } from "@openbot/ui/pointer-focus";
import { render } from "@solidjs/web";
// Copying a selection with a formula in it gives its LaTeX source, not the typeset glyphs twice.
import "katex/contrib/copy-tex";
import { App } from "./App";
import { startActionSounds } from "./action-sounds";
import { syncLogoColor } from "./logo-color";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Renderer root element was not found.");
}

installPointerFocusGuard();
syncLogoColor();
startActionSounds();

// `App` must stay a static import. Main sends the first runtime snapshot on `did-finish-load`,
// which does not wait for a dynamic import, and `App` would subscribe after it. The helper windows
// load `helper.html` instead.
render(() => <App />, root);
