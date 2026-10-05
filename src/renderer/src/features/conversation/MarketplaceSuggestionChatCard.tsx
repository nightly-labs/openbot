import { GITHUB_MARKETPLACE_APP_ID, type GitHubConnectorStatus } from "@openbot/contracts/ipc";
import {
  MarketplaceSuggestionCard,
  type MarketplaceSuggestionState,
} from "@openbot/ui/features/conversation/MarketplaceSuggestionCard";
import { GitHubMark } from "@openbot/ui/features/settings/IntegrationLayout";
import { useText } from "@openbot/ui/text";
import { createMemo, createSignal, onSettled, untrack } from "solid-js";
import { githubConnectorPort } from "../connectors/github-connector-port";
import { MARKETPLACE_PLUGINS } from "../settings/marketplace-plugin-catalog";
import { dismissMarketplaceSuggestion, marketplaceSuggestionDismissed } from "./marketplace-suggestion-dismissals";

export interface MarketplaceSuggestionChatCardProps {
  messageId: string;
  appId: string;
  /** GitHub connects only on the computer that runs OpenBot. */
  localServer: boolean;
  onOpenMarketplaceApp?: ((request: { appId: string; connect: boolean }) => void) | undefined;
}

/** True when this client can draw a card for the app: a catalog plugin, or GitHub. */
export function marketplaceSuggestionKnown(appId: string): boolean {
  return appId === GITHUB_MARKETPLACE_APP_ID || MARKETPLACE_PLUGINS.some((plugin) => plugin.slug === appId);
}

/**
 * The Marketplace app an agent suggested in this chat. Connect and the name open the app in
 * Marketplace, where the connect step and its dialogs run.
 */
export function MarketplaceSuggestionChatCard(props: MarketplaceSuggestionChatCardProps) {
  const { t } = useText();
  const plugin = createMemo(() => MARKETPLACE_PLUGINS.find((candidate) => candidate.slug === props.appId));
  const github = () => props.appId === GITHUB_MARKETPLACE_APP_ID;
  // Only the desktop app of the computer that runs OpenBot has this connection, and `window.openbot`.
  const githubStatus = createGitHubStatus(untrack(() => github() && props.localServer));
  const state = (): MarketplaceSuggestionState => {
    if (!github()) return "available";
    const status = githubStatus();
    if (!props.localServer || status?.available === false) return "unavailable";
    if (status?.state === "connected") return "connected";
    if (status?.state === "pending") return "busy";
    return status?.state === "expired" ? "attention" : "available";
  };
  const open = (connect: boolean) => props.onOpenMarketplaceApp?.({ appId: props.appId, connect });
  return (
    <MarketplaceSuggestionCard
      kind="app"
      name={github() ? t("connector.github.title") : (plugin()?.name ?? props.appId)}
      description={github() ? t("marketplace.app.githubTagline") : (plugin()?.tagline ?? "")}
      iconUrl={plugin()?.iconUrl ?? null}
      mark={github() ? <GitHubMark /> : undefined}
      state={state()}
      unavailableText={
        props.localServer ? t("chat.suggestion.githubUnavailable") : t("chat.suggestion.githubLocalOnly")
      }
      dismissed={marketplaceSuggestionDismissed(props.messageId)}
      onConnect={props.onOpenMarketplaceApp ? () => open(true) : undefined}
      onOpenDetails={props.onOpenMarketplaceApp && state() !== "unavailable" ? () => open(false) : undefined}
      onDismiss={() => dismissMarketplaceSuggestion(props.messageId, true)}
      onRestore={() => dismissMarketplaceSuggestion(props.messageId, false)}
    />
  );
}

/**
 * This computer's GitHub connection, read once and then followed, for a GitHub card. Null until the
 * first read. A failed read keeps the last status, as the Marketplace does.
 */
function createGitHubStatus(enabled: boolean) {
  const [status, setStatus] = createSignal<GitHubConnectorStatus | null>(null);
  onSettled(() => {
    if (!enabled) return;
    let live = true;
    const port = githubConnectorPort();
    const unsubscribe = port.onChanged((next) => {
      if (live) setStatus(next);
    });
    void port
      .status()
      .then((next) => {
        if (live) setStatus(next);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      unsubscribe();
    };
  });
  return status;
}
