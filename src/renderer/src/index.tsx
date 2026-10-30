import { installPointerFocusGuard } from "@openbot/ui/pointer-focus";
import { render } from "@solidjs/web";
// Copying a selection with a formula in it gives its LaTeX source, not the typeset glyphs twice.
import "katex/contrib/copy-tex";
import { App } from "./App";
import { startActionSounds } from "./action-sounds";
import { syncAppearance } from "./appearance-choice";
import { readChatWindowTarget } from "./features/window/chat-window";
import { syncLogoColor } from "./logo-color";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Renderer root element was not found.");
}

// A startup mark for `dev:bench`, after the bundle is parsed.
performance.mark("openbot:renderer-start");
installPointerFocusGuard();
syncAppearance({ windowGlass: true });
syncLogoColor();
startActionSounds();

// `App` must stay a static import. Main sends the first runtime snapshot on `did-finish-load`,
// which does not wait for a dynamic import, and `App` would subscribe after it. The helper windows
// load `helper.html` instead.
render(() => <App chatWindow={readChatWindowTarget(window.location.search)} />, root);
