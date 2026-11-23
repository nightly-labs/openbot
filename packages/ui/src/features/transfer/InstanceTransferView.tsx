import { type AgentProviderId, agentProviderName } from "@openbot/contracts/agent-providers";
import type {
  AgentImportPreviewAgent,
  InstanceTransferPreview,
  InstanceTransferResult,
  InstanceTransferSummary,
  InstanceTransferUploadProgress,
} from "@openbot/contracts/ipc";
import type { AppFormat, AppTranslate } from "@openbot/i18n";
import {
  ArrowLeftRight,
  ArrowRight,
  Bot,
  Brain,
  Button,
  CalendarClock,
  Checkbox,
  ChevronLeft,
  CircleCheck,
  ConfirmDialog,
  Download,
  FolderOpen,
  ItemGroup,
  Lock,
  Monitor,
  Progress,
  Settings,
  SlidingTabs,
  Sparkles,
  SwitchField,
  TriangleAlert,
  Upload,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, createUniqueId, For, onCleanup, Show, untrack } from "solid-js";
import { RollingPrice } from "../../rolling-price";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";

export type InstanceTransferScreen = "home" | "export" | "import";
export type InstanceExportPhase = "options" | "exporting" | "saved";
export type InstanceImportPhase = "idle" | "reading" | "review" | "importing" | "done";

export type TransferUploadState = Pick<InstanceTransferUploadProgress, "sent" | "total">;

export interface InstanceExportOptions {
  agentIds: string[];
  includeFiles: boolean;
  includeSettings: boolean;
  includeHistory?: boolean;
  includeChannelMessages?: boolean;
  includeServerPreferences?: boolean;
}

export interface InstanceTransferViewProps {
  screen: InstanceTransferScreen;
  onScreenChange: (screen: InstanceTransferScreen) => void;
  summary: InstanceTransferSummary | null;
  exportPhase: InstanceExportPhase;
  exportFileName: string | null;
  exportWarnings: string[];
  exportError: string | null;
  onExport: (options: InstanceExportOptions) => void;
  historyAvailable?: boolean | undefined;
  fullCopyAvailable?: boolean | undefined;
  onShowExport?: (() => void) | undefined;
  onExportAgain: () => void;
  importPhase: InstanceImportPhase;
  preview: InstanceTransferPreview | null;
  result: InstanceTransferResult | null;
  importError: string | null;
  importProgress?: TransferUploadState | null | undefined;
  onChoose: () => void;
  onImport: (keys: string[], includeSettings: boolean, includeServerPreferences: boolean) => void;
  onCancelImport: () => void;
  onImportDone: () => void;
  onSignIn?: ((provider: AgentProviderId) => void) | undefined;
  onCopy?: (() => void) | undefined;
}

