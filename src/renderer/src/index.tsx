import { installPointerFocusGuard } from "@openbot/ui/pointer-focus";
import { render } from "@solidjs/web";
import "katex/contrib/copy-tex";
import "./selection-copy";
import { App } from "./App";
import { startActionSounds } from "./action-sounds";
import { syncAppearance } from "./appearance-choice";
import "./dev-worktree";
import { WindowBackdropBubbles } from "./features/window/backdrop-bubbles";
import { readChatWindowTarget } from "./features/window/chat-window";
import { syncLogoColor } from "./logo-color";
import { startRendererTiming } from "./renderer-timing";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Renderer root element was not found.");
}

performance.mark("openbot:renderer-start");
installPointerFocusGuard();
syncAppearance({ windowGlass: true });
syncLogoColor();
startActionSounds();
startRendererTiming();

render(
  () => (
    <WindowBackdropBubbles>
      <App chatWindow={readChatWindowTarget(window.location.search)} />
    </WindowBackdropBubbles>
  ),
  root,
);
