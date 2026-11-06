import type { MobileTranslate } from "@openbot/i18n/mobile";
import type { Href } from "expo-router";
import { Typography } from "heroui-native";
import type { LucideIcon } from "lucide-react-native";
import CalendarClock from "lucide-react-native/icons/calendar-clock";
import ChartArea from "lucide-react-native/icons/chart-area";
import Check from "lucide-react-native/icons/check";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ListChecks from "lucide-react-native/icons/list-checks";
import Monitor from "lucide-react-native/icons/monitor";
import Pin from "lucide-react-native/icons/pin";
import PinOff from "lucide-react-native/icons/pin-off";
import Plus from "lucide-react-native/icons/plus";
import Settings from "lucide-react-native/icons/settings";
import Settings2 from "lucide-react-native/icons/settings-2";
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
import { scheduleOnRN } from "react-native-worklets";
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
import { serverStatusLabel, showsOnline } from "@/features/workspace/model/server-status";
import { type MenuAction, type MenuComponentRef, MenuView } from "@/shared/components/menu-view";
import { ProfileAvatar } from "@/shared/components/profile-avatar";
import { devFeatureOverride } from "@/shared/lib/dev-feature-overrides";
import { haptics } from "@/shared/lib/haptics";
import { refreshMobileFeatures, useMobileFeature } from "@/shared/lib/mobile-features";
import { useReducedMotion } from "@/shared/lib/motion";
import { isAndroid, longPressDelay } from "@/shared/lib/platform";
import { currentText, useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";
import { DrawerHeaderBlur } from "./drawer-header-blur";
import { ServerAvatar } from "./server-avatar";
import { ServerDrawerIconButton } from "./server-drawer-icon-button";
import { SERVER_ROW_HEIGHT, SortableServerList } from "./sortable-server-list";
import { useDrawerMemberCount, useDrawerServerValues } from "./use-drawer-server-values";

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const SERVER_LIST_MOTION = { duration: 240, easing: EASE_OUT };
const SERVER_AVATAR_SIZE = 40;
const HEADER_AVATAR_SIZE = 48;
// The blur is full behind the header text and fades out slowly: it starts this far above the
// header's bottom and goes on this far below it.
const HEADER_FADE_START = 16;
const HEADER_EDGE = 16;
// The first row's text starts below the blur, so it is clear when the list is at the top.
const LIST_TOP_GAP = 8;
const DRAWER_ROW_HEIGHT = 46;
const CLOSED_LIST = { height: 0, overflow: "hidden" } as const;
const UNPINNED_OPACITY = 0.5;

interface ServerDrawerContentProps {
  activeServerId: string;
  muted: ViewStyle["backgroundColor"];
  /** True after the drawer has opened: the drawer then reads its values from the host. */
  open: boolean;
  servers: MobileServer[];
  session: MobileSession;
  /** The drawer's left padding. The header blur reaches over it to the screen edge. */
  sideInset: number;
  topInset: number;
  onNavigate: (href: Href) => void;
  onLeave: (serverId: string) => Promise<void>;
  onRemove: (serverId: string) => Promise<void>;
  /** Deletes a server that an OpenBot desktop app runs beside its own server, through that app. */
  onDelete: (serverId: string) => Promise<void>;
  /** See `MobileWorkspaceState.localServerKind`. */
  localServerKind: (serverId: string) => "computer" | "onComputer" | null;
  onReorder: (serverIds: string[]) => boolean;
  onSelectServer: (serverId: string) => void;
}

/** Local or Remote, with the connection state only when it needs attention. The dot shows online or offline. */
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

function serverKindLabel(server: MobileServer, t: MobileTranslate): string {
  return server.kind === "local" ? t("mobile.server.drawer.local") : t("mobile.server.drawer.remote");
}

/**
 * The drawer under the home screen. The name of the open server opens the server list in place;
 * below it are the tools of that server, each with its current value. The app opens on the first
 * server of the list. The shell renders again while the drawer moves; with the same props this
 * content does not.
 */
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
  localServerKind,
  onReorder,
  onSelectServer,
}: ServerDrawerContentProps) {
  const { t } = useText();
  const { theme } = useUniwind();
  const reducedMotion = useReducedMotion();
  // Android: the row's own long press opens its menu, as on the agent rows. `shouldOpenOnLongPress`
  // does not open it there, because the row takes the long press.
  const menus = useRef(new Map<string, MenuComponentRef | null>());
  const displayName = mobileUserName(session.user);
  const avatarUrl = session.user.avatarUrl ? new URL(session.user.avatarUrl, session.apiUrl).toString() : null;
  const mutedColor = String(muted);
  const [editing, setEditing] = useState(false);
  const [editingTools, setEditingTools] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);
  // The iOS menu host sizes to its content, so a row in a menu gets the slot width explicitly.
  const [rowWidth, setRowWidth] = useState<number>();
  const activeServer = servers.find((server) => server.id === activeServerId);
  const serverIds = servers.map((server) => server.id);
  const canReorder = serverIds.length > 1;
  // Without an open server the list is the only content, so it stays open.
  const showsList = listOpen || editing || !activeServer;
  const memberCount = useDrawerMemberCount(activeServer?.id ?? "");
  const hostedServerIds = useHostedServerAvailability((state) =>
    state.userId === session.user.id ? state.serverIds : null,
  );
  const exiting = useRef(false);
  // The same rules as the server settings screen. The owner cannot leave. Billing deletes a hosted
  // server, so Remove shows only after the hosted servers are known.
  function serverExit(server: MobileServer): ServerExit | null {
    if (server.role !== "owner") return "leave";
    // The desktop app's own server stays while the app runs; a server beside it is deleted on its computer.
    const kind = localServerKind(server.id);
    if (kind === "computer") return null;
    if (kind === "onComputer") return "delete";
    return hostedServerIds && !hostedServerIds.has(server.id) ? "remove" : null;
  }
  function menuActions(server: MobileServer): MenuAction[] {
    const actions: MenuAction[] = canReorder
      ? [{ id: "reorder", title: t("mobile.server.drawer.editOrder"), image: "arrow.up.arrow.down" }]
      : [];
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

  // The server leaves the list after it succeeds, and the workspace selects another server if it was active.
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
      // The account service explains a refusal, such as a hosted server that Billing deletes.
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

  // A drag cut short by leaving edit mode never reports its end, so leaving also releases the scroll lock.
  const stopEditing = () => {
    void haptics.selection();
    setEditing(false);
    setEditingTools(false);
    setDragging(false);
  };

  // The server list closes, so the tools that the user edits stay in view.
  const editTools = useCallback(() => {
    void haptics.selection();
    setEditing(false);
    setListOpen(false);
    setEditingTools(true);
  }, []);

  // The drawer opens again on the tools of the open server.
  useEffect(() => {
    if (open) return;
    setEditing(false);
    setEditingTools(false);
    setDragging(false);
    setListOpen(false);
  }, [open]);

  // The plus button opens the plans and the account's hosted servers when the account can have
  // hosted servers and the feature flag of this build is on. A development build can override both.
  const accountHasPlans = useHostedServerAvailability((state) => state.userId === session.user.id && state.available);
  const cloudServersOn = useMobileFeature(session.apiUrl, "cloudServers");
  const showsPlans = devFeatureOverride("cloudServers") ?? (accountHasPlans && cloudServersOn);
  useEffect(() => {
    if (!open) return;
    void refreshHostedServerAvailability(session.user.id, hostedServerCalls(session));
    void refreshMobileFeatures(session.apiUrl);
  }, [open, session]);

  function move(serverId: string, targetIndex: number) {
    const next = moveServerId(serverIds, serverId, targetIndex);
    if (next.join("\n") !== serverIds.join("\n")) onReorder(next);
  }

  function renderRow(serverItem: MobileServer, width?: number) {
    const selected = serverItem.id === activeServerId;
    const listIndex = serverIds.indexOf(serverItem.id);
    const serverLabel = serverKindLabel(serverItem, t);
    const exit = serverExit(serverItem);
    const accessibilityActions = [
      ...(editing ? [] : [...(exit ? [{ name: exit, label: t(EXIT_TEXT[exit].action) }] : [])]),
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
          if (action === "moveUp") move(serverItem.id, listIndex - 1);
          if (action === "moveDown") move(serverItem.id, listIndex + 1);
        }}
        className={`flex-row items-center gap-3 rounded-2xl px-2.5 ${selected ? "bg-control" : ""}`}
        onPress={editing ? undefined : () => onSelectServer(serverItem.id)}
        // The native context menu does not cancel this touch. Without a long-press handler, lifting the
        // finger after the menu opens counts as a tap and closes the drawer under the open menu.
        delayLongPress={longPressDelay}
        onLongPress={
          editing
            ? undefined
            : () => {
                // A row with no actions has no menu, so it gives no menu haptic.
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

  // Every row gets the same fixed slot, so the list keeps its spacing in edit mode and in the menu wrapper.
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
          className="absolute top-0 right-0 left-0 z-20 pr-3 pb-1"
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
                fallbackVariant="filled"
                systemName="checkmark"
                onPress={stopEditing}
              >
                <Check color={mutedColor} size={18} strokeWidth={2} />
              </ServerDrawerIconButton>
            ) : (
              <ServerDrawerIconButton
                accessibilityLabel={showsPlans ? t("mobile.server.drawer.add") : t("mobile.server.drawer.join")}
                color={mutedColor}
                fallbackVariant="filled"
                systemName="plus"
                onPress={() =>
                  onNavigate(
                    showsPlans ? { pathname: "/hosted-server", params: { entryPoint: "drawer" } } : "/add-server",
                  )
                }
              >
                <Plus color={mutedColor} size={18} strokeWidth={2} />
              </ServerDrawerIconButton>
            )}
          </View>
        </View>

        {/* The list scrolls under the header, which blurs it as the other screens blur theirs. */}
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
                onReorder={onReorder}
              />
            ) : (
              servers.map(withMenu)
            )}
            {editing ? (
              <Typography.Paragraph className="px-3 pt-3 text-text-secondary" style={typeScale.caption}>
                {t("mobile.server.drawer.orderHint")}
              </Typography.Paragraph>
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

      <View className="mr-3 flex-row items-center gap-2 pt-2">
        <View className="min-h-14 min-w-0 flex-1 flex-row items-center gap-2.5 rounded-2xl px-2 py-2">
          <ProfileAvatar neutral name={displayName} imageUrl={avatarUrl} size={36} />
          <View className="min-w-0 flex-1">
            <Typography.Paragraph className="font-semibold" numberOfLines={1} style={typeScale.preview}>
              {displayName}
            </Typography.Paragraph>
            <Typography.Paragraph className="text-text-secondary" numberOfLines={1} selectable style={typeScale.small}>
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
});

