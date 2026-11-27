import { installPointerFocusGuard } from "@openbot/ui/pointer-focus";
import { render } from "@solidjs/web";
import "katex/contrib/copy-tex";
import "./selection-copy";
import { App } from "./App";
import { startActionSounds } from "./action-sounds";
import { syncAppearance } from "./appearance-choice";
import "./dev-worktree";
import { createRemoteChatContent, RemoteChatContentProvider } from "./features/servers/remote-chat-content";
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
if (__OPENBOT_PERF_PROBES__) {
  const { installRendererPerfProbes } = await import("./perf-probes");
  installRendererPerfProbes();
}
installPointerFocusGuard();
syncAppearance({ windowGlass: true });
syncLogoColor();
startActionSounds();
startRendererTiming();

render(
  () => (
    <RemoteChatContentProvider value={createRemoteChatContent(window.openbot.hostAdmin)}>
      <WindowBackdropBubbles>
        <App chatWindow={readChatWindowTarget(window.location.search)} />
      </WindowBackdropBubbles>
    </RemoteChatContentProvider>
  ),
  root,
);
