import { type MenuAction, MenuView } from "@expo/ui/community/menu";
import type { MobileTranslate } from "@openbot/i18n/mobile";
import type { Href } from "expo-router";
import { Typography } from "heroui-native";
import { Check, Plus, Settings } from "lucide-react-native";
import { type ReactNode, useEffect, useState } from "react";
import { Pressable, ScrollView, View, type ViewStyle } from "react-native";
import type { MobileSession } from "@/features/auth/api/mobile-auth";
import { mobileUserName } from "@/features/auth/api/mobile-user-name";
import type { MobileServer } from "@/features/workspace/context/mobile-workspace-context";
import { moveServerId } from "@/features/workspace/model/server-order";
import { serverStatusLabel } from "@/features/workspace/model/server-status";
import { ProfileAvatar } from "@/shared/components/profile-avatar";
import { SheetScrollEdgeEffect } from "@/shared/components/sheet-scroll-edge-effect";
import { useText } from "@/shared/lib/text";
import { ServerAvatar } from "./server-avatar";
import { ServerDrawerIconButton } from "./server-drawer-icon-button";
import { SERVER_ROW_HEIGHT, SortableServerList } from "./sortable-server-list";

interface ServerDrawerContentProps {
  activeServerId: string;
  headerHeight: number;
  listTopInset: number;
  muted: ViewStyle["backgroundColor"];
  open: boolean;
  servers: MobileServer[];
  session: MobileSession;
  sideInset: number;
  topInset: number;
  onNavigate: (href: Href) => void;
  onReorder: (serverIds: string[]) => boolean;
  onSelectServer: (serverId: string) => void;
}

/** Local or Remote, with the connection state only when it needs attention. The dot shows online or offline. */
function serverDetail(server: MobileServer, t: MobileTranslate): string {
  const label = serverKindLabel(server, t);
  const pending = server.state === "connecting" && server.initialConnectionPending;
  return pending || server.state === "error" ? `${label} · ${serverStatusLabel(server, t)}` : label;
}

function serverKindLabel(server: MobileServer, t: MobileTranslate): string {
  return server.kind === "local" ? t("mobile.server.drawer.local") : t("mobile.server.drawer.remote");
}

