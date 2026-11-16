import { McpSignInPageDialog, McpSignInRelayDialog } from "@openbot/ui/features/settings/McpSignInPage";
import { createEffect, createMemo, Show } from "solid-js";
import type { McpServerTools } from "./mcp-server-tools";
import type { McpServerConfig } from "./mcp-servers";

/**
 * The dialog of a relayed sign-in that waits (`sign-in-relay-v1`), for the form and the connection
 * card. A page that only the joined server can reach shows instead in the host's own tab, through the
 * live view. When the dialog leaves with its sign-in, `returnFocus` gets the focus one frame later.
 */
export function McpRelaySignIn(props: {
  tools: McpServerTools;
  /** The config of the sign-in that waits for the browser, if any. */
  pending: McpServerConfig | null | undefined;
  onCancel: (url: string) => void;
  returnFocus: () => HTMLElement | undefined;
}) {
  const relayPage = createMemo(
    () => {
      const relay = props.tools.signIn()?.relay;
      const pending = props.pending;
      const page = relay && pending ? relay.page(pending.url) : undefined;
      return relay && pending && page ? { relay, url: pending.url, name: pending.name, page } : null;
    },
    {
      equals: (previous, next) =>
        previous?.url === next?.url &&
        previous?.page.authorizeHost === next?.page.authorizeHost &&
        previous?.page.url === next?.page.url &&
        previous?.page.listening === next?.page.listening,
    },
  );

  const hostPage = createMemo(
    () => {
      const hostTab = props.tools.signIn()?.hostTab;
      const pending = props.pending;
      const page = hostTab && pending ? hostTab.page(pending.url) : undefined;
      return hostTab && pending && page
        ? { hostName: hostTab.hostName, url: pending.url, name: pending.name, page }
        : null;
    },
    { equals: (previous, next) => previous?.url === next?.url && previous?.page.tabId === next?.page.tabId },
  );

  createEffect(
    () => relayPage() !== null || hostPage() !== null,
    (open, previous) => {
      if (open || !previous) return;
      requestAnimationFrame(() => {
        const target = props.returnFocus();
        if (target?.isConnected && !document.querySelector(".integration-wizard-dialog"))
          target.focus({ preventScroll: true });
      });
    },
  );

  // Keyed by the page, so each sign-in opens a dialog of its own and a Cancel does not carry over.
  return (
    <>
      <Show when={hostPage()} keyed>
        {(open) => (
          <McpSignInPageDialog
            name={open.name}
            hostName={open.hostName}
            page={open.page}
            onCancel={() => props.onCancel(open.url)}
          />
        )}
      </Show>
      <Show when={relayPage()} keyed>
        {(open) => (
          <McpSignInRelayDialog
            name={open.name}
            hostName={open.relay.hostName}
            page={open.page}
            onOpen={() => open.relay.open(open.url)}
            onPaste={(address) => open.relay.paste(open.url, address)}
            onCancel={() => props.onCancel(open.url)}
          />
        )}
      </Show>
    </>
  );
}
