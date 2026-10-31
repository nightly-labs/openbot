import {
  AGENT_IMPORT_EXPORT_AGENT_NAME,
  AGENT_IMPORT_PROMPT,
  type AgentImportPreview,
  type AgentImportPreviewChannel,
  GROK_BOT_EXPORT_URL,
  HERMES_EXPORT_PROMPT,
  HERMES_SKILL_COMMAND,
  parseAgentImportSkillSource,
  type RemoteAgentImportResult,
} from "@openbot/contracts/ipc";
import { AGENT_IMPORT_UPLOAD_BYTES } from "@openbot/contracts/team-protocol/agent-import-v1";
import { sourceText } from "@openbot/i18n/source";
import type { RemoteFileUpload } from "@openbot/team-client/remote-peer";
import * as Clipboard from "expo-clipboard";
import { Stack, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { Alert, Linking } from "react-native";
import {
  agentContents,
  exportDate,
  IncludeRow,
  importCount,
  NotesSection,
  toggledKeys,
} from "@/features/servers/components/import-parts";
import { pickZipUpload } from "@/features/servers/model/transfer-file";
import { IMPORT_SOURCE_NAMES } from "@/features/servers/screens/server-import-screen";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { SheetSaveAction } from "@/shared/components/sheet-save-action";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";

type Phase = "guide" | "reading" | "review" | "importing" | "done";

/**
 * Server settings › Import agents › one source. The guide names the export agent or skill and what to
 * say to it. The export goes to the host, which keeps it under a token: the review shows what is in
 * it before anything changes. A token left open when the screen closes is released.
 */
export function ServerImportGuideScreen() {
  const { t, errorMessage } = useText();
  const params = useLocalSearchParams<{ serverId: string; source: string }>();
  const serverId = params.serverId;
  const source = parseSource(params.source);
  const { canImportAgents } = useMobileWorkspace();
  const { stageAgentImport, applyAgentImport, discardAgentImport } = useMobileWorkspaceActions();
  const [phase, setPhase] = useState<Phase>("guide");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AgentImportPreview | null>(null);
  const [result, setResult] = useState<RemoteAgentImportResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  // The open token, for the release when the screen closes. A token that comes back after that is
  // released when it arrives.
  const token = useRef<string | null>(null);
  token.current = preview?.token ?? null;
  const closed = useRef(false);
  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
      if (token.current) void discardAgentImport(token.current, serverId).catch(() => undefined);
    };
  }, [discardAgentImport, serverId]);

  if (!canImportAgents(serverId))
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.server.import.unavailable")}</SettingsNote>
      </SettingsContent>
    );

  const name = IMPORT_SOURCE_NAMES[source];
  const hermes = source === "hermes-agent";
  const busy = phase === "reading" || phase === "importing";

  async function copy(text: string) {
    await Clipboard.setStringAsync(text);
    void haptics.notification("success");
    setCopied(text);
  }

  async function choose() {
    const open = preview;
    setPhase("reading");
    setError(null);
    setProgress(null);
    let upload: RemoteFileUpload | null;
    try {
      upload = await pickZipUpload(AGENT_IMPORT_UPLOAD_BYTES, sourceText("error.import.remoteZipTooLarge"));
    } catch (caught) {
      // Nothing went to the host, so the open export stays open.
      setPhase(open ? "review" : "guide");
      setError(errorMessage(caught, t("mobile.server.import.readFailed")));
      void haptics.notification("error");
      return;
    }
    if (!upload) {
      setPhase(open ? "review" : "guide");
      return;
    }
    try {
      // A new export releases the earlier one on the host.
      const next = await stageAgentImport(upload, serverId, (fraction) => setProgress(Math.floor(fraction * 100)));
      if (closed.current) {
        void discardAgentImport(next.token, serverId).catch(() => undefined);
        return;
      }
      setPreview(next);
      setPhase("review");
    } catch (caught) {
      // The host may still hold the export that was open, so it is released.
      if (open) void discardAgentImport(open.token, serverId).catch(() => undefined);
      setPreview(null);
      setPhase("guide");
      setError(errorMessage(caught, t("mobile.server.import.readFailed")));
      void haptics.notification("error");
    } finally {
      setProgress(null);
    }
  }

  async function apply(keys: string[], channelKeys: string[]) {
    if (!preview) return;
    setPhase("importing");
    setError(null);
    try {
      const done = await applyAgentImport({ token: preview.token, keys, channelKeys }, serverId);
      setPreview(null);
      setResult(done);
      setPhase("done");
      void haptics.notification("success");
    } catch (caught) {
      // The token is spent either way, so the user chooses the export again.
      setPreview(null);
      setPhase("guide");
      setError(errorMessage(caught, t("mobile.server.import.applyFailed")));
      void haptics.notification("error");
    }
  }

  const title = <Stack.Screen options={{ title: name }} />;

  if (phase === "done" && result)
    return (
      <>
        {title}
        <ImportResult result={result} />
      </>
    );

  if (preview && phase !== "guide")
    return (
      <>
        {title}
        <ImportReview
          key={preview.token}
          preview={preview}
          sourceName={name}
          reading={phase === "reading"}
          importing={phase === "importing"}
          progress={progress}
          error={error}
          onChoose={() => void choose()}
          onImport={(keys, channelKeys) => void apply(keys, channelKeys)}
        />
      </>
    );

  const prompt = hermes ? HERMES_EXPORT_PROMPT : AGENT_IMPORT_PROMPT;
  const copyTrailing = (text: string) => (
    <Typography.Paragraph className="text-accent">
      {copied === text ? t("mobile.server.import.copied") : t("mobile.server.import.copy")}
    </Typography.Paragraph>
  );
  return (
    <SettingsContent>
      {title}
      <SettingsNote>{hermes ? t("mobile.server.import.hermesLede") : t("mobile.server.import.grokLede")}</SettingsNote>
      {hermes ? (
        <SettingsSection title={t("mobile.server.import.hermesStep1")} footer={t("mobile.server.import.commandNote")}>
          <SettingsRow
            disclosure={false}
            trailing={copyTrailing(HERMES_SKILL_COMMAND)}
            accessibilityLabel={t("mobile.server.import.copyLabel", { text: HERMES_SKILL_COMMAND })}
            onPress={() => void copy(HERMES_SKILL_COMMAND)}
          >
            <Typography.Paragraph selectable>{HERMES_SKILL_COMMAND}</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      ) : (
        <SettingsSection
          title={t("mobile.server.import.grokStep1")}
          footer={linkError ?? t("mobile.server.import.agentNote")}
        >
          <SettingsRow
            supportingText={t("mobile.server.import.agentMeta")}
            onPress={() => {
              setLinkError(null);
              void Linking.openURL(GROK_BOT_EXPORT_URL).catch(() =>
                setLinkError(currentText().t("mobile.server.import.openAgentFailed")),
              );
            }}
          >
            <Typography.Paragraph>{AGENT_IMPORT_EXPORT_AGENT_NAME}</Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      )}
      <SettingsSection
        title={t("mobile.server.import.step2")}
        footer={hermes ? t("mobile.server.import.hermesMessageNote") : t("mobile.server.import.grokMessageNote")}
      >
        <SettingsRow
          disclosure={false}
          trailing={copyTrailing(prompt)}
          accessibilityLabel={t("mobile.server.import.copyLabel", { text: prompt })}
          onPress={() => void copy(prompt)}
        >
          <Typography.Paragraph selectable>{prompt}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={t("mobile.server.import.step3")} footer={error ?? t("mobile.server.import.chooseNote")}>
        <SettingsRow disclosure={false} disabled={busy} onPress={() => void choose()}>
          <Typography.Paragraph className="text-accent">
            {phase !== "reading"
              ? t("mobile.server.import.choose")
              : progress === null
                ? t("mobile.server.import.reading")
                : t("mobile.server.import.sending", { percent: progress })}
          </Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  );
}

