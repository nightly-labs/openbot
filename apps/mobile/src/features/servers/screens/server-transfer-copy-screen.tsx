import { AGENT_IMPORT_LIMITS, type RemoteInstanceTransferResult } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { copiedTransferUpload } from "@openbot/team-client/team-api-requests";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { agentContents, IncludeRow, toggledKeys } from "@/features/servers/components/import-parts";
import { TransferResult } from "@/features/servers/screens/server-transfer-import-screen";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

type Phase = "idle" | "exporting" | "sending" | "applying";

export function ServerTransferCopyScreen() {
  const { t, format, errorMessage } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const queryScope = useQueryScope();
  const { servers, canTransferServer } = useMobileWorkspace();
  const {
    loadInstanceTransferSummary,
    downloadInstanceTransfer,
    stageInstanceTransfer,
    applyInstanceTransfer,
    discardInstanceTransfer,
  } = useMobileWorkspaceActions();
  const available = canTransferServer(serverId);
  const targets = servers.filter((server) => server.id !== serverId && canTransferServer(server.id));
  const [chosenTarget, setChosenTarget] = useState<string | null>(null);
  const target =
    chosenTarget === null ? (targets[0] ?? null) : (targets.find((server) => server.id === chosenTarget) ?? null);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ server: string; value: RemoteInstanceTransferResult } | null>(null);

  const source = useQuery({
    queryKey: queryKeys.instanceTransferSummary(queryScope, serverId),
    enabled: available,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    queryFn: () => loadInstanceTransferSummary(serverId),
  });
  const destination = useQuery({
    queryKey: queryKeys.instanceTransferSummary(queryScope, target?.id ?? ""),
    enabled: available && target !== null,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    queryFn: () => loadInstanceTransferSummary(target?.id ?? ""),
  });

  const closed = useRef(false);
  const running = useRef(false);
  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
    };
  }, []);

  if (result)
    return (
      <TransferResult
        result={result.value}
        title={t("mobile.server.transfer.copied", { count: result.value.agents.length, server: result.server })}
        footer={t("mobile.server.transfer.copyNext", { server: result.server })}
      />
    );

  if (!available)
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.server.transfer.unavailable")}</SettingsNote>
      </SettingsContent>
    );

  if (targets.length === 0)
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.server.transfer.copyNoServer")}</SettingsNote>
      </SettingsContent>
    );

  const data = source.data;
  if (!data)
    return (
      <SettingsContent>
        <SettingsNote>
          {source.isError
            ? errorMessage(source.error, t("mobile.server.transfer.loadFailed"))
            : t("mobile.server.transfer.loading")}
        </SettingsNote>
        {source.isError ? (
          <SettingsSection>
            <SettingsRow disclosure={false} disabled={source.isFetching} onPress={() => void source.refetch()}>
              <Typography.Paragraph className="text-accent">{t("mobile.server.transfer.retry")}</Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
        ) : null}
      </SettingsContent>
    );

  const busy = phase !== "idle";
  const selected = data.agents.filter((agent) => !excluded.has(agent.id));
  const usedNames = new Set(destination.data?.agents.map((agent) => agent.name.toLowerCase()) ?? []);
  const readingDestination = destination.isPending && destination.fetchStatus !== "idle";

  async function copy(to: { id: string; name: string }) {
    if (running.current) return;
    running.current = true;
    setPhase("exporting");
    setError(null);
    setProgress(null);
    let token: string | null = null;
    try {
      const upload = copiedTransferUpload(
        await downloadInstanceTransfer(
          { agentIds: selected.map((agent) => agent.id), includeFiles: true, includeSettings: true },
          serverId,
        ),
      );
      if (!upload) throw new Error(sourceText("error.import.transferNotFile"));
      if (closed.current) return;
      setPhase("sending");
      const preview = await stageInstanceTransfer(upload, to.id, (fraction) => setProgress(Math.floor(fraction * 100)));
      token = preview.token;
      if (closed.current) return;
      setPhase("applying");
      setProgress(null);
      const done = await applyInstanceTransfer(
        { token, keys: preview.agents.map((agent) => agent.key), includeSettings: true },
        to.id,
      );
      token = null;
      const warnings = [...new Set([...preview.warnings, ...done.warnings])].slice(0, AGENT_IMPORT_LIMITS.warnings);
      setResult({ server: to.name, value: { ...done, warnings } });
      void haptics.notification("success");
    } catch (caught) {
      if (closed.current) return;
      setError(errorMessage(caught, t("mobile.server.transfer.copyFailed")));
      void haptics.notification("error");
    } finally {
      if (token) void discardInstanceTransfer(token, to.id).catch(() => undefined);
      running.current = false;
      if (!closed.current) {
        setPhase("idle");
        setProgress(null);
      }
    }
  }

  const actionLabel =
    phase === "exporting"
      ? t("mobile.server.transfer.copying")
      : phase === "sending"
        ? progress === null
          ? t("mobile.server.transfer.copying")
          : t("mobile.server.transfer.sending", { percent: progress })
        : phase === "applying"
          ? t("mobile.server.transfer.copying")
          : t("mobile.server.transfer.copySubmit", { count: selected.length });
  const confirmAndCopy = (to: { id: string; name: string }) => {
    const duplicates = selected.filter((agent) => usedNames.has(agent.name.toLowerCase()));
    if (duplicates.length === 0) return void copy(to);
    Alert.alert(
      t("mobile.server.transfer.copyDuplicatesTitle"),
      t("mobile.server.transfer.copyDuplicatesBody", {
        server: to.name,
        names: duplicates.map((agent) => agent.name).join(", "),
      }),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("mobile.server.transfer.copyDuplicatesConfirm"), onPress: () => void copy(to) },
      ],
    );
  };

  return (
    <SettingsContent>
      <SettingsSection title={t("mobile.server.transfer.copyTo")}>
        {targets.map((server) => (
          <SettingsRow
            key={server.id}
            checked={server.id === target?.id}
            disabled={busy}
            onPress={() => {
              void haptics.selection();
              setChosenTarget(server.id);
            }}
          >
            <Typography.Paragraph>{server.name}</Typography.Paragraph>
          </SettingsRow>
        ))}
      </SettingsSection>
      <SettingsSection
        title={t("mobile.server.transfer.copyAgents")}
        footer={
          destination.isError
            ? errorMessage(destination.error, t("mobile.server.transfer.loadFailed"))
            : t("mobile.server.transfer.copyNotMoved")
        }
      >
        {data.agents.length === 0 ? (
          <SettingsRow disclosure={false}>
            <Typography.Paragraph>{t("mobile.server.transfer.copyNoAgents")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {data.agents.map((agent) => (
          <IncludeRow
            key={agent.id}
            label={agent.name}
            supportingText={[
              agentContents(t, agent),
              ...(agent.fileBytes > 0 ? [format.fileSize(agent.fileBytes)] : []),
              ...(usedNames.has(agent.name.toLowerCase()) ? [t("mobile.server.transfer.nameExists")] : []),
            ].join(" · ")}
            value={!excluded.has(agent.id)}
            disabled={busy}
            onValueChange={(include) => setExcluded(toggledKeys(excluded, agent.id, include))}
          />
        ))}
      </SettingsSection>
      <SettingsSection footer={error ?? undefined}>
        <SettingsRow
          disclosure={false}
          disabled={busy || selected.length === 0 || !target || readingDestination}
          onPress={() => {
            if (target) confirmAndCopy({ id: target.id, name: target.name });
          }}
        >
          <Typography.Paragraph className="text-accent">{actionLabel}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  );
}
