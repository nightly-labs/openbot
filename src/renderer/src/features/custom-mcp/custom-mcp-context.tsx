import { onSettled } from "solid-js";
import { createSimpleContext } from "../../simple-context";
import { createCustomMcpStore } from "./stores/custom-mcp-store";

/**
 * The user's own MCP servers. Mounted above `ServerScopeBoundary`, like custom providers: a server
 * is injected into provider sessions on *this* computer, so a server switch must not discard it.
 */
const CustomMcp = createSimpleContext({
  name: "Custom MCP",
  init: () => {
    const store = createCustomMcpStore(() => window.openbot.customMcp);
    onSettled(() => {
      void store.refreshCustomMcp().catch(() => undefined);
    });
    return store;
  },
});

export const CustomMcpProvider = CustomMcp.provider;
export const useCustomMcp = CustomMcp.use;
