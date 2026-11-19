import { canAdministerServer } from "@openbot/contracts/ipc";
import { router } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Check from "lucide-react-native/icons/check";
import { type ReactNode, useMemo } from "react";
import { View } from "react-native";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { useChatCardSurface } from "@/features/chat/components/chat-bubble-fill";
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

const BUTTON_SHAPE = "rounded-[8px]";
const ICON_SIZE = 44;

type SuggestionState = "available" | "pending" | "connected" | "notAllowed" | "unavailable";

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

function useServerAccess(serverId: string) {
  const online = useMobileWorkspaceSelector((workspace) =>
    showsOnline(workspace.servers.find((server) => server.id === serverId)),
  );
  const administers = useMobileWorkspaceSelector((workspace) =>
    canAdministerServer(workspace.servers.find((server) => server.id === serverId)?.role),
  );
  return { online, administers };
}

function blockedState(access: { online: boolean; administers: boolean }): SuggestionState {
  if (!access.online) return "pending";
  return access.administers ? "unavailable" : "notAllowed";
}

function PluginSuggestion({ serverId, messageId, slug }: { serverId: string; messageId: string; slug: string }) {
  const { session } = useMobileSession();
  const canRelay = useMobileWorkspaceSelector((workspace) => workspace.canRelayMcpSignIn(serverId));
  const macUnavailable = useMobileWorkspaceSelector((workspace) => workspace.macAppsUnavailable(serverId));
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
  const state: SuggestionState =
    macUnavailable && plugin.apps.some((entry) => entry.needsMac)
      ? "unavailable"
      : !canManage
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
            : // `attention` needs a new sign-in, `paused` needs Resume, and `unknown` failed to read: the
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
  const card = useChatCardSurface();
  const muted = useThemeColor("muted");
  const dismissed = useAppSuggestionDismissals((store) => store.ids.includes(messageId));
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
    <View className={`${frame} flex-row items-center gap-3 rounded-[20px] ${card.fillClass} p-3`} style={card.style}>
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