function parseSource(value: string | undefined) {
  try {
    return parseAgentImportSkillSource(value);
  } catch {
    return "grok-bot";
  }
}

function ImportReview({
  preview,
  sourceName,
  reading,
  importing,
  progress,
  error,
  onChoose,
  onImport,
}: {
  preview: AgentImportPreview;
  sourceName: string;
  reading: boolean;
  importing: boolean;
  progress: number | null;
  error: string | null;
  onChoose: () => void;
  onImport: (keys: string[], channelKeys: string[]) => void;
}) {
  const { t, format } = useText();
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [excludedChannels, setExcludedChannels] = useState<ReadonlySet<string>>(new Set());
  const busy = reading || importing;
  const selected = preview.agents.filter((agent) => !excluded.has(agent.key));
  const agentsByKey = new Map(preview.agents.map((agent) => [agent.key, agent]));
  // A channel imports with the members that are selected, and needs at least one of them.
  const selectedMembers = (channel: AgentImportPreviewChannel) =>
    channel.memberKeys.filter((key) => !excluded.has(key));
  const importable = (channel: AgentImportPreviewChannel) => selectedMembers(channel).length > 0;
  const selectedChannels = preview.channels.filter(
    (channel) => importable(channel) && !excludedChannels.has(channel.key),
  );
  const fileBytes = preview.agents.reduce((total, agent) => total + agent.fileBytes, 0);
  const caption = [
    ...(preview.exportedAt
      ? [t("mobile.server.import.exported", { date: exportDate(preview.exportedAt, format) })]
      : []),
    fileBytes > 0
      ? t("mobile.server.import.fileSize", { size: format.fileSize(fileBytes) })
      : t("mobile.server.import.noFiles"),
  ].join(" · ");
  const agentsLabel = importCount(t, "agent", selected.length);
  const importLabel =
    selectedChannels.length > 0
      ? t("mobile.server.import.importBoth", {
          agents: agentsLabel,
          channels: importCount(t, "channel", selectedChannels.length),
        })
      : t("mobile.server.import.importAgents", { agents: agentsLabel });
  const start = () =>
    onImport(
      selected.map((agent) => agent.key),
      selectedChannels.map((channel) => channel.key),
    );
  // An agent whose name is already on this server imports as a second, separate agent: the user accepts that first.
  const confirmAndStart = () => {
    const duplicates = selected.filter((agent) => agent.nameExists);
    if (duplicates.length === 0) return start();
    Alert.alert(
      t("mobile.server.import.duplicatesTitle"),
      t("mobile.server.import.duplicatesBody", { names: duplicates.map((agent) => agent.name).join(", ") }),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("mobile.server.import.duplicatesConfirm"), onPress: start },
      ],
    );
  };
  const channelNote = (channel: AgentImportPreviewChannel) => {
    const members = selectedMembers(channel);
    const missing = channel.memberKeys
      .filter((key) => !members.includes(key))
      .map((key) => agentsByKey.get(key)?.name ?? key);
    if (missing.length === 0) return null;
    return members.length === 0
      ? t("mobile.server.import.channelNeedsMember")
      : t("mobile.server.import.channelWithout", { names: missing.join(", ") });
  };

  return (
    <SettingsContent>
      <SheetSaveAction
        dirty
        canSave={selected.length > 0 && !reading}
        pending={importing}
        label={importLabel}
        pendingLabel={t("mobile.server.import.importing")}
        onSave={confirmAndStart}
      />
      <SettingsSection
        title={t("mobile.server.import.reviewTitle", { source: sourceName })}
        footer={error ?? importLabel}
      >
        <SettingsRow disclosure={false} supportingText={caption}>
          <Typography.Paragraph>{importCount(t, "agent", preview.agents.length)}</Typography.Paragraph>
        </SettingsRow>
        <SettingsRow disclosure={false} disabled={busy} onPress={onChoose}>
          <Typography.Paragraph className="text-accent">
            {!reading
              ? t("mobile.server.import.chooseAnother")
              : progress === null
                ? t("mobile.server.import.reading")
                : t("mobile.server.import.sending", { percent: progress })}
          </Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <NotesSection title={t("mobile.server.import.warnings")} notes={preview.warnings} />
      <SettingsSection
        title={t("mobile.server.import.agents")}
        footer={t("mobile.server.import.selected", { selected: selected.length, total: preview.agents.length })}
      >
        {preview.agents.map((agent) => (
          <IncludeRow
            key={agent.key}
            label={agent.name}
            supportingText={[
              agentContents(t, agent),
              ...(agent.nameExists ? [t("mobile.server.import.nameExists", { name: agent.name })] : []),
            ].join("\n")}
            value={!excluded.has(agent.key)}
            disabled={busy}
            onValueChange={(include) => setExcluded(toggledKeys(excluded, agent.key, include))}
          />
        ))}
      </SettingsSection>
      {preview.channels.length > 0 ? (
        <SettingsSection
          title={t("mobile.server.import.channels")}
          footer={t("mobile.server.import.selected", {
            selected: selectedChannels.length,
            total: preview.channels.length,
          })}
        >
          {preview.channels.map((channel) => {
            const note = channelNote(channel);
            return (
              <IncludeRow
                key={channel.key}
                label={channel.name}
                supportingText={[
                  [
                    importCount(t, "agent", channel.memberKeys.length),
                    importCount(t, "routine", channel.routineCount),
                    importCount(t, "memory", channel.memoryCount),
                  ].join(" · "),
                  ...(note ? [note] : []),
                ].join("\n")}
                value={importable(channel) && !excludedChannels.has(channel.key)}
                disabled={busy || !importable(channel)}
                onValueChange={(include) => setExcludedChannels(toggledKeys(excludedChannels, channel.key, include))}
              />
            );
          })}
        </SettingsSection>
      ) : null}
    </SettingsContent>
  );
}

