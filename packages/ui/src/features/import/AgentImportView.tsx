import type {
  AgentImportPreview,
  AgentImportPreviewAgent,
  AgentImportPreviewChannel,
  AgentImportResult,
} from "@openbot/contracts/ipc";
import type { AppFormat, AppTranslate } from "@openbot/i18n";
import {
  Button,
  Checkbox,
  ChevronRight,
  CircleCheck,
  CopyButton,
  Download,
  ExternalLink,
  File,
  FolderOpen,
  Hash,
  Info,
  SlidingTabs,
  Tooltip,
  TriangleAlert,
  Upload,
} from "@openbot/ui";
import { createMemo, createSignal, createUniqueId, For, Show } from "solid-js";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";

/**
 * `idle`: the guide, before an export is chosen. `reading`: main is checking the chosen file.
 * `review`: the export is open and nothing has changed yet. `importing`: agents are being created.
 * `done`: the result of one import.
 */
export type AgentImportPhase = "idle" | "reading" | "review" | "importing" | "done";

/** What the user says to the export agent. It is also the copy button's value. */
export const AGENT_IMPORT_PROMPT = "Export my agents for OpenBot";

/**
 * How the user gets the export agent into Grok Bot. `agent`: install the ready one from its link.
 * `skill`: create a new agent there and add the export skill by hand.
 */
export type AgentImportSetup = "agent" | "skill";

/** The name of the export agent on its Grok Bot page. */
const EXPORT_AGENT_NAME = "OpenBot export";
const EXPORT_SKILL_FILE = "SKILL.md";
const EXPORT_SKILL_ID = "openbot-export";

type CountKind = "agent" | "channel" | "skill" | "routine" | "memory" | "file";

export interface AgentImportViewProps {
  phase: AgentImportPhase;
  error?: string | null;
  preview?: AgentImportPreview | null;
  result?: AgentImportResult | null;
  now?: Date;
  setup: AgentImportSetup;
  /** The export skill's text, or null while it loads or when it could not be read. */
  exportSkill: string | null;
  onSetupChange: (setup: AgentImportSetup) => void;
  onOpenExportAgent: () => void;
  onSaveExportSkill: () => void;
  onChoose: () => void;
  onImport: (keys: string[], channelKeys: string[]) => void;
  onCancel: () => void;
  /** Done on the result: the import is over, so the settings it ran in close. */
  onDone: () => void;
  onOpenAgent: (agentId: string) => void;
}

/**
 * Server settings > Import: move agents from Grok Bot. The guide names the export agent and what to
 * say to it; the review shows what is in the export before anything changes on this server.
 */
export function AgentImportView(props: AgentImportViewProps) {
  return (
    <div
      class="storage-overview agent-import"
      aria-busy={props.phase === "reading" || props.phase === "importing" ? "true" : undefined}
    >
      <Show when={props.phase === "done" && props.result}>
        {(result) => <ImportResult result={result()} onOpenAgent={props.onOpenAgent} onDone={props.onDone} />}
      </Show>
      {/* Keyed, so a newly chosen export starts with every agent selected again. */}
      <Show when={props.phase !== "idle" && props.phase !== "done" && props.preview} keyed>
        {(preview) => (
          <ImportReview
            preview={preview}
            reading={props.phase === "reading"}
            importing={props.phase === "importing"}
            error={props.error}
            now={props.now}
            onChoose={props.onChoose}
            onImport={props.onImport}
            onCancel={props.onCancel}
          />
        )}
      </Show>
      <Show when={props.phase === "idle" || (props.phase === "reading" && !props.preview)}>
        <ImportGuide
          reading={props.phase === "reading"}
          error={props.error}
          setup={props.setup}
          exportSkill={props.exportSkill}
          onSetupChange={props.onSetupChange}
          onOpenExportAgent={props.onOpenExportAgent}
          onSaveExportSkill={props.onSaveExportSkill}
          onChoose={props.onChoose}
        />
      </Show>
    </div>
  );
}

