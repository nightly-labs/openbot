import type { McpServerConfig } from "@openbot/contracts/ipc";
import { applyMcpFlow, type McpAuthValues } from "@openbot/contracts/mcp-connect-flows";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { type McpSignInRelayState, useMcpSignInRelay } from "@/features/servers/model/use-mcp-sign-in-relay";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import type { MobilePluginApp } from "./plugin-catalog.generated";
import { type PluginConnectMethod, pluginAppConfig, pluginKeyLinkError } from "./plugin-connect";

export type PluginConnectState =
  | { phase: "idle" }
  | { phase: "working" }
  | Exclude<McpSignInRelayState, { phase: "idle" }>
  | { phase: "done" };

export function usePluginConnect(serverId: string, app: MobilePluginApp | null, method: PluginConnectMethod | null) {
  const { t, sourceText, errorMessage } = useText();
  const { saveMcpServer, testMcpServer } = useMobileWorkspaceActions();
  const queryClient = useQueryClient();
  const queryScope = useQueryScope();
  const relay = useMcpSignInRelay(serverId);
  const [ownState, setState] = useState<PluginConnectState>({ phase: "idle" });
  const [ownError, setError] = useState<string | null>(null);
  const state: PluginConnectState = relay.state.phase === "idle" ? ownState : relay.state;
  const error = ownError ?? relay.error;

  async function save(config: McpServerConfig) {
    const list = await saveMcpServer(config, serverId);
    queryClient.setQueryData(queryKeys.mcpServers(queryScope, serverId), list);
  }

  const hostFailure = (message: string) => new Error(sourceText(message));

  async function testAndSave(config: McpServerConfig) {
    const result = await testMcpServer(config, serverId);
    if (result.error) throw hostFailure(result.error);
    await save(config);
  }

  async function run(operation: () => Promise<void>) {
    setError(null);
    relay.setError(null);
    setState({ phase: "working" });
    try {
      await mobileAnalytics.operation("marketplace_action", { entity: "plugin", action: "install" }, operation);
      if (!relay.mounted.current) return;
      void haptics.notification("success");
      setState({ phase: "done" });
    } catch (cause) {
      if (!relay.mounted.current) return;
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.marketplace.app.connectFailed")));
      setState({ phase: "idle" });
    }
  }

  function connect(values: McpAuthValues = {}) {
    if (!app || !method || state.phase !== "idle") return;
    const base = pluginAppConfig(app);
    if (method.kind === "none") return run(() => testAndSave(base));
    if (method.kind === "key") {
      const invalidLink = pluginKeyLinkError(base, method.flow, values);
      if (invalidLink) {
        setError(t("mobile.marketplace.app.linkInvalid", { hostname: new URL(base.url).hostname }));
        return;
      }
      return run(() => testAndSave(applyMcpFlow(base, method.flow, values)));
    }
    if (method.kind === "link")
      return run(async () => {
        await relay.signIn(base);
        await save(base);
      });
  }

  async function paste(address: string) {
    setError(null);
    await relay.paste(address);
  }

  return { state, error, connect, paste, pasting: relay.pasting, reopen: relay.reopen };
}