function ImportResult({ result }: { result: RemoteAgentImportResult }) {
  const { t, sourceText: localize } = useText();
  const agents = importCount(t, "agent", result.agents.length);
  const done =
    result.channels.length > 0
      ? t("mobile.server.import.importedBoth", {
          agents,
          channels: importCount(t, "channel", result.channels.length),
        })
      : t("mobile.server.import.importedAgents", { agents });
  const skippedAgents = importCount(t, "agent", result.skipped.length);
  const skippedChannels = importCount(t, "channel", result.skippedChannels.length);
  const notImported =
    result.skipped.length > 0 && result.skippedChannels.length > 0
      ? t("mobile.server.import.notImportedBoth", { agents: skippedAgents, channels: skippedChannels })
      : result.skipped.length + result.skippedChannels.length > 0
        ? t("mobile.server.import.notImported", {
            items: result.skipped.length > 0 ? skippedAgents : skippedChannels,
          })
        : undefined;
  // An agent and a channel of one export can have the same key.
  const skipped = [
    ...result.skipped.map((entry) => ({ ...entry, id: `agent:${entry.key}` })),
    ...result.skippedChannels.map((entry) => ({ ...entry, id: `channel:${entry.key}` })),
  ];
  return (
    <SettingsContent>
      <SettingsSection title={t("mobile.server.import.resultTitle")} footer={notImported}>
        <SettingsRow disclosure={false}>
          <Typography.Paragraph>{done}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      {result.agents.length + result.channels.length > 0 ? (
        <SettingsSection title={t("mobile.server.import.imported")}>
          {result.agents.map((agent) => (
            <SettingsRow key={agent.agentId} disclosure={false}>
              <Typography.Paragraph>{agent.name}</Typography.Paragraph>
            </SettingsRow>
          ))}
          {result.channels.map((channel) => (
            <SettingsRow key={channel.id} disclosure={false} supportingText={t("mobile.server.import.channel")}>
              <Typography.Paragraph>{channel.name}</Typography.Paragraph>
            </SettingsRow>
          ))}
        </SettingsSection>
      ) : null}
      {skipped.length > 0 ? (
        <SettingsSection title={t("mobile.server.import.notImportedTitle")}>
          {skipped.map((entry) => (
            <SettingsRow key={entry.id} disclosure={false} supportingText={localize(entry.reason)}>
              <Typography.Paragraph>{entry.name}</Typography.Paragraph>
            </SettingsRow>
          ))}
        </SettingsSection>
      ) : null}
      <NotesSection title={t("mobile.server.import.resultWarnings")} notes={result.warnings} />
    </SettingsContent>
  );
}
