import { type AgentProviderId, agentProviderName } from "@openbot/contracts/agent-providers";
import type {
  AgentImportPreviewAgent,
  InstanceTransferPreview,
  InstanceTransferResult,
  InstanceTransferSummary,
} from "@openbot/contracts/ipc";
import type { AppFormat, AppTranslate } from "@openbot/i18n";
import {
  ArrowRight,
  Bot,
  Brain,
  Button,
  CalendarClock,
  Checkbox,
  ChevronLeft,
  CircleCheck,
  Download,
  FolderOpen,
  ItemGroup,
  Lock,
  Monitor,
  Settings,
  Sparkles,
  SwitchField,
  TriangleAlert,
  Upload,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, createUniqueId, For, Show } from "solid-js";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";

/** `home`: which computer is this. `export` and `import`: one screen for each direction. */
export type InstanceTransferScreen = "home" | "export" | "import";
export type InstanceExportPhase = "options" | "exporting" | "saved";
export type InstanceImportPhase = "idle" | "reading" | "review" | "importing" | "done";

export interface InstanceExportOptions {
  agentIds: string[];
  includeFiles: boolean;
  includeSettings: boolean;
  includeHistory?: boolean;
}

export interface InstanceTransferViewProps {
  screen: InstanceTransferScreen;
  onScreenChange: (screen: InstanceTransferScreen) => void;
  /** This computer's agents, or null while main reads them. */
  summary: InstanceTransferSummary | null;
  exportPhase: InstanceExportPhase;
  exportFileName: string | null;
  /** What the saved file left out, such as files deleted while it was written. */
  exportWarnings: string[];
  exportError: string | null;
  onExport: (options: InstanceExportOptions) => void;
  /** The server can put the chat history in the file. */
  historyAvailable?: boolean | undefined;
  /** Shows the saved file in its folder. Absent in a browser, which saves to its own download folder. */
  onShowExport?: (() => void) | undefined;
  onExportAgain: () => void;
  importPhase: InstanceImportPhase;
  preview: InstanceTransferPreview | null;
  result: InstanceTransferResult | null;
  importError: string | null;
  onChoose: () => void;
  onImport: (keys: string[], includeSettings: boolean) => void;
  onCancelImport: () => void;
  onImportDone: () => void;
  /** Absent for a joined server: its providers are signed in on that computer. */
  onSignIn?: ((provider: AgentProviderId) => void) | undefined;
}

/**
 * Settings > Transfer: move this computer's agents and app settings to another OpenBot computer.
 * The first screen asks which computer this is, so each direction is one focused screen.
 */
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

