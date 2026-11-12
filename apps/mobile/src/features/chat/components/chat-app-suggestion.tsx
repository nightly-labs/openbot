import { canAdministerServer } from "@openbot/contracts/ipc";
import { router } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Check from "lucide-react-native/icons/check";
import { type ReactNode, useMemo } from "react";
import { View } from "react-native";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { dismissAppSuggestion, useAppSuggestionDismissals } from "@/features/chat/model/app-suggestion-dismissals";
import { ListingIcon } from "@/features/marketplace/components/marketplace-parts";
import { appListings, CONNECTOR_TAGLINES } from "@/features/marketplace/model/marketplace-listings";
import { pluginConnectMethod, pluginInstalled } from "@/features/marketplace/model/plugin-connect";
import { ConnectorLogo } from "@/features/servers/components/connector-logo";
import { CONNECTOR_TITLE_KEYS, isMobileConnectorId, type MobileConnectorId } from "@/features/servers/model/connectors";
import { useConnectorRowState } from "@/features/servers/model/use-connector-rows";
import { useMcpServerList } from "@/features/servers/model/use-server-mcp";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { showsOnline } from "@/features/workspace/model/server-status";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/**
 * The card has a 20-point radius and 12 points of padding. The buttons take the difference, 8 points,
 * so their corners follow the corners of the card.
 */
const BUTTON_SHAPE = "rounded-[8px]";
const ICON_SIZE = 44;

/** `pending` waits for the state of the app on the server: the card shows Skip, but not Connect yet. */
type SuggestionState = "available" | "pending" | "connected" | "notAllowed" | "unavailable";

/**
 * A Marketplace app that an agent suggests in the chat, as on desktop: the app, Skip, and Connect.
 * Connect opens the connect step of the app, where its sign-in or key runs. Skip folds the card to one
 * line with Undo, and the phone keeps it. A card for an app that this app version does not know is not drawn.
 */
export function ChatAppSuggestion({
  serverId,
  messageId,
  appId,
}: {
  serverId: string;
  messageId: string;
  appId: string;
}) {
  if (isMobileConnectorId(appId))
    return <ConnectorSuggestion serverId={serverId} messageId={messageId} connector={appId} />;
  return <PluginSuggestion serverId={serverId} messageId={messageId} slug={appId} />;
}

/**
 * Who reads the card, apart from the permission to act: the permission is also false while the server is
 * offline or when the host lacks the capability, and then the members-only text would be false.
 */
function useServerAccess(serverId: string) {
  const online = useMobileWorkspaceSelector((workspace) =>
    showsOnline(workspace.servers.find((server) => server.id === serverId)),
  );
  const administers = useMobileWorkspaceSelector((workspace) =>
    canAdministerServer(workspace.servers.find((server) => server.id === serverId)?.role),
  );
  return { online, administers };
}

/** The state when the user cannot act now: offline waits, an owner's host lacks the feature, a member may not. */
function blockedState(access: { online: boolean; administers: boolean }): SuggestionState {
  if (!access.online) return "pending";
  return access.administers ? "unavailable" : "notAllowed";
}

function PluginSuggestion({ serverId, messageId, slug }: { serverId: string; messageId: string; slug: string }) {
  const { session } = useMobileSession();
  const canRelay = useMobileWorkspaceSelector((workspace) => workspace.canRelayMcpSignIn(serverId));
  // A member reads no MCP list, so the app shows as not connected; the card then says who can connect it.
  const { canManage, list: mcpServers } = useMcpServerList(serverId);
  const access = useServerAccess(serverId);
  const apiUrl = session?.apiUrl;
  const listing = useMemo(
    () => (apiUrl ? appListings(apiUrl).find((item) => item.id === slug) : undefined),
    [apiUrl, slug],
  );
  if (listing?.kind !== "app" || listing.source !== "plugin") return null;
  const { plugin } = listing;
  const app = plugin.apps[0] ?? null;
  const method = app ? pluginConnectMethod(app, canRelay) : null;
  const state: SuggestionState = !canManage
    ? blockedState(access)
    : mcpServers.data
      ? pluginInstalled(plugin, mcpServers.data)
        ? "connected"
        : "available"
      : // A failed read cannot tell; Connect opens the listing, which shows the real state.
        mcpServers.isError
        ? "available"
        : "pending";
  return (
    <SuggestionCard
      messageId={messageId}
      name={listing.name}
      tagline={listing.description}
      icon={<ListingIcon listing={listing} size={ICON_SIZE} />}
      state={state}
      onConnect={() => {
        // A key or a sign-in has its own page. Any other app goes to its listing, which says how it connects.
        if (method?.kind === "key" || method?.kind === "link")
          router.push({ pathname: "/marketplace-listing/connect", params: { serverId, slug } });
        else
          router.push({
            pathname: "/marketplace-listing",
            params: { serverId, kind: "app", id: slug, name: listing.name },
          });
      }}
    />
  );
}