export function InstanceTransferView(props: InstanceTransferViewProps) {
  const { t } = useText();
  const busy = () =>
    props.exportPhase === "exporting" || props.importPhase === "reading" || props.importPhase === "importing";
  return (
    <div class="instance-transfer" aria-busy={busy() ? "true" : undefined}>
      <Show when={props.screen === "home"}>
        <header class="agent-import-intro">
          <h3 class="agent-import-heading">{t("settings.transfer.title")}</h3>
          <p class="agent-import-lede">{t("settings.transfer.lede")}</p>
        </header>
        <ol class="instance-transfer-flow" aria-label={t("settings.transfer.flow.label")}>
          <li class="instance-transfer-flow-item">
            <Monitor class="instance-transfer-flow-icon" aria-hidden="true" />
            <span>{t("settings.transfer.flow.export")}</span>
          </li>
          <ArrowRight class="instance-transfer-flow-arrow" aria-hidden="true" />
          <li class="instance-transfer-flow-item">
            <FolderOpen class="instance-transfer-flow-icon" aria-hidden="true" />
            <span>{t("settings.transfer.flow.copy")}</span>
          </li>
          <ArrowRight class="instance-transfer-flow-arrow" aria-hidden="true" />
          <li class="instance-transfer-flow-item">
            <Monitor class="instance-transfer-flow-icon" aria-hidden="true" />
            <span>{t("settings.transfer.flow.import")}</span>
          </li>
        </ol>
        <div class="instance-transfer-tiles">
          <Button
            type="button"
            variant="outline"
            class="instance-transfer-tile"
            onClick={() => props.onScreenChange("export")}
          >
            <Download class="instance-transfer-tile-icon" aria-hidden="true" />
            <span class="instance-transfer-tile-title">{t("settings.transfer.old.title")}</span>
            <span class="instance-transfer-tile-text">{t("settings.transfer.old.text")}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            class="instance-transfer-tile"
            onClick={() => props.onScreenChange("import")}
          >
            <Upload class="instance-transfer-tile-icon" aria-hidden="true" />
            <span class="instance-transfer-tile-title">{t("settings.transfer.new.title")}</span>
            <span class="instance-transfer-tile-text">{t("settings.transfer.new.text")}</span>
          </Button>
          <Show when={props.onCopy}>
            {(copy) => (
              <Button type="button" variant="outline" class="instance-transfer-tile" onClick={() => copy()()}>
                <ArrowLeftRight class="instance-transfer-tile-icon" aria-hidden="true" />
                <span class="instance-transfer-tile-title">{t("settings.transfer.copy.tileTitle")}</span>
                <span class="instance-transfer-tile-text">{t("settings.transfer.copy.tileText")}</span>
              </Button>
            )}
          </Show>
        </div>
        <NotMoved />
      </Show>
      <Show when={props.screen === "export"}>
        <BackButton disabled={busy()} onBack={() => props.onScreenChange("home")} />
        <ExportScreen {...props} />
      </Show>
      <Show when={props.screen === "import"}>
        <BackButton disabled={busy()} onBack={() => props.onScreenChange("home")} />
        <ImportScreen {...props} />
      </Show>
    </div>
  );
}

type ExportPart = "settings" | "history" | "channels" | "files" | "preferences";

const TEMPLATE_PARTS: ReadonlySet<ExportPart> = new Set(["settings"]);

