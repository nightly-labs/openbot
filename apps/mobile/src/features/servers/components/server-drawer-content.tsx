import type { MobileTranslate } from "@openbot/i18n/mobile";
import type { Href } from "expo-router";
import { Typography } from "heroui-native";
import type { LucideIcon } from "lucide-react-native";
import Calendar from "lucide-react-native/icons/calendar";
import ChartColumn from "lucide-react-native/icons/chart-column";
import Check from "lucide-react-native/icons/check";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import Plus from "lucide-react-native/icons/plus";
import Settings from "lucide-react-native/icons/settings";
import Settings2 from "lucide-react-native/icons/settings-2";
import ShoppingBag from "lucide-react-native/icons/shopping-bag";
import SquareCheck from "lucide-react-native/icons/square-check";
import UsersRound from "lucide-react-native/icons/users-round";
import WorkflowIcon from "lucide-react-native/icons/workflow";
import { memo, type PropsWithChildren, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
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
  refreshHostedServerAvailability,
  useHostedServerAvailability,
} from "@/features/servers/model/hosted-server-availability";
import { DrawerPinnedWorkflows, useDrawerWorkflows } from "@/features/workflows/components/drawer-workflows";
import type { MobileServer } from "@/features/workspace/context/mobile-workspace-context";
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
import { ServerAvatar } from "./server-avatar";
import { ServerDrawerIconButton } from "./server-drawer-icon-button";
import { SERVER_ROW_HEIGHT, SortableServerList } from "./sortable-server-list";
import { useDrawerMemberCount, useDrawerServerValues } from "./use-drawer-server-values";

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const SERVER_LIST_MOTION = { duration: 240, easing: EASE_OUT };
const SERVER_AVATAR_SIZE = 40;
const DRAWER_ROW_HEIGHT = 46;
const CLOSED_LIST = { height: 0, overflow: "hidden" } as const;

interface ServerDrawerContentProps {
  activeServerId: string;
  muted: ViewStyle["backgroundColor"];
  /** True after the drawer has opened: the drawer then reads its values from the host. */
  open: boolean;
  servers: MobileServer[];
  session: MobileSession;
  topInset: number;
  onNavigate: (href: Href) => void;
  onLeave: (serverId: string) => Promise<void>;
  onRemove: (serverId: string) => Promise<void>;
  onReorder: (serverIds: string[]) => boolean;
  onSelectServer: (serverId: string) => void;
}

/** Local or Remote, with the connection state only when it needs attention. The dot shows online or offline. */
function serverDetail(server: MobileServer, t: MobileTranslate): string {
  const label = serverKindLabel(server, t);
  const pending = server.state === "connecting" && server.initialConnectionPending;
  return pending || server.state === "error" ? `${label} · ${serverStatusLabel(server, t)}` : label;
}

