import { MenuView } from "@expo/ui/community/menu";
import type { ChannelTask } from "@openbot/contracts/ipc";
import { Button, Typography } from "heroui-native";
import { View } from "react-native";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";

export function ChannelTaskActions({
  tasks,
  members,
  online,
  pending,
  archived,
  onCommand,
}: {
  tasks: ChannelTask[];
  members: MobileAgent[];
  online: boolean;
  pending: boolean;
  archived: boolean;
  onCommand: (taskId: string, type: "stop" | "resume" | "reassign", recipientAgentId?: string | null) => void;
}) {
  return (
    <>
      {tasks
        .filter((task) => ["running", "waiting", "paused", "failed"].includes(task.state))
        .map((task) => (
          <View key={task.id} className="flex-row items-center gap-2 px-4">
            <View className="flex-1 gap-1">
              <Typography type="body-xs">
                {members.find((agent) => agent.id === task.ownerAgentId)?.name ?? "Task"}: {task.state}
              </Typography>
              {task.error ? (
                <Typography.Paragraph type="body-xs" className="text-danger-text">
                  {task.error}
                </Typography.Paragraph>
              ) : null}
            </View>
            <Button
              size="sm"
              variant="ghost"
              isDisabled={!online || pending || archived}
              onPress={() => onCommand(task.id, task.state === "paused" || task.state === "failed" ? "resume" : "stop")}
            >
              <Button.Label>{task.state === "paused" || task.state === "failed" ? "Resume" : "Stop"}</Button.Label>
            </Button>
            {(task.state === "paused" || task.state === "failed") && online && !pending && !archived ? (
              <MenuView
                actions={members.map((member) => ({ id: member.id, title: member.name }))}
                onPressAction={(event) => {
                  const id = event.nativeEvent.event;
                  if (members.some((member) => member.id === id)) onCommand(task.id, "reassign", id);
                }}
              >
                <View accessibilityRole="button" accessibilityLabel="Reassign task" className="p-3">
                  <Typography type="body-xs">Reassign</Typography>
                </View>
              </MenuView>
            ) : null}
          </View>
        ))}
    </>
  );
}
