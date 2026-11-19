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

const RELAY_POLL_MS = 1_000;

export type PluginConnectState =
  | { phase: "idle" }
  | { phase: "working" }
  | { phase: "waiting"; flowId: string }
  | { phase: "signIn"; flowId: string; url: string; state: string | null; paste: boolean }
  | { phase: "done" };

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, RELAY_POLL_MS));

export function usePluginConnect(serverId: string, app: MobilePluginApp | null, method: PluginConnectMethod | null) {
  const { t, sourceText, errorMessage } = useText();
  const { saveMcpServer, testMcpServer, mcpSignInRelay } = useMobileWorkspaceActions();
  const queryClient = useQueryClient();
  const queryScope = useQueryScope();
  const [state, setState] = useState<PluginConnectState>({ phase: "idle" });
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

  async function save(config: McpServerConfig) {
    const list = await saveMcpServer(config, serverId);
    queryClient.setQueryData(queryKeys.mcpServers(queryScope, serverId), list);
  }

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
      throw new Error("The sign-in stopped because its page closed.");
    } catch (cause) {
      if (activeFlow.current === flowId) {
        activeFlow.current = null;
        await relay.cancel(flowId).catch(() => undefined);
      }
      throw cause;
    }
  }

  async function paste(address: string) {
    if (state.phase !== "signIn") return;
    const query = relayCallbackQuery(address, state.state);
    if (query === null) {
      setError(t("mobile.marketplace.app.pasteInvalid"));
      return;
    }
    setError(null);
    await mcpSignInRelay(serverId)
      .complete(state.flowId, query)
      .catch((cause: unknown) => setError(errorMessage(cause, t("mobile.marketplace.app.connectFailed"))));
  }

  function reopen() {
    if (state.phase !== "signIn") return;
    void Linking.openURL(state.url).catch(() => setError(t("mobile.marketplace.app.openFailed")));
  }

  return { state, error, connect, paste, reopen };
}
