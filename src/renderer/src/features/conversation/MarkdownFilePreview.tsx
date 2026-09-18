import { createEffect, createSignal, Show } from "solid-js";
import { Button } from "../../components/ui";
import type { AgentProfile } from "../../data";
import { MarkdownMessageText } from "./MarkdownMessageText";

export interface MarkdownFilePreviewProps {
  body: string;
  agents: AgentProfile[];
  loading?: boolean;
  error?: string | null;
  truncated?: boolean;
  resetKey: string;
  class?: string;
  renderedClass: string;
  sourceClass: string;
  statusClass: string;
  truncatedClass: string;
  onSelectAgent: (agentId: string) => void;
  onOpenLink: (url: string) => void;
  onOpenSharedFile: (path: string) => void;
  onOpenWorkspaceFile: (path: string) => void;
}

export function isMarkdownFileName(name: string): boolean {
  return /\.(?:md|markdown)$/iu.test(name);
}

export function MarkdownFilePreview(props: MarkdownFilePreviewProps) {
  const [showSource, setShowSource] = createSignal(false);
  const contentReady = () => props.loading !== true && !props.error;

  createEffect(
    () => props.resetKey,
    () => {
      setShowSource(false);
    },
  );

  return (
    <div class={`markdown-file-preview${props.class ? ` ${props.class}` : ""}`}>
      <div class="markdown-file-preview-toolbar">
        <Button
          variant="outline"
          type="button"
          class="markdown-file-preview-source-action"
          disabled={!contentReady()}
          onClick={() => setShowSource((current) => !current)}
        >
          {showSource() ? "View rendered Markdown" : "View source"}
        </Button>
      </div>
      <Show
        when={contentReady()}
        fallback={
          <pre class={props.statusClass}>
            {props.loading === true ? "Loading…" : (props.error ?? "Preview unavailable.")}
          </pre>
        }
      >
        <Show
          when={showSource()}
          fallback={
            <article class={props.renderedClass}>
              <MarkdownMessageText
                body={props.body}
                agents={props.agents}
                attachments={[]}
                citations={[]}
                showCitationFooter={false}
                onSelectAgent={props.onSelectAgent}
                onOpenLink={props.onOpenLink}
                onOpenSharedFile={props.onOpenSharedFile}
                onOpenWorkspaceFile={props.onOpenWorkspaceFile}
              />
            </article>
          }
        >
          <pre class={props.sourceClass}>{props.body}</pre>
        </Show>
        <Show when={props.truncated}>
          <p class={props.truncatedClass}>Preview truncated after 1,000,000 characters.</p>
        </Show>
      </Show>
    </div>
  );
}
