import type { HostDirectory } from "@openbot/contracts/ipc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Typography } from "heroui-native";
import { useCallback, useState, useSyncExternalStore } from "react";
import { Alert, Pressable } from "react-native";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import {
  type MobileAgent,
  type MobileServer,
  useMobileWorkspace,
} from "@/features/workspace/context/mobile-workspace-context";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { useText } from "@/shared/lib/text";

export function AgentWorkingDirectory({
  agent,
  server,
  available,
  compact = false,
}: {
  agent: MobileAgent;
  server: MobileServer | undefined;
  available: boolean;
  compact?: boolean;
}) {
  const { t, errorMessage } = useText();
  const workspace = useMobileWorkspace();
  const { session, sessionScope } = useMobileSession();
  const client = useQueryClient();
  const selectWorking = useCallback(
    () => Boolean(workspace.liveState.get().activityByServer[agent.serverId]?.[agent.id]),
    [workspace.liveState, agent.serverId, agent.id],
  );
  const working = useSyncExternalStore(workspace.liveState.subscribe, selectWorking);
  const [directory, setDirectory] = useState<HostDirectory | null>(null);
  const [path, setPath] = useState("");
  const [hidden, setHidden] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canAdminister = server?.role === "owner" || server?.role === "admin";
  const queryKey = [
    "agent-info",
    session?.apiUrl,
    session?.user.id,
    sessionScope,
    agent.serverId,
    agent.id,
    working,
    "working-directory",
  ];
  const settings = useQuery({
    queryKey,
    queryFn: () => workspace.loadWorkingDirectory(agent.id, agent.serverId),
    enabled: available && canAdminister,
    retry: false,
    staleTime: 0,
  });
  if (!canAdminister || !settings.data) return null;
  if (compact)
    return (
      <Pressable
        className="min-w-0 shrink self-center px-2"
        accessibilityRole="button"
        accessibilityLabel={`${t("mobile.agent.directory.title")}: ${settings.data.effectivePath}`}
        onPress={() =>
          Alert.alert(t("mobile.agent.directory.title"), `${server?.name ?? ""}\n${settings.data?.effectivePath ?? ""}`)
        }
      >
        <Typography.Paragraph
          type="body-xs"
          numberOfLines={1}
          accessibilityLabel={`${t("mobile.agent.directory.title")}: ${settings.data.effectivePath}`}
        >
          {settings.data.effectivePath.split(/[\\/]/).filter(Boolean).at(-1) ?? settings.data.effectivePath}
        </Typography.Paragraph>
      </Pressable>
    );
  const disabled = !available || working || pending || settings.data.busy;
  async function browse(target: string | null, offset = 0, showHidden = hidden) {
    setPending(true);
    setError(null);
    try {
      const next = await workspace.browseWorkingDirectory(
        { agentId: agent.id, path: target, offset, showHidden },
        agent.serverId,
      );
      setDirectory(next);
      setPath(next.path);
    } catch (cause) {
      setError(errorMessage(cause, t("mobile.agent.directory.failed")));
    } finally {
      setPending(false);
    }
  }
  async function save(target: string | null) {
    setPending(true);
    setError(null);
    try {
      const saved = await workspace.setWorkingDirectory({ agentId: agent.id, path: target }, agent.serverId);
      client.setQueryData(queryKey, saved);
      setDirectory(null);
    } catch (cause) {
      setError(errorMessage(cause, t("mobile.agent.directory.failed")));
    } finally {
      setPending(false);
    }
  }
  return (
    <SettingsSection title={t("mobile.agent.directory.title")} footer={error ?? server?.name}>
      <SettingsRow>
        <Typography.Paragraph>{settings.data.effectivePath}</Typography.Paragraph>
      </SettingsRow>
      <SettingsRow disabled={disabled} onPress={() => void browse(null)}>
        <Typography.Paragraph>{t("mobile.agent.directory.choose")}</Typography.Paragraph>
      </SettingsRow>
      <SettingsRow disabled={disabled || !settings.data.workingDirectory} onPress={() => void save(null)}>
        <Typography.Paragraph>{t("mobile.agent.directory.default")}</Typography.Paragraph>
      </SettingsRow>
      {directory ? (
        <>
          <SheetFormField
            label={t("mobile.agent.directory.path")}
            value={path}
            onChangeText={setPath}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <SettingsRow disabled={disabled} onPress={() => void browse(path)}>
            <Typography.Paragraph>{t("mobile.agent.directory.open")}</Typography.Paragraph>
          </SettingsRow>
          <SettingsRow disabled={disabled || !directory.parentPath} onPress={() => void browse(directory.parentPath)}>
            <Typography.Paragraph>{t("mobile.agent.directory.parent")}</Typography.Paragraph>
          </SettingsRow>
          <SettingsRow
            disabled={disabled}
            onPress={() => {
              setHidden(!hidden);
              void browse(directory.path, 0, !hidden);
            }}
          >
            <Typography.Paragraph>
              {t(hidden ? "mobile.agent.directory.hideHidden" : "mobile.agent.directory.hidden")}
            </Typography.Paragraph>
          </SettingsRow>
          {directory.roots.map((root) => (
            <SettingsRow key={`root:${root.path}`} disabled={disabled} onPress={() => void browse(root.path)}>
              <Typography.Paragraph>{root.name}</Typography.Paragraph>
            </SettingsRow>
          ))}
          {directory.entries.map((entry) => (
            <SettingsRow key={entry.path} disabled={disabled} onPress={() => void browse(entry.path)}>
              <Typography.Paragraph>{entry.name}</Typography.Paragraph>
            </SettingsRow>
          ))}
          {directory.nextOffset !== null ? (
            <SettingsRow disabled={disabled} onPress={() => void browse(directory.path, directory.nextOffset ?? 0)}>
              <Typography.Paragraph>{t("mobile.agent.directory.more")}</Typography.Paragraph>
            </SettingsRow>
          ) : null}
          <SettingsRow supportingText={directory.path} disabled={disabled} onPress={() => void save(directory.path)}>
            <Typography.Paragraph>{t("mobile.agent.directory.use")}</Typography.Paragraph>
          </SettingsRow>
          <SettingsRow disabled={pending} onPress={() => setDirectory(null)}>
            <Typography.Paragraph>{t("mobile.agent.directory.cancel")}</Typography.Paragraph>
          </SettingsRow>
        </>
      ) : null}
    </SettingsSection>
  );
}