type ServerExit = "leave" | "remove";

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
  topInset,
  onNavigate,
  onLeave,
  onRemove,
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
  const [dragging, setDragging] = useState(false);
  const [listOpen, setListOpen] = useState(false);
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
            title: exit === "leave" ? t("mobile.server.settings.leave") : t("mobile.server.settings.remove"),
            image: exit === "leave" ? "rectangle.portrait.and.arrow.right" : "trash",
            attributes: { destructive: true },
          },
        ],
      });
    return actions;
  }

  // The server leaves the list after it succeeds, and the workspace selects another server if it was active.
  function confirmExit(server: MobileServer, exit: ServerExit) {
    const leave = exit === "leave";
    Alert.alert(
      leave
        ? t("mobile.server.settings.leaveTitle", { name: server.name })
        : t("mobile.server.settings.removeTitle", { name: server.name }),
      leave ? t("mobile.server.settings.leaveBody") : t("mobile.server.settings.removeBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: leave ? t("mobile.server.settings.leave") : t("mobile.server.settings.remove"),
          style: "destructive",
          onPress: () => void exitServer(server, exit),
        },
      ],
    );
  }

  async function exitServer(server: MobileServer, exit: ServerExit) {
    if (exiting.current) return;
    exiting.current = true;
    try {
      await (exit === "leave" ? onLeave : onRemove)(server.id);
      void haptics.notification("success");
    } catch (error) {
      void haptics.notification("error");
      const text = currentText();
      // The account service explains a refusal, such as a hosted server that Billing deletes.
      showFailureAlert(
        error,
        "team",
        exit === "leave"
          ? text.t("mobile.server.drawer.leaveFailed", { name: server.name })
          : text.t("mobile.server.drawer.removeFailed", { name: server.name }),
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
    setDragging(false);
  };

  // The drawer opens again on the tools of the open server.
  useEffect(() => {
    if (open) return;
    setEditing(false);
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
      ...(editing
        ? []
        : [
            ...(exit === "leave" ? [{ name: "leave", label: t("mobile.server.settings.leave") }] : []),
            ...(exit === "remove" ? [{ name: "remove", label: t("mobile.server.settings.remove") }] : []),
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
          if (action === "leave" || action === "remove") confirmExit(serverItem, action);
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
          if (event.nativeEvent.event === "reorder") setEditing(true);
          if (event.nativeEvent.event === "leave" || event.nativeEvent.event === "remove")
            confirmExit(serverItem, event.nativeEvent.event);
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
      <View className="pr-3 pb-1" style={{ paddingTop: Math.max(topInset, 16) }}>
        <View className="min-h-14 flex-row items-center justify-between gap-2 pl-3">
          {activeServer ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={activeServer.name}
              accessibilityHint={t("mobile.server.drawer.serverListHint")}
              accessibilityState={{ expanded: showsList }}
              className="min-w-0 shrink flex-row items-center gap-1"
              disabled={editing}
              hitSlop={8}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              onPress={() => {
                void haptics.selection();
                setListOpen((current) => !current);
              }}
            >
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
            </Pressable>
          ) : (
            <Typography.Heading className="font-bold shrink" numberOfLines={1} style={typeScale.drawerTitle}>
              {t("mobile.server.drawer.title")}
            </Typography.Heading>
          )}
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
        {subtitle ? (
          <Typography.Paragraph
            className="-mt-1.5 px-3 text-text-secondary"
            numberOfLines={1}
            style={typeScale.caption}
          >
            {subtitle}
          </Typography.Paragraph>
        ) : null}
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="pt-1 pr-3 pb-4"
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

        {activeServer ? <DrawerServerTools server={activeServer} open={open} onNavigate={onNavigate} /> : null}
      </ScrollView>

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

type DrawerRoute = "tasks" | "routines" | "workflows" | "marketplace" | "usage" | "members" | "settings";

/**
 * The tools of the open server with their values. Each answer from the host renders only this part
 * of the drawer, not the server list above it.
 */
function DrawerServerTools({
  server,
  open,
  onNavigate,
}: {
  server: MobileServer;
  open: boolean;
  onNavigate: (href: Href) => void;
}) {
  const { t } = useText();
  const values = useDrawerServerValues(server, open);
  const serverId = server.id;
  const workflows = useDrawerWorkflows(serverId, open);
  const routes = useMemo(
    (): Record<DrawerRoute, Href> => ({
      tasks: { pathname: "/server-tasks", params: { serverId } },
      routines: { pathname: "/server-routines", params: { serverId } },
      workflows: { pathname: "/server-workflows", params: { serverId } },
      marketplace: { pathname: "/server-marketplace", params: { serverId } },
      usage: { pathname: "/server-usage", params: { serverId } },
      members: { pathname: "/server-settings/members", params: { serverId } },
      settings: { pathname: "/server-settings", params: { serverId } },
    }),
    [serverId],
  );
  return (
    <View className="pt-1.5">
      {values.tasks ? (
        <DrawerRow
          icon={SquareCheck}
          label={t("mobile.app.route.threads")}
          value={values.tasks.value}
          accentValue={values.tasks.needsYou}
          href={routes.tasks}
          onNavigate={onNavigate}
        />
      ) : null}
      <DrawerRow
        icon={Calendar}
        label={t("mobile.app.route.routines")}
        value={values.nextRoutine}
        href={routes.routines}
        onNavigate={onNavigate}
      />
      {workflows.supported ? (
        <>
          <DrawerRow
            icon={WorkflowIcon}
            label={t("mobile.app.route.workflows")}
            value={workflows.value}
            accentValue={workflows.needsYou}
            href={routes.workflows}
            onNavigate={onNavigate}
          />
          <DrawerPinnedWorkflows serverId={serverId} pinned={workflows.pinned} onNavigate={onNavigate} />
        </>
      ) : null}
      <DrawerRow
        icon={ShoppingBag}
        label={t("mobile.app.route.marketplace")}
        href={routes.marketplace}
        onNavigate={onNavigate}
      />
      <DrawerRow
        icon={ChartColumn}
        label={t("mobile.app.route.usage")}
        value={values.usage}
        href={routes.usage}
        onNavigate={onNavigate}
      />
      <DrawerRow
        icon={UsersRound}
        label={t("mobile.app.route.members")}
        value={values.members}
        href={routes.members}
        onNavigate={onNavigate}
      />
      <DrawerDivider />
      <DrawerRow
        icon={Settings2}
        label={t("mobile.server.drawer.serverSettings")}
        href={routes.settings}
        onNavigate={onNavigate}
      />
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

/** One tool of the open server, with its current value on the right. A new value renders only its row. */
const DrawerRow = memo(function DrawerRow({
  icon: Icon,
  label,
  value,
  accentValue = false,
  href,
  onNavigate,
}: {
  icon: LucideIcon;
  label: string;
  value?: string | null;
  /** A value that asks for the person, such as tasks that need them. */
  accentValue?: boolean;
  href: Href;
  onNavigate: (href: Href) => void;
}) {
  const [secondary, control] = useCSSVariable(["--openbot-text-secondary", "--openbot-bg-control"]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      className="flex-row items-center gap-3 rounded-2xl px-3"
      style={({ pressed }) => ({ height: DRAWER_ROW_HEIGHT, backgroundColor: pressed ? String(control) : undefined })}
      onPress={() => {
        void haptics.impact("soft");
        onNavigate(href);
      }}
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
