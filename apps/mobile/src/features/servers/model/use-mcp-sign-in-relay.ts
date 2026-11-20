import { type McpServerConfig, relayCallbackQuery } from "@openbot/contracts/ipc";
import { useEffect, useRef, useState } from "react";
import { Linking } from "react-native";
import { relayPage } from "@/features/servers/model/provider-admin";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { useText } from "@/shared/lib/text";

const RELAY_POLL_MS = 1_000;

export const RELAY_PASTE_PLACEHOLDER = "http://localhost/callback?code=…";

export type McpSignInRelayState =
  | { phase: "idle" }
  | { phase: "waiting"; flowId: string }
  | { phase: "signIn"; flowId: string; url: string; state: string | null; paste: boolean };

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, RELAY_POLL_MS));

export function useMcpSignInRelay(serverId: string) {
  const { t, sourceText, errorMessage } = useText();
  const { mcpSignInRelay } = useMobileWorkspaceActions();
  const [state, setState] = useState<McpSignInRelayState>({ phase: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const activeFlow = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const flowId = activeFlow.current;
      activeFlow.current = null;
      if (flowId)
        void mcpSignInRelay(serverId)
          .cancel(flowId)
          .catch(() => undefined);
    };
  }, [mcpSignInRelay, serverId]);

  async function signIn(config: McpServerConfig): Promise<void> {
    setError(null);
    const relay = mcpSignInRelay(serverId);
    const flowId = await relay.start(config);
    activeFlow.current = flowId;
    try {
      setState({ phase: "waiting", flowId });
      let opened = false;
      while (mounted.current && activeFlow.current === flowId) {
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
      throw new Error("The sign-in stopped because its page closed.");
    } catch (cause) {
      if (activeFlow.current === flowId) {
        activeFlow.current = null;
        await relay.cancel(flowId).catch(() => undefined);
      }
      throw cause;
    } finally {
      if (mounted.current) {
        setState({ phase: "idle" });
        setPasting(false);
      }
    }
  }

  async function paste(address: string) {
    if (state.phase !== "signIn") return;
    const query = relayCallbackQuery(address, state.state);
    if (query === null) {
      setError(t("mobile.marketplace.app.pasteInvalid"));
      return;
    }
    if (pasting) return;
    setError(null);
    setPasting(true);
    await mcpSignInRelay(serverId)
      .complete(state.flowId, query)
      .catch((cause: unknown) => setError(errorMessage(cause, t("mobile.marketplace.app.connectFailed"))))
      .finally(() => {
        if (mounted.current) setPasting(false);
      });
  }

  function reopen() {
    if (state.phase !== "signIn") return;
    void Linking.openURL(state.url).catch(() => setError(t("mobile.marketplace.app.openFailed")));
  }

  return { state, error, setError, mounted, pasting, signIn, paste, reopen };
}
