import type { WorkflowSummary } from "@openbot/contracts/ipc";
import { Typography } from "heroui-native";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import Pin from "lucide-react-native/icons/pin";
import WorkflowIcon from "lucide-react-native/icons/workflow";
import { useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useCSSVariable, useUniwind } from "uniwind";
import { RUN_STATUS_LABEL } from "@/features/workflows/model/workflow-steps";
import { type MenuComponentRef, MenuView } from "@/shared/components/menu-view";
import { formatUpdatedAt } from "@/shared/lib/format-updated-at";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid, longPressDelay } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

export type WorkflowRowAction = "pin" | "run" | "edit";

/** The colour class of a run status line. */
export function runStatusClass(lastRun: WorkflowSummary["lastRun"]) {
  switch (lastRun?.status) {
    case "running":
    case "stopping":
      return "text-accent-text";
    case "approval":
      return "text-warning-text";
    case "failed":
      return "text-danger-text";
    default:
      return "text-text-secondary";
  }
}

/** One workflow of the list: its name, its last run, and a pin when the drawer shows it. */
export function WorkflowRow({
  workflow,
  pinned,
  onPress,
  onAction,
}: {
  workflow: WorkflowSummary;
  pinned: boolean;
  onPress: () => void;
  onAction: (action: WorkflowRowAction) => void;
}) {
  const { t, format } = useText();
  const { theme } = useUniwind();
  const [muted, control, iconColor, iconBackground] = useCSSVariable([
    "--openbot-text-grouped-secondary",
    "--openbot-bg-control",
    "--openbot-file-default",
    "--openbot-file-default-soft",
  ]);
  const menu = useRef<MenuComponentRef | null>(null);
  // The iOS menu host takes the size of its content, so the row gets the width of its slot.
  const [width, setWidth] = useState<number>();
  const last = workflow.lastRun;
  const status = last
    ? t("mobile.workflow.list.lastRun", {
        status: t(RUN_STATUS_LABEL[last.status]),
        time: formatUpdatedAt(last.at, format),
      })
    : t("mobile.workflow.list.neverRun");
  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <MenuView
        {...(isAndroid ? { ref: menu, colorScheme: theme === "dark" ? ("dark" as const) : ("light" as const) } : null)}
        shouldOpenOnLongPress
        actions={[
          {
            id: "pin",
            title: pinned ? t("mobile.workflow.action.unpin") : t("mobile.workflow.action.pin"),
            image: pinned ? "pin.slash" : "pin",
          },
          { id: "run", title: t("mobile.workflow.action.run"), image: "play" },
          { id: "edit", title: t("mobile.workflow.action.edit"), image: "pencil" },
        ]}
        onPressAction={(event) => {
          const id = event.nativeEvent.event;
          if (id === "pin" || id === "run" || id === "edit") onAction(id);
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${workflow.title}, ${status}`}
          accessibilityHint={t("mobile.workflow.list.rowHint")}
          accessibilityActions={[
            { name: "pin", label: pinned ? t("mobile.workflow.action.unpin") : t("mobile.workflow.action.pin") },
            { name: "run", label: t("mobile.workflow.action.run") },
            { name: "edit", label: t("mobile.workflow.action.edit") },
          ]}
          onAccessibilityAction={(event) => {
            const name = event.nativeEvent.actionName;
            if (name === "pin" || name === "run" || name === "edit") onAction(name);
          }}
          className="min-h-[60px] flex-row items-center gap-3 px-4 py-2.5"
          style={({ pressed }) => ({ width, backgroundColor: pressed ? String(control) : undefined })}
          onPress={() => {
            void haptics.impact("soft");
            onPress();
          }}
          // The native context menu does not cancel this touch. Without a long-press handler, lifting the
          // finger after the menu opens counts as a tap. Android opens its menu from the row.
          delayLongPress={longPressDelay}
          onLongPress={() => {
            void haptics.longPress();
            if (isAndroid) menu.current?.show();
          }}
        >
          <View
            className="items-center justify-center"
            style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: String(iconBackground) }}
          >
            <WorkflowIcon color={String(iconColor)} size={18} strokeWidth={1.9} />
          </View>
          <View className="min-w-0 flex-1">
            <View className="flex-row items-center gap-1.5">
              {pinned ? <Pin color={String(muted)} size={13} strokeWidth={2.2} /> : null}
              <Typography.Paragraph className="min-w-0 shrink" numberOfLines={1} style={typeScale.rowTitle}>
                {workflow.title}
              </Typography.Paragraph>
            </View>
            <Typography.Paragraph className={runStatusClass(last)} numberOfLines={1} style={typeScale.caption}>
              {status}
            </Typography.Paragraph>
          </View>
          <ChevronRight color={String(muted)} size={18} strokeWidth={1.5} />
        </Pressable>
      </MenuView>
    </View>
  );
}