type DrawerRoute = DrawerToolId | "settings";

interface DrawerTool {
  icon: LucideIcon;
  label: string;
  value?: string | null;
  accentValue?: boolean;
}

/**
 * The tools of the open server with their values. Each answer from the host renders only this part
 * of the drawer, not the server list above it. A long press opens a menu to edit the tools or unpin
 * one. In edit mode all tools show: the handle moves a tool, and the pin button shows or hides it.
 */
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
  // The iOS menu host sizes to its content, so a row in a menu gets the width of the list.
  const [rowWidth, setRowWidth] = useState<number>();
  // A connected host that shares its screen. The host decides which members it lets in.
  const remoteDesktop = useMobileWorkspaceSelector((current) => current.canControlComputer(serverId));
  const routes = useMemo(
    (): Record<DrawerRoute, Href> => ({
      tasks: { pathname: "/server-tasks", params: { serverId } },
      routines: { pathname: "/server-routines", params: { serverId } },
      workflows: { pathname: "/server-workflows", params: { serverId } },
      marketplace: { pathname: "/server-marketplace", params: { serverId } },
      usage: { pathname: "/server-usage", params: { serverId } },
      remoteDesktop: { pathname: "/remote-desktop/[serverId]", params: { serverId } },
      members: { pathname: "/server-settings/members", params: { serverId } },
      settings: { pathname: "/server-settings", params: { serverId } },
    }),
    [serverId],
  );
  // A tool that this server does not have is null.
  const tools: Record<DrawerToolId, DrawerTool | null> = {
    tasks: values.tasks
      ? {
          icon: ListChecks,
          label: t("mobile.app.route.threads"),
          value: values.tasks.value,
          accentValue: values.tasks.needsYou,
        }
      : null,
    routines: { icon: CalendarClock, label: t("mobile.app.route.schedule"), value: values.nextRoutine },
    workflows: workflows.supported
      ? {
          icon: Waypoints,
          label: t("mobile.app.route.workflows"),
          value: workflows.value,
          accentValue: workflows.needsYou,
        }
      : null,
    marketplace: { icon: Store, label: t("mobile.app.route.marketplace") },
    usage: { icon: ChartArea, label: t("mobile.app.route.usage"), value: values.usage },
    remoteDesktop: remoteDesktop ? { icon: Monitor, label: t("mobile.app.route.remoteDesktop") } : null,
    members: { icon: UsersRound, label: t("mobile.app.route.members"), value: values.members },
  };
  const available = layout.order.filter((id) => tools[id] !== null);
  const shown = available.filter((id) => !layout.hidden.includes(id));
  const onToolAction = useCallback(
    (action: string, toolId: DrawerToolId | null) => {
      if (action === "editSidebar") onEdit();
      if (action === "unpin" && toolId) {
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
      <DrawerDivider />
      {/* Server settings always shows, so its long press opens the edit mode when all tools are unpinned. */}
      <DrawerToolRow
        toolId={null}
        icon={Settings2}
        label={t("mobile.server.drawer.serverSettings")}
        href={routes.settings}
        width={rowWidth}
        // In edit mode a tap does not leave the drawer, as on the server rows.
        disabled={editing}
        onAction={editing ? undefined : onToolAction}
        onNavigate={onNavigate}
      />
    </View>
  );
}

/** A drawer row with the menu of the tools. `toolId` is null for Server settings, which cannot be unpinned. */
const DrawerToolRow = memo(function DrawerToolRow({
  toolId,
  width,
  onAction,
  ...row
}: DrawerRowProps & {
  toolId: DrawerToolId | null;
  width?: number;
  /** Without it, the row has no menu. */
  onAction?: (action: string, toolId: DrawerToolId | null) => void;
}) {
  const { t } = useText();
  const { theme } = useUniwind();
  const menu = useRef<MenuComponentRef | null>(null);
  if (!onAction) return <DrawerRow {...row} />;
  const items = [
    { name: "editSidebar", label: t("mobile.server.drawer.editSidebar") },
    ...(toolId ? [{ name: "unpin", label: t("mobile.server.drawer.unpinTool") }] : []),
  ];
  const actions: MenuAction[] = [
    { id: "editSidebar", title: t("mobile.server.drawer.editSidebar"), image: "arrow.up.arrow.down" },
  ];
  if (toolId) actions.push({ id: "unpin", title: t("mobile.server.drawer.unpinTool"), image: "pin.slash" });
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

/** A tool in edit mode. The list adds the handle; the pin button shows or hides the tool. */
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
          // Dimmed as the name of the unpinned tool.
          <View style={{ opacity: UNPINNED_OPACITY }}>
            <PinOff color={String(foreground)} size={18} strokeWidth={1.8} />
          </View>
        )}
      </Pressable>
    </View>
  );
}

