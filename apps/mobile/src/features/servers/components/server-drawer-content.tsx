import type { MobileTranslate } from "@openbot/i18n/mobile";
import type { Href } from "expo-router";
import { Typography } from "heroui-native";
import type { LucideIcon } from "lucide-react-native";
import CalendarClock from "lucide-react-native/icons/calendar-clock";
import ChartArea from "lucide-react-native/icons/chart-area";
import Check from "lucide-react-native/icons/check";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import Folder from "lucide-react-native/icons/folder";
import GalleryVerticalEnd from "lucide-react-native/icons/gallery-vertical-end";
import ListChecks from "lucide-react-native/icons/list-checks";
import Monitor from "lucide-react-native/icons/monitor";
import Pin from "lucide-react-native/icons/pin";
import PinOff from "lucide-react-native/icons/pin-off";
import Plus from "lucide-react-native/icons/plus";
import Settings from "lucide-react-native/icons/settings";
import Sparkles from "lucide-react-native/icons/sparkles";
import Store from "lucide-react-native/icons/store";
import UsersRound from "lucide-react-native/icons/users-round";
import Waypoints from "lucide-react-native/icons/waypoints";
import {
  Fragment,
  memo,
  type PropsWithChildren,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Alert, Pressable, ScrollView, View, type ViewStyle } from "react-native";