function ExportScreen(props: InstanceTransferViewProps) {
  const { t, format } = useText();
  const [excluded, setExcluded] = createSignal<ReadonlySet<string>>(new Set());
  const [choosing, setChoosing] = createSignal(false);
  const [parts, setParts] = createSignal<ReadonlySet<ExportPart>>(TEMPLATE_PARTS);
  const agents = () => props.summary?.agents ?? [];
  const selected = createMemo(() => agents().filter((agent) => !excluded().has(agent.id)));
  const busy = () => props.exportPhase === "exporting";
  const has = (part: ExportPart) => parts().has(part);
  const available = createMemo((): ExportPart[] => [
    "settings",
    ...(props.historyAvailable ? (["history"] as const) : []),
    ...(props.historyAvailable && props.fullCopyAvailable ? (["channels"] as const) : []),
    "files",
    ...(props.fullCopyAvailable ? (["preferences"] as const) : []),
  ]);
  const everything = () => available().every(has);
  const templates = () => available().every((part) => has(part) === TEMPLATE_PARTS.has(part));
  const preset = () => (templates() ? "templates" : everything() ? "everything" : "custom");
  let lastPreset = untrack(preset);
  const fromCustom = createMemo(() => {
    const next = preset();
    const result = lastPreset === "custom" && next !== "custom";
    lastPreset = next;
    return result;
  });
  const pill = () => {
    const appear = fromCustom();
    return preset() === "custom" ? "none" : appear ? "appear" : undefined;
  };
  const toggle = (part: ExportPart, on: boolean) => {
    const next = new Set(parts());
    if (on) next.add(part);
    else next.delete(part);
    setParts(next);
  };
  const allFileBytes = () => agents().reduce((total, agent) => total + agent.fileBytes, 0);
  const fileBytes = () => (has("files") ? selected().reduce((total, agent) => total + agent.fileBytes, 0) : 0);
  const contents = () =>
    [
      t("import.count.agent", { count: selected().length }),
      t("import.count.skill", { count: selected().reduce((total, agent) => total + agent.skillCount, 0) }),
      t("import.count.routine", { count: selected().reduce((total, agent) => total + agent.routineCount, 0) }),
      t("import.count.memory", { count: selected().reduce((total, agent) => total + agent.memoryCount, 0) }),
    ].join(" · ");
  const row = (part: ExportPart) => {
    switch (part) {
      case "settings":
        return {
          label: t("settings.transfer.part.settings"),
          description: t("settings.transfer.export.settingsDescription"),
        };
      case "history":
        return {
          label: t("settings.transfer.part.chats"),
          description: props.fullCopyAvailable
            ? t("settings.transfer.part.chatsDescription")
            : t("settings.transfer.export.historyDescription"),
        };
      case "channels":
        return {
          label: t("settings.transfer.part.channels"),
          description: t("settings.transfer.part.channelsDescription"),
        };
      case "files":
        return {
          label: t("settings.transfer.part.files"),
          description: `${format.fileSize(selected().reduce((total, agent) => total + agent.fileBytes, 0))} · ${t("settings.transfer.part.filesDescription")}`,
        };
      case "preferences":
        return {
          label: t("settings.transfer.part.preferences"),
          description: t("settings.transfer.part.preferencesDescription"),
        };
    }
  };

  return (
    <Show
      when={props.exportPhase !== "saved"}
      fallback={
        <ExportSaved
          fileName={props.exportFileName}
          warnings={props.exportWarnings}
          onShow={props.onShowExport}
          onAgain={props.onExportAgain}
        />
      }
    >
      <h3 class="agent-import-heading">{t("settings.transfer.export.title")}</h3>
      <Show when={props.exportError}>
        {(error) => <TransferAlert title={t("settings.transfer.export.failed")} description={error()} />}
      </Show>
      <Show when={props.summary} fallback={<p class="agent-import-lede">{t("settings.transfer.loading")}</p>}>
        <div class="instance-transfer-meter">
          <div class="instance-transfer-meter-head">
            <RollingPrice value={fileBytes()} format={format.fileSize} class="instance-transfer-meter-total" />
            <span class="instance-transfer-meter-of">
              {t("settings.transfer.meter.files", { total: format.fileSize(allFileBytes()) })}
            </span>
            <SlidingTabs.Root
              class="instance-transfer-presets"
              data-pill={pill()}
              value={preset()}
              disabled={busy()}
              onChange={(value: string) => {
                if (value === "templates") setParts(TEMPLATE_PARTS);
                else if (value === "everything") setParts(new Set(available()));
              }}
            >
              <SlidingTabs.List aria-label={t("settings.transfer.preset.label")}>
                <SlidingTabs.Trigger value="templates">{t("settings.transfer.preset.templates")}</SlidingTabs.Trigger>
                <SlidingTabs.Trigger value="everything">{t("settings.transfer.preset.everything")}</SlidingTabs.Trigger>
                <SlidingTabs.Trigger value="custom" disabled class="instance-transfer-preset-custom">
                  {t("settings.transfer.preset.label")}
                </SlidingTabs.Trigger>
              </SlidingTabs.List>
            </SlidingTabs.Root>
          </div>
        </div>
        <ItemGroup class="settings-modal-card">
          <SwitchField
            class="settings-modal-row"
            checked
            disabled
            label={t("settings.transfer.part.agents")}
            description={t("settings.transfer.part.agentsDescription", { contents: contents() })}
          />
          <For each={available()}>
            {(part) => (
              <SwitchField
                class="settings-modal-row"
                checked={has(part)}
                disabled={busy()}
                onChange={(on: boolean) => toggle(part, on)}
                label={row(part).label}
                description={row(part).description}
              />
            )}
          </For>
        </ItemGroup>
        <Button
          type="button"
          size="sm"
          variant="link"
          class="instance-transfer-link"
          aria-expanded={choosing() ? "true" : "false"}
          onClick={() => setChoosing(!choosing())}
        >
          {choosing()
            ? t("settings.transfer.export.hideAgents")
            : t("settings.transfer.export.chooseAgents", { selected: selected().length, total: agents().length })}
        </Button>
        <Show when={choosing()}>
          <AgentChecklist
            label={t("settings.transfer.export.agentsLabel")}
            agents={agents().map((agent) => ({
              key: agent.id,
              name: agent.name,
              avatar: <AgentAvatar agent={agent} class="storage-row-avatar" />,
              skillCount: agent.skillCount,
              routineCount: agent.routineCount,
              memoryCount: agent.memoryCount,
              fileCount: has("files") ? agent.fileCount : 0,
              fileBytes: has("files") ? agent.fileBytes : 0,
              nameExists: false,
            }))}
            excluded={excluded()}
            disabled={busy()}
            onToggle={(key, include) => setExcluded(toggled(excluded(), key, include))}
          />
        </Show>
        <NotMoved />
        <div class="agent-import-actions instance-transfer-start">
          <Button
            type="button"
            disabled={selected().length === 0}
            loading={busy()}
            loadingLabel={t("settings.transfer.export.saving")}
            onClick={() =>
              props.onExport({
                agentIds: selected().map((agent) => agent.id),
                includeFiles: has("files"),
                includeSettings: has("settings"),
                ...(props.historyAvailable && has("history") ? { includeHistory: true } : {}),
                ...(props.historyAvailable && props.fullCopyAvailable
                  ? { includeChannelMessages: has("channels") }
                  : {}),
                ...(props.fullCopyAvailable && has("preferences") ? { includeServerPreferences: true } : {}),
              })
            }
          >
            <Download class="files-button-icon" aria-hidden="true" />
            {t("settings.transfer.export.save")}
          </Button>
        </div>
      </Show>
    </Show>
  );
}