function ConnectorSuggestion({
  serverId,
  messageId,
  connector,
}: {
  serverId: string;
  messageId: string;
  connector: MobileConnectorId;
}) {
  const { t } = useText();
  const canManage = useMobileWorkspaceSelector((workspace) => workspace.canManageConnectors(serverId));
  const access = useServerAccess(serverId);
  const rows = useConnectorRowState(serverId);
  const row = rows.rows.find((item) => item.id === connector);
  // No row and no load in progress: the host cannot run this connector.
  const loading = rows.loading.includes(connector);
  const name = t(CONNECTOR_TITLE_KEYS[connector]);
  const tagline = t(CONNECTOR_TAGLINES[connector]);
  const state: SuggestionState = !canManage
    ? blockedState(access)
    : !row
      ? loading
        ? "pending"
        : "unavailable"
      : row.status === "connecting"
        ? "pending"
        : row.status === "unavailable"
          ? "unavailable"
          : row.status === "connected"
            ? "connected"
            : // `attention` needs a new sign-in, and `unknown` failed to read: the connector page shows both.
              "available";
  return (
    <SuggestionCard
      messageId={messageId}
      name={name}
      tagline={tagline}
      icon={<ConnectorLogo id={connector} size={ICON_SIZE} />}
      state={state}
      onConnect={() => router.push({ pathname: "/server-settings/connector", params: { serverId, id: connector } })}
    />
  );
}

function SuggestionCard({
  messageId,
  name,
  tagline,
  icon,
  state,
  onConnect,
}: {
  messageId: string;
  name: string;
  tagline: string;
  icon: ReactNode;
  state: SuggestionState;
  onConnect: () => void;
}) {
  const { t } = useText();
  const muted = useThemeColor("muted");
  const dismissed = useAppSuggestionDismissals((store) => store.ids.includes(messageId));
  // The card is as wide as the widest chat bubble, as the other cards of the chat.
  const frame = "w-full max-w-[92%] self-start";

  if (dismissed && state !== "connected")
    return (
      <View className={`${frame} flex-row items-center gap-2 px-1`}>
        <Typography type="body-xs" className="flex-1 text-text-secondary" accessibilityLiveRegion="polite">
          {t("mobile.chat.appSuggestion.skipped", { name })}
        </Typography>
        <Button
          size="sm"
          variant="ghost"
          className={BUTTON_SHAPE}
          onPress={() => {
            void haptics.selection();
            dismissAppSuggestion(messageId, false);
          }}
        >
          <Button.Label className="font-sans font-semibold">{t("mobile.chat.appSuggestion.undo")}</Button.Label>
        </Button>
      </View>
    );

  const detail =
    state === "notAllowed"
      ? t("mobile.chat.appSuggestion.notAllowed", { name })
      : state === "unavailable"
        ? t("mobile.chat.appSuggestion.unavailable", { name })
        : tagline;
  return (
    <View
      className={`${frame} flex-row items-center gap-3 rounded-[20px] bg-control/60 p-3`}
      style={{ borderCurve: "circular" }}
    >
      {icon}
      <View className="min-w-0 flex-1 gap-0.5">
        <Typography weight="medium" numberOfLines={1}>
          {name}
        </Typography>
        <Typography
          type="body-xs"
          className="text-text-secondary"
          numberOfLines={state === "available" || state === "pending" ? 1 : 2}
        >
          {detail}
        </Typography>
      </View>
      {state === "connected" ? (
        <View className="flex-row items-center gap-1.5 pr-1" accessibilityLiveRegion="polite">
          <Check color={String(muted)} size={16} />
          <Typography type="body-xs" className="text-text-secondary">
            {t("mobile.marketplace.app.connected")}
          </Typography>
        </View>
      ) : (
        <View className="flex-row items-center gap-2">
          <Button
            size="sm"
            variant="tertiary"
            className={BUTTON_SHAPE}
            accessibilityLabel={t("mobile.chat.appSuggestion.skipNamed", { name })}
            onPress={() => {
              void haptics.selection();
              dismissAppSuggestion(messageId, true);
            }}
          >
            <Button.Label className="font-sans font-semibold">{t("mobile.chat.appSuggestion.skip")}</Button.Label>
          </Button>
          {state === "available" ? (
            <Button
              size="sm"
              className={BUTTON_SHAPE}
              accessibilityLabel={t("mobile.chat.appSuggestion.connectNamed", { name })}
              onPress={() => {
                void haptics.selection();
                onConnect();
              }}
            >
              <Button.Label className="font-sans font-semibold">{t("mobile.marketplace.app.connect")}</Button.Label>
            </Button>
          ) : null}
        </View>
      )}
    </View>
  );
}