import Animated, {
  cubicBezier,
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useCSSVariable, useUniwind } from "uniwind";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import type { MobileSession } from "@/features/auth/api/mobile-auth";
import { mobileUserName } from "@/features/auth/api/mobile-user-name";
import { hostedServerCalls } from "@/features/servers/api/hosted-servers";
import {
  type DrawerToolId,
  isDrawerToolId,
  reorderDrawerTools,
  setDrawerToolPinned,
  useDrawerToolLayout,
} from "@/features/servers/model/drawer-tools";
import {
  refreshHostedServerAvailability,
  useHostedServerAvailability,
} from "@/features/servers/model/hosted-server-availability";
import { DrawerPinnedWorkflows, useDrawerWorkflows } from "@/features/workflows/components/drawer-workflows";
import { type MobileServer, useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { moveServerId } from "@/features/workspace/model/server-order";
import { serverRowState } from "@/features/workspace/model/server-row-state";
import { serverStatusLabel, showsOnline } from "@/features/workspace/model/server-status";
import { type MenuAction, type MenuComponentRef, MenuView } from "@/shared/components/menu-view";
import { ProfileAvatar } from "@/shared/components/profile-avatar";
import { devFeatureOverride } from "@/shared/lib/dev-feature-overrides";
import { haptics } from "@/shared/lib/haptics";
import { refreshMobileFeatures, useMobileFeature } from "@/shared/lib/mobile-features";
import { useReducedMotion } from "@/shared/lib/motion";
import { isAndroid, longPressDelay } from "@/shared/lib/platform";
import { currentText, useText } from "@/shared/lib/text";
import { MIRROR_IN_RTL } from "@/shared/lib/text-direction";
import { typeScale } from "@/shared/lib/type-scale";
import { DrawerCredits } from "./drawer-credits";
import { DrawerHeaderBlur } from "./drawer-header-blur";
import { SERVER_AVATAR_CORNER_RATIO, ServerAvatar } from "./server-avatar";
import { ServerDrawerIconButton } from "./server-drawer-icon-button";
import { SERVER_ROW_HEIGHT, SortableServerList } from "./sortable-server-list";
import { useDrawerMemberCount, useDrawerServerValues } from "./use-drawer-server-values";

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const SERVER_LIST_MOTION = { duration: 240, easing: EASE_OUT };
const SERVER_AVATAR_SIZE = 40;
const HEADER_AVATAR_SIZE = 48;
const HEADER_FADE_START = 16;
const HEADER_EDGE = 16;
const LIST_TOP_GAP = 8;
const DRAWER_ROW_HEIGHT = 46;
const UNPINNED_OPACITY = 0.5;
const UNAVAILABLE_OPACITY = 0.45;
const PROFILE_ROW_OVERHANG = 12;

interface ServerDrawerContentProps {
  activeServerId: string;
  muted: ViewStyle["backgroundColor"];
  open: boolean;
  servers: MobileServer[];
  session: MobileSession;
  sideInset: number;
  topInset: number;
  onNavigate: (href: Href) => void;
  onLeave: (serverId: string) => Promise<void>;
  onRemove: (serverId: string) => Promise<void>;
  onDelete: (serverId: string) => Promise<void>;
  onSetHidden: (serverId: string, hidden: boolean) => Promise<void>;
  localServerKind: (serverId: string) => "computer" | "onComputer" | null;
  onReorder: (serverIds: string[]) => boolean;
  onSelectServer: (serverId: string) => void;
}

function serverDetail(server: MobileServer, t: MobileTranslate): string {
  const label = serverKindLabel(server, t);
  const pending = server.state === "connecting" && server.initialConnectionPending;
  return pending || server.state === "error" ? `${label} · ${serverStatusLabel(server, t)}` : label;
}

type ServerExit = "leave" | "remove" | "delete";

const EXIT_TEXT = {
  leave: {
    action: "mobile.server.settings.leave",
    title: "mobile.server.settings.leaveTitle",
    body: "mobile.server.settings.leaveBody",
    failed: "mobile.server.drawer.leaveFailed",
  },
  remove: {
    action: "mobile.server.settings.remove",
    title: "mobile.server.settings.removeTitle",
    body: "mobile.server.settings.removeBody",
    failed: "mobile.server.drawer.removeFailed",
  },
  delete: {
    action: "mobile.server.settings.delete",
    title: "mobile.server.settings.deleteTitle",
    body: "mobile.server.settings.deleteBody",
    failed: "mobile.server.drawer.deleteFailed",
  },
} as const;

function isServerExit(value: string): value is ServerExit {
  return value === "leave" || value === "remove" || value === "delete";
}

const VISIBILITY_TEXT = {
  hide: { action: "mobile.server.drawer.hide", failed: "mobile.server.drawer.hideFailed" },
  show: { action: "mobile.server.drawer.show", failed: "mobile.server.drawer.showFailed" },
} as const;

type ServerVisibility = keyof typeof VISIBILITY_TEXT;

function isServerVisibility(value: string): value is ServerVisibility {
  return value === "hide" || value === "show";
}

function serverKindLabel(server: MobileServer, t: MobileTranslate): string {
  return server.kind === "local" ? t("mobile.server.drawer.local") : t("mobile.server.drawer.remote");
}

export const ServerDrawerContent = memo(function ServerDrawerContent({
  activeServerId,
  muted,
  open,
  servers,
  session,
  sideInset,
  topInset,
  onNavigate,
  onLeave,
  onRemove,
  onDelete,
  onSetHidden,
  localServerKind,
  onReorder,
  onSelectServer,
}: ServerDrawerContentProps) {
  const { t } = useText();
  const { theme } = useUniwind();
  const reducedMotion = useReducedMotion();
  const menus = useRef(new Map<string, MenuComponentRef | null>());
  const displayName = mobileUserName(session.user);
  const avatarUrl = session.user.avatarUrl ? new URL(session.user.avatarUrl, session.apiUrl).toString() : null;
  const mutedColor = String(muted);
  const controlColor = useCSSVariable("--openbot-bg-control");
  const [editing, setEditing] = useState(false);
  const [editingTools, setEditingTools] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [rowWidth, setRowWidth] = useState<number>();
  const visibleServers = servers.filter((server) => !server.hidden);
  const hiddenServers = servers.filter((server) => server.hidden);
  const activeServer = visibleServers.find((server) => server.id === activeServerId);
  const serverIds = visibleServers.map((server) => server.id);
  const canReorder = serverIds.length > 1;
  const showsList = listOpen || editing || !activeServer;
  const showsHidden = hiddenOpen || serverIds.length === 0;
  const reorderVisible = (ids: string[]) => {
    const visible = new Set(serverIds);
    let index = 0;
    return onReorder(servers.map((server) => (visible.has(server.id) ? (ids[index++] ?? server.id) : server.id)));
  };
  const memberCount = useDrawerMemberCount(activeServer?.id ?? "");
  const hostedServerIds = useHostedServerAvailability((state) =>
    state.userId === session.user.id ? state.serverIds : null,
  );
  const exiting = useRef(false);
  function serverExit(server: MobileServer): ServerExit | null {
    if (server.role !== "owner") return "leave";
    if (localServerKind(server.id) === "onComputer") return "delete";
    return hostedServerIds && !hostedServerIds.has(server.id) ? "remove" : null;
  }
  function serverVisibility(server: MobileServer): ServerVisibility | null {
    if (server.hidden) return "show";
    return serverIds.length > 1 ? "hide" : null;
  }
  function menuActions(server: MobileServer): MenuAction[] {
    const actions: MenuAction[] =
      canReorder && !server.hidden
        ? [{ id: "reorder", title: t("mobile.server.drawer.editOrder"), image: "arrow.up.arrow.down" }]
        : [];
    const visibility = serverVisibility(server);
    if (visibility)
      actions.push({
        id: visibility,
        title: t(VISIBILITY_TEXT[visibility].action),
        image: visibility === "hide" ? "eye.slash" : "eye",
      });
    const exit = serverExit(server);
    if (exit)
      actions.push({
        id: "exit",
        title: "",
        displayInline: true,
        subactions: [
          {
            id: exit,
            title: t(EXIT_TEXT[exit].action),
            image: exit === "leave" ? "rectangle.portrait.and.arrow.right" : "trash",
            attributes: { destructive: true },
          },
        ],
      });
    return actions;
  }

  function confirmExit(server: MobileServer, exit: ServerExit) {
    const text = EXIT_TEXT[exit];
    Alert.alert(t(text.title, { name: server.name }), t(text.body), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t(text.action),
        style: "destructive",
        onPress: () => void exitServer(server, exit),
      },
    ]);
  }

  async function exitServer(server: MobileServer, exit: ServerExit) {
    if (exiting.current) return;
    exiting.current = true;
    try {
      await (exit === "leave" ? onLeave : exit === "remove" ? onRemove : onDelete)(server.id);
      void haptics.notification("success");
    } catch (error) {
      void haptics.notification("error");
      const text = currentText();
      showFailureAlert(
        error,
        "team",
        text.t(EXIT_TEXT[exit].failed, { name: server.name }),
        text.errorMessage(error, text.t("mobile.server.drawer.actionFailed")),
      );
    } finally {
      exiting.current = false;
    }
  }

  async function changeVisibility(server: MobileServer, visibility: ServerVisibility) {
    if (exiting.current) return;
    exiting.current = true;
    try {
      await onSetHidden(server.id, visibility === "hide");
      void haptics.notification("success");
    } catch (error) {
      void haptics.notification("error");
      const text = currentText();
      showFailureAlert(
        error,
        "team",
        text.t(VISIBILITY_TEXT[visibility].failed, { name: server.name }),
        text.errorMessage(error, text.t("mobile.server.drawer.actionFailed")),
      );
    } finally {
      exiting.current = false;
    }
  }

  const stopEditing = () => {
    void haptics.selection();
    setEditing(false);
    setEditingTools(false);
    setDragging(false);
  };

  const editTools = useCallback(() => {
    void haptics.selection();
    setEditing(false);
    setListOpen(false);
    setEditingTools(true);
  }, []);

  useEffect(() => {
    if (open) return;
    setEditing(false);
    setEditingTools(false);
    setDragging(false);
    setListOpen(false);
    setHiddenOpen(false);
  }, [open]);

  const accountHasPlans = useHostedServerAvailability((state) => state.userId === session.user.id && state.available);
  const ownsHostedServers = useHostedServerAvailability(
    (state) => state.userId === session.user.id && state.ownsServers,
  );
  const cloudServersOn = useMobileFeature(session.apiUrl, "cloudServers");
  const showsPlans = devFeatureOverride("cloudServers") ?? ((accountHasPlans && cloudServersOn) || ownsHostedServers);
  useEffect(() => {
    if (!open) return;
    void refreshHostedServerAvailability(session.user.id, hostedServerCalls(session));
    void refreshMobileFeatures(session.apiUrl);
  }, [open, session]);

  function move(serverId: string, targetIndex: number) {
    const next = moveServerId(serverIds, serverId, targetIndex);
    if (next.join("\n") !== serverIds.join("\n")) reorderVisible(next);
  }

  function renderRow(serverItem: MobileServer, width?: number) {
    const selected = serverItem.id === activeServerId;
    const listIndex = serverIds.indexOf(serverItem.id);
    const serverLabel = serverKindLabel(serverItem, t);
    const exit = serverExit(serverItem);
    const visibility = serverVisibility(serverItem);
    const accessibilityActions = [
      ...(editing
        ? []
        : [
            ...(visibility ? [{ name: visibility, label: t(VISIBILITY_TEXT[visibility].action) }] : []),
            ...(exit ? [{ name: exit, label: t(EXIT_TEXT[exit].action) }] : []),
          ]),
      ...(listIndex > 0 ? [{ name: "moveUp", label: t("mobile.server.drawer.moveUp") }] : []),
      ...(listIndex >= 0 && listIndex < serverIds.length - 1
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
          if (isServerExit(action)) confirmExit(serverItem, action);
          if (isServerVisibility(action)) void changeVisibility(serverItem, action);
          if (action === "moveUp") move(serverItem.id, listIndex - 1);
          if (action === "moveDown") move(serverItem.id, listIndex + 1);
        }}
        className={`flex-row items-center gap-3 rounded-2xl px-3 ${selected ? "bg-control" : ""}`}
        onPress={editing || serverItem.hidden ? undefined : () => onSelectServer(serverItem.id)}
        delayLongPress={longPressDelay}
        onLongPress={
          editing
            ? undefined
            : () => {
                if (menuActions(serverItem).length === 0) return;
                void haptics.longPress();
                if (isAndroid) menus.current.get(serverItem.id)?.show();
              }
        }
        style={({ pressed }) => ({ height: SERVER_ROW_HEIGHT - 4, opacity: pressed ? 0.58 : 1, width })}
      >
        <ServerAvatar server={serverItem} size={SERVER_AVATAR_SIZE} />
        <View className="min-w-0 flex-1">
          <Typography.Paragraph
            className={showsOnline(serverItem) ? "font-medium" : "font-medium text-text-secondary"}
            numberOfLines={1}
            style={typeScale.rowTitle}
          >
            {serverItem.name}
          </Typography.Paragraph>
          <Typography.Paragraph
            className={serverItem.state === "error" ? "text-danger-text" : "text-text-secondary"}
            numberOfLines={1}
            style={typeScale.caption}
          >
            {serverDetail(serverItem, t)}
          </Typography.Paragraph>
        </View>
      </Pressable>
    );
  }

  function rowSlot(serverItem: MobileServer, row: ReactNode) {
    return (
      <View
        key={serverItem.id}
        className="justify-center"
        style={{ height: SERVER_ROW_HEIGHT }}
        onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}
      >
        {row}
      </View>
    );
  }

  function withMenu(serverItem: MobileServer) {
    const actions = menuActions(serverItem);
    if (actions.length === 0) return rowSlot(serverItem, renderRow(serverItem));
    return rowSlot(
      serverItem,
      <MenuView
        {...(isAndroid
          ? {
              ref: (menu: MenuComponentRef | null) => {
                menus.current.set(serverItem.id, menu);
              },
              colorScheme: theme === "dark" ? ("dark" as const) : ("light" as const),
            }
          : null)}
        shouldOpenOnLongPress
        actions={actions}
        onPressAction={(event) => {
          if (event.nativeEvent.event === "reorder") {
            setEditingTools(false);
            setEditing(true);
          }
          if (isServerExit(event.nativeEvent.event)) confirmExit(serverItem, event.nativeEvent.event);
          if (isServerVisibility(event.nativeEvent.event)) void changeVisibility(serverItem, event.nativeEvent.event);
        }}
      >
        {renderRow(serverItem, rowWidth)}
      </MenuView>,
    );
  }

  const subtitle = activeServer
    ? memberCount === null
      ? serverDetail(activeServer, t)
      : t("mobile.server.drawer.kindMembers", {
          kind: serverDetail(activeServer, t),
          members: t("mobile.server.drawer.memberCount", { count: memberCount }),
        })
    : null;

  return (
    <>
      <View className="flex-1">
        <View
          className="absolute top-0 right-0 left-0 z-20 pr-6 pb-1"
          style={{ paddingTop: Math.max(topInset, 16) }}
          onLayout={(event) => {
            const measured = event.nativeEvent.layout.height;
            setHeaderHeight((current) => (current === measured ? current : measured));
          }}
        >
          <View className="min-h-14 flex-row items-center justify-between gap-2 pl-3">
            {activeServer ? (
              <Pressable
                accessibilityRole="button"
                accessibilityHint={t("mobile.server.drawer.serverListHint")}
                accessibilityState={{ expanded: showsList }}
                className="min-w-0 shrink flex-row items-center gap-3"
                disabled={editing || editingTools}
                hitSlop={8}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                onPress={() => {
                  void haptics.selection();
                  setListOpen((current) => !current);
                }}
              >
                <ServerAvatar server={activeServer} size={HEADER_AVATAR_SIZE} />
                <View className="min-w-0 shrink">
                  <View className="min-w-0 flex-row items-center gap-1">
                    <Typography.Heading className="font-bold shrink" numberOfLines={1} style={typeScale.drawerTitle}>
                      {activeServer.name}
                    </Typography.Heading>
                    <Animated.View
                      style={{
                        marginTop: 3,
                        transform: [{ rotate: showsList ? "180deg" : "0deg" }],
                        transitionProperty: "transform",
                        transitionDuration: reducedMotion ? 0 : 240,
                        transitionTimingFunction: cubicBezier(0.23, 1, 0.32, 1),
                      }}
                    >
                      <ChevronDown color={mutedColor} size={20} strokeWidth={2.4} />
                    </Animated.View>
                  </View>
                  {subtitle ? (
                    <Typography.Paragraph className="text-text-secondary" numberOfLines={1} style={typeScale.caption}>
                      {subtitle}
                    </Typography.Paragraph>
                  ) : null}
                </View>
              </Pressable>
            ) : (
              <Typography.Heading className="font-bold shrink" numberOfLines={1} style={typeScale.drawerTitle}>
                {t("mobile.server.drawer.title")}
              </Typography.Heading>
            )}
            {editing || editingTools ? (
              <ServerDrawerIconButton
                accessibilityLabel={
                  editingTools ? t("mobile.server.drawer.doneEditingSidebar") : t("mobile.server.drawer.doneEditing")
                }
                color={mutedColor}
                systemName="checkmark"
                onPress={stopEditing}
              >
                <Check color={mutedColor} size={18} strokeWidth={2} />
              </ServerDrawerIconButton>
            ) : activeServer ? (
              <ServerDrawerIconButton
                accessibilityLabel={t("mobile.server.drawer.serverSettings")}
                color={mutedColor}
                systemName="gearshape"
                onPress={() => onNavigate({ pathname: "/server-settings", params: { serverId: activeServer.id } })}
              >
                <Settings color={mutedColor} size={18} strokeWidth={1.8} />
              </ServerDrawerIconButton>
            ) : null}
          </View>
        </View>

        <DrawerHeaderBlur
          left={-sideInset}
          solidHeight={Math.max(0, headerHeight - HEADER_FADE_START)}
          fadeHeight={headerHeight === 0 ? 0 : HEADER_FADE_START + HEADER_EDGE}
        />
        <ScrollView
          className="flex-1"
          contentContainerClassName="pr-3 pb-4"
          contentContainerStyle={{ paddingTop: headerHeight + LIST_TOP_GAP }}
          contentInsetAdjustmentBehavior="never"
          scrollEnabled={!dragging}
          showsVerticalScrollIndicator={false}
        >
          <ServerListCollapse open={showsList} reducedMotion={reducedMotion}>
            {editing ? (
              <SortableServerList
                color={mutedColor}
                ids={serverIds}
                renderRow={(id) => {
                  const serverItem = servers.find((candidate) => candidate.id === id);
                  return serverItem ? renderRow(serverItem) : null;
                }}
                onDragActive={setDragging}
                onReorder={reorderVisible}
              />
            ) : (
              visibleServers.map(withMenu)
            )}
            {editing ? (
              <Typography.Paragraph className="px-3 pt-3 text-text-secondary" style={typeScale.caption}>
                {t("mobile.server.drawer.orderHint")}
              </Typography.Paragraph>
            ) : (
              <Pressable
                accessibilityRole="button"
                className="flex-row items-center gap-3 rounded-2xl px-3"
                style={({ pressed }) => ({ height: SERVER_ROW_HEIGHT - 4, opacity: pressed ? 0.58 : 1 })}
                onPress={() =>
                  onNavigate(
                    showsPlans ? { pathname: "/hosted-server", params: { entryPoint: "drawer" } } : "/add-server",
                  )
                }
              >
                <View
                  className="items-center justify-center bg-control"
                  style={{
                    width: SERVER_AVATAR_SIZE,
                    height: SERVER_AVATAR_SIZE,
                    borderRadius: SERVER_AVATAR_SIZE * SERVER_AVATAR_CORNER_RATIO,
                  }}
                >
                  <Plus color={mutedColor} size={20} strokeWidth={2} />
                </View>
                <Typography.Paragraph className="font-medium" numberOfLines={1} style={typeScale.rowTitle}>
                  {showsPlans ? t("mobile.server.drawer.add") : t("mobile.server.drawer.join")}
                </Typography.Paragraph>
              </Pressable>
            )}
            {!editing && hiddenServers.length > 0 ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showsHidden }}
                  className="flex-row items-center gap-3 rounded-2xl px-3"
                  disabled={serverIds.length === 0}
                  style={({ pressed }) => ({ height: SERVER_ROW_HEIGHT - 4, opacity: pressed ? 0.58 : 1 })}
                  onPress={() => {
                    void haptics.selection();
                    setHiddenOpen((current) => !current);
                  }}
                >
                  <View
                    className="items-center justify-center bg-control"
                    style={{
                      width: SERVER_AVATAR_SIZE,
                      height: SERVER_AVATAR_SIZE,
                      borderRadius: SERVER_AVATAR_SIZE * SERVER_AVATAR_CORNER_RATIO,
                    }}
                  >
                    <Folder color={mutedColor} size={20} strokeWidth={2} />
                  </View>
                  <Typography.Paragraph
                    className="min-w-0 shrink font-medium"
                    numberOfLines={1}
                    style={typeScale.rowTitle}
                  >
                    {t("mobile.server.drawer.hiddenServers")}
                  </Typography.Paragraph>
                  <Typography.Paragraph className="text-muted" style={typeScale.rowTitle}>
                    {hiddenServers.length}
                  </Typography.Paragraph>
                  <Animated.View
                    style={{
                      transform: [{ rotate: showsHidden ? "180deg" : "0deg" }],
                      transitionProperty: "transform",
                      transitionDuration: reducedMotion ? 0 : 240,
                      transitionTimingFunction: cubicBezier(0.23, 1, 0.32, 1),
                    }}
                  >
                    <ChevronDown color={mutedColor} size={18} strokeWidth={2.4} />
                  </Animated.View>
                </Pressable>
                <ServerListCollapse open={showsHidden} reducedMotion={reducedMotion}>
                  {hiddenServers.map(withMenu)}
                </ServerListCollapse>
              </>
            ) : null}
            {activeServer ? <DrawerDivider /> : null}
          </ServerListCollapse>

          {activeServer ? (
            <DrawerServerTools
              server={activeServer}
              open={open}
              editing={editingTools}
              color={mutedColor}
              onEdit={editTools}
              onDragActive={setDragging}
              onNavigate={onNavigate}
            />
          ) : null}
        </ScrollView>
      </View>

      <View className="mr-6 pt-2">
        <DrawerCredits serverId={activeServer?.id ?? null} open={open} onNavigate={onNavigate} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${displayName}, ${session.user.email}`}
          accessibilityHint={t("mobile.server.drawer.settings")}
          className="min-h-14 flex-row items-center gap-2.5 rounded-2xl py-2 pl-3"
          style={({ pressed }) => ({
            marginRight: -PROFILE_ROW_OVERHANG,
            paddingRight: PROFILE_ROW_OVERHANG,
            backgroundColor: pressed ? String(controlColor) : undefined,
          })}
          onPress={() => {
            void haptics.impact("soft");
            onNavigate("/settings");
          }}
        >
          <ProfileAvatar neutral name={displayName} imageUrl={avatarUrl} size={36} />
          <View className="min-w-0 flex-1">
            <Typography.Paragraph className="font-semibold" numberOfLines={1} style={typeScale.preview}>
              {displayName}
            </Typography.Paragraph>
            <Typography.Paragraph className="text-text-secondary" numberOfLines={1} style={typeScale.small}>
              {session.user.email}
            </Typography.Paragraph>
          </View>
          <ChevronRight color={mutedColor} size={18} strokeWidth={2} style={MIRROR_IN_RTL} />
        </Pressable>
      </View>
    </>
  );
});

interface DrawerTool {
  icon: LucideIcon;
  label: string;
  value?: string | null;
  accentValue?: boolean;
  disabled?: boolean;
}

function DrawerServerTools({
  server,
  open,
  editing,
  color,
  onEdit,
  onDragActive,
  onNavigate,
}: {
  server: MobileServer;
  open: boolean;
  editing: boolean;
  color: string;
  onEdit: () => void;
  onDragActive: (active: boolean) => void;
  onNavigate: (href: Href) => void;
}) {
  const { t } = useText();
  const values = useDrawerServerValues(server, open);
  const serverId = server.id;
  const workflows = useDrawerWorkflows(serverId, open);
  const layout = useDrawerToolLayout();
  const [rowWidth, setRowWidth] = useState<number>();
  const remoteDesktop = useMobileWorkspaceSelector((current) =>
    serverRowState(current, serverId, (checks) => checks.canControlComputer(serverId)),
  );
  const library = useMobileWorkspaceSelector((current) =>
    serverRowState(current, serverId, (checks) => checks.canReadServerStorage(serverId)),
  );
  const providers = useMobileWorkspaceSelector((current) =>
    serverRowState(current, serverId, (checks) => checks.canManageProviders(serverId)),
  );
  const tasksRow = useMobileWorkspaceSelector((current) =>
    serverRowState(current, serverId, (checks) => checks.canUseTasks(serverId)),
  );
  const workflowsRow = useMobileWorkspaceSelector((current) =>
    serverRowState(current, serverId, (checks) => checks.canUseWorkflows(serverId)),
  );
  const routes = useMemo(
    (): Record<DrawerToolId, Href> => ({
      tasks: { pathname: "/server-tasks", params: { serverId } },
      routines: { pathname: "/server-routines", params: { serverId } },
      workflows: { pathname: "/server-workflows", params: { serverId } },
      marketplace: { pathname: "/server-marketplace", params: { serverId } },
      usage: { pathname: "/server-usage", params: { serverId } },
      library: { pathname: "/server-library", params: { serverId } },
      providers: { pathname: "/server-settings/providers", params: { serverId } },
      remoteDesktop: { pathname: "/remote-desktop/[serverId]", params: { serverId } },
      members: { pathname: "/server-settings/members", params: { serverId } },
    }),
    [serverId],
  );
  const tools: Record<DrawerToolId, DrawerTool | null> = {
    tasks: values.tasks
      ? {
          icon: ListChecks,
          label: t("mobile.app.route.threads"),
          value: values.tasks.value,
          accentValue: values.tasks.needsYou,
        }
      : tasksRow === "disabled"
        ? { icon: ListChecks, label: t("mobile.app.route.threads"), disabled: true }
        : null,
    routines: { icon: CalendarClock, label: t("mobile.app.route.schedule"), value: values.nextRoutine },
    workflows: workflows.supported
      ? {
          icon: Waypoints,
          label: t("mobile.app.route.workflows"),
          value: workflows.value,
          accentValue: workflows.needsYou,
        }
      : workflowsRow === "disabled"
        ? { icon: Waypoints, label: t("mobile.app.route.workflows"), disabled: true }
        : null,
    marketplace: { icon: Store, label: t("mobile.app.route.marketplace") },
    usage: { icon: ChartArea, label: t("mobile.app.route.usage"), value: values.usage },
    library:
      library === "hidden"
        ? null
        : { icon: GalleryVerticalEnd, label: t("mobile.app.route.library"), disabled: library === "disabled" },
    providers:
      providers === "hidden"
        ? null
        : { icon: Sparkles, label: t("mobile.server.route.providers"), disabled: providers === "disabled" },
    remoteDesktop:
      remoteDesktop === "hidden"
        ? null
        : { icon: Monitor, label: t("mobile.app.route.remoteDesktop"), disabled: remoteDesktop === "disabled" },
    members: { icon: UsersRound, label: t("mobile.app.route.members"), value: values.members },
  };
  const available = layout.order.filter((id) => tools[id] !== null);
  const shown = available.filter((id) => !layout.hidden.includes(id));
  const onToolAction = useCallback(
    (action: string, toolId: DrawerToolId) => {
      if (action === "editSidebar") onEdit();
      if (action === "unpin") {
        void haptics.selection();
        setDrawerToolPinned(toolId, false);
      }
    },
    [onEdit],
  );

  return (
    <View className="pt-1.5" onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}>
      {editing ? (
        <>
          <SortableServerList
            color={color}
            ids={available}
            rowHeight={DRAWER_ROW_HEIGHT}
            renderRow={(id) => {
              const toolId = available.find((candidate) => candidate === id);
              const tool = toolId ? tools[toolId] : null;
              if (!toolId || !tool) return null;
              const index = available.indexOf(toolId);
              return (
                <DrawerEditRow
                  icon={tool.icon}
                  label={tool.label}
                  pinned={!layout.hidden.includes(toolId)}
                  canMoveUp={index > 0}
                  canMoveDown={index < available.length - 1}
                  onMove={(step) =>
                    reorderDrawerTools(moveServerId(available, toolId, index + step).filter(isDrawerToolId))
                  }
                  onPinnedChange={(pinned) => setDrawerToolPinned(toolId, pinned)}
                />
              );
            }}
            onDragActive={onDragActive}
            onReorder={(ids) => {
              reorderDrawerTools(ids.filter(isDrawerToolId));
              return true;
            }}
          />
          <Typography.Paragraph className="px-3 pt-3 text-text-secondary" style={typeScale.caption}>
            {t("mobile.server.drawer.toolsHint")}
          </Typography.Paragraph>
        </>
      ) : (
        shown.map((id) => {
          const tool = tools[id];
          if (!tool) return null;
          return (
            <Fragment key={id}>
              <DrawerToolRow
                toolId={id}
                icon={tool.icon}
                label={tool.label}
                value={tool.value}
                accentValue={tool.accentValue}
                unavailable={tool.disabled}
                href={routes[id]}
                width={rowWidth}
                onAction={onToolAction}
                onNavigate={onNavigate}
              />
              {id === "workflows" ? (
                <DrawerPinnedWorkflows serverId={serverId} pinned={workflows.pinned} onNavigate={onNavigate} />
              ) : null}
            </Fragment>
          );
        })
      )}
    </View>
  );
}

const DrawerToolRow = memo(function DrawerToolRow({
  toolId,
  width,
  onAction,
  ...row
}: DrawerRowProps & {
  toolId: DrawerToolId;
  width?: number;
  onAction: (action: string, toolId: DrawerToolId) => void;
}) {
  const { t } = useText();
  const { theme } = useUniwind();
  const menu = useRef<MenuComponentRef | null>(null);
  const items = [
    { name: "editSidebar", label: t("mobile.server.drawer.editSidebar") },
    { name: "unpin", label: t("mobile.server.drawer.unpinTool") },
  ];
  const actions: MenuAction[] = [
    { id: "editSidebar", title: t("mobile.server.drawer.editSidebar"), image: "arrow.up.arrow.down" },
    { id: "unpin", title: t("mobile.server.drawer.unpinTool"), image: "pin.slash" },
  ];
  return (
    <View style={{ height: DRAWER_ROW_HEIGHT }}>
      <MenuView
        {...(isAndroid
          ? {
              ref: (instance: MenuComponentRef | null) => {
                menu.current = instance;
              },
              colorScheme: theme === "dark" ? ("dark" as const) : ("light" as const),
            }
          : null)}
        shouldOpenOnLongPress
        actions={actions}
        onPressAction={(event) => onAction(event.nativeEvent.event, toolId)}
      >
        <DrawerRow
          {...row}
          width={width}
          accessibilityActions={items}
          onAccessibilityAction={(name) => onAction(name, toolId)}
          onLongPress={() => {
            void haptics.longPress();
            if (isAndroid) menu.current?.show();
          }}
        />
      </MenuView>
    </View>
  );
});

function DrawerEditRow({
  icon: Icon,
  label,
  pinned,
  canMoveUp,
  canMoveDown,
  onMove,
  onPinnedChange,
}: {
  icon: LucideIcon;
  label: string;
  pinned: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (step: -1 | 1) => void;
  onPinnedChange: (pinned: boolean) => void;
}) {
  const { t } = useText();
  const [secondary, foreground] = useCSSVariable(["--openbot-text-secondary", "--openbot-text-primary"]);
  return (
    <View className="flex-row items-center gap-3 pl-3" style={{ height: DRAWER_ROW_HEIGHT }}>
      <View
        accessible
        accessibilityLabel={pinned ? label : t("mobile.server.drawer.unpinnedTool", { name: label })}
        accessibilityActions={[
          ...(canMoveUp ? [{ name: "moveUp", label: t("mobile.server.drawer.moveUp") }] : []),
          ...(canMoveDown ? [{ name: "moveDown", label: t("mobile.server.drawer.moveDown") }] : []),
        ]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "moveUp") onMove(-1);
          if (event.nativeEvent.actionName === "moveDown") onMove(1);
        }}
        className="min-w-0 flex-1 flex-row items-center gap-3"
        style={{ opacity: pinned ? 1 : UNPINNED_OPACITY }}
      >
        <Icon color={String(secondary)} size={20} strokeWidth={1.8} />
        <Typography.Paragraph className="min-w-0 flex-1" numberOfLines={1} style={typeScale.rowTitle}>
          {label}
        </Typography.Paragraph>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          pinned
            ? t("mobile.server.drawer.unpinToolNamed", { name: label })
            : t("mobile.server.drawer.pinToolNamed", { name: label })
        }
        className="h-11 w-11 items-center justify-center"
        hitSlop={4}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        onPress={() => {
          void haptics.selection();
          onPinnedChange(!pinned);
        }}
      >
        {pinned ? (
          <Pin color={String(foreground)} fill={String(foreground)} size={18} strokeWidth={1.8} />
        ) : (
          <View style={{ opacity: UNPINNED_OPACITY }}>
            <PinOff color={String(foreground)} size={18} strokeWidth={1.8} />
          </View>
        )}
      </Pressable>
    </View>
  );
}

function ServerListCollapse({
  open,
  reducedMotion,
  children,
}: PropsWithChildren<{ open: boolean; reducedMotion: boolean }>) {
  const height = useSharedValue(0);
  const progress = useSharedValue(open ? 1 : 0);
  const shown = useRef(open);
  useEffect(() => {
    if (shown.current === open) return;
    shown.current = open;
    const target = open ? 1 : 0;
    progress.set(reducedMotion ? target : withTiming(target, SERVER_LIST_MOTION));
  }, [open, progress, reducedMotion]);
  const frameStyle = useAnimatedStyle(() => {
    const value = progress.get();
    const settledOpen = value >= 1;
    return {
      height: settledOpen ? "auto" : height.get() * value,
      overflow: settledOpen ? "visible" : "hidden",
    };
  });
  const contentStyle = useAnimatedStyle(() => {
    const value = progress.get();
    return {
      position: value > 0 && value < 1 ? "absolute" : "relative",
      top: 0,
      left: 0,
      right: 0,
      opacity: interpolate(value, [0, 0.8], [0, 1], Extrapolation.CLAMP),
      transform: [{ translateY: reducedMotion ? 0 : (1 - value) * -6 }],
    };
  });
  return (
    <Animated.View
      style={frameStyle}
      pointerEvents={open ? "auto" : "none"}
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? "auto" : "no-hide-descendants"}
    >
      <Animated.View style={contentStyle} onLayout={(event) => height.set(event.nativeEvent.layout.height)}>
        {children}
      </Animated.View>
    </Animated.View>
  );
}

function DrawerDivider() {
  return <View accessibilityElementsHidden className="mx-3 mt-2.5 mb-1 h-px bg-grouped-border" />;
}

interface DrawerRowProps {
  icon: LucideIcon;
  label: string;
  value?: string | null;
  accentValue?: boolean;
  href: Href;
  unavailable?: boolean;
  onNavigate: (href: Href) => void;
}

const DrawerRow = memo(function DrawerRow({
  icon: Icon,
  label,
  value,
  accentValue = false,
  href,
  unavailable = false,
  onNavigate,
  width,
  accessibilityActions,
  onAccessibilityAction,
  onLongPress,
}: DrawerRowProps & {
  width?: number;
  accessibilityActions?: { name: string; label: string }[];
  onAccessibilityAction?: (name: string) => void;
  onLongPress?: () => void;
}) {
  const [secondary, control] = useCSSVariable(["--openbot-text-secondary", "--openbot-bg-control"]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={(event) => onAccessibilityAction?.(event.nativeEvent.actionName)}
      accessibilityState={{ disabled: unavailable }}
      className="flex-row items-center gap-3 rounded-2xl px-3"
      disabled={unavailable}
      style={({ pressed }) => ({
        height: DRAWER_ROW_HEIGHT,
        width,
        opacity: unavailable ? UNAVAILABLE_OPACITY : 1,
        backgroundColor: pressed ? String(control) : undefined,
      })}
      onPress={() => {
        void haptics.impact("soft");
        onNavigate(href);
      }}
      delayLongPress={longPressDelay}
      onLongPress={onLongPress}
    >
      <Icon color={String(secondary)} size={20} strokeWidth={1.8} />
      <Typography.Paragraph className="min-w-0 flex-1" numberOfLines={1} style={typeScale.rowTitle}>
        {label}
      </Typography.Paragraph>
      {value ? (
        <Typography.Paragraph
          className={accentValue ? "font-medium text-accent-text" : "text-text-secondary"}
          numberOfLines={1}
          style={typeScale.preview}
        >
          {value}
        </Typography.Paragraph>
      ) : null}
    </Pressable>
  );
});