function ExportSaved(props: {
  fileName: string | null;
  warnings: string[];
  onShow: (() => void) | undefined;
  onAgain: () => void;
}) {
  const { t } = useText();
  return (
    <>
      <p class="storage-summary-total agent-import-done" role="status">
        <CircleCheck class="agent-import-done-icon" aria-hidden="true" />
        {t("settings.transfer.export.saved")}
      </p>
      <Show when={props.fileName}>
        <p class="storage-message-description">{props.fileName}</p>
      </Show>
      <Show when={props.warnings.length > 0}>
        <TransferNotes title={t("settings.transfer.result.warnings")} notes={props.warnings} />
      </Show>
      <ol class="agent-import-steps">
        <li class="agent-import-step">
          <span class="agent-import-marker" aria-hidden="true">
            1
          </span>
          <div class="agent-import-step-body">
            <p class="agent-import-step-title">{t("settings.transfer.export.step1")}</p>
            <p class="agent-import-step-note">{t("settings.transfer.export.step1Note")}</p>
          </div>
        </li>
        <li class="agent-import-step">
          <span class="agent-import-marker" aria-hidden="true">
            2
          </span>
          <div class="agent-import-step-body">
            <p class="agent-import-step-title">{t("settings.transfer.export.step2")}</p>
            <p class="agent-import-step-note">{t("settings.transfer.export.step2Note")}</p>
          </div>
        </li>
      </ol>
      <div class="agent-import-actions instance-transfer-start">
        <Show when={props.onShow}>
          {(show) => (
            <Button type="button" variant="secondary" onClick={() => show()()}>
              <FolderOpen class="files-button-icon" aria-hidden="true" />
              {t("settings.transfer.export.show")}
            </Button>
          )}
        </Show>
        <Button type="button" variant="ghost" onClick={() => props.onAgain()}>
          {t("settings.transfer.export.again")}
        </Button>
      </div>
    </>
  );
}

function ImportScreen(props: InstanceTransferViewProps) {
  const { t } = useText();
  const uploading = () => (props.importPhase === "reading" ? props.importProgress : null);
  return (
    <>
      <Show when={props.importPhase === "idle" || (props.importPhase === "reading" && !props.preview)}>
        <h3 class="agent-import-heading">{t("settings.transfer.import.title")}</h3>
        <p class="agent-import-lede">{t("settings.transfer.import.lede")}</p>
        <Show when={props.importError}>
          {(error) => <TransferAlert title={t("settings.transfer.import.openFailed")} description={error()} />}
        </Show>
        <div class="agent-import-actions instance-transfer-start">
          <Button
            type="button"
            loading={props.importPhase === "reading"}
            loadingLabel={t(uploadLabel(uploading(), "settings.transfer.import.reading"))}
            onClick={() => props.onChoose()}
          >
            <Upload class="files-button-icon" aria-hidden="true" />
            {t("settings.transfer.import.choose")}
          </Button>
        </div>
        <Show when={uploading()}>{(progress) => <TransferUploadProgress progress={progress()} />}</Show>
      </Show>
      <Show when={props.importPhase !== "idle" && props.importPhase !== "done" && props.preview} keyed>
        {(preview) => (
          <ImportReview
            preview={preview}
            preferencesAvailable={props.fullCopyAvailable === true && preview.hasServerPreferences !== false}
            importing={props.importPhase === "importing"}
            error={props.importError}
            onImport={props.onImport}
            onCancel={props.onCancelImport}
          />
        )}
      </Show>
      <Show when={props.importPhase === "done" && props.result}>
        {(result) => <ImportResult result={result()} onSignIn={props.onSignIn} onDone={props.onImportDone} />}
      </Show>
    </>
  );
}

