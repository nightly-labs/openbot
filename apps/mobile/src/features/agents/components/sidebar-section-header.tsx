import { type MenuAction, MenuView } from "@expo/ui/community/menu";
import type { SidebarLayoutAction } from "@openbot/contracts/ipc";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { ChevronRight, Ellipsis } from "lucide-react-native";
import { useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import Animated, { cubicBezier, useReducedMotion } from "react-native-reanimated";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { currentText, useText } from "@/shared/lib/text";

export function SidebarSectionHeader({
  id,
  name,
  empty,
  visibleSectionIds,
  collapsed,
  onToggle,
}: {
  id: string;
  name: string;
  empty: boolean;
  visibleSectionIds: string[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { t } = useText();
  const { activeServer, sidebarByServer, mutateSidebarLayout } = useMobileWorkspace();
  const muted = String(useThemeColor("muted"));
  const reducedMotion = useReducedMotion();
  const layout = sidebarByServer[activeServer.id]?.layout;
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const custom = layout?.sections.some((section) => section.id === id);
  const index = layout?.order.indexOf(id) ?? -1;
  const visibleIndex = visibleSectionIds.indexOf(id);
  const disabled = activeServer.state !== "online" || saving;
  async function run(action: SidebarLayoutAction) {
    if (pending.current || disabled) return;
    pending.current = true;
    setSaving(true);
    try {
      await mutateSidebarLayout(activeServer.id, action);
    } catch (error) {
      const text = currentText();
      Alert.alert(
        text.t("mobile.agent.section.changeFailed"),
        text.errorMessage(error, text.t("mobile.agent.section.tryAgain")),
      );
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  const actions: MenuAction[] = [
    { id: "up", title: t("mobile.agent.section.moveUp"), attributes: { disabled: disabled || visibleIndex <= 0 } },
    {
      id: "down",
      title: t("mobile.agent.section.moveDown"),
      attributes: { disabled: disabled || visibleIndex >= visibleSectionIds.length - 1 },
    },
    ...(custom
      ? [
          { id: "rename", title: t("common.rename"), attributes: { disabled } },
          { id: "delete", title: t("mobile.agent.section.delete"), attributes: { disabled, destructive: true } },
        ]
      : []),
  ];
  return (
    <View className="px-4 pt-5 pb-2">
      <View className="flex-row items-center">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(collapsed ? "mobile.agent.section.expand" : "mobile.agent.section.collapse", { name })}
          accessibilityState={{ expanded: !collapsed }}
          onPress={onToggle}
          className="min-h-12 flex-1 flex-row items-center gap-2"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Animated.View
            style={{
              transform: [{ rotate: collapsed ? "0deg" : "90deg" }],
              transitionProperty: "transform",
              transitionDuration: reducedMotion ? 0 : 120,
              transitionTimingFunction: cubicBezier(0.23, 1, 0.32, 1),
            }}
          >
            <ChevronRight size={16} color={muted} />
          </Animated.View>
          <Typography.Paragraph className="flex-1 text-muted">{name}</Typography.Paragraph>
        </Pressable>
        <MenuView
          actions={actions}
          onPressAction={({ nativeEvent }) => {
            const action = nativeEvent.event;
            if (action === "up" || action === "down")
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
            if (action === "rename")
              router.push({ pathname: "/section-form", params: { serverId: activeServer.id, sectionId: id } });
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
            className="size-12 items-center justify-center"
          >
            <Ellipsis size={20} color={muted} />
          </View>
        </MenuView>
      </View>
      {empty && !collapsed ? (
        <Typography.Paragraph type="body-sm" className="text-muted">
          {t("mobile.agent.section.empty")}
        </Typography.Paragraph>
      ) : null}
    </View>
  );
}
