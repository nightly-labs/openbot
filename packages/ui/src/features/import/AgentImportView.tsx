import type { AgentImportPreview, AgentImportPreviewAgent, AgentImportResult } from "@openbot/contracts/ipc";
import {
  Button,
  Checkbox,
  ChevronRight,
  CircleCheck,
  CopyButton,
  ExternalLink,
  FolderOpen,
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

export interface AgentImportViewProps {
  phase: AgentImportPhase;
  error?: string | null;
  preview?: AgentImportPreview | null;
  result?: AgentImportResult | null;
  now?: Date;
  onOpenExportAgent: () => void;
  onChoose: () => void;
  onImport: (keys: string[]) => void;
  onCancel: () => void;
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
        {(result) => <ImportResult result={result()} onOpenAgent={props.onOpenAgent} onDone={props.onCancel} />}
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
          onOpenExportAgent={props.onOpenExportAgent}
          onChoose={props.onChoose}
        />
      </Show>
    </div>
  );
}

function ImportGuide(props: {
  reading: boolean;
  error?: string | null;
  onOpenExportAgent: () => void;
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
          An export agent in Grok Bot packs your agents into one .zip file. OpenBot reads it on this computer and
          uploads nothing.
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
            <Button
              type="button"
              variant="link"
              size="sm"
              class="agent-import-link"
              onClick={() => props.onOpenExportAgent()}
            >
              Open the export agent
              <ExternalLink aria-hidden="true" />
            </Button>
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

      <p class="agent-import-footnote">
        Names, instructions, avatars, skills, routines, memories, and the files you include move to OpenBot. Chat
        history stays in Grok Bot. The export keeps its important facts as memories.
      </p>
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
  onImport: (keys: string[]) => void;
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
                    <span class="storage-row-title">{agent.name}</span>
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

      <div class="agent-import-actions">
        <Button type="button" variant="ghost" disabled={props.importing} onClick={() => props.onCancel()}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={selected().length === 0 || props.reading}
          loading={props.importing}
          loadingLabel="Importing…"
          onClick={() => props.onImport(selected().map((agent) => agent.key))}
        >
          Import {countLabel(selected().length, "agent")}
        </Button>
      </div>
    </>
  );
}

function ImportResult(props: {
  result: AgentImportResult;
  onOpenAgent: (agentId: string) => void;
  onDone: () => void;
}) {
  const headingId = `agent-import-${createUniqueId()}`;
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
          {countLabel(props.result.agents.length, "agent")} imported
        </p>
        <Show when={props.result.skipped.length > 0}>
          <p class="storage-summary-caption">{countLabel(props.result.skipped.length, "agent")} did not import.</p>
        </Show>
      </section>

      <Show when={props.result.agents.length > 0}>
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
          </ul>
        </section>
      </Show>

      <Show when={props.result.skipped.length > 0}>
        <section class="storage-section" aria-labelledby={`${headingId}-skipped`}>
          <h3 id={`${headingId}-skipped`} class="storage-section-heading">
            Not imported
          </h3>
          <ul class="storage-rows">
            <For each={props.result.skipped}>
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