function ImportReview(props: {
  preview: InstanceTransferPreview;
  preferencesAvailable: boolean;
  importing: boolean;
  error: string | null;
  onImport: (keys: string[], includeSettings: boolean, includeServerPreferences: boolean) => void;
  onCancel: () => void;
}) {
  const { t, format } = useText();
  const [excluded, setExcluded] = createSignal<ReadonlySet<string>>(new Set());
  const [settings, setSettings] = createSignal(props.preview.hasSettings);
  const [preferences, setPreferences] = createSignal(untrack(() => props.preferencesAvailable));
  const selected = createMemo(() => props.preview.agents.filter((agent) => !excluded().has(agent.key)));
  const duplicates = createMemo(() => selected().filter((agent) => agent.nameExists));
  const [confirmingDuplicates, setConfirmingDuplicates] = createSignal(false);
  const startImport = () =>
    props.onImport(
      selected().map((agent) => agent.key),
      settings(),
      props.preferencesAvailable && preferences(),
    );
  const totals = () => ({
    agents: selected().length,
    skills: selected().reduce((total, agent) => total + agent.skillCount, 0),
    routines: selected().reduce((total, agent) => total + agent.routineCount, 0),
    memories: selected().reduce((total, agent) => total + agent.memoryCount, 0),
    fileBytes: selected().reduce((total, agent) => total + agent.fileBytes, 0),
    settings: settings(),
  });
  const source = () =>
    props.preview.exportedAt
      ? t("settings.transfer.import.source", {
          version: props.preview.appVersion,
          date: formatDate(props.preview.exportedAt, format),
        })
      : t("settings.transfer.import.sourceNoDate", { version: props.preview.appVersion });

  return (
    <>
      <h3 class="agent-import-heading">{t("settings.transfer.import.contains")}</h3>
      <p class="storage-summary-caption">{source()}</p>
      <SetupSummary totals={totals()} label={t("settings.transfer.summary.label")} />
      <Show when={props.error}>
        {(error) => <TransferAlert title={t("settings.transfer.import.failed")} description={error()} />}
      </Show>
      <Show when={props.preview.warnings.length > 0}>
        <TransferNotes title={t("settings.transfer.import.warnings")} notes={props.preview.warnings} />
      </Show>
      <Show when={props.preview.agents.length > 0}>
        <AgentChecklist
          label={t("settings.transfer.import.agentsLabel")}
          agents={props.preview.agents.map((agent: AgentImportPreviewAgent) => ({
            key: agent.key,
            name: agent.name,
            avatar: <AgentAvatar seed={agent.key} url={agent.avatarUrl} class="storage-row-avatar" />,
            skillCount: agent.skillCount,
            routineCount: agent.routineCount,
            memoryCount: agent.memoryCount,
            fileCount: agent.fileCount,
            fileBytes: agent.fileBytes,
            nameExists: agent.nameExists,
          }))}
          excluded={excluded()}
          disabled={props.importing}
          onToggle={(key, include) => setExcluded(toggled(excluded(), key, include))}
        />
      </Show>
      <Show when={props.preview.hasSettings}>
        <ItemGroup class="settings-modal-card">
          <SwitchField
            class="settings-modal-row"
            checked={settings()}
            disabled={props.importing}
            onChange={setSettings}
            label={t("settings.transfer.import.settings")}
            description={t("settings.transfer.import.settingsAndPreferences")}
          />
        </ItemGroup>
      </Show>
      <Show when={props.preferencesAvailable}>
        <ItemGroup class="settings-modal-card">
          <SwitchField
            class="settings-modal-row"
            checked={preferences()}
            disabled={props.importing}
            onChange={setPreferences}
            label={t("settings.transfer.import.preferences")}
            description={t("settings.transfer.import.preferencesDescription")}
          />
        </ItemGroup>
      </Show>
      <div class="agent-import-actions instance-transfer-start">
        <Button
          type="button"
          disabled={selected().length === 0 && !settings() && !(props.preferencesAvailable && preferences())}
          loading={props.importing}
          loadingLabel={t("settings.transfer.import.importing")}
          onClick={() => (duplicates().length > 0 ? setConfirmingDuplicates(true) : startImport())}
        >
          {selected().length > 0
            ? t("settings.transfer.import.submit", { count: selected().length })
            : t("settings.transfer.import.submitSettings")}
        </Button>
        <Button type="button" variant="ghost" disabled={props.importing} onClick={() => props.onCancel()}>
          {t("common.cancel")}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmingDuplicates()}
        tone="default"
        initialFocus="cancel"
        title={t("import.review.duplicatesTitle")}
        description={t("import.review.duplicatesDescription", {
          names: duplicates()
            .map((agent) => agent.name)
            .join(", "),
        })}
        cancelLabel={t("common.cancel")}
        confirmLabel={t("import.review.duplicatesConfirm")}
        onCancel={() => setConfirmingDuplicates(false)}
        onConfirm={() => {
          setConfirmingDuplicates(false);
          startImport();
        }}
      />
    </>
  );
}

