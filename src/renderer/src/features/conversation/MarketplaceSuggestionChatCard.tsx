import type { McpServerConfig } from "@openbot/contracts/ipc";
import { connectorSummary } from "@openbot/ui/features/connectors/ConnectorDetailPanel";
import { CONNECTOR_LISTINGS } from "@openbot/ui/features/connectors/connector-catalog";
import { isConnectorId } from "@openbot/ui/features/connectors/connectors";
import {
  MarketplaceSuggestionCard,
  type MarketplaceSuggestionState,
} from "@openbot/ui/features/conversation/MarketplaceSuggestionCard";
import { isPluginAppConfig } from "@openbot/ui/features/settings/marketplace-plugins";
import { useText } from "@openbot/ui/text";
import { createMemo } from "solid-js";
import type { ConnectorRegistry } from "../connectors/connector-registry";
import { MARKETPLACE_PLUGINS } from "../settings/marketplace-plugin-catalog";
import { localizedPlugin } from "../settings/marketplace-plugin-text";
import { dismissMarketplaceSuggestion, marketplaceSuggestionDismissed } from "./marketplace-suggestion-dismissals";

export interface MarketplaceSuggestionChatCardProps {
  messageId: string;
  appId: string;
  /** The connectors of the server on screen. Without it, a connector card has no action. */
  connectors?: ConnectorRegistry | undefined;
  /** The MCP servers of the host. A catalog app is connected when the host holds each of its servers. */
  mcpServers?: readonly McpServerConfig[] | undefined;
  onOpenMarketplaceApp?: ((request: { appId: string; connect: boolean }) => void) | undefined;
}

/** True when this client can draw a card for the app: a catalog plugin, or a connector. */
export function marketplaceSuggestionKnown(appId: string): boolean {
  return isConnectorId(appId) || MARKETPLACE_PLUGINS.some((plugin) => plugin.slug === appId);
}

/**
 * The Marketplace app an agent suggested in this chat. Connect and the name open the app in
 * Marketplace, where the connect step and its dialogs run.
 */
export function MarketplaceSuggestionChatCard(props: MarketplaceSuggestionChatCardProps) {
  const { t } = useText();
  const plugin = createMemo(() => MARKETPLACE_PLUGINS.find((candidate) => candidate.slug === props.appId));
  const connector = () => {
    const id = props.appId;
    return isConnectorId(id) ? (props.connectors?.get(id) ?? { id, access: "hidden" as const }) : undefined;
  };
  const listing = () => {
    const entry = connector();
    return entry ? CONNECTOR_LISTINGS[entry.id] : undefined;
  };
  const description = () => {
    const known = listing();
    if (known) return t(known.tagline);
    const found = plugin();
    return found ? localizedPlugin(found, t).tagline : "";
  };
  /**
   * Connected when the host holds every app, and attention when it holds some, as Marketplace does
   * for apps. Marketplace also counts the plugin's skills, which belong to an agent; no catalog
   * plugin has one yet.
   */
  const pluginState = (): MarketplaceSuggestionState => {
    const apps = plugin()?.apps ?? [];
    const held = apps.map((app) => (props.mcpServers ?? []).some((config) => isPluginAppConfig(config, app)));
    if (held.length > 0 && held.every(Boolean)) return "connected";
    return held.some(Boolean) ? "attention" : "available";
  };
  const state = (): MarketplaceSuggestionState => {
    const entry = connector();
    if (!entry) return pluginState();
    if (entry.access === "loading") return "busy";
    if (entry.access !== "available") return "unavailable";
    if (entry.controller.busy()) return "busy";
    const { status } = connectorSummary(entry.controller.detail, t);
    if (status === "connected") return "connected";
    if (status === "connecting") return "busy";
    return status === "attention" ? "attention" : "available";
  };
  const name = () => {
    const known = listing();
    return known ? t(known.title) : (plugin()?.name ?? props.appId);
  };
  const open = (connect: boolean) => props.onOpenMarketplaceApp?.({ appId: props.appId, connect });
  return (
    <MarketplaceSuggestionCard
      kind="app"
      name={name()}
      description={description()}
      iconUrl={plugin()?.iconUrl ?? null}
      mark={listing()?.Mark()}
      state={state()}
      unavailableText={
        connector()?.access === "local-only"
          ? t("chat.suggestion.localOnly", { name: name() })
          : t("chat.suggestion.unavailable", { name: name() })
      }
      dismissed={marketplaceSuggestionDismissed(props.messageId)}
      onConnect={props.onOpenMarketplaceApp ? () => open(true) : undefined}
      onOpenDetails={props.onOpenMarketplaceApp && state() !== "unavailable" ? () => open(false) : undefined}
      onDismiss={() => dismissMarketplaceSuggestion(props.messageId, true)}
      onRestore={() => dismissMarketplaceSuggestion(props.messageId, false)}
    />
  );
}
