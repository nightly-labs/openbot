import { Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
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

/** The text limit of the callers that set `truncated`. */
const TRUNCATED_AFTER = 1_000_000;

export function isMarkdownFileName(name: string): boolean {
  return /\.(?:md|markdown)$/iu.test(name);
}

export function MarkdownFilePreview(props: MarkdownFilePreviewProps) {
  const { t, format } = useText();
  const contentReady = () => props.loading !== true && !props.error;

  return (
    <div class={`markdown-file-preview${props.class ? ` ${props.class}` : ""}`}>
      <Show
        when={contentReady()}
        fallback={
          <pre class={props.statusClass}>
            {props.loading === true ? t("common.loading") : (props.error ?? t("preview.unavailable"))}
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
          <p class={props.truncatedClass}>{t("preview.truncated", { limit: format.number(TRUNCATED_AFTER) })}</p>
        </Show>
      </Show>
    </div>
  );
}