function ImportResult(props: {
  result: InstanceTransferResult;
  onSignIn?: ((provider: AgentProviderId) => void) | undefined;
  onDone: () => void;
}) {
  const { t } = useText();
  const headingId = `instance-transfer-${createUniqueId()}`;
  return (
    <>
      <p class="storage-summary-total agent-import-done" role="status">
        <Show when={props.result.agents.length > 0}>
          <CircleCheck class="agent-import-done-icon" aria-hidden="true" />
        </Show>
        {t("settings.transfer.result.imported", { count: props.result.agents.length })}
      </p>
      <p class="agent-import-lede">{t("settings.transfer.result.next")}</p>
      <Show when={props.result.signIn.length > 0}>
        <section class="storage-section" aria-labelledby={`${headingId}-sign-in`}>
          <h3 id={`${headingId}-sign-in`} class="storage-section-heading">
            {t("settings.transfer.result.signIn")}
          </h3>
          <p class="agent-import-step-note">{t("settings.transfer.result.signInText")}</p>
          <div class="agent-import-actions instance-transfer-start">
            <For each={props.result.signIn}>
              {(provider) => (
                <Show
                  when={props.onSignIn}
                  fallback={<span class="instance-transfer-chip">{agentProviderName(provider)}</span>}
                >
                  {(signIn) => (
                    <Button type="button" size="sm" variant="secondary" onClick={() => signIn()(provider)}>
                      {t("settings.transfer.result.signInButton", { provider: agentProviderName(provider) })}
                    </Button>
                  )}
                </Show>
              )}
            </For>
          </div>
        </section>
      </Show>
      <Show when={props.result.skipped.length > 0}>
        <TransferNotes
          title={t("settings.transfer.result.notImported")}
          notes={props.result.skipped.map((entry) => `${entry.name}: ${entry.reason}`)}
        />
      </Show>
      <Show when={props.result.warnings.length > 0}>
        <TransferNotes title={t("settings.transfer.result.warnings")} notes={props.result.warnings} />
      </Show>
      <div class="agent-import-actions instance-transfer-start">
        <Button type="button" variant="secondary" onClick={() => props.onDone()}>
          {t("common.done")}
        </Button>
      </div>
    </>
  );
}

interface Totals {
  agents: number;
  skills: number;
  routines: number;
  memories: number;
  fileBytes: number | null;
  settings: boolean;
}

