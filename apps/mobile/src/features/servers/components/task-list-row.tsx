import type { AgentTask } from "@openbot/contracts/ipc";
import { taskTone } from "@openbot/team-client/agent-tasks";
import { Typography } from "heroui-native";
import { memo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useCSSVariable, useUniwind } from "uniwind";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { AgentTaskMark } from "@/features/servers/components/agent-task-mark";
import { agentTaskStatus } from "@/features/servers/model/agent-task-text";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { type MenuAction, type MenuComponentRef, MenuView } from "@/shared/components/menu-view";
import { formatUpdatedAt } from "@/shared/lib/format-updated-at";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid, longPressDelay } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

const AVATAR_SIZE = 36;
const STATUS_MARK = "⁣";

interface TaskListRowProps {
  task: AgentTask;
  agent?: MobileAgent;
  dimmed?: boolean;
  onPress: (task: AgentTask) => void;
  menu?: { actions: MenuAction[]; onAction: (task: AgentTask, id: string) => void };
  slotWidth?: number;
}

export const TaskListRow = memo(
  TaskListRowContent,
  (previous, next) =>
    previous.task === next.task &&
    previous.agent === next.agent &&
    previous.dimmed === next.dimmed &&
    previous.onPress === next.onPress &&
    previous.slotWidth === next.slotWidth &&
    sameMenu(previous.menu, next.menu),
);

function TaskListRowContent({ task, agent, dimmed = false, onPress, menu, slotWidth }: TaskListRowProps) {
  const { t, format } = useText();
  const { theme } = useUniwind();
  const menuRef = useRef<MenuComponentRef | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number>();
  const width = slotWidth ?? measuredWidth;
  const status = agentTaskStatus(task, t);
  const when = formatUpdatedAt(task.closedAt ?? task.updatedAt, format);
  const line = agent
    ? t("mobile.server.threads.rowMetaTime", { agent: agent.name, status: STATUS_MARK, when })
    : t("mobile.server.threads.rowMetaTimeOnly", { status: STATUS_MARK, when });
  const [before = "", after = ""] = line.split(STATUS_MARK);
  const tone = taskTone(task);
  const [success, danger] = useCSSVariable(["--openbot-success-text", "--openbot-danger-text"]);
  const mark = tone === "attention" ? String(success) : tone === "danger" ? String(danger) : null;
  const menuItems = menu ? leafActions(menu.actions) : [];
  const row = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("mobile.chat.threads.open", { title: task.title, status })}
      accessibilityActions={menuItems.map((action) => ({ name: action.id, label: action.title }))}
      onAccessibilityAction={(event) => menu?.onAction(task, event.nativeEvent.actionName)}
      className="flex-row items-center gap-3 px-5 py-2.5"
      style={({ pressed }) => ({ width: menu ? width : undefined, opacity: pressed ? 0.58 : 1 })}
      onPress={() => {
        void haptics.selection();
        onPress(task);
      }}
      delayLongPress={longPressDelay}
      onLongPress={
        menu
          ? () => {
              void haptics.longPress();
              if (isAndroid) menuRef.current?.show();
            }
          : undefined
      }
    >
      {agent ? (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <BloubAvatar
            agentId={agent.id}
            serverId={agent.serverId}
            hue={agent.avatarHue}
            color={agent.avatarColor}
            seed={agent.avatarSeed}
            size={AVATAR_SIZE}
            animateIdle={false}
          />
        </View>
      ) : null}
      <View className="min-w-0 flex-1 gap-0.5">
        <Typography.Paragraph
          className={dimmed ? "font-medium text-muted" : "font-medium"}
          numberOfLines={1}
          style={typeScale.body}
        >
          {task.title}
        </Typography.Paragraph>
        <Typography.Paragraph className="text-muted" numberOfLines={1} style={typeScale.caption}>
          {before}
          <Typography.Paragraph
            className={mark ? "font-semibold" : "text-muted"}
            style={[typeScale.caption, mark ? { color: mark } : null]}
          >
            {status}
          </Typography.Paragraph>
          {mark ? (
            <Typography.Paragraph style={[typeScale.caption, { color: mark }]}>{after}</Typography.Paragraph>
          ) : (
            after
          )}
        </Typography.Paragraph>
      </View>
      {mark ? (
        <View
          className="size-4 items-center justify-center"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <View className="size-2 rounded-full" style={{ backgroundColor: mark }} />
        </View>
      ) : (
        <AgentTaskMark task={task} />
      )}
    </Pressable>
  );
  if (!menu) return row;
  return (
    <View onLayout={slotWidth === undefined ? (event) => setMeasuredWidth(event.nativeEvent.layout.width) : undefined}>
      {width === undefined ? (
        row
      ) : (
        <MenuView
          {...(isAndroid
            ? { ref: menuRef, colorScheme: theme === "dark" ? ("dark" as const) : ("light" as const) }
            : null)}
          shouldOpenOnLongPress
          actions={menu.actions}
          onPressAction={(event) => menu.onAction(task, event.nativeEvent.event)}
        >
          {row}
        </MenuView>
      )}
    </View>
  );
}

function sameMenu(previous: TaskListRowProps["menu"], next: TaskListRowProps["menu"]): boolean {
  if (!previous || !next) return previous === next;
  return previous.onAction === next.onAction && JSON.stringify(previous.actions) === JSON.stringify(next.actions);
}

function leafActions(actions: readonly MenuAction[]): { id: string; title: string }[] {
  return actions.flatMap((action) =>
    action.subactions
      ? leafActions(action.subactions)
      : action.attributes?.disabled || action.attributes?.hidden
        ? []
        : [{ id: action.id ?? action.title, title: action.title }],
  );
}
