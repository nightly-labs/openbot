import type { AgentTasksSnapshot } from "@openbot/contracts/ipc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { showsOnline } from "@/features/workspace/model/server-status";
import { SaveError } from "@/shared/components/save-error";
import { SheetCloseAction } from "@/shared/components/sheet-close-action";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { useDiscardGuard } from "@/shared/lib/use-discard-guard";

/** The bound of `agent-threads-v1`: one line of 1 to 120 characters after trim. */
const TITLE_LIMIT = 120;

/** Renames a thread of an agent. The title then no longer follows the thread's first message. */
export function ThreadRenameScreen() {
  const { t, errorMessage } = useText();
  const { serverId, agentId, taskId } = useLocalSearchParams<{ serverId: string; agentId: string; taskId: string }>();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const { servers, canEditThreads, loadAgentTasks, renameAgentThread } = useMobileWorkspace();
  const online = servers.some((server) => server.id === serverId && showsOnline(server));
  const list = useQuery({
    queryKey: queryKeys.agentTasks(queryScope, serverId, agentId),
    enabled: online,
    retry: false,
    queryFn: () => loadAgentTasks(agentId, serverId),
  });
  const task = list.data?.tasks.find((item) => item.id === taskId);
  const [initialTitle, setInitialTitle] = useState(task?.title ?? "");
  const [title, setTitle] = useState(initialTitle);
  // The list can load after the sheet opens. The field then starts with the thread's title.
  const loadedTitle = task?.title;
  const touched = useRef(false);
  useEffect(() => {
    if (loadedTitle === undefined || touched.current) return;
    setInitialTitle(loadedTitle);
    setTitle(loadedTitle);
  }, [loadedTitle]);
  const [saving, setSaving] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const trimmed = title.trim();
  const dirty = trimmed !== initialTitle.trim();
  const available = online && canEditThreads(serverId) && Boolean(task);
  const valid = trimmed.length > 0 && trimmed.length <= TITLE_LIMIT;
  useDiscardGuard(!finished && (dirty || saving), { busy: () => pending.current });
  useEffect(() => {
    if (finished) router.back();
  }, [finished]);

  async function save() {
    if (!available || !valid || !dirty || pending.current || finished) return;
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      await renameAgentThread({ agentId, taskId, title: trimmed }, serverId);
      // The header shows the new title before the list event arrives.
      queryClient.setQueryData<AgentTasksSnapshot>(queryKeys.agentTasks(queryScope, serverId, agentId), (stored) =>
        stored
          ? {
              ...stored,
              tasks: stored.tasks.map((entry) => (entry.id === taskId ? { ...entry, title: trimmed } : entry)),
            }
          : stored,
      );
      void haptics.notification("success");
      setFinished(true);
    } catch (cause) {
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.chat.threads.error.rename")));
      pending.current = false;
      setSaving(false);
    }
  }

  const close = () => {
    void haptics.impact("soft");
    router.back();
  };

  return (
    <SheetScrollView
      className="bg-sheet"
      contentContainerClassName="gap-5 px-5 pb-safe-offset-5 pt-5"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: t("mobile.chat.threads.renameTitle") }} />
      <SheetCloseAction disabled={saving} onPress={close} />
      <SheetSaveAction
        dirty={dirty}
        canSave={available && valid && !finished}
        pending={saving}
        label={t("mobile.chat.threads.renameSave")}
        onSave={() => void save()}
      />
      <SheetFormField
        label={t("mobile.chat.threads.name")}
        value={title}
        onChangeText={(value) => {
          touched.current = true;
          setTitle(value);
          if (error) setError(null);
        }}
        editable={!saving}
        maxLength={TITLE_LIMIT}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={() => void save()}
      />
      {!available && !list.isPending ? (
        <Typography.Paragraph className="text-muted">{t("mobile.chat.threads.renameUnavailable")}</Typography.Paragraph>
      ) : null}
      <SaveError error={error} />
    </SheetScrollView>
  );
}
