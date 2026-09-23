import { Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { MarkdownMessageText } from "./MarkdownMessageText";

export interface MarkdownFilePreviewProps {
  body: string;
  agents: AgentProfile[];
  loading?: boolean;
  error?: string | null;
  truncated?: boolean;
  class?: string;
  renderedClass: string;
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
  const contentReady = () => props.loading !== true && !props.error;

  return (
    <div class={`markdown-file-preview${props.class ? ` ${props.class}` : ""}`}>
      <Show
        when={contentReady()}
        fallback={
          <pre class={props.statusClass}>
            {props.loading === true ? "Loading…" : (props.error ?? "Preview unavailable.")}
          </pre>
        }
      >
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
        <Show when={props.truncated}>
          <p class={props.truncatedClass}>Preview truncated after 1,000,000 characters.</p>
        </Show>
      </Show>
    </div>
  );
}
