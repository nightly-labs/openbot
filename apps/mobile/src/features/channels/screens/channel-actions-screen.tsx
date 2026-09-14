import { userErrorMessage } from "@openbot/user-errors";
import * as Crypto from "expo-crypto";
import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useRef, useState } from "react";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { ChannelTaskActions } from "../components/channel-task-actions";
import { useChannels } from "../components/use-channels";
import { channelTasksNeedingAction } from "../model/channel-task-actions";

export function ChannelActionsScreen() {
  const { channelId, serverId } = useLocalSearchParams<{ channelId: string; serverId: string }>();
  const { agents, servers } = useMobileWorkspace();
  const state = useChannels(serverId, channelId);
  const page = state.pages.get(channelId);
  const channel = state.channels.find((item) => item.id === channelId);
  const online = servers.some((server) => server.id === serverId && server.state === "online");
  const members = agents.filter(
    (agent) => agent.serverId === serverId && channel?.members.some((member) => member.agentId === agent.id),
  );
  const tasks = channelTasksNeedingAction(page?.tasks ?? []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  async function command(taskId: string, type: "resume" | "reassign", recipientAgentId: string | null = null) {
    if (lock.current || !online || !channel || channel.archived || !tasks.some((task) => task.id === taskId)) return;
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      await state.store.command(
        serverId,
        {
          type,
          operationId: Crypto.randomUUID(),
          channelId,
          taskId,
          recipientAgentId,
        },
        { waitForRefresh: true },
      );
    } catch (cause) {
      setError(userErrorMessage(cause, "Could not change this task. Try again."));
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <SheetScrollView headerOverlaysContent={false} contentContainerClassName="gap-3 px-4 pt-3 pb-safe-offset-5">
      <ChannelTaskActions
        tasks={tasks}
        members={members}
        online={online}
        archived={channel?.archived ?? false}
        pending={pending}
        onCommand={(...args) => {
          void command(...args);
        }}
      />
      {!tasks.length ? (
        <Typography.Paragraph>
          {!page ? (state.error ?? "Loading actions…") : "No actions needed."}
        </Typography.Paragraph>
      ) : null}
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
    </SheetScrollView>
  );
}
