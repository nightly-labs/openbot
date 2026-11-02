import type { McpServerConfig } from "@openbot/contracts/ipc";
import { applyMcpFlow, type McpAuthValues } from "@openbot/contracts/mcp-connect-flows";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { type McpSignInRelayState, useMcpSignInRelay } from "@/features/servers/model/use-mcp-sign-in-relay";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import type { MobilePluginApp } from "./plugin-catalog.generated";
import { type PluginConnectMethod, pluginAppConfig, pluginKeyLinkError } from "./plugin-connect";

/** Where the connect step of one app is. */
export type PluginConnectState = { phase: "idle" } | { phase: "working" } | McpSignInRelayState | { phase: "done" };

/**
 * Connects one plugin app on the host, as the desktop connect step does for a joined host: a key is
 * tested before it is saved, and a browser sign-in is relayed (`sign-in-relay-v1`) so that the host
 * keeps the grant. The host saves the configuration that connected, never the listing's alone.
 */
export function usePluginConnect(serverId: string, app: MobilePluginApp | null, method: PluginConnectMethod | null) {
  const { t, sourceText, errorMessage } = useText();
  const { saveMcpServer, testMcpServer } = useMobileWorkspaceActions();
  const relay = useMcpSignInRelay(serverId);
  const queryClient = useQueryClient();
  const queryScope = useQueryScope();
  const [phase, setPhase] = useState<"idle" | "working" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  async function save(config: McpServerConfig) {
    const list = await saveMcpServer(config, serverId);
    queryClient.setQueryData(queryKeys.mcpServers(queryScope, serverId), list);
  }

  async function run(operation: () => Promise<void>) {
    setError(null);
    setPhase("working");
    try {
      await mobileAnalytics.operation("marketplace_action", { entity: "plugin", action: "install" }, operation);
      if (!mounted.current) return;
      void haptics.notification("success");
      setPhase("done");
    } catch (cause) {
      if (!mounted.current) return;
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.marketplace.app.connectFailed")));
      setPhase("idle");
    }
  }

  /** Adds an app that asks for nothing, or tests and adds one with the typed key. */
  function connect(values: McpAuthValues = {}) {
    if (!app || !method || phase !== "idle") return;
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
        // A failed test, in the words of the host. It fails the operation, so analytics counts it.
        if (result.error) throw new Error(sourceText(result.error));
        await save(config);
      });
    }
    if (method.kind === "link")
      return run(async () => {
        await relay.signIn(base);
        await save(base);
      });
  }

  const state: PluginConnectState = phase === "working" && relay.state ? relay.state : { phase };
  return { state, error: error ?? relay.error, connect, paste: relay.paste, reopen: relay.reopen };
}