function ExportScreen(props: InstanceTransferViewProps) {
  const { t } = useText();
  const [excluded, setExcluded] = createSignal<ReadonlySet<string>>(new Set());
  const [choosing, setChoosing] = createSignal(false);
  const [files, setFiles] = createSignal(true);
  const [settings, setSettings] = createSignal(true);
  const [history, setHistory] = createSignal(true);
  const agents = () => props.summary?.agents ?? [];
  const selected = createMemo(() => agents().filter((agent) => !excluded().has(agent.id)));
  const busy = () => props.exportPhase === "exporting";
  const totals = () => ({
    agents: selected().length,
    skills: selected().reduce((total, agent) => total + agent.skillCount, 0),
    routines: selected().reduce((total, agent) => total + agent.routineCount, 0),
    memories: selected().reduce((total, agent) => total + agent.memoryCount, 0),
    fileBytes: files() ? selected().reduce((total, agent) => total + agent.fileBytes, 0) : null,
    settings: settings(),
  });

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
      {/* Outside the summary, so a summary that fails is shown and not left loading. */}
      <Show when={props.exportError}>
        {(error) => <Alert title={t("settings.transfer.export.failed")} description={error()} />}
      </Show>
      <Show when={props.summary} fallback={<p class="agent-import-lede">{t("settings.transfer.loading")}</p>}>
        <SetupSummary totals={totals()} label={t("settings.transfer.summary.label")} />
        <ItemGroup class="settings-modal-card">
          <SwitchField
            class="settings-modal-row"
            checked={files()}
            disabled={busy()}
            onChange={setFiles}
            label={t("settings.transfer.export.files")}
            description={t("settings.transfer.export.filesDescription")}
          />
          <SwitchField
            class="settings-modal-row"
            checked={settings()}
            disabled={busy()}
            onChange={setSettings}
            label={t("settings.transfer.export.settings")}
            description={t("settings.transfer.export.settingsDescription")}
          />
          <Show when={props.historyAvailable}>
            <SwitchField
              class="settings-modal-row"
              checked={history()}
              disabled={busy()}
              onChange={setHistory}
              label={t("settings.transfer.export.history")}
              description={t("settings.transfer.export.historyDescription")}
            />
          </Show>
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
              fileCount: files() ? agent.fileCount : 0,
              fileBytes: files() ? agent.fileBytes : 0,
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
                includeFiles: files(),
                includeSettings: settings(),
                ...(props.historyAvailable && history() ? { includeHistory: true } : {}),
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
        <Notes title={t("settings.transfer.result.warnings")} notes={props.warnings} />
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
  return (
    <>
      <Show when={props.importPhase === "idle" || (props.importPhase === "reading" && !props.preview)}>
        <h3 class="agent-import-heading">{t("settings.transfer.import.title")}</h3>
        <p class="agent-import-lede">{t("settings.transfer.import.lede")}</p>
        <Show when={props.importError}>
          {(error) => <Alert title={t("settings.transfer.import.openFailed")} description={error()} />}
        </Show>
        <div class="agent-import-actions instance-transfer-start">
          <Button
            type="button"
            loading={props.importPhase === "reading"}
            loadingLabel={t("settings.transfer.import.reading")}
            onClick={() => props.onChoose()}
          >
            <Upload class="files-button-icon" aria-hidden="true" />
            {t("settings.transfer.import.choose")}
          </Button>
        </div>
      </Show>
      {/* Keyed, so a newly chosen file starts with every agent selected again. */}
      <Show when={props.importPhase !== "idle" && props.importPhase !== "done" && props.preview} keyed>
        {(preview) => (
          <ImportReview
            preview={preview}
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
  importing: boolean;
  error: string | null;
  onImport: (keys: string[], includeSettings: boolean) => void;
  onCancel: () => void;
}) {
  const { t, format } = useText();
  const [excluded, setExcluded] = createSignal<ReadonlySet<string>>(new Set());
  const [settings, setSettings] = createSignal(props.preview.hasSettings);
  const selected = createMemo(() => props.preview.agents.filter((agent) => !excluded().has(agent.key)));
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
        {(error) => <Alert title={t("settings.transfer.import.failed")} description={error()} />}
      </Show>
      <Show when={props.preview.warnings.length > 0}>
        <Notes title={t("settings.transfer.import.warnings")} notes={props.preview.warnings} />
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
            description={t("settings.transfer.import.settingsDescription")}
          />
        </ItemGroup>
      </Show>
      <div class="agent-import-actions instance-transfer-start">
        <Button
          type="button"
          disabled={selected().length === 0 && !settings()}
          loading={props.importing}
          loadingLabel={t("settings.transfer.import.importing")}
          onClick={() =>
            props.onImport(
              selected().map((agent) => agent.key),
              settings(),
            )
          }
        >
          {selected().length > 0
            ? t("settings.transfer.import.submit", { count: selected().length })
            : t("settings.transfer.import.submitSettings")}
        </Button>
        <Button type="button" variant="ghost" disabled={props.importing} onClick={() => props.onCancel()}>
          {t("common.cancel")}
        </Button>
      </div>
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
        <Notes
          title={t("settings.transfer.result.notImported")}
          notes={props.result.skipped.map((entry) => `${entry.name}: ${entry.reason}`)}
        />
      </Show>
      <Show when={props.result.warnings.length > 0}>
        <Notes title={t("settings.transfer.result.warnings")} notes={props.result.warnings} />
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
  /** Null when the file has no workspace files. */
  fileBytes: number | null;
  settings: boolean;
}

/** What moves, as counts with icons. Export and import show the same block. */
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

function NotMoved() {
  const { t } = useText();
  return (
    <p class="instance-transfer-not-moved">
      <Lock class="instance-transfer-not-moved-icon" aria-hidden="true" />
      <span>{t("settings.transfer.notMovedSecrets")}</span>
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

function Alert(props: { title: string; description: string }) {
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

function Notes(props: { title: string; notes: readonly string[] }) {
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
