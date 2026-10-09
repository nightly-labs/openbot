import type { SharedTable } from "@openbot/contracts/ipc";
import { useQuery } from "@tanstack/react-query";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { Trash2 } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { SettingsNote, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { type MobileAgent, useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";

/**
 * Agent info > Tables: the records that the agents of the host keep between tasks, as the desktop
 * agent settings list them. The list is the same for every agent, because the agents share one
 * database. Only an owner or admin opens it, and the host checks the role again.
 */
export function AgentSharedTables({ agent, available }: { agent: MobileAgent; available: boolean }) {
  const { t } = useText();
  const workspace = useMobileWorkspace();
  const { session, sessionScope } = useMobileSession();
  const tables = useQuery({
    queryKey: ["agent-info", session?.apiUrl, session?.user.id, sessionScope, agent.serverId, "tables"],
    queryFn: () => workspace.listSharedTables(agent.serverId),
    enabled: available,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });

  if (!available) return <Typography.Paragraph>{t("mobile.agent.tables.reconnect")}</Typography.Paragraph>;
  if (tables.isPending) return <Typography.Paragraph>{t("mobile.agent.tables.loading")}</Typography.Paragraph>;
  if (tables.isError)
    return (
      <View className="gap-2">
        <Typography.Paragraph accessibilityRole="alert">{t("mobile.agent.tables.failed")}</Typography.Paragraph>
        <Button variant="ghost" onPress={() => void tables.refetch()}>
          <Button.Label>{t("mobile.agent.tables.retry")}</Button.Label>
        </Button>
      </View>
    );
  return (
    <>
      <SettingsSection>
        {tables.data.map((table) => (
          <SharedTableRow key={table.name} agent={agent} table={table} onChanged={() => void tables.refetch()} />
        ))}
        {!tables.data.length ? (
          <SettingsRow>
            <Typography.Paragraph className="text-grouped-secondary">
              {t("mobile.agent.tables.empty")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      <SettingsNote>{t("mobile.agent.tables.note")}</SettingsNote>
    </>
  );
}

function SharedTableRow({
  agent,
  table,
  onChanged,
}: {
  agent: MobileAgent;
  table: SharedTable;
  /** Reads the list again after a deletion, whether it succeeded or not. */
  onChanged: () => void;
}) {
  const { t } = useText();
  const { agents, deleteSharedTable } = useMobileWorkspace();
  const danger = useThemeColor("danger");
  const [deleting, setDeleting] = useState(false);
  // The owner can be an agent that was deleted, so its name is looked up and may be missing.
  const owner = table.ownerAgentId
    ? agents.find((candidate) => candidate.id === table.ownerAgentId && candidate.serverId === agent.serverId)
    : undefined;
  const ownerLine = !table.ownerAgentId
    ? t("mobile.agent.tables.madeOutside")
    : owner
      ? t("mobile.agent.tables.keptBy", { name: owner.name })
      : t("mobile.agent.tables.keptByDeleted");
  const records =
    table.rowCount === null
      ? t("mobile.agent.tables.notCounted")
      : t("mobile.agent.tables.records", { count: table.rowCount });

  function confirmDelete() {
    Alert.alert(t("mobile.agent.tables.deleteTitle", { name: table.name }), t("mobile.agent.tables.deleteBody"), [
      { text: t("mobile.agent.tables.keep"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () => {
          setDeleting(true);
          deleteSharedTable(table.name, agent.serverId)
            .then(() => {
              void haptics.notification("success");
            })
            .catch((cause: unknown) => {
              void haptics.notification("error");
              const text = currentText();
              showFailureAlert(
                cause,
                "agent",
                text.t("mobile.agent.tables.deleteFailed"),
                text.errorMessage(cause, text.t("mobile.agent.tables.deleteFailedBody")),
              );
            })
            .finally(() => {
              setDeleting(false);
              onChanged();
            });
        },
      },
    ]);
  }

  return (
    <SettingsRow
      disclosure={false}
      disabled={deleting}
      supportingText={`${records} · ${ownerLine}`}
      trailing={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("mobile.agent.tables.deleteNamed", { name: table.name })}
          accessibilityState={{ disabled: deleting }}
          disabled={deleting}
          hitSlop={8}
          onPress={confirmDelete}
        >
          <Trash2 size={18} color={String(danger)} />
        </Pressable>
      }
    >
      <Typography numberOfLines={1}>{table.name}</Typography>
    </SettingsRow>
  );
}