function ImportGuide(props: {
  reading: boolean;
  error?: string | null;
  setup: AgentImportSetup;
  exportSkill: string | null;
  onSetupChange: (setup: AgentImportSetup) => void;
  onOpenExportAgent: () => void;
  onSaveExportSkill: () => void;
  onChoose: () => void;
}) {
  const { t, format, sourceText } = useText();
  const headingId = `agent-import-${createUniqueId()}`;
  return (
    <section class="agent-import-guide" aria-labelledby={headingId}>
      <header class="agent-import-intro">
        <h3 id={headingId} class="agent-import-heading">
          {t("import.guide.title")}
        </h3>
        <p class="agent-import-lede">{t("import.guide.lede")}</p>
      </header>

      <Show when={props.error}>
        <ImportAlert title={t("import.guide.openFailed")} description={sourceText(props.error ?? "")} />
      </Show>

      <ol class="agent-import-steps">
        <li class="agent-import-step">
          <span class="agent-import-marker" aria-hidden="true">
            1
          </span>
          <div class="agent-import-step-body">
            <p class="agent-import-step-title">{t("import.guide.step1")}</p>
            <SlidingTabs.Root
              class="agent-import-setup"
              value={props.setup}
              onChange={(value) => props.onSetupChange(value === "skill" ? "skill" : "agent")}
            >
              <SlidingTabs.List aria-label={t("import.guide.setupLabel")}>
                <SlidingTabs.Trigger value="agent">{t("import.guide.setupAgent")}</SlidingTabs.Trigger>
                <SlidingTabs.Trigger value="skill">{t("import.guide.setupSkill")}</SlidingTabs.Trigger>
              </SlidingTabs.List>
              <SlidingTabs.ContentSlot>
                <SlidingTabs.Content value="agent" class="agent-import-setup-panel">
                  <div class="agent-import-card">
                    <AgentAvatar seed="openbot-export" class="storage-row-avatar" />
                    <span class="agent-import-card-copy">
                      <span class="agent-import-card-name">{EXPORT_AGENT_NAME}</span>
                      <span class="agent-import-card-meta">{t("import.guide.agentMeta")}</span>
                    </span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => props.onOpenExportAgent()}>
                      <ExternalLink aria-hidden="true" />
                      {t("import.guide.openAgent")}
                    </Button>
                  </div>
                  <p class="agent-import-step-note">{t("import.guide.agentNote")}</p>
                </SlidingTabs.Content>
                <SlidingTabs.Content value="skill" class="agent-import-setup-panel">
                  <div class="agent-import-card">
                    <File class="agent-import-card-icon" aria-hidden="true" />
                    <span class="agent-import-card-copy">
                      <span class="agent-import-card-name">{EXPORT_SKILL_FILE}</span>
                      <span class="agent-import-card-meta">
                        {EXPORT_SKILL_ID}
                        <Show when={props.exportSkill}>
                          {(text) => <> · {format.fileSize(new TextEncoder().encode(text()).byteLength)}</>}
                        </Show>
                      </span>
                    </span>
                    <CopyButton
                      value={props.exportSkill}
                      label={t("common.copy")}
                      copiedLabel={t("import.guide.skillCopied")}
                    />
                    <Button type="button" variant="ghost" size="sm" onClick={() => props.onSaveExportSkill()}>
                      <Download aria-hidden="true" />
                      {t("import.guide.saveFile")}
                    </Button>
                  </div>
                  <p class="agent-import-step-note">{t("import.guide.skillNote")}</p>
                </SlidingTabs.Content>
              </SlidingTabs.ContentSlot>
            </SlidingTabs.Root>
          </div>
        </li>
        <li class="agent-import-step">
          <span class="agent-import-marker" aria-hidden="true">
            2
          </span>
          <div class="agent-import-step-body">
            <p class="agent-import-step-title">{t("import.guide.step2")}</p>
            <div class="agent-import-prompt">
              <span class="agent-import-prompt-text">{AGENT_IMPORT_PROMPT}</span>
              <CopyButton
                iconOnly
                value={AGENT_IMPORT_PROMPT}
                label={t("import.guide.copyMessage")}
                copiedLabel={t("import.guide.messageCopied")}
              />
            </div>
            <p class="agent-import-step-note">{t("import.guide.messageNote")}</p>
          </div>
        </li>
        <li class="agent-import-step">
          <span class="agent-import-marker" aria-hidden="true">
            3
          </span>
          <div class="agent-import-step-body">
            <p class="agent-import-step-title">{t("import.guide.step3")}</p>
            <Button
              type="button"
              variant="ghost"
              class="agent-import-picker"
              loading={props.reading}
              loadingLabel={t("import.guide.reading")}
              onClick={() => props.onChoose()}
            >
              <FolderOpen class="agent-import-picker-icon" aria-hidden="true" />
              <span class="agent-import-picker-copy">
                <span class="agent-import-picker-title">{t("import.guide.choose")}</span>
                <span class="agent-import-picker-meta">{t("import.guide.chooseNote")}</span>
              </span>
            </Button>
          </div>
        </li>
      </ol>
    </section>
  );
}

