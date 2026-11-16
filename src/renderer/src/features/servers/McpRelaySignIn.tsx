import { McpSignInRelayDialog } from "@openbot/ui/features/settings/McpSignInPage";
import { createEffect, createMemo, Show } from "solid-js";
import type { McpServerTools } from "./mcp-server-tools";
import type { McpServerConfig } from "./mcp-servers";

/**
 * The dialog of a relayed sign-in that waits (`sign-in-relay-v1`), for the form and the connection
 * card. When the dialog leaves with its sign-in, `returnFocus` gets the focus one frame later.
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

  createEffect(
    () => relayPage() !== null,
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
  );
}