/**
 * Opens the server list under the server name and closes it again. The rows come down 6 pt as they
 * fade in, so the list reads as coming out of the name.
 */
function ServerListCollapse({
  open,
  reducedMotion,
  children,
}: PropsWithChildren<{ open: boolean; reducedMotion: boolean }>) {
  const [height, setHeight] = useState(0);
  // At rest the list has no animated style: open, it takes its own height; closed, none. A later
  // render then cannot put back a first-render style when the animated value has not reached React.
  const [moving, setMoving] = useState(false);
  const progress = useSharedValue(open ? 1 : 0);
  const shown = useRef(open);
  useEffect(() => {
    if (shown.current === open) {
      // A change of the motion setting cuts a move short: the list goes to rest where it is going.
      progress.set(open ? 1 : 0);
      setMoving(false);
      return;
    }
    shown.current = open;
    if (reducedMotion) {
      progress.set(open ? 1 : 0);
      return;
    }
    let active = true;
    const stop = () => {
      if (active) setMoving(false);
    };
    setMoving(true);
    progress.set(
      withTiming(open ? 1 : 0, SERVER_LIST_MOTION, (finished) => {
        if (finished) scheduleOnRN(stop);
      }),
    );
    return () => {
      active = false;
    };
  }, [open, progress, reducedMotion]);
  const frameStyle = useAnimatedStyle(() => ({ height: height * progress.get(), overflow: "hidden" }));
  const contentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 0.8], [0, 1], Extrapolation.CLAMP),
    transform: [{ translateY: reducedMotion ? 0 : (1 - progress.get()) * -6 }],
  }));
  return (
    <Animated.View
      style={moving ? frameStyle : open ? undefined : CLOSED_LIST}
      pointerEvents={open ? "auto" : "none"}
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? "auto" : "no-hide-descendants"}
    >
      <Animated.View
        style={moving ? [{ position: "absolute", top: 0, left: 0, right: 0 }, contentStyle] : undefined}
        onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
      >
        {children}
      </Animated.View>
    </Animated.View>
  );
}

function DrawerDivider() {
  return <View accessibilityElementsHidden className="mx-2.5 mt-2.5 mb-1 h-px bg-grouped-border" />;
}

interface DrawerRowProps {
  icon: LucideIcon;
  label: string;
  value?: string | null;
  /** A value that asks for the person, such as tasks that need them. */
  accentValue?: boolean;
  href: Href;
  disabled?: boolean;
  onNavigate: (href: Href) => void;
}

/** One tool of the open server, with its current value on the right. A new value renders only its row. */
const DrawerRow = memo(function DrawerRow({
  icon: Icon,
  label,
  value,
  accentValue = false,
  href,
  disabled = false,
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
      className="flex-row items-center gap-3 rounded-2xl px-3"
      disabled={disabled}
      style={({ pressed }) => ({
        height: DRAWER_ROW_HEIGHT,
        width,
        backgroundColor: pressed ? String(control) : undefined,
      })}
      onPress={() => {
        void haptics.impact("soft");
        onNavigate(href);
      }}
      // The native context menu does not cancel this touch. Without a long-press handler, lifting the
      // finger after the menu opens counts as a tap and navigates under the open menu.
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
