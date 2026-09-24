import type {
  AgentImportPreview,
  AgentImportPreviewAgent,
  AgentImportPreviewChannel,
  AgentImportResult,
} from "@openbot/contracts/ipc";
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
import { AgentAvatar } from "../agents/AgentAvatar";
import { formatFileSize } from "../conversation/AttachmentCards";

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
  const headingId = `agent-import-${createUniqueId()}`;
  return (
    <section class="agent-import-guide" aria-labelledby={headingId}>
      <header class="agent-import-intro">
        <h3 id={headingId} class="agent-import-heading">
          Move your agents from Grok Bot
        </h3>
        <p class="agent-import-lede">
          An export agent in Grok Bot packs names, instructions, avatars, skills, routines, memories, and the files you
          include into one .zip file.
        </p>
      </header>

      <Show when={props.error}>
        <ImportAlert title="The export could not be opened" description={props.error ?? ""} />
      </Show>

      <ol class="agent-import-steps">
        <li class="agent-import-step">
          <span class="agent-import-marker" aria-hidden="true">
            1
          </span>
          <div class="agent-import-step-body">
            <p class="agent-import-step-title">Add the export agent to Grok Bot</p>
            <SlidingTabs.Root
              class="agent-import-setup"
              value={props.setup}
              onChange={(value) => props.onSetupChange(value === "skill" ? "skill" : "agent")}
            >
              <SlidingTabs.List aria-label="How to add the export agent">
                <SlidingTabs.Trigger value="agent">Install the agent</SlidingTabs.Trigger>
                <SlidingTabs.Trigger value="skill">Set it up yourself</SlidingTabs.Trigger>
              </SlidingTabs.List>
              <SlidingTabs.ContentSlot>
                <SlidingTabs.Content value="agent" class="agent-import-setup-panel">
                  <div class="agent-import-card">
                    <AgentAvatar seed="openbot-export" class="storage-row-avatar" />
                    <span class="agent-import-card-copy">
                      <span class="agent-import-card-name">OpenBot export</span>
                      <span class="agent-import-card-meta">Grok Bot agent · has the export skill</span>
                    </span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => props.onOpenExportAgent()}>
                      <ExternalLink aria-hidden="true" />
                      Open the export agent
                    </Button>
                  </div>
                  <p class="agent-import-step-note">
                    Install the ready agent from its Grok Bot page. The export leaves it out.
                  </p>
                </SlidingTabs.Content>
                <SlidingTabs.Content value="skill" class="agent-import-setup-panel">
                  <div class="agent-import-card">
                    <File class="agent-import-card-icon" aria-hidden="true" />
                    <span class="agent-import-card-copy">
                      <span class="agent-import-card-name">SKILL.md</span>
                      <span class="agent-import-card-meta">
                        openbot-export
                        <Show when={props.exportSkill}>
                          {(text) => <> · {formatFileSize(new TextEncoder().encode(text()).byteLength)}</>}
                        </Show>
                      </span>
                    </span>
                    <CopyButton value={props.exportSkill} label="Copy" copiedLabel="Skill copied" />
                    <Button type="button" variant="ghost" size="sm" onClick={() => props.onSaveExportSkill()}>
                      <Download aria-hidden="true" />
                      Save file…
                    </Button>
                  </div>
                  <p class="agent-import-step-note">
                    Add this skill to a new agent in Grok Bot, used only for the export. The export leaves it out.
                  </p>
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
            <p class="agent-import-step-title">Send it this message</p>
            <div class="agent-import-prompt">
              <span class="agent-import-prompt-text">{AGENT_IMPORT_PROMPT}</span>
              <CopyButton iconOnly value={AGENT_IMPORT_PROMPT} label="Copy message" copiedLabel="Message copied" />
            </div>
            <p class="agent-import-step-note">
              It asks if it can include workspace files, then saves the .zip file to Downloads.
            </p>
          </div>
        </li>
        <li class="agent-import-step">
          <span class="agent-import-marker" aria-hidden="true">
            3
          </span>
          <div class="agent-import-step-body">
            <p class="agent-import-step-title">Choose the .zip file</p>
            <Button
              type="button"
              variant="ghost"
              class="agent-import-picker"
              loading={props.reading}
              loadingLabel="Reading the export…"
              onClick={() => props.onChoose()}
            >
              <FolderOpen class="agent-import-picker-icon" aria-hidden="true" />
              <span class="agent-import-picker-copy">
                <span class="agent-import-picker-title">Choose export file</span>
                <span class="agent-import-picker-meta">You see its agents before anything changes.</span>
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
  const headingId = `agent-import-${createUniqueId()}`;
  const [excluded, setExcluded] = createSignal<ReadonlySet<string>>(new Set());
  const selected = createMemo(() => props.preview.agents.filter((agent) => !excluded().has(agent.key)));
  const fileBytes = () => props.preview.agents.reduce((total, agent) => total + agent.fileBytes, 0);
  const caption = () => {
    const parts: string[] = [];
    if (props.preview.exportedAt) parts.push(`Exported ${formatDate(props.preview.exportedAt, props.now)}`);
    parts.push(fileBytes() > 0 ? `${formatFileSize(fileBytes())} of files` : "No workspace files");
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
      ? `Import ${countLabel(selected().length, "agent")} and ${countLabel(selectedChannels().length, "channel")}`
      : `Import ${countLabel(selected().length, "agent")}`;

  return (
    <>
      <section class="storage-summary" aria-labelledby={`${headingId}-summary`}>
        <div class="storage-summary-heading">
          <div>
            <h3 id={`${headingId}-summary`} class="storage-summary-label">
              {sourceLabel(props.preview.sourceApp)} export
            </h3>
            <p class="storage-summary-total">{countLabel(props.preview.agents.length, "agent")}</p>
            <p class="storage-summary-caption">{caption()}</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={props.importing}
            loading={props.reading}
            loadingLabel="Reading…"
            onClick={() => props.onChoose()}
          >
            <Upload class="files-button-icon" aria-hidden="true" />
            Choose another
          </Button>
        </div>
      </section>

      <Show when={props.error}>
        <ImportAlert title="The import did not start" description={props.error ?? ""} />
      </Show>
      <Show when={props.preview.warnings.length > 0}>
        <ImportNotes title="Some items will not move" notes={props.preview.warnings} />
      </Show>

      <section class="storage-section" aria-labelledby={`${headingId}-agents`}>
        <div class="storage-section-heading-row">
          <h3 id={`${headingId}-agents`} class="storage-section-heading">
            Agents
          </h3>
          <span class="storage-section-aside">
            {selected().length} of {props.preview.agents.length} selected
          </span>
        </div>
        <ul class="storage-rows">
          <For each={props.preview.agents}>
            {(agent) => (
              <li>
                <label class="storage-row agent-import-row" for={`${headingId}-${agent.key}`}>
                  <Checkbox
                    id={`${headingId}-${agent.key}`}
                    checked={!excluded().has(agent.key)}
                    disabled={props.importing}
                    aria-label={`Import ${agent.name}`}
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
                    <span class="storage-row-meta">{contentsLabel(agent)}</span>
                  </span>
                  <Show when={agent.fileBytes > 0}>
                    <span class="storage-row-size">{formatFileSize(agent.fileBytes)}</span>
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
              Channels
            </h3>
            <span class="storage-section-aside">
              {selectedChannels().length} of {props.preview.channels.length} selected
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
                      aria-label={`Import ${channel.name}`}
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
                      <span class="storage-row-meta">{channelContentsLabel(channel)}</span>
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
          Cancel
        </Button>
        <Button
          type="button"
          disabled={selected().length === 0 || props.reading}
          loading={props.importing}
          loadingLabel="Importing…"
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
  const missing = () =>
    props.channel.memberKeys
      .filter((key) => !props.selectedMembers.includes(key))
      .map((key) => props.agentsByKey.get(key)?.name ?? key);
  return (
    <Show when={missing().length > 0}>
      <span class="agent-import-row-note">
        {props.selectedMembers.length === 0
          ? "Select at least one of its agents to import it."
          : `Imports without ${missing().join(", ")}.`}
      </span>
    </Show>
  );
}

/** A second agent with a name already on this server is allowed; the hint says so before import. */
function NameExistsHint(props: { name: string }) {
  const text = () => `An agent named ${props.name} already exists. The import adds another one.`;
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
  const headingId = `agent-import-${createUniqueId()}`;
  const notImported = () => props.result.skipped.length + props.result.skippedChannels.length;
  const notImportedLabel = () =>
    [
      props.result.skipped.length > 0 ? countLabel(props.result.skipped.length, "agent") : null,
      props.result.skippedChannels.length > 0 ? countLabel(props.result.skippedChannels.length, "channel") : null,
    ]
      .filter(Boolean)
      .join(" and ");
  return (
    <>
      <section class="storage-summary" aria-labelledby={`${headingId}-summary`}>
        <h3 id={`${headingId}-summary`} class="storage-summary-label">
          Import finished
        </h3>
        <p class="storage-summary-total agent-import-done">
          <Show when={props.result.agents.length > 0}>
            <CircleCheck class="agent-import-done-icon" aria-hidden="true" />
          </Show>
          {props.result.channels.length > 0
            ? `${countLabel(props.result.agents.length, "agent")} and ${countLabel(props.result.channels.length, "channel")} imported`
            : `${countLabel(props.result.agents.length, "agent")} imported`}
        </p>
        <Show when={notImported() > 0}>
          <p class="storage-summary-caption">{notImportedLabel()} did not import.</p>
        </Show>
      </section>

      <Show when={props.result.agents.length + props.result.channels.length > 0}>
        <section class="storage-section" aria-labelledby={`${headingId}-imported`}>
          <h3 id={`${headingId}-imported`} class="storage-section-heading">
            Imported
          </h3>
          <ul class="storage-rows">
            <For each={props.result.agents}>
              {(agent) => (
                <li>
                  <Button
                    type="button"
                    variant="ghost"
                    class="storage-row"
                    aria-label={`Open ${agent.name}`}
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
                    <span class="storage-row-meta">Channel</span>
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
            Not imported
          </h3>
          <ul class="storage-rows">
            <For each={[...props.result.skipped, ...props.result.skippedChannels]}>
              {(entry) => (
                <li class="storage-row agent-import-row">
                  <TriangleAlert class="storage-message-icon agent-import-skipped-icon" aria-hidden="true" />
                  <span class="storage-row-copy">
                    <span class="storage-row-title">{entry.name}</span>
                    <span class="agent-import-row-note">{entry.reason}</span>
                  </span>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      <Show when={props.result.warnings.length > 0}>
        <ImportNotes title="Some items did not move" notes={props.result.warnings} />
      </Show>

      <div class="agent-import-actions">
        <Button type="button" variant="secondary" onClick={() => props.onDone()}>
          Done
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
  return (
    <div class="storage-message">
      <TriangleAlert class="storage-message-icon" aria-hidden="true" />
      <div>
        <p class="storage-message-title">{props.title}</p>
        <ul class="agent-import-notes">
          <For each={props.notes}>{(note) => <li class="storage-message-description">{note}</li>}</For>
        </ul>
      </div>
    </div>
  );
}

function contentsLabel(agent: AgentImportPreviewAgent): string {
  const parts = [
    countLabel(agent.skillCount, "skill"),
    countLabel(agent.routineCount, "routine"),
    countLabel(agent.memoryCount, "memory", "memories"),
  ];
  if (agent.fileCount > 0) parts.push(countLabel(agent.fileCount, "file"));
  return parts.join(" · ");
}

function channelContentsLabel(channel: AgentImportPreviewChannel): string {
  return [
    countLabel(channel.memberKeys.length, "agent"),
    countLabel(channel.routineCount, "routine"),
    countLabel(channel.memoryCount, "memory", "memories"),
  ].join(" · ");
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function sourceLabel(app: string): string {
  return app === "grok-bot" ? "Grok Bot" : app;
}

function formatDate(value: string, now = new Date()): string {
  const date = new Date(value);
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}
