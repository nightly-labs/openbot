import { agentProviderName } from "@openbot/contracts/agent-providers";
import type { InstanceTransferPreview, RemoteInstanceTransferResult } from "@openbot/contracts/ipc";
import { INSTANCE_TRANSFER_REMOTE_BYTES } from "@openbot/contracts/team-protocol/instance-transfer-v1";
import { sourceText } from "@openbot/i18n/source";
import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import {
  agentContents,
  exportDate,
  IncludeRow,
  importCount,
  NotesSection,
  toggledKeys,
} from "@/features/servers/components/import-parts";
import { pickZipUpload } from "@/features/servers/model/transfer-file";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

type Phase = "idle" | "reading" | "review" | "importing" | "done";

/**
 * Server settings › Transfer › Import. The chosen transfer file goes to the host, which keeps it under a
 * token: the review shows what is in it before anything changes. A token left open when the page
 * closes is released.
 */
export function ServerTransferImportScreen() {
  const { t, errorMessage } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { canTransferServer } = useMobileWorkspace();
  const { stageInstanceTransfer, applyInstanceTransfer, discardInstanceTransfer } = useMobileWorkspaceActions();
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<InstanceTransferPreview | null>(null);
  const [result, setResult] = useState<RemoteInstanceTransferResult | null>(null);

  // The open token, for the release when the page closes.
  const token = useRef<string | null>(null);
  token.current = preview?.token ?? null;
  useEffect(
    () => () => {
      if (token.current) void discardInstanceTransfer(token.current, serverId).catch(() => undefined);
    },
    [discardInstanceTransfer, serverId],
  );

  if (!canTransferServer(serverId))
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.server.transfer.unavailable")}</SettingsNote>
      </SettingsContent>
    );

  async function choose() {
    const open = preview;
    setPhase("reading");
    setError(null);
    setProgress(null);
    try {
      const upload = await pickZipUpload(
        INSTANCE_TRANSFER_REMOTE_BYTES,
        sourceText("error.import.transferRemoteTooLarge"),
      );
      if (!upload) {
        setPhase(open ? "review" : "idle");
        return;
      }
      const next = await stageInstanceTransfer(upload, serverId, (fraction) => setProgress(Math.floor(fraction * 100)));
      if (open) void discardInstanceTransfer(open.token, serverId).catch(() => undefined);
      setPreview(next);
      setPhase("review");
    } catch (caught) {
      setPhase(open ? "review" : "idle");
      setError(errorMessage(caught, t("mobile.server.transfer.openFailed")));
      void haptics.notification("error");
    } finally {
      setProgress(null);
    }
  }

  async function apply(keys: string[], includeSettings: boolean) {
    if (!preview) return;
    setPhase("importing");
    setError(null);
    try {
      const done = await applyInstanceTransfer({ token: preview.token, keys, includeSettings }, serverId);
      setPreview(null);
      setResult(done);
      setPhase("done");
      void haptics.notification("success");
    } catch (caught) {
      // The token is spent once the host starts, so the file must be chosen again.
      setPreview(null);
      setPhase("idle");
      setError(errorMessage(caught, t("mobile.server.transfer.importFailed")));
      void haptics.notification("error");
    }
  }

  if (phase === "done" && result) return <TransferResult result={result} />;

  if (preview && phase !== "idle")
    return (
      <TransferReview
        key={preview.token}
        preview={preview}
        reading={phase === "reading"}
        importing={phase === "importing"}
        progress={progress}
        error={error}
        onChoose={() => void choose()}
        onImport={(keys, includeSettings) => void apply(keys, includeSettings)}
      />
    );

  return (
    <SettingsContent>
      <SettingsSection
        title={t("mobile.server.transfer.import")}
        footer={error ?? t("mobile.server.transfer.importLede")}
      >
        <SettingsRow disclosure={false} disabled={phase === "reading"} onPress={() => void choose()}>
          <Typography.Paragraph className="text-accent">
            {phase !== "reading"
              ? t("mobile.server.transfer.choose")
              : progress === null
                ? t("mobile.server.transfer.reading")
                : t("mobile.server.transfer.sending", { percent: progress })}
          </Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  );
}

