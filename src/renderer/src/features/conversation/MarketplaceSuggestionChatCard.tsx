import type { McpServerConfig } from "@openbot/contracts/ipc";
import type { AgentMessage } from "@openbot/ui/data";
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
import { marketplacePlugins } from "../settings/marketplace-plugin-source";
import { localizedPlugin } from "../settings/marketplace-plugin-text";
import { useConversationViewScope } from "./conversation-scope";
import { dismissMarketplaceSuggestion, marketplaceSuggestionDismissed } from "./marketplace-suggestion-dismissals";

export interface MarketplaceSuggestionChatCardProps {
  messageId: string;
  appId: string;
  connectors?: ConnectorRegistry | undefined;
  mcpServers?: readonly McpServerConfig[] | undefined;
  onOpenMarketplaceApp?: ((request: { appId: string; connect: boolean }) => void) | undefined;
}

export function marketplaceSuggestionKnown(appId: string): boolean {
  return isConnectorId(appId) || marketplacePlugins().some((plugin) => plugin.slug === appId);
}

export function MarketplaceSuggestionChatCard(props: MarketplaceSuggestionChatCardProps) {
  const { t } = useText();
  const plugin = createMemo(() => marketplacePlugins().find((candidate) => candidate.slug === props.appId));
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
  const unavailableText = () => {
    if (connector()?.access === "local-only") return t("chat.suggestion.localOnly", { name: name() });
    if (props.connectors && !props.connectors.canManage()) return t("chat.suggestion.notAllowed", { name: name() });
    return t("chat.suggestion.unavailable", { name: name() });
  };
  return (
    <MarketplaceSuggestionCard
      kind="app"
      name={name()}
      description={description()}
      iconUrl={plugin()?.iconUrl ?? null}
      mark={listing()?.Mark()}
      state={state()}
      unavailableText={unavailableText()}
      dismissed={marketplaceSuggestionDismissed(props.messageId)}
      onConnect={props.onOpenMarketplaceApp ? () => open(true) : undefined}
      onOpenDetails={props.onOpenMarketplaceApp && state() !== "unavailable" ? () => open(false) : undefined}
      onDismiss={() => dismissMarketplaceSuggestion(props.messageId, true)}
      onRestore={() => dismissMarketplaceSuggestion(props.messageId, false)}
    />
  );
}

export function useThreadMarketplaceSuggestionCard() {
  const { props, mcpServers } = useConversationViewScope();
  return (message: AgentMessage) => {
    const marker = message.actionMarker;
    if (marker?.kind !== "marketplace-suggestion" || !marketplaceSuggestionKnown(marker.appId)) return undefined;
    return (
      <MarketplaceSuggestionChatCard
        messageId={message.id}
        appId={marker.appId}
        connectors={props.connectors}
        mcpServers={mcpServers()}
        onOpenMarketplaceApp={props.onOpenMarketplaceApp}
      />
    );
  };
}
