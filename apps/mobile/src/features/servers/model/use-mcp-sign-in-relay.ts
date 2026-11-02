import { type McpServerConfig, relayCallbackQuery } from "@openbot/contracts/ipc";
import { useEffect, useRef, useState } from "react";
import { Linking } from "react-native";
import { relayPage } from "@/features/servers/model/provider-admin";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { useText } from "@/shared/lib/text";

/** How often the host is asked how a relayed sign-in is, as on the web and the provider page. */
const RELAY_POLL_MS = 1_000;

/** Where a relayed sign-in is, while it runs. */
export type McpSignInRelayState =
  /** The host waits for the page of its sign-in; the phone has not opened it yet. */
  | { phase: "waiting"; flowId: string }
  /** The page is open. A page that returns to the host's loopback address needs that address pasted back. */
  | { phase: "signIn"; flowId: string; url: string; state: string | null; paste: boolean };

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, RELAY_POLL_MS));

/**
 * The relayed browser sign-in of an MCP server (`sign-in-relay-v1`): the host starts it, the phone
 * opens the page, and the host keeps the grant. A sign-in that the page leaves while it runs is
 * ended on the host.
 */
export function useMcpSignInRelay(serverId: string) {
  const { t, sourceText, errorMessage } = useText();
  const { mcpSignInRelay } = useMobileWorkspaceActions();
  const [state, setState] = useState<McpSignInRelayState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeFlow = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
      const flowId = activeFlow.current;
      if (flowId)
        void mcpSignInRelay(serverId)
          .cancel(flowId)
          .catch(() => undefined);
    },
    [mcpSignInRelay, serverId],
  );

  /** Resolves when the host holds the grant. Rejects with the host's words when the sign-in fails. */
  async function signIn(config: McpServerConfig): Promise<void> {
    setError(null);
    const relay = mcpSignInRelay(serverId);
    const flowId = await relay.start(config);
    activeFlow.current = flowId;
    try {
      setState({ phase: "waiting", flowId });
      let opened = false;
      while (mounted.current) {
        const status = await relay.status(flowId);
        if (status.result) {
          activeFlow.current = null;
          if (status.result.error) throw new Error(sourceText(status.result.error));
          return;
        }
        if (!opened && status.authorizeUrl) {
          const page = relayPage(status.authorizeUrl);
          if ("error" in page) throw new Error(t(page.error));
          opened = true;
          setState({ phase: "signIn", flowId, url: page.url, state: page.state, paste: page.paste });
          await Linking.openURL(page.url).catch(() => setError(t("mobile.marketplace.app.openFailed")));
        }
        await pause();
      }
      // The page left while the sign-in ran, and the cleanup ended it on the host. No one sees this
      // text: the page is gone.
      throw new Error("The sign-in stopped because its page closed.");
    } catch (cause) {
      if (activeFlow.current === flowId) {
        activeFlow.current = null;
        await relay.cancel(flowId).catch(() => undefined);
      }
      throw cause;
    } finally {
      if (mounted.current) setState(null);
    }
  }

  /** The address the browser ended on. Only its query goes to the host. */
  async function paste(address: string) {
    if (state?.phase !== "signIn") return;
    const query = relayCallbackQuery(address, state.state);
    if (query === null) {
      setError(t("mobile.marketplace.app.pasteInvalid"));
      return;
    }
    setError(null);
    // The waiting loop reads the result that this completes.
    await mcpSignInRelay(serverId)
      .complete(state.flowId, query)
      .catch((cause: unknown) => setError(errorMessage(cause, t("mobile.marketplace.app.connectFailed"))));
  }

  /** Opens the sign-in page again, for a user who closed the browser. */
  function reopen() {
    if (state?.phase !== "signIn") return;
    void Linking.openURL(state.url).catch(() => setError(t("mobile.marketplace.app.openFailed")));
  }

  return { state, error, signIn, paste, reopen };
}
