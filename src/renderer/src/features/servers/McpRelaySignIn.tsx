import { McpSignInPageDialog, McpSignInRelayDialog } from "@openbot/ui/features/settings/McpSignInPage";
import { createEffect, createMemo, Show } from "solid-js";
import type { McpServerTools } from "./mcp-server-tools";
import type { McpServerConfig } from "./mcp-servers";

export function McpRelaySignIn(props: {
  tools: McpServerTools;
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
