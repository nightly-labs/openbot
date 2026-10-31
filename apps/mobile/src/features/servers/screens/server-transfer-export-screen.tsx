import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { agentContents, IncludeRow, toggledKeys, transferContents } from "@/features/servers/components/import-parts";
import { keepTransferFile, shareTransferFile } from "@/features/servers/model/transfer-file";
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

/**
 * Server settings › Transfer › Export. The host packs the chosen agents into a transfer file, the
 * phone receives it and opens the share sheet, where the user saves it or sends it to the new computer.
 * The phone keeps the file until the page closes, so it can share it again.
 */
export function ServerTransferExportScreen() {
  const { t, format, errorMessage } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const queryScope = useQueryScope();
  const { canTransferServer } = useMobileWorkspace();
  const { loadInstanceTransferSummary, downloadInstanceTransfer } = useMobileWorkspaceActions();
  const available = canTransferServer(serverId);
  // The agents are read again each time the page opens.
  const summary = useQuery({
    queryKey: queryKeys.instanceTransferSummary(queryScope, serverId),
    enabled: available,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    queryFn: () => loadInstanceTransferSummary(serverId),
  });
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [files, setFiles] = useState(true);
  const [settings, setSettings] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The kept file. The host sends the file only, with no warnings.
  const [saved, setSaved] = useState<string | null>(null);

  // The file holds memories and workspace files, so it leaves this phone with the page. A file that
  // arrives after the page closes is not kept.
  const release = useRef<(() => void) | null>(null);
  const closed = useRef(false);
  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
      release.current?.();
    };
  }, []);

  if (!available)
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.server.transfer.unavailable")}</SettingsNote>
      </SettingsContent>
    );

  async function share(uri: string) {
    setError(null);
    try {
      await shareTransferFile(uri);
    } catch (caught) {
      setError(errorMessage(caught, t("mobile.server.transfer.exportFailed")));
      void haptics.notification("error");
    }
  }

  if (saved)
    return (
      <SettingsContent>
        <SettingsSection title={t("mobile.server.transfer.saved")} footer={error ?? undefined}>
          <SettingsRow disclosure={false} supportingText={t("mobile.server.transfer.savedStep1Note")}>
            <Typography.Paragraph>{t("mobile.server.transfer.savedStep1")}</Typography.Paragraph>
          </SettingsRow>
          <SettingsRow disclosure={false} supportingText={t("mobile.server.transfer.savedStep2Note")}>
            <Typography.Paragraph>{t("mobile.server.transfer.savedStep2")}</Typography.Paragraph>
          </SettingsRow>
          <SettingsRow disclosure={false} onPress={() => void share(saved)}>
            <Typography.Paragraph className="text-accent">
              {t("mobile.server.transfer.shareAgain")}
            </Typography.Paragraph>
          </SettingsRow>
          <SettingsRow
            disclosure={false}
            onPress={() => {
              release.current?.();
              release.current = null;
              setSaved(null);
              setError(null);
            }}
          >
            <Typography.Paragraph className="text-accent">
              {t("mobile.server.transfer.exportAgain")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      </SettingsContent>
    );

  const data = summary.data;
  if (!data)
    return (
      <SettingsContent>
        <SettingsNote>
          {summary.isError
            ? errorMessage(summary.error, t("mobile.server.transfer.loadFailed"))
            : t("mobile.server.transfer.loading")}
        </SettingsNote>
        {summary.isError ? (
          <SettingsSection>
            <SettingsRow disclosure={false} disabled={summary.isFetching} onPress={() => void summary.refetch()}>
              <Typography.Paragraph className="text-accent">{t("mobile.server.transfer.retry")}</Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
        ) : null}
      </SettingsContent>
    );

  const selected = data.agents.filter((agent) => !excluded.has(agent.id));
  const fileBytes = files ? selected.reduce((total, agent) => total + agent.fileBytes, 0) : 0;
  const contents = transferContents(t, format, selected, fileBytes, settings);

  async function exportFile() {
    setExporting(true);
    setError(null);
    try {
      const download = await downloadInstanceTransfer(
        { agentIds: selected.map((agent) => agent.id), includeFiles: files, includeSettings: settings },
        serverId,
      );
      if (closed.current) return;
      const kept = keepTransferFile(download);
      release.current?.();
      release.current = kept.release;
      setSaved(kept.uri);
      void haptics.notification("success");
      await share(kept.uri);
    } catch (caught) {
      setError(errorMessage(caught, t("mobile.server.transfer.exportFailed")));
      void haptics.notification("error");
    } finally {
      setExporting(false);
    }
  }

  return (
    <SettingsContent>
      <SettingsSection title={t("mobile.server.transfer.contains")} footer={t("mobile.server.transfer.notMoved")}>
        {contents.map((line) => (
          <SettingsRow key={line} disclosure={false}>
            <Typography.Paragraph>{line}</Typography.Paragraph>
          </SettingsRow>
        ))}
      </SettingsSection>
      <SettingsSection footer={t("mobile.server.transfer.includeFilesNote")}>
        <IncludeRow
          label={t("mobile.server.transfer.includeFiles")}
          value={files}
          disabled={exporting}
          onValueChange={setFiles}
        />
      </SettingsSection>
      <SettingsSection footer={t("mobile.server.transfer.includeSettingsNote")}>
        <IncludeRow
          label={t("mobile.server.transfer.includeSettings")}
          value={settings}
          disabled={exporting}
          onValueChange={setSettings}
        />
      </SettingsSection>
      <SettingsSection title={t("mobile.server.transfer.exportAgents")}>
        {data.agents.map((agent) => (
          <IncludeRow
            key={agent.id}
            label={agent.name}
            supportingText={[
              agentContents(t, { ...agent, fileCount: files ? agent.fileCount : 0 }),
              ...(files && agent.fileBytes > 0 ? [format.fileSize(agent.fileBytes)] : []),
            ].join(" · ")}
            value={!excluded.has(agent.id)}
            disabled={exporting}
            onValueChange={(include) => setExcluded(toggledKeys(excluded, agent.id, include))}
          />
        ))}
      </SettingsSection>
      <SettingsSection footer={error ?? undefined}>
        <SettingsRow disclosure={false} disabled={exporting || selected.length === 0} onPress={() => void exportFile()}>
          <Typography.Paragraph className="text-accent">
            {exporting ? t("mobile.server.transfer.exporting") : t("mobile.server.transfer.exportFile")}
          </Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  );
}