function SetupSummary(props: { totals: Totals; label: string }) {
  const { t, format } = useText();
  const items = () => [
    { icon: Bot, text: t("import.count.agent", { count: props.totals.agents }) },
    { icon: Sparkles, text: t("import.count.skill", { count: props.totals.skills }) },
    { icon: CalendarClock, text: t("import.count.routine", { count: props.totals.routines }) },
    { icon: Brain, text: t("import.count.memory", { count: props.totals.memories }) },
    {
      icon: FolderOpen,
      text: props.totals.fileBytes
        ? t("settings.transfer.count.files", { size: format.fileSize(props.totals.fileBytes) })
        : t("settings.transfer.count.noFiles"),
    },
    {
      icon: Settings,
      text: props.totals.settings ? t("settings.transfer.count.settings") : t("settings.transfer.count.noSettings"),
    },
  ];
  return (
    <ul class="instance-transfer-summary" aria-label={props.label}>
      <For each={items()}>
        {(item) => {
          const Icon = item.icon;
          return (
            <li class="instance-transfer-summary-item">
              <Icon class="instance-transfer-summary-icon" aria-hidden="true" />
              <span>{item.text}</span>
            </li>
          );
        }}
      </For>
    </ul>
  );
}

interface ChecklistAgent {
  key: string;
  name: string;
  avatar: JSX.Element;
  skillCount: number;
  routineCount: number;
  memoryCount: number;
  fileCount: number;
  fileBytes: number;
  nameExists: boolean;
}

function AgentChecklist(props: {
  label: string;
  agents: ChecklistAgent[];
  excluded: ReadonlySet<string>;
  disabled: boolean;
  onToggle: (key: string, include: boolean) => void;
}) {
  const { t, format } = useText();
  const id = `instance-transfer-${createUniqueId()}`;
  return (
    <ul class="storage-rows" aria-label={props.label}>
      <For each={props.agents}>
        {(agent) => (
          <li>
            <label class="storage-row agent-import-row" for={`${id}-${agent.key}`}>
              <Checkbox
                id={`${id}-${agent.key}`}
                checked={!props.excluded.has(agent.key)}
                disabled={props.disabled}
                aria-label={t("settings.transfer.includeAgent", { name: agent.name })}
                onChange={(event) => props.onToggle(agent.key, event.currentTarget.checked)}
              />
              {agent.avatar}
              <span class="storage-row-copy">
                <span class="agent-import-row-title">
                  <span class="storage-row-title">{agent.name}</span>
                  <Show when={agent.nameExists}>
                    <span class="instance-transfer-chip">{t("settings.transfer.import.nameExists")}</span>
                  </Show>
                </span>
                <span class="storage-row-meta">{contentsLabel(agent, t)}</span>
              </span>
              <Show when={agent.fileBytes > 0}>
                <span class="storage-row-size">{format.fileSize(agent.fileBytes)}</span>
              </Show>
            </label>
          </li>
        )}
      </For>
    </ul>
  );
}

export function NotMoved(props: { text?: "settings.transfer.notMovedSecrets" | "settings.transfer.copy.notCopied" }) {
  const { t } = useText();
  return (
    <p class="instance-transfer-not-moved">
      <Lock class="instance-transfer-not-moved-icon" aria-hidden="true" />
      <span>{t(props.text ?? "settings.transfer.notMovedSecrets")}</span>
    </p>
  );
}

function BackButton(props: { onBack: () => void; disabled: boolean }) {
  const { t } = useText();
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      class="instance-transfer-back"
      disabled={props.disabled}
      onClick={() => props.onBack()}
    >
      <ChevronLeft aria-hidden="true" />
      {t("settings.transfer.back")}
    </Button>
  );
}

function uploadLabel<Fallback extends string>(progress: TransferUploadState | null | undefined, fallback: Fallback) {
  if (!progress) return fallback;
  return progress.sent < progress.total ? "settings.transfer.upload.sending" : "settings.transfer.upload.serverReading";
}

const TIME_LEFT_WINDOW_MS = 30_000;
const TIME_LEFT_FIRST_MS = 3_000;