function ImportReview(props: {
  preview: AgentImportPreview;
  reading: boolean;
  importing: boolean;
  error?: string | null;
  now?: Date;
  onChoose: () => void;
  onImport: (keys: string[], channelKeys: string[]) => void;
  onCancel: () => void;
}) {
  const { t, format, sourceText } = useText();
  const headingId = `agent-import-${createUniqueId()}`;
  const [excluded, setExcluded] = createSignal<ReadonlySet<string>>(new Set());
  const selected = createMemo(() => props.preview.agents.filter((agent) => !excluded().has(agent.key)));
  const fileBytes = () => props.preview.agents.reduce((total, agent) => total + agent.fileBytes, 0);
  const caption = () => {
    const parts: string[] = [];
    if (props.preview.exportedAt)
      parts.push(t("import.review.exported", { date: formatDate(props.preview.exportedAt, format, props.now) }));
    parts.push(
      fileBytes() > 0
        ? t("import.review.fileSize", { size: format.fileSize(fileBytes()) })
        : t("import.review.noFiles"),
    );
    return parts.join(" · ");
  };
  const toggle = (key: string, include: boolean) => {
    const next = new Set(excluded());
    if (include) next.delete(key);
    else next.add(key);
    setExcluded(next);
  };
  // A channel imports with the members that are selected, and needs at least one of them.
  const [excludedChannels, setExcludedChannels] = createSignal<ReadonlySet<string>>(new Set());
  const agentsByKey = createMemo(() => new Map(props.preview.agents.map((agent) => [agent.key, agent])));
  const selectedMembers = (channel: AgentImportPreviewChannel) =>
    channel.memberKeys.filter((key) => !excluded().has(key));
  const importable = (channel: AgentImportPreviewChannel) => selectedMembers(channel).length > 0;
  const selectedChannels = createMemo(() =>
    props.preview.channels.filter((channel) => importable(channel) && !excludedChannels().has(channel.key)),
  );
  const toggleChannel = (key: string, include: boolean) => {
    const next = new Set(excludedChannels());
    if (include) next.delete(key);
    else next.add(key);
    setExcludedChannels(next);
  };
  const importLabel = () =>
    selectedChannels().length > 0
      ? t("import.review.importBoth", {
          agents: countLabel(selected().length, "agent", t),
          channels: countLabel(selectedChannels().length, "channel", t),
        })
      : t("import.review.importAgents", { agents: countLabel(selected().length, "agent", t) });

  return (
    <>
      <section class="storage-summary" aria-labelledby={`${headingId}-summary`}>
        <div class="storage-summary-heading">
          <div>
            <h3 id={`${headingId}-summary`} class="storage-summary-label">
              {t("import.review.title", { source: sourceLabel(props.preview.sourceApp) })}
            </h3>
            <p class="storage-summary-total">{countLabel(props.preview.agents.length, "agent", t)}</p>
            <p class="storage-summary-caption">{caption()}</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={props.importing}
            loading={props.reading}
            loadingLabel={t("import.review.reading")}
            onClick={() => props.onChoose()}
          >
            <Upload class="files-button-icon" aria-hidden="true" />
            {t("import.review.chooseAnother")}
          </Button>
        </div>
      </section>

      <Show when={props.error}>
        <ImportAlert title={t("import.review.startFailed")} description={sourceText(props.error ?? "")} />
      </Show>
      <Show when={props.preview.warnings.length > 0}>
        <ImportNotes title={t("import.review.warnings")} notes={props.preview.warnings} />
      </Show>

      <section class="storage-section" aria-labelledby={`${headingId}-agents`}>
        <div class="storage-section-heading-row">
          <h3 id={`${headingId}-agents`} class="storage-section-heading">
            {t("import.review.agents")}
          </h3>
          <span class="storage-section-aside">
            {t("import.review.selected", { selected: selected().length, total: props.preview.agents.length })}
          </span>
        </div>
        <ul class="storage-rows">
          <For each={props.preview.agents}>
            {(agent) => (
              <li>
                <label class="storage-row agent-import-row" for={`${headingId}-agent-${agent.key}`}>
                  <Checkbox
                    id={`${headingId}-agent-${agent.key}`}
                    checked={!excluded().has(agent.key)}
                    disabled={props.importing}
                    aria-label={t("import.review.importItem", { name: agent.name })}
                    onChange={(event) => toggle(agent.key, event.currentTarget.checked)}
                  />
                  <AgentAvatar seed={agent.key} url={agent.avatarUrl} class="storage-row-avatar" />
                  <span class="storage-row-copy">
                    <span class="agent-import-row-title">
                      <span class="storage-row-title">{agent.name}</span>
                      <Show when={agent.nameExists}>
                        <NameExistsHint name={agent.name} />
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
      </section>

      <Show when={props.preview.channels.length > 0}>
        <section class="storage-section" aria-labelledby={`${headingId}-channels`}>
          <div class="storage-section-heading-row">
            <h3 id={`${headingId}-channels`} class="storage-section-heading">
              {t("import.review.channels")}
            </h3>
            <span class="storage-section-aside">
              {t("import.review.selected", {
                selected: selectedChannels().length,
                total: props.preview.channels.length,
              })}
            </span>
          </div>
          <ul class="storage-rows">
            <For each={props.preview.channels}>
              {(channel) => (
                <li>
                  <label class="storage-row agent-import-row" for={`${headingId}-channel-${channel.key}`}>
                    <Checkbox
                      id={`${headingId}-channel-${channel.key}`}
                      checked={importable(channel) && !excludedChannels().has(channel.key)}
                      disabled={props.importing || !importable(channel)}
                      aria-label={t("import.review.importItem", { name: channel.name })}
                      onChange={(event) => toggleChannel(channel.key, event.currentTarget.checked)}
                    />
                    <span class="agent-import-members" aria-hidden="true">
                      <For each={channel.memberKeys.slice(0, 3)}>
                        {(key) => (
                          <AgentAvatar
                            seed={key}
                            url={agentsByKey().get(key)?.avatarUrl ?? null}
                            class="agent-import-member-avatar"
                          />
                        )}
                      </For>
                    </span>
                    <span class="storage-row-copy">
                      <span class="storage-row-title">{channel.name}</span>
                      <span class="storage-row-meta">{channelContentsLabel(channel, t)}</span>
                      <ChannelMemberNote
                        channel={channel}
                        selectedMembers={selectedMembers(channel)}
                        agentsByKey={agentsByKey()}
                      />
                    </span>
                  </label>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      <div class="agent-import-actions">
        <Button type="button" variant="ghost" disabled={props.importing} onClick={() => props.onCancel()}>
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          disabled={selected().length === 0 || props.reading}
          loading={props.importing}
          loadingLabel={t("import.review.importing")}
          onClick={() =>
            props.onImport(
              selected().map((agent) => agent.key),
              selectedChannels().map((channel) => channel.key),
            )
          }
        >
          {importLabel()}
        </Button>
      </div>
    </>
  );
}

/** Which members stay out: an agent that is not selected is not in the channel after import. */
function ChannelMemberNote(props: {
  channel: AgentImportPreviewChannel;
  selectedMembers: string[];
  agentsByKey: ReadonlyMap<string, AgentImportPreviewAgent>;
}) {
  const { t } = useText();
  const missing = () =>
    props.channel.memberKeys
      .filter((key) => !props.selectedMembers.includes(key))
      .map((key) => props.agentsByKey.get(key)?.name ?? key);
  return (
    <Show when={missing().length > 0}>
      <span class="agent-import-row-note">
        {props.selectedMembers.length === 0
          ? t("import.review.channelNeedsMember")
          : t("import.review.channelWithout", { names: missing().join(", ") })}
      </span>
    </Show>
  );
}

/** A second agent with a name already on this server is allowed; the hint says so before import. */
function NameExistsHint(props: { name: string }) {
  const { t } = useText();
  const text = () => t("import.review.nameExists", { name: props.name });
  return (
    <Tooltip.Root openDelay={250} closeDelay={75} placement="top" gutter={8}>
      <Tooltip.Trigger as="span" tabindex={0} class="agent-import-name-hint" aria-label={text()}>
        <Info aria-hidden="true" />
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content class="ui-tooltip agent-import-name-tooltip">{text()}</Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function ImportResult(props: {
  result: AgentImportResult;
  onOpenAgent: (agentId: string) => void;
  onDone: () => void;
}) {
  const { t, sourceText } = useText();
  const headingId = `agent-import-${createUniqueId()}`;
  const notImported = () => props.result.skipped.length + props.result.skippedChannels.length;
  const notImportedLabel = () => {
    const agents = countLabel(props.result.skipped.length, "agent", t);
    const channels = countLabel(props.result.skippedChannels.length, "channel", t);
    if (props.result.skipped.length > 0 && props.result.skippedChannels.length > 0)
      return t("import.result.notImportedBoth", { agents, channels });
    return t("import.result.notImported", { items: props.result.skipped.length > 0 ? agents : channels });
  };
  return (
    <>
      <section class="storage-summary" aria-labelledby={`${headingId}-summary`}>
        <h3 id={`${headingId}-summary`} class="storage-summary-label">
          {t("import.result.title")}
        </h3>
        <p class="storage-summary-total agent-import-done">
          <Show when={props.result.agents.length > 0}>
            <CircleCheck class="agent-import-done-icon" aria-hidden="true" />
          </Show>
          {props.result.channels.length > 0
            ? t("import.result.importedBoth", {
                agents: countLabel(props.result.agents.length, "agent", t),
                channels: countLabel(props.result.channels.length, "channel", t),
              })
            : t("import.result.importedAgents", { agents: countLabel(props.result.agents.length, "agent", t) })}
        </p>
        <Show when={notImported() > 0}>
          <p class="storage-summary-caption">{notImportedLabel()}</p>
        </Show>
      </section>

      <Show when={props.result.agents.length + props.result.channels.length > 0}>
        <section class="storage-section" aria-labelledby={`${headingId}-imported`}>
          <h3 id={`${headingId}-imported`} class="storage-section-heading">
            {t("import.result.imported")}
          </h3>
          <ul class="storage-rows">
            <For each={props.result.agents}>
              {(agent) => (
                <li>
                  <Button
                    type="button"
                    variant="ghost"
                    class="storage-row"
                    aria-label={t("import.result.open", { name: agent.name })}
                    onClick={() => props.onOpenAgent(agent.id)}
                  >
                    <AgentAvatar agent={agent} class="storage-row-avatar" />
                    <span class="storage-row-copy">
                      <span class="storage-row-title">{agent.name}</span>
                      <Show when={agent.title}>
                        <span class="storage-row-meta">{agent.title}</span>
                      </Show>
                    </span>
                    <ChevronRight class="storage-row-chevron" aria-hidden="true" />
                  </Button>
                </li>
              )}
            </For>
            <For each={props.result.channels}>
              {(channel) => (
                <li class="storage-row agent-import-row">
                  <Hash class="agent-import-channel-icon" aria-hidden="true" />
                  <span class="storage-row-copy">
                    <span class="storage-row-title">{channel.name}</span>
                    <span class="storage-row-meta">{t("import.result.channel")}</span>
                  </span>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      <Show when={notImported() > 0}>
        <section class="storage-section" aria-labelledby={`${headingId}-skipped`}>
          <h3 id={`${headingId}-skipped`} class="storage-section-heading">
            {t("import.result.notImportedTitle")}
          </h3>
          <ul class="storage-rows">
            <For each={[...props.result.skipped, ...props.result.skippedChannels]}>
              {(entry) => (
                <li class="storage-row agent-import-row">
                  <TriangleAlert class="storage-message-icon agent-import-skipped-icon" aria-hidden="true" />
                  <span class="storage-row-copy">
                    <span class="storage-row-title">{entry.name}</span>
                    <span class="agent-import-row-note">{sourceText(entry.reason)}</span>
                  </span>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      <Show when={props.result.warnings.length > 0}>
        <ImportNotes title={t("import.result.warnings")} notes={props.result.warnings} />
      </Show>

      <div class="agent-import-actions">
        <Button type="button" variant="secondary" onClick={() => props.onDone()}>
          {t("common.done")}
        </Button>
      </div>
    </>
  );
}

function ImportAlert(props: { title: string; description: string }) {
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

function ImportNotes(props: { title: string; notes: readonly string[] }) {
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

function contentsLabel(agent: AgentImportPreviewAgent, t: AppTranslate): string {
  const parts = [
    countLabel(agent.skillCount, "skill", t),
    countLabel(agent.routineCount, "routine", t),
    countLabel(agent.memoryCount, "memory", t),
  ];
  if (agent.fileCount > 0) parts.push(countLabel(agent.fileCount, "file", t));
  return parts.join(" · ");
}

function channelContentsLabel(channel: AgentImportPreviewChannel, t: AppTranslate): string {
  return [
    countLabel(channel.memberKeys.length, "agent", t),
    countLabel(channel.routineCount, "routine", t),
    countLabel(channel.memoryCount, "memory", t),
  ].join(" · ");
}

function countLabel(count: number, kind: CountKind, t: AppTranslate): string {
  switch (kind) {
    case "agent":
      return t("import.count.agent", { count });
    case "channel":
      return t("import.count.channel", { count });
    case "skill":
      return t("import.count.skill", { count });
    case "routine":
      return t("import.count.routine", { count });
    case "memory":
      return t("import.count.memory", { count });
    case "file":
      return t("import.count.file", { count });
  }
}

function sourceLabel(app: string): string {
  return app === "grok-bot" ? "Grok Bot" : app;
}

function formatDate(value: string, format: AppFormat, now = new Date()): string {
  const date = new Date(value);
  // Intl throws on an invalid date, where `toLocaleDateString` returns text.
  if (Number.isNaN(date.getTime())) return value;
  return format.date(date, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}
