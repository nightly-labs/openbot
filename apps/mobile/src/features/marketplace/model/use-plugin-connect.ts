import { type McpServerConfig, relayCallbackQuery } from "@openbot/contracts/ipc";
import { applyMcpFlow, type McpAuthValues } from "@openbot/contracts/mcp-connect-flows";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Linking } from "react-native";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { relayPage } from "@/features/servers/model/provider-admin";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import type { MobilePluginApp } from "./plugin-catalog.generated";
import { type PluginConnectMethod, pluginAppConfig, pluginKeyLinkError } from "./plugin-connect";

/** How often the host is asked how a relayed sign-in is, as on the web and the provider page. */
const RELAY_POLL_MS = 1_000;

/** Where the connect step of one app is. */
export type PluginConnectState =
  | { phase: "idle" }
  | { phase: "working" }
  /** The host waits for the page of its sign-in; the phone has not opened it yet. */
  | { phase: "waiting"; flowId: string }
  /** The page is open. A page that returns to the host's loopback address needs that address pasted back. */
  | { phase: "signIn"; flowId: string; url: string; state: string | null; paste: boolean }
  | { phase: "done" };

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, RELAY_POLL_MS));

/**
 * Connects one plugin app on the host, as the desktop connect step does for a joined host: a key is
 * tested before it is saved, and a browser sign-in is relayed (`sign-in-relay-v1`) so that the host
 * keeps the grant. The host saves the configuration that connected, never the listing's alone.
 */
export function usePluginConnect(serverId: string, app: MobilePluginApp | null, method: PluginConnectMethod | null) {
  const { t, sourceText, errorMessage } = useText();
  const { saveMcpServer, testMcpServer, mcpSignInRelay } = useMobileWorkspaceActions();
  const queryClient = useQueryClient();
  const queryScope = useQueryScope();
  const [state, setState] = useState<PluginConnectState>({ phase: "idle" });
  const [error, setError] = useState<string | null>(null);
  // A sign-in that the page leaves while it runs is ended on the host.
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

  async function save(config: McpServerConfig) {
    const list = await saveMcpServer(config, serverId);
    queryClient.setQueryData(queryKeys.mcpServers(queryScope, serverId), list);
  }

  /** A failed test or sign-in, in the words of the host. It fails the operation, so analytics counts it. */
  const hostFailure = (message: string) => new Error(sourceText(message));

  async function run(operation: () => Promise<void>) {
    setError(null);
    setState({ phase: "working" });
    try {
      await mobileAnalytics.operation("marketplace_action", { entity: "plugin", action: "install" }, operation);
      if (!mounted.current) return;
      void haptics.notification("success");
      setState({ phase: "done" });
    } catch (cause) {
      if (!mounted.current) return;
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.marketplace.app.connectFailed")));
      setState({ phase: "idle" });
    }
  }

  /** Adds an app that asks for nothing, or tests and adds one with the typed key. */
  function connect(values: McpAuthValues = {}) {
    if (!app || !method || state.phase !== "idle") return;
    const base = pluginAppConfig(app);
    if (method.kind === "none") return run(() => save(base));
    if (method.kind === "key") {
      const invalidLink = pluginKeyLinkError(base, method.flow, values);
      if (invalidLink) {
        setError(t("mobile.marketplace.app.linkInvalid", { hostname: new URL(base.url).hostname }));
        return;
      }
      const config = applyMcpFlow(base, method.flow, values);
      return run(async () => {
        const result = await testMcpServer(config, serverId);
        if (result.error) throw hostFailure(result.error);
        await save(config);
      });
    }
    if (method.kind === "link") return run(() => signIn(base));
  }

  /** The relayed sign-in: the host starts it, the phone opens the page, and the host keeps the grant. */
  async function signIn(config: McpServerConfig): Promise<void> {
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
          if (status.result.error) throw hostFailure(status.result.error);
          await save(config);
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
      // The page left while the sign-in ran, and the cleanup ended it on the host. Nothing was saved,
      // so the operation must not count as an install. No one sees this text: the page is gone.
      throw new Error("The sign-in stopped because its page closed.");
    } catch (cause) {
      if (activeFlow.current === flowId) {
        activeFlow.current = null;
        await relay.cancel(flowId).catch(() => undefined);
      }
      throw cause;
    }
  }

  /** The address the browser ended on. Only its query goes to the host. */
  async function paste(address: string) {
    if (state.phase !== "signIn") return;
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
    if (state.phase !== "signIn") return;
    void Linking.openURL(state.url).catch(() => setError(t("mobile.marketplace.app.openFailed")));
  }

  return { state, error, connect, paste, reopen };
}