function TransferReview({
  preview,
  reading,
  importing,
  progress,
  error,
  onChoose,
  onImport,
}: {
  preview: InstanceTransferPreview;
  reading: boolean;
  importing: boolean;
  progress: number | null;
  error: string | null;
  onChoose: () => void;
  onImport: (keys: string[], includeSettings: boolean) => void;
}) {
  const { t, format } = useText();
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [settings, setSettings] = useState(preview.hasSettings);
  const busy = reading || importing;
  const selected = preview.agents.filter((agent) => !excluded.has(agent.key));
  const fileBytes = selected.reduce((total, agent) => total + agent.fileBytes, 0);
  const source = preview.exportedAt
    ? t("mobile.server.transfer.source", {
        version: preview.appVersion,
        date: exportDate(preview.exportedAt, format),
      })
    : t("mobile.server.transfer.sourceNoDate", { version: preview.appVersion });
  const contents = [
    importCount(t, "agent", selected.length),
    importCount(
      t,
      "skill",
      selected.reduce((total, agent) => total + agent.skillCount, 0),
    ),
    importCount(
      t,
      "routine",
      selected.reduce((total, agent) => total + agent.routineCount, 0),
    ),
    importCount(
      t,
      "memory",
      selected.reduce((total, agent) => total + agent.memoryCount, 0),
    ),
    fileBytes > 0
      ? t("mobile.server.transfer.filesSize", { size: format.fileSize(fileBytes) })
      : t("mobile.server.transfer.noFiles"),
    settings ? t("mobile.server.transfer.settings") : t("mobile.server.transfer.noSettings"),
  ].join(" · ");
  const label =
    selected.length > 0
      ? t("mobile.server.transfer.submit", { count: selected.length })
      : t("mobile.server.transfer.submitSettings");

  return (
    <SettingsContent>
      <SheetSaveAction
        dirty
        canSave={(selected.length > 0 || settings) && !reading}
        pending={importing}
        label={label}
        pendingLabel={t("mobile.server.transfer.importing")}
        onSave={() =>
          onImport(
            selected.map((agent) => agent.key),
            settings,
          )
        }
      />
      <SettingsSection title={t("mobile.server.transfer.contains")} footer={error ?? label}>
        <SettingsRow disclosure={false} supportingText={contents}>
          <Typography.Paragraph>{source}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow disclosure={false} disabled={busy} onPress={onChoose}>
          <Typography.Paragraph className="text-accent">
            {!reading
              ? t("mobile.server.transfer.chooseAnother")
              : progress === null
                ? t("mobile.server.transfer.reading")
                : t("mobile.server.transfer.sending", { percent: progress })}
          </Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <NotesSection title={t("mobile.server.transfer.importWarnings")} notes={preview.warnings} />
      {preview.agents.length > 0 ? (
        <SettingsSection title={t("mobile.server.transfer.importAgents")}>
          {preview.agents.map((agent) => (
            <IncludeRow
              key={agent.key}
              label={agent.name}
              supportingText={[
                agentContents(t, agent),
                ...(agent.fileBytes > 0 ? [format.fileSize(agent.fileBytes)] : []),
                ...(agent.nameExists ? [t("mobile.server.transfer.nameExists")] : []),
              ].join(" · ")}
              value={!excluded.has(agent.key)}
              disabled={busy}
              onValueChange={(include) => setExcluded(toggledKeys(excluded, agent.key, include))}
            />
          ))}
        </SettingsSection>
      ) : null}
      {preview.hasSettings ? (
        <SettingsSection footer={t("mobile.server.transfer.importSettingsNote")}>
          <IncludeRow
            label={t("mobile.server.transfer.importSettings")}
            value={settings}
            disabled={busy}
            onValueChange={setSettings}
          />
        </SettingsSection>
      ) : null}
    </SettingsContent>
  );
}

function TransferResult({ result }: { result: RemoteInstanceTransferResult }) {
  const { t, sourceText: localize } = useText();
  return (
    <SettingsContent>
      <SettingsSection
        title={t("mobile.server.transfer.imported", { count: result.agents.length })}
        footer={t("mobile.server.transfer.next")}
      >
        {result.agents.map((agent) => (
          <SettingsRow key={agent.agentId} disclosure={false}>
            <Typography.Paragraph>{agent.name}</Typography.Paragraph>
          </SettingsRow>
        ))}
      </SettingsSection>
      {result.signIn.length > 0 ? (
        <SettingsSection title={t("mobile.server.transfer.signIn")} footer={t("mobile.server.transfer.signInNote")}>
          {result.signIn.map((provider) => (
            <SettingsRow key={provider} disclosure={false}>
              <Typography.Paragraph>{agentProviderName(provider)}</Typography.Paragraph>
            </SettingsRow>
          ))}
        </SettingsSection>
      ) : null}
      {result.skipped.length > 0 ? (
        <SettingsSection title={t("mobile.server.transfer.notImported")}>
          {result.skipped.map((entry) => (
            <SettingsRow key={entry.key} disclosure={false} supportingText={localize(entry.reason)}>
              <Typography.Paragraph>{entry.name}</Typography.Paragraph>
            </SettingsRow>
          ))}
        </SettingsSection>
      ) : null}
      <NotesSection title={t("mobile.server.transfer.warnings")} notes={result.warnings} />
    </SettingsContent>
  );
}