export function ServerDrawerContent({
  activeServerId,
  headerHeight,
  listTopInset,
  muted,
  open,
  servers,
  session,
  sideInset,
  topInset,
  onNavigate,
  onReorder,
  onSelectServer,
}: ServerDrawerContentProps) {
  const { t } = useText();
  const displayName = mobileUserName(session.user);
  const avatarUrl = session.user.avatarUrl ? new URL(session.user.avatarUrl, session.apiUrl).toString() : null;
  const mutedColor = String(muted);
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const localServers = servers.filter((server) => server.kind === "local");
  const remoteIds = servers.filter((server) => server.kind !== "local").map((server) => server.id);
  const canReorder = remoteIds.length > 1;
  const menuActions: MenuAction[] = [{ id: "options", title: t("mobile.server.drawer.options"), image: "gearshape" }];
  if (canReorder)
    menuActions.push({ id: "reorder", title: t("mobile.server.drawer.editOrder"), image: "arrow.up.arrow.down" });

  // A drag cut short by leaving edit mode never reports its end, so leaving also releases the scroll lock.
  const stopEditing = () => {
    setEditing(false);
    setDragging(false);
  };

  useEffect(() => {
    if (open) return;
    setEditing(false);
    setDragging(false);
  }, [open]);

  function move(serverId: string, targetIndex: number) {
    const next = moveServerId(remoteIds, serverId, targetIndex);
    if (next.join("\n") !== remoteIds.join("\n")) onReorder(next);
  }

  const openOptions = (serverId: string) => onNavigate({ pathname: "/server-settings", params: { serverId } });

  function renderRow(serverItem: MobileServer) {
    const selected = serverItem.id === activeServerId;
    const remoteIndex = remoteIds.indexOf(serverItem.id);
    const serverLabel = serverKindLabel(serverItem, t);
    const accessibilityActions = [
      ...(editing ? [] : [{ name: "options", label: t("mobile.server.drawer.serverOptions") }]),
      ...(remoteIndex > 0 ? [{ name: "moveUp", label: t("mobile.server.drawer.moveUp") }] : []),
      ...(remoteIndex >= 0 && remoteIndex < remoteIds.length - 1
        ? [{ name: "moveDown", label: t("mobile.server.drawer.moveDown") }]
        : []),
    ];
    return (
      <Pressable
        key={serverItem.id}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`${serverItem.name}, ${serverLabel}, ${serverStatusLabel(serverItem, t)}`}
        accessibilityActions={accessibilityActions}
        onAccessibilityAction={(event) => {
          const action = event.nativeEvent.actionName;
          if (action === "options") openOptions(serverItem.id);
          if (action === "moveUp") move(serverItem.id, remoteIndex - 1);
          if (action === "moveDown") move(serverItem.id, remoteIndex + 1);
        }}
        className={`flex-row items-center gap-3 rounded-2xl px-2.5 ${selected ? "bg-control" : ""}`}
        onPress={editing ? undefined : () => onSelectServer(serverItem.id)}
        style={({ pressed }) => ({ height: SERVER_ROW_HEIGHT - 8, opacity: pressed ? 0.58 : 1 })}
      >
        <ServerAvatar server={serverItem} />
        <View className="min-w-0 flex-1">
          <Typography.Paragraph
            weight="medium"
            className={serverItem.state === "online" ? undefined : "text-text-secondary"}
            numberOfLines={1}
          >
            {serverItem.name}
          </Typography.Paragraph>
          <Typography.Paragraph
            type="body-xs"
            className={serverItem.state === "error" ? "text-danger-text" : "text-text-secondary"}
            numberOfLines={1}
          >
            {serverDetail(serverItem, t)}
          </Typography.Paragraph>
        </View>
      </Pressable>
    );
  }

  // Every row gets the same fixed slot, so the list keeps its spacing in edit mode and in the menu wrapper.
  function rowSlot(serverItem: MobileServer, row: ReactNode) {
    return (
      <View key={serverItem.id} className="justify-center" style={{ height: SERVER_ROW_HEIGHT }}>
        {row}
      </View>
    );
  }

  function withMenu(serverItem: MobileServer) {
    return rowSlot(
      serverItem,
      <MenuView
        shouldOpenOnLongPress
        actions={menuActions}
        onPressAction={(event) => {
          if (event.nativeEvent.event === "options") openOptions(serverItem.id);
          if (event.nativeEvent.event === "reorder") setEditing(true);
        }}
      >
        {renderRow(serverItem)}
      </MenuView>,
    );
  }

  return (
    <>
      <ScrollView
        className="flex-1"
        contentContainerClassName="pr-3"
        contentContainerStyle={{ paddingTop: listTopInset }}
        contentInsetAdjustmentBehavior="never"
        scrollEnabled={!dragging}
        showsVerticalScrollIndicator={false}
      >
        {localServers.map((serverItem) =>
          editing ? rowSlot(serverItem, renderRow(serverItem)) : withMenu(serverItem),
        )}
        {localServers.length && remoteIds.length ? (
          <View accessibilityElementsHidden className="mx-2.5 my-4 h-px bg-grouped-border" />
        ) : null}
        {editing ? (
          <SortableServerList
            color={mutedColor}
            ids={remoteIds}
            renderRow={(id) => {
              const serverItem = servers.find((candidate) => candidate.id === id);
              return serverItem ? renderRow(serverItem) : null;
            }}
            onDragActive={setDragging}
            onReorder={onReorder}
          />
        ) : (
          servers.filter((serverItem) => serverItem.kind !== "local").map(withMenu)
        )}
        {editing && localServers.length ? (
          <Typography.Paragraph type="body-xs" className="px-3 pt-3 text-text-secondary">
            {t("mobile.server.drawer.orderHint")}
          </Typography.Paragraph>
        ) : null}
      </ScrollView>

      <SheetScrollEdgeEffect
        style={{ height: headerHeight + 20, left: -sideInset, position: "absolute", right: -34, top: 0, zIndex: 10 }}
      />

      <View
        className="absolute right-0 z-20 h-14 flex-row items-center justify-between pr-3"
        pointerEvents="box-none"
        style={{ left: -sideInset, paddingLeft: sideInset + 12, top: Math.max(topInset, 16) }}
      >
        <Typography.Heading type="h1" weight="bold">
          {t("mobile.server.drawer.title")}
        </Typography.Heading>
        {editing ? (
          <ServerDrawerIconButton
            accessibilityLabel={t("mobile.server.drawer.doneEditing")}
            color={mutedColor}
            fallbackVariant="filled"
            systemName="checkmark"
            onPress={stopEditing}
          >
            <Check color={mutedColor} size={18} strokeWidth={2} />
          </ServerDrawerIconButton>
        ) : (
          <ServerDrawerIconButton
            accessibilityLabel={t("mobile.server.drawer.join")}
            color={mutedColor}
            fallbackVariant="filled"
            systemName="plus"
            onPress={() => onNavigate("/add-server")}
          >
            <Plus color={mutedColor} size={18} strokeWidth={2} />
          </ServerDrawerIconButton>
        )}
      </View>

      <View className="mr-3 flex-row items-center gap-2 pt-2">
        <View className="min-h-14 min-w-0 flex-1 flex-row items-center gap-2.5 rounded-2xl px-2 py-2">
          <ProfileAvatar neutral name={displayName} imageUrl={avatarUrl} size={36} />
          <View className="min-w-0 flex-1">
            <Typography.Paragraph type="body-sm" weight="semibold" numberOfLines={1}>
              {displayName}
            </Typography.Paragraph>
            <Typography.Paragraph type="body-xs" className="text-text-secondary" numberOfLines={1} selectable>
              {session.user.email}
            </Typography.Paragraph>
          </View>
        </View>
        <ServerDrawerIconButton
          accessibilityLabel={t("mobile.server.drawer.settings")}
          color={mutedColor}
          systemName="gearshape"
          onPress={() => onNavigate("/settings")}
        >
          <Settings color={mutedColor} size={18} strokeWidth={1.8} />
        </ServerDrawerIconButton>
      </View>
    </>
  );
}
