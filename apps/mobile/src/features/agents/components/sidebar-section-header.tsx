import {
  SIDEBAR_FOLDER_LEVELS,
  type SidebarLayoutAction,
  sidebarFolderAncestors,
  sidebarFolderHeight,
  sidebarFolderParents,
  sidebarFolderPath,
} from "@openbot/contracts/ipc";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import Folder from "lucide-react-native/icons/folder";
import FolderOpen from "lucide-react-native/icons/folder-open";
import { memo, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import Animated, { cubicBezier } from "react-native-reanimated";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import {
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { showsOnline } from "@/features/workspace/model/server-status";
import { type MenuAction, MenuView } from "@/shared/components/menu-view";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { currentText, useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

/**
 * A folder header, as on the desktop: folders do not indent, so a folder in a folder names its parent
 * first ("Parent / Name"). A folder of the user ends with a folder icon; the "Agents" group keeps the
 * chevron.
 */
export const SidebarSectionHeader = memo(function SidebarSectionHeader({
  id,
  name,
  title,
  parentName,
  custom,
  empty,
  unread,
  visibleSectionIds,
  collapsed,
  onToggle,
}: {
  id: string;
  /** The path of the folder, for accessibility and the delete question. */
  name: string;
  title: string;
  parentName: string | null;
  custom: boolean;
  empty: boolean;
  /** The unread messages in a closed folder and in the folders in it; 0 for an open folder. */
  unread: number;
  visibleSectionIds: readonly string[];
  collapsed: boolean;
  onToggle: (sectionId: string) => void;
}) {
  const { t, format } = useText();
  const workspace = useMobileWorkspaceReader();
  const serverId = useMobileWorkspaceSelector(({ activeServer }) => activeServer.id);
  const online = useMobileWorkspaceSelector(({ activeServer }) => showsOnline(activeServer));
  const foldersSupported = useMobileWorkspaceSelector(({ activeServer, canNestSidebarFolders }) =>
    canNestSidebarFolders(activeServer.id),
  );
  const layout = useMobileWorkspaceSelector(
    ({ activeServer, sidebarByServer }) => sidebarByServer[activeServer.id]?.layout,
  );
  const [mutedColor, accentForegroundColor] = useThemeColor(["muted", "accent-foreground"]);
  const muted = String(mutedColor);
  const accentForeground = String(accentForegroundColor);
  const reducedMotion = useReducedMotion();
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const index = layout?.order.indexOf(id) ?? -1;
  // A folder moves among the folders next to it. Only a host with `sidebar-folders-v1` sends parents,
  // and that host takes `nest`; a flat `move` over the order can leave a folder in a folder in place.
  const parents = layout ? sidebarFolderParents(layout) : new Map<string, string>();
  const nested = parents.size > 0;
  const parentId = parents.get(id) ?? null;
  const siblings = nested
    ? visibleSectionIds.filter((sectionId) => (parents.get(sectionId) ?? null) === parentId)
    : visibleSectionIds;
  const visibleIndex = siblings.indexOf(id);
  const customIds = new Set(layout?.sections.map((section) => section.id));
  const depth = sidebarFolderAncestors(parents, id).length;
  /** Not into itself or a folder in it, and three levels at most with the folders it holds. */
  const canNestIn = (targetId: string) =>
    customIds.has(targetId) &&
    targetId !== id &&
    !sidebarFolderAncestors(parents, targetId).includes(id) &&
    sidebarFolderAncestors(parents, targetId).length + 1 + sidebarFolderHeight(parents, id) < SIDEBAR_FOLDER_LEVELS;
  const destinations =
    custom && foldersSupported && layout
      ? visibleSectionIds
          .filter((sectionId) => sectionId !== parentId && canNestIn(sectionId))
          .map((sectionId) => ({ id: sectionId, name: sidebarFolderPath(layout, parents, sectionId).join(" / ") }))
      : [];
  const disabled = !online || saving;
  async function run(action: SidebarLayoutAction) {
    if (pending.current || disabled) return;
    pending.current = true;
    setSaving(true);
    try {
      await workspace().mutateSidebarLayout(serverId, action);
      void (action.type === "move" || action.type === "nest" ? haptics.selection() : haptics.notification("success"));
    } catch (error) {
      void haptics.notification("error");
      const text = currentText();
      showFailureAlert(
        error,
        "agent",
        text.t("mobile.agent.section.changeFailed"),
        text.errorMessage(error, text.t("mobile.agent.section.tryAgain")),
      );
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  const actions: MenuAction[] = [
    ...(custom ? [{ id: "rename", title: t("common.rename"), attributes: { disabled } }] : []),
    ...(custom && foldersSupported
      ? [
          {
            id: "new-inside",
            title: t("mobile.agent.section.newInside"),
            attributes: { disabled: disabled || depth + 1 >= SIDEBAR_FOLDER_LEVELS },
          },
        ]
      : []),
    ...(custom && foldersSupported && (parentId !== null || destinations.length > 0)
      ? [
          {
            id: "nest",
            title: t("mobile.agent.section.moveFolder"),
            attributes: { disabled },
            subactions: [
              ...(parentId !== null ? [{ id: "nest:", title: t("mobile.agent.section.topLevel") }] : []),
              ...destinations.map((destination) => ({ id: `nest:${destination.id}`, title: destination.name })),
            ],
          },
        ]
      : []),
    { id: "up", title: t("mobile.agent.section.moveUp"), attributes: { disabled: disabled || visibleIndex <= 0 } },
    {
      id: "down",
      title: t("mobile.agent.section.moveDown"),
      attributes: { disabled: disabled || visibleIndex >= siblings.length - 1 },
    },
    ...(custom
      ? [{ id: "delete", title: t("mobile.agent.section.delete"), attributes: { disabled, destructive: true } }]
      : []),
  ];
  const FolderIcon = collapsed || empty ? Folder : FolderOpen;
  const showUnread = custom && collapsed && unread > 0;
  const toggleLabel = t(collapsed ? "mobile.agent.section.expand" : "mobile.agent.section.collapse", { name });
  return (
    <View className="pt-2.5 pr-3 pb-0.5 pl-5">
      <View className="flex-row items-center">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            showUnread ? `${toggleLabel}, ${t("mobile.agent.section.unread", { count: unread })}` : toggleLabel
          }
          accessibilityState={{ expanded: !collapsed }}
          onPress={() => {
            void haptics.selection();
            onToggle(id);
          }}
          className="min-h-8 flex-1 flex-row items-center gap-1.5"
          hitSlop={{ top: 6, bottom: 6 }}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Typography.Paragraph className="font-medium shrink text-muted" numberOfLines={1} style={typeScale.caption}>
            {parentName ? (
              <Typography.Paragraph className="font-normal text-muted" style={typeScale.caption}>
                {`${parentName} / `}
              </Typography.Paragraph>
            ) : null}
            {title}
          </Typography.Paragraph>
          {showUnread ? (
            <View className="h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5">
              <Typography.Paragraph className="font-semibold" style={[typeScale.small, { color: accentForeground }]}>
                {format.number(Math.min(unread, 99))}
              </Typography.Paragraph>
            </View>
          ) : null}
          {custom ? (
            <FolderIcon size={14} color={muted} strokeWidth={2} />
          ) : (
            <Animated.View
              style={{
                transform: [{ rotate: collapsed ? "0deg" : "90deg" }],
                transitionProperty: "transform",
                transitionDuration: reducedMotion ? 0 : 120,
                transitionTimingFunction: cubicBezier(0.23, 1, 0.32, 1),
              }}
            >
              <ChevronRight size={14} color={muted} strokeWidth={2.2} />
            </Animated.View>
          )}
        </Pressable>
        <MenuView
          actions={actions}
          onPressAction={({ nativeEvent }) => {
            const action = nativeEvent.event;
            if (action.startsWith("nest:"))
              void run({ type: "nest", sectionId: id, parentId: action.slice(5) || null, beforeSectionId: null });
            else if ((action === "up" || action === "down") && nested)
              void run({
                type: "nest",
                sectionId: id,
                parentId,
                beforeSectionId:
                  action === "up" ? (siblings[visibleIndex - 1] ?? null) : (siblings[visibleIndex + 2] ?? null),
              });
            else if (action === "up" || action === "down")
              void run({
                type: "move",
                sectionId: id,
                direction: action,
                steps: Math.abs(
                  index -
                    (layout?.order.indexOf(visibleSectionIds[visibleIndex + (action === "up" ? -1 : 1)] ?? id) ??
                      index),
                ),
              });
            if (action === "rename") router.push({ pathname: "/section-form", params: { serverId, sectionId: id } });
            if (action === "new-inside") {
              if (collapsed) onToggle(id);
              router.push({ pathname: "/section-form", params: { serverId, parentId: id } });
            }
            if (action === "delete")
              Alert.alert(t("mobile.agent.section.deleteTitle", { name }), t("mobile.agent.section.deleteBody"), [
                { text: t("common.cancel"), style: "cancel" },
                {
                  text: t("common.delete"),
                  style: "destructive",
                  onPress: () => void run({ type: "delete", sectionId: id }),
                },
              ]);
          }}
        >
          <View
            accessible
            accessibilityRole="button"
            accessibilityLabel={t("mobile.agent.section.options", { name })}
            className="size-8 items-center justify-center"
            hitSlop={8}
          >
            <Ellipsis size={18} color={muted} />
          </View>
        </MenuView>
      </View>
      {empty && !collapsed ? (
        <Typography.Paragraph className="pb-2 text-muted" style={typeScale.preview}>
          {t("mobile.agent.section.empty")}
        </Typography.Paragraph>
      ) : null}
    </View>
  );
});
