import type { AgentTask, AgentTasksSnapshot } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert } from "react-native";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import type { MenuAction } from "@/shared/components/menu-view";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";

type ControlAction = "stop" | "close" | "reopen";
export type ThreadAction = ControlAction | "rename" | "delete";

const CONTROL_TEXT = {
  stop: { label: "mobile.server.threads.stop", error: "mobile.server.threads.error.stop", icon: "stop.circle" },
  close: { label: "mobile.server.threads.close", error: "mobile.server.threads.error.close", icon: "archivebox" },
  reopen: {
    label: "mobile.server.threads.reopen",
    error: "mobile.server.threads.error.reopen",
    icon: "arrow.clockwise",
  },
} as const satisfies Record<ControlAction, { label: MobileTextKey; error: MobileTextKey; icon: string }>;

/** A turn runs or waits in the thread. As on desktop, the person stops it before a delete. */
const threadBusy = (task: AgentTask) => task.state === "running" || task.state === "queued";

/** As on desktop: a running or waiting thread can stop, another open thread can archive, and an archived one can restore. */
function controlAction(task: AgentTask): ControlAction {
  if (threadBusy(task)) return "stop";
  return task.state === "closed" ? "reopen" : "close";
}

const isThreadAction = (id: string): id is ThreadAction =>
  id === "stop" || id === "close" || id === "reopen" || id === "rename" || id === "delete";

/**
 * The actions of a thread, for its ⋯ menu and the long press on its row: stop, archive or restore,
 * and rename and delete on a host with `agent-threads-v1`. A delete asks first, because it removes
 * the thread for good. `onDeleted` runs after the host deleted the thread.
 */
export function useThreadActions(serverId: string, onDeleted?: (task: AgentTask) => void) {
  const { t } = useText();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const { canEditThreads, controlAgentTask, deleteAgentThread } = useMobileWorkspace();
  const [acting, setActing] = useState<ReadonlySet<string>>(() => new Set());
  const editable = canEditThreads(serverId);

  // The threads with a request on the way. The ref answers at once; the state draws the menu.
  const pending = useRef(new Set<string>());
  const track = useCallback(async (task: AgentTask, error: MobileTextKey, run: () => Promise<void>) => {
    if (pending.current.has(task.id)) return false;
    pending.current.add(task.id);
    setActing(new Set(pending.current));
    try {
      await run();
      return true;
    } catch (cause) {
      void haptics.notification("error");
      const text = currentText();
      const title = text.t(error);
      showFailureAlert(cause, "team", title, text.errorMessage(cause, title));
      return false;
    } finally {
      pending.current.delete(task.id);
      setActing(new Set(pending.current));
    }
  }, []);

  const remove = useCallback(
    async (task: AgentTask) => {
      const deleted = await track(task, "mobile.chat.threads.error.delete", () =>
        deleteAgentThread({ agentId: task.agentId, taskId: task.id }, serverId),
      );
      if (!deleted) return;
      queryClient.setQueryData<AgentTasksSnapshot>(
        queryKeys.agentTasks(queryScope, serverId, task.agentId),
        (stored) => (stored ? { ...stored, tasks: stored.tasks.filter((entry) => entry.id !== task.id) } : stored),
      );
      void haptics.notification("success");
      onDeleted?.(task);
    },
    [track, deleteAgentThread, serverId, queryClient, queryScope, onDeleted],
  );

  function menu(task: AgentTask): MenuAction[] {
    const control = controlAction(task);
    const busy = acting.has(task.id);
    return [
      {
        id: control,
        title: t(CONTROL_TEXT[control].label),
        image: CONTROL_TEXT[control].icon,
        attributes: { disabled: busy, destructive: control === "stop" },
      },
      ...(editable
        ? [
            {
              id: "edit",
              title: "",
              displayInline: true,
              subactions: [
                {
                  id: "rename",
                  title: t("mobile.chat.threads.rename"),
                  image: "pencil",
                  attributes: { disabled: busy },
                },
                {
                  id: "delete",
                  title: t("mobile.chat.threads.delete.action"),
                  image: "trash",
                  attributes: { disabled: busy || threadBusy(task), destructive: true },
                },
              ],
            } satisfies MenuAction,
          ]
        : []),
    ];
  }

  function run(task: AgentTask, id: string) {
    if (!isThreadAction(id)) return;
    if (id === "rename") {
      router.push({ pathname: "/thread-rename", params: { serverId, agentId: task.agentId, taskId: task.id } });
      return;
    }
    void haptics.impact("light");
    if (id === "delete") {
      Alert.alert(t("mobile.chat.threads.delete.title"), t("mobile.chat.threads.delete.body"), [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("mobile.chat.threads.delete.action"), style: "destructive", onPress: () => void remove(task) },
      ]);
      return;
    }
    void track(task, CONTROL_TEXT[id].error, () =>
      controlAgentTask(id, { agentId: task.agentId, taskId: task.id }, serverId),
    );
  }

  return { menu, run, acting: (task: AgentTask) => acting.has(task.id) };
}
