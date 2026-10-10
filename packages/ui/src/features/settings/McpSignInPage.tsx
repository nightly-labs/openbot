/**
 * A joined server's sign-in page, on that host's browser and drawn here.
 *
 * The grant comes back on an address the host listens on, and only a browser on the host can reach
 * it. So the host opens the server's page in its own browser, and this client shows it as the live
 * view any host tab has: the user signs in there, the server sends the browser back to the host, and
 * the host keeps what it gets. Nothing comes back through this client, so the web client signs in
 * the same way the desktop does.
 *
 * The page runs in a session of its own on the host, so the sign-in leaves no cookies where agents
 * browse.
 */

import { Button, Dialog, ShieldCheck, Text } from "@openbot/ui";
import { createSignal } from "solid-js";
import { useText } from "../../text";
import BrowserLiveView, { type BrowserViewRuntime } from "../browser/BrowserLiveView";

/** The host tab with the sign-in page, and the way to watch it. */
export interface McpSignInPageSource {
  runtime: BrowserViewRuntime;
  tabId: string;
  /** Whether the host pastes and copies for a live view, so a password manager's copy works. */
  clipboard: boolean;
}

/** The page itself, at the shape of the host's frame. */
export function McpSignInPage(props: { page: McpSignInPageSource }) {
  const [shape, setShape] = createSignal("4 / 3");
  return (
    <div class="mcp-sign-in-page" style={{ "aspect-ratio": shape() }}>
      <BrowserLiveView
        runtime={props.page.runtime}
        tabId={props.page.tabId}
        active
        clipboard={props.page.clipboard}
        onFrameSize={(size) => setShape(`${size.width} / ${size.height}`)}
      />
    </div>
  );
}

/** The line under the page: where the sign-in stays. */
export function McpSignInPageNote(props: { hostName: string }) {
  const { t } = useText();
  return (
    <p class="mcp-connect-privacy mcp-sign-in-page-note">
      <ShieldCheck aria-hidden="true" />
      <Text as="span" tone="muted">
        {t("mcp.connect.keptOn", { host: props.hostName })}
      </Text>
    </p>
  );
}

export interface McpSignInPageDialogProps {
  /** The server the sign-in is for, as its row names it. */
  name: string;
  hostName: string;
  page: McpSignInPageSource;
  /**
   * Stops the sign-in. The dialog stays until the wait ends, and the caller removes it then, the
   * same as when the host took the grant.
   */
  onCancel: () => void;
}

/** The page in its own dialog, for the MCP list. It is there for as long as the sign-in waits. */
export function McpSignInPageDialog(props: McpSignInPageDialogProps) {
  const { t } = useText();
  const [cancelling, setCancelling] = createSignal(false);
  const cancel = () => {
    if (cancelling()) return;
    setCancelling(true);
    props.onCancel();
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="mcp-connect-backdrop">
          <Dialog.Content class="mcp-connect-dialog mcp-sign-in-page-dialog" as="section">
            <header class="mcp-connect-header">
              <Dialog.Title class="mcp-connect-title">{t("mcp.panel.signInTo", { name: props.name })}</Dialog.Title>
              <Dialog.Description class="mcp-connect-description">
                {t("mcp.signIn.pageDescription", { host: props.hostName })}
              </Dialog.Description>
            </header>
            <McpSignInPage page={props.page} />
            <footer class="mcp-sign-in-page-footer">
              <McpSignInPageNote hostName={props.hostName} />
              <Button type="button" variant="outline" loading={cancelling()} onClick={cancel}>
                {t("mcp.panel.cancelSignIn")}
              </Button>
            </footer>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