function createSecondsLeft(progress: () => TransferUploadState) {
  const samples: { at: number; sent: number }[] = [];
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => {
    const { sent, total } = untrack(progress);
    if (sent < total) setNow(Date.now());
  }, 1000);
  onCleanup(() => clearInterval(timer));
  return createMemo(() => {
    const { sent, total } = progress();
    if (samples.at(-1)?.sent !== sent) {
      const at = Date.now();
      const latest = samples.at(-1);
      const previous = samples.at(-2);
      if (latest && previous && at - latest.at > Math.max(TIME_LEFT_WINDOW_MS, 2 * (latest.at - previous.at)))
        samples.length = 0;
      samples.push({ at, sent });
    }
    const time = Math.max(now(), samples.at(-1)?.at ?? 0);
    while (samples.length > 2 && time - (samples[1]?.at ?? time) >= TIME_LEFT_WINDOW_MS) samples.shift();
    const first = samples[0];
    const last = samples.at(-1);
    const before = samples.at(-2);
    if (!first || !last || sent >= total) return null;
    const usualGap = before ? last.at - before.at : 0;
    if (time - last.at > Math.max(TIME_LEFT_WINDOW_MS, 2 * usualGap)) return null;
    const elapsed = time - first.at;
    const bytesPerMs = (last.sent - first.sent) / elapsed;
    if (elapsed < TIME_LEFT_FIRST_MS || !(bytesPerMs > 0)) return null;
    return (total - sent) / bytesPerMs / 1000;
  });
}

function timeLeftText(t: AppTranslate, seconds: number): string {
  if (seconds < 60) return t("settings.transfer.upload.etaSoon");
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return t("settings.transfer.upload.etaMinutes", { minutes });
  return t("settings.transfer.upload.etaHours", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

export function TransferUploadProgress(props: { progress: TransferUploadState }) {
  const { t, format } = useText();
  const secondsLeft = createSecondsLeft(() => props.progress);
  const percent = () =>
    props.progress.total > 0 ? Math.min(100, Math.floor((props.progress.sent / props.progress.total) * 100)) : 0;
  return (
    <div class="instance-transfer-upload">
      <Progress
        class="instance-transfer-upload-bar"
        value={percent()}
        aria-label={t("settings.transfer.upload.label")}
      />
      <p class="instance-transfer-upload-status">
        {t("settings.transfer.upload.sent", {
          sent: format.fileSizeAmount(props.progress.sent, props.progress.total),
          total: format.fileSize(props.progress.total),
        })}
      </p>
      <Show when={secondsLeft()}>
        {(seconds) => <p class="instance-transfer-upload-status">{timeLeftText(t, seconds())}</p>}
      </Show>
    </div>
  );
}

export function TransferAlert(props: { title: string; description: string }) {
  return (
    <div class="storage-message" role="alert">
      <TriangleAlert class="storage-message-icon" aria-hidden="true" />
      <div>
        <p class="storage-message-title">{props.title}</p>
        <p class="storage-message-description">{props.description}</p>
      </div>
    </div>
  );
}

export function TransferNotes(props: { title: string; notes: readonly string[] }) {
  const { sourceText } = useText();
  return (
    <div class="storage-message">
      <TriangleAlert class="storage-message-icon" aria-hidden="true" />
      <div>
        <p class="storage-message-title">{props.title}</p>
        <ul class="agent-import-notes">
          <For each={props.notes}>{(note) => <li class="storage-message-description">{sourceText(note)}</li>}</For>
        </ul>
      </div>
    </div>
  );
}

function contentsLabel(agent: ChecklistAgent, t: AppTranslate): string {
  const parts = [
    t("import.count.skill", { count: agent.skillCount }),
    t("import.count.routine", { count: agent.routineCount }),
    t("import.count.memory", { count: agent.memoryCount }),
  ];
  if (agent.fileCount > 0) parts.push(t("import.count.file", { count: agent.fileCount }));
  return parts.join(" · ");
}

function toggled(set: ReadonlySet<string>, key: string, include: boolean): ReadonlySet<string> {
  const next = new Set(set);
  if (include) next.delete(key);
  else next.add(key);
  return next;
}

function formatDate(value: string, format: AppFormat): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return format.date(date, { day: "numeric", month: "short", year: "numeric" });
}
