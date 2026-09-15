import { userErrorMessage } from "@openbot/user-errors";
import * as Crypto from "expo-crypto";
import { useLocalSearchParams } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useRef, useState } from "react";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { ChannelTaskActions } from "../components/channel-task-actions";
import { useChannels } from "../components/use-channels";
import { ChannelHistoryRefreshError } from "../model/channel-store";
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
  const operations = useRef(new Map<string, string>());
  const [historyPending, setHistoryPending] = useState(false);
  async function refreshHistory() {
    if (lock.current || !online) return;
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      await state.store.refreshHistory(
        serverId,
        channelId,
        "The task was changed, but chat history could not refresh.",
      );
      setHistoryPending(false);
    } catch (cause) {
      setError(userErrorMessage(cause, "Could not refresh task history. Try again."));
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  async function command(taskId: string, type: "resume" | "reassign", recipientAgentId: string | null = null) {
    if (
      lock.current ||
      historyPending ||
      !online ||
      !channel ||
      channel.archived ||
      !tasks.some((task) => task.id === taskId)
    )
      return;
    lock.current = true;
    setPending(true);
    setError(null);
    const signature = JSON.stringify([serverId, channelId, taskId, type, recipientAgentId]);
    const operationId = operations.current.get(signature) ?? Crypto.randomUUID();
    operations.current.set(signature, operationId);
    try {
      await state.store.command(
        serverId,
        {
          type,
          operationId,
          channelId,
          taskId,
          recipientAgentId,
        },
        { waitForRefresh: true },
      );
      operations.current.delete(signature);
    } catch (cause) {
      if (cause instanceof ChannelHistoryRefreshError) {
        operations.current.delete(signature);
        setHistoryPending(true);
      }
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
        pending={pending || historyPending}
        onCommand={(...args) => {
          void command(...args);
        }}
      />
      {historyPending ? (
        <Button variant="ghost" isDisabled={pending || !online} onPress={() => void refreshHistory()}>
          <Button.Label>Refresh history</Button.Label>
        </Button>
      ) : null}
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
