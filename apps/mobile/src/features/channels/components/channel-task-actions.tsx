import { MenuView } from "@expo/ui/community/menu";
import type { ChannelTask } from "@openbot/contracts/ipc";
import { Button, Typography } from "heroui-native";
import { View } from "react-native";
import { BloubAvatarThumbnail } from "@/features/agents/components/bloub-avatar";
import { ChatMarkdown } from "@/features/chat/components/chat-markdown";
import { SettingsSection } from "@/features/settings/components/settings-content";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { useText } from "@/shared/lib/text";

type TaskCommand = (taskId: string, type: "resume" | "reassign", recipientAgentId?: string | null) => void;

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
  onCommand: TaskCommand;
}) {
  return (
    <>
      {tasks.map((task) => (
        <TaskActionCard
          key={task.id}
          task={task}
          members={members}
          disabled={!online || pending || archived}
          onCommand={onCommand}
        />
      ))}
    </>
  );
}

function TaskActionCard({
  task,
  members,
  disabled,
  onCommand,
}: {
  task: ChannelTask;
  members: MobileAgent[];
  disabled: boolean;
  onCommand: TaskCommand;
}) {
  const { t, sourceText } = useText();
  const agent = members.find((member) => member.id === task.ownerAgentId);
  const name = agent?.name ?? t("mobile.channel.task.task");
  return (
    <SettingsSection>
      <View className="gap-3 p-4">
        <View className="flex-row items-center gap-2">
          {task.ownerAgentId ? (
            <BloubAvatarThumbnail
              agentId={agent?.id}
              serverId={agent?.serverId}
              seed={agent?.avatarSeed ?? task.ownerAgentId}
              hue={agent?.avatarHue ?? null}
              size={24}
            />
          ) : null}
          <Typography.Paragraph type="body-sm" weight="semibold" className="flex-1" numberOfLines={1}>
            {name}
          </Typography.Paragraph>
          <Typography.Paragraph type="body-xs" className="text-grouped-secondary">
            {t(task.state === "failed" ? "mobile.channel.task.failed" : "mobile.channel.task.paused")}
          </Typography.Paragraph>
        </View>
        {task.instruction ? (
          <ChatMarkdown body={task.instruction} color={undefined} compact agents={members} animationEnabled={false} />
        ) : null}
        {task.error ? (
          <Typography.Paragraph type="body-sm" className="text-grouped-secondary">
            {sourceText(task.error)}
          </Typography.Paragraph>
        ) : null}
        <View className="flex-row items-center gap-3">
          <Button
            className="min-h-11 flex-1"
            size="sm"
            variant="secondary"
            isDisabled={disabled}
            onPress={() => onCommand(task.id, "resume")}
          >
            <Button.Label>{t("mobile.channel.task.resume")}</Button.Label>
          </Button>
          <View className="flex-1" pointerEvents={disabled || !members.length ? "none" : "auto"}>
            <MenuView
              style={{ flex: 1 }}
              actions={members.map((member) => ({ id: member.id, title: member.name, attributes: { disabled } }))}
              onPressAction={({ nativeEvent }) => {
                if (!disabled && members.some((member) => member.id === nativeEvent.event))
                  onCommand(task.id, "reassign", nativeEvent.event);
              }}
            >
              <Button
                className="min-h-11 w-full"
                size="sm"
                variant="secondary"
                isDisabled={disabled || !members.length}
                pointerEvents="none"
              >
                <Button.Label>{t("mobile.channel.task.reassign")}</Button.Label>
              </Button>
            </MenuView>
          </View>
        </View>
      </View>
    </SettingsSection>
  );
}
