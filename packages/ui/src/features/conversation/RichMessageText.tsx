import { type ChatTagKind, chatTagReferences } from "@openbot/contracts/chat-tag-references";
import type { AttachmentSummary, InstalledSkill } from "@openbot/contracts/ipc";
import { Blocks, Button, Puzzle } from "@openbot/ui";
import { ReferenceChip } from "@openbot/ui/reference-chip";
import { usesTouchLayout } from "@openbot/ui/utils";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, createUniqueId, For, Show } from "solid-js";
import type { AgentProfile, MessageCitation } from "../../data";
import { AgentAvatar } from "../agents/AgentAvatar";
import { AnchoredTooltip } from "./AnchoredTooltip";
import { AttachmentReferenceVisual, attachmentReferenceTone } from "./AttachmentReference";
import { LinkIcon } from "./ConversationIcons";
import { messageFileReferences } from "./FileReference";
import {
  sameStreamingTailOffsets,
  splitStreamingTrail,
  streamingTailOffsets,
  streamingTrailReach,
  useStreamingReveal,
} from "./streamingReveal";

export interface RichMessageTextProps {
  body: string;
  agents: AgentProfile[];
  skills?: InstalledSkill[];
  attachments?: AttachmentSummary[];
  citations?: MessageCitation[];
  onSelectAgent: (agentId: string) => void;
  onOpenLink: (url: string) => void;
  onOpenAttachment?: (attachment: AttachmentSummary) => void;
  onOpenSharedFile?: (path: string) => void;
  onOpenWorkspaceFile?: (path: string) => void;
  showCitationFooter?: boolean;
  /** The characters of a streaming body after this text. It fades the words revealed last. */
  streamingTailAfter?: number | undefined;
}

export function RichMessageText(props: RichMessageTextProps) {
  const citationsByNumber = createMemo(
    () => new Map((props.citations ?? []).map((citation) => [citation.number, citation])),
  );
  const attachmentsById = createMemo(
    () => new Map((props.attachments ?? []).map((attachment) => [attachment.id, attachment])),
  );
  const parts = createMemo(() =>
    richMessageParts(props.body, props.agents, props.skills ?? [], citationsByNumber(), attachmentsById()),
  );
  const trail = useStreamingReveal();
  const tailAfter = createMemo(
    () =>
      streamingTailOffsets(
        parts().map((part) => (plainTextPart(part) ? part.text.length : Number.POSITIVE_INFINITY)),
        props.streamingTailAfter,
        streamingTrailReach(trail?.() ?? []),
      ),
    { equals: sameStreamingTailOffsets },
  );
  const citations = createMemo(() => (props.citations ?? []).filter((citation) => safeBrowserUrl(citation.url)));
  const tooltipId = `rich-message-tooltip-${createUniqueId()}`;
  const [tooltip, setTooltip] = createSignal<{
    anchor: HTMLElement;
    content: string;
    light: boolean;
  } | null>(null);

  const openTooltip = (anchor: HTMLElement, content: string, onlyWhenTruncated = false) => {
    const label = anchor.querySelector<HTMLElement>(".inline-file-reference-name");
    if (onlyWhenTruncated && (!label || label.scrollWidth <= label.clientWidth + 1)) {
      setTooltip(null);
      return;
    }
    setTooltip({
      anchor,
      content,
      light: Boolean(anchor.closest('[data-slot="bubble"][data-author="user"]')),
    });
  };
  const closeTooltip = (anchor: HTMLElement) => {
    if (tooltip()?.anchor === anchor) setTooltip(null);
  };
  const closeTooltipOnEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    if (!(event.currentTarget instanceof HTMLElement)) return;
    closeTooltip(event.currentTarget);
  };

  return (
    <>
      <For each={parts()}>
        {(part, index) => {
          const attachment = part.attachment;
          const sharedPath = part.sharedPath;
          if (attachment || sharedPath) {
            const name = attachment?.name ?? part.text;
            return (
              <Button
                variant="ghost"
                type="button"
                class="message-file-reference"
                data-file-tone={attachmentReferenceTone(name)}
                aria-label={`${attachment ? "Open attached file" : "Open shared file"} ${name}`}
                aria-describedby={tooltipId}
                onPointerEnter={(event) => openTooltip(event.currentTarget, name, true)}
                onMouseEnter={(event) => openTooltip(event.currentTarget, name, true)}
                onPointerLeave={(event) => closeTooltip(event.currentTarget)}
                onMouseLeave={(event) => closeTooltip(event.currentTarget)}
                onFocus={(event) => openTooltip(event.currentTarget, name, true)}
                onBlur={(event) => closeTooltip(event.currentTarget)}
                onKeyDown={closeTooltipOnEscape}
                onClick={(event) => {
                  if (!usesTouchLayout()) setTooltip(null);
                  else openTooltip(event.currentTarget, name, true);
                  if (attachment) props.onOpenAttachment?.(attachment);
                  else if (sharedPath) props.onOpenSharedFile?.(sharedPath);
                }}
              >
                <AttachmentReferenceVisual name={name} />
                <span class="inline-file-reference-name">{name}</span>
              </Button>
            );
          }
          if (part.url) {
            return (
              <MessageLink url={part.url} onOpenLink={props.onOpenLink}>
                {part.text}
              </MessageLink>
            );
          }
          if (part.agent) {
            return (
              <ReferenceChip
                kind="agent"
                name={part.agent.name}
                class="message-agent-tag"
                icon={<AgentAvatar agent={part.agent} />}
                onClick={() => props.onSelectAgent(part.agent?.id ?? "")}
              />
            );
          }
          if (part.skill) {
            return <ReferenceChip kind="skill" name={part.skill.name} icon={<Puzzle />} />;
          }
          if (part.mcpName) {
            return <ReferenceChip kind="mcp" name={part.mcpName} icon={<Blocks />} />;
          }
          if (part.unavailableKind) {
            return (
              <span class="message-tag-unavailable">
                <span class="sr-only">Unavailable {part.unavailableKind} </span>
                {part.text}
              </span>
            );
          }
          if (part.citation) {
            return (
              <span class="message-citation">
                <a
                  class="message-citation-mark"
                  href={part.citation.url}
                  aria-label={`Open citation ${part.citation.number}: ${part.citation.label}`}
                  aria-describedby={tooltipId}
                  onPointerEnter={(event) => openTooltip(event.currentTarget, part.citation?.label ?? "")}
                  onMouseEnter={(event) => openTooltip(event.currentTarget, part.citation?.label ?? "")}
                  onPointerLeave={(event) => closeTooltip(event.currentTarget)}
                  onMouseLeave={(event) => closeTooltip(event.currentTarget)}
                  onFocus={(event) => openTooltip(event.currentTarget, part.citation?.label ?? "")}
                  onBlur={(event) => closeTooltip(event.currentTarget)}
                  onKeyDown={closeTooltipOnEscape}
                  onClick={(event) => {
                    event.preventDefault();
                    setTooltip(null);
                    props.onOpenLink(part.citation?.url ?? "");
                  }}
                >
                  {part.citation.number}
                </a>
              </span>
            );
          }
          return (
            <Show when={tailAfter()[index()] !== undefined} fallback={part.text}>
              <StreamingTailText body={part.text} after={tailAfter()[index()] ?? 0} />
            </Show>
          );
        }}
      </For>
      <Show when={props.showCitationFooter !== false && citations().length > 0}>
        <span class="message-citation-footer">
          <For each={citations()}>
            {(citation) => (
              <a
                class="message-citation-ref"
                href={citation.url}
                aria-label={`Open source ${citation.number}: ${citation.label}`}
                onClick={(event) => {
                  event.preventDefault();
                  props.onOpenLink(citation.url);
                }}
              >
                <span class="message-citation-mark">{citation.number}</span>
                <span class="message-citation-ref-label">{citation.label}</span>
                <span class="message-citation-separator" aria-hidden="true">
                  ·
                </span>
                <span class="message-citation-ref-host">{citation.host ?? citationHost(citation.url)}</span>
                <span class="message-citation-arrow" aria-hidden="true">
                  <CitationArrowIcon />
                </span>
              </a>
            )}
          </For>
        </span>
      </Show>
      <Show when={tooltip()}>
        {(activeTooltip) => (
          <AnchoredTooltip
            id={tooltipId}
            anchor={activeTooltip().anchor}
            content={activeTooltip().content}
            light={activeTooltip().light}
          />
        )}
      </Show>
    </>
  );
}

function StreamingTailText(props: { body: string; after: number }) {
  const trail = useStreamingReveal();
  const parts = createMemo(() => splitStreamingTrail(props.body, trail?.() ?? [], props.after));

  return (
    <>
      {parts().prefix}
      <For each={parts().chunks}>
        {(chunk) => (
          /* The block that holds the tail renders again on each step. A delay of minus the step's
             age continues its fade where it was, instead of starting it again. */
          <span
            class="t-stream-w"
            style={{ "animation-delay": `${Math.min(0, chunk.revealedAt - performance.now())}ms` }}
          >
            {chunk.text}
          </span>
        )}
      </For>
    </>
  );
}

export function MessageLink(props: {
  url: string;
  title?: string | null;
  children: JSX.Element;
  onOpenLink: (url: string) => void;
}) {
  return (
    <a
      class="message-link"
      href={props.url}
      title={props.title ?? props.url}
      onClick={(event) => {
        event.preventDefault();
        props.onOpenLink(props.url);
      }}
    >
      <span class="message-link-icon" aria-hidden="true">
        <LinkIcon />
        <img
          src={faviconUrl(props.url)}
          alt=""
          loading="lazy"
          decoding="async"
          referrerpolicy="no-referrer"
          onError={(event) => event.currentTarget.remove()}
        />
      </span>
      {props.children}
    </a>
  );
}

/** A part that shows its source text as it is, so its length counts body characters. */
function plainTextPart(part: RichMessagePart): boolean {
  return !(
    part.agent ||
    part.skill ||
    part.mcpName ||
    part.unavailableKind ||
    part.citation ||
    part.attachment ||
    part.sharedPath
  );
}

interface RichMessagePart {
  text: string;
  agent?: AgentProfile;
  skill?: InstalledSkill;
  /**
   * An MCP server tag carries the name it was written with, and nothing looks it up. A message is a
   * record of what the user asked, and a server removed since does not make that record wrong.
   */
  mcpName?: string;
  unavailableKind?: ChatTagKind;
  citation?: MessageCitation;
  attachment?: AttachmentSummary;
  sharedPath?: string;
  url?: string;
}

function richMessageParts(
  body: string,
  agents: AgentProfile[],
  skills: InstalledSkill[],
  citationsByNumber: Map<number, MessageCitation>,
  attachmentsById: Map<string, AttachmentSummary>,
): RichMessagePart[] {
  const parts: RichMessagePart[] = [];
  for (const taggedReference of semanticTagParts(body, agents, skills)) {
    if (taggedReference.agent || taggedReference.skill || taggedReference.mcpName || taggedReference.unavailableKind) {
      parts.push(taggedReference);
      continue;
    }
    for (const referencedPart of referencedMessageParts(taggedReference.text, attachmentsById)) {
      if (referencedPart.attachment || referencedPart.sharedPath) {
        parts.push(referencedPart);
        continue;
      }
      for (const part of linkedMessageParts(referencedPart.text)) {
        if (part.url) parts.push(part);
        else {
          for (const taggedPart of taggedMessageParts(part.text, agents)) {
            if (taggedPart.agent) {
              parts.push(taggedPart);
            } else {
              parts.push(...citedMessageParts(taggedPart.text, citationsByNumber));
            }
          }
        }
      }
    }
  }
  return parts;
}

function semanticTagParts(body: string, agents: AgentProfile[], skills: InstalledSkill[]): RichMessagePart[] {
  const references = chatTagReferences(body);
  if (references.length === 0) return [{ text: body }];
  const parts: RichMessagePart[] = [];
  let cursor = 0;
  for (const reference of references) {
    if (reference.start > cursor) parts.push({ text: body.slice(cursor, reference.start) });
    if (reference.kind === "agent") {
      const agent = agents.find((candidate) => candidate.id === reference.id);
      parts.push(agent ? { text: agent.name, agent } : { text: reference.name, unavailableKind: "agent" });
    } else if (reference.kind === "mcp") {
      parts.push({ text: reference.name, mcpName: reference.name });
    } else {
      const skill = skills.find(
        (candidate) => candidate.skillId === reference.id && candidate.state !== "needs-repair",
      );
      parts.push(skill ? { text: skill.name, skill } : { text: reference.name, unavailableKind: "skill" });
    }
    cursor = reference.end;
  }
  if (cursor < body.length) parts.push({ text: body.slice(cursor) });
  return parts;
}

function referencedMessageParts(body: string, attachmentsById: Map<string, AttachmentSummary>): RichMessagePart[] {
  const references = messageFileReferences(body, [...attachmentsById.values()]);
  if (references.length === 0) return [{ text: body }];
  const parts: RichMessagePart[] = [];
  let cursor = 0;
  for (const reference of references) {
    if (reference.start > cursor) parts.push({ text: body.slice(cursor, reference.start) });
    if (reference.kind === "attachment") {
      parts.push({ text: reference.name, attachment: reference.attachment });
    } else {
      parts.push({ text: reference.name, sharedPath: reference.path });
    }
    cursor = reference.end;
  }
  if (cursor < body.length) parts.push({ text: body.slice(cursor) });
  return parts;
}

function citedMessageParts(body: string, citationsByNumber: Map<number, MessageCitation>) {
  if (citationsByNumber.size === 0) return [{ text: body }];
  const parts: RichMessagePart[] = [];
  const expression = /\[(\d+)\]/gu;
  let cursor = 0;
  for (const match of body.matchAll(expression)) {
    const index = match.index ?? 0;
    const number = Number(match[1]);
    const citation = citationsByNumber.get(number);
    if (!citation) continue;
    if (index > cursor) parts.push({ text: body.slice(cursor, index) });
    parts.push({ text: match[0], citation });
    cursor = index + match[0].length;
  }
  if (cursor < body.length) parts.push({ text: body.slice(cursor) });
  return parts.length > 0 ? parts : [{ text: body }];
}

function linkedMessageParts(body: string): RichMessagePart[] {
  const expression = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+)/giu;
  const parts: RichMessagePart[] = [];
  let cursor = 0;
  for (const match of body.matchAll(expression)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ text: body.slice(cursor, index) });
    const markdownUrl = match[2];
    const rawUrl = match[3];
    const rawLink = markdownUrl ?? rawUrl ?? "";
    const cleanLink = rawLink.replace(/[.,!?;:]+$/u, "");
    const url = safeBrowserUrl(cleanLink);
    if (!url) {
      parts.push({ text: match[0] });
    } else {
      parts.push({ text: match[1] ?? cleanLink, url });
      const trailingText = rawLink.slice(cleanLink.length);
      if (trailingText) parts.push({ text: trailingText });
    }
    cursor = index + match[0].length;
  }
  if (cursor < body.length) parts.push({ text: body.slice(cursor) });
  return parts.length > 0 ? parts : [{ text: body }];
}

export function safeBrowserUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function faviconUrl(value: string): string {
  return `${new URL(value).origin}/favicon.ico`;
}

function citationHost(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./u, "");
  } catch {
    return value;
  }
}

function CitationArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
    </svg>
  );
}

interface AgentTagMatcher {
  expression: RegExp;
  agentsByName: Map<string, AgentProfile>;
}

const agentTagMatchers = new WeakMap<AgentProfile[], AgentTagMatcher>();

function agentTagMatcher(agents: AgentProfile[]): AgentTagMatcher | null {
  if (agents.length === 0) return null;
  const cached = agentTagMatchers.get(agents);
  if (cached) return cached;
  const orderedAgents = [...agents].sort((left, right) => right.name.length - left.name.length);
  const matcher: AgentTagMatcher = {
    expression: new RegExp(
      `@(${orderedAgents.map((agent) => escapeExpression(agent.name)).join("|")})(?=$|[\\s.,!?;:()\\[\\]{}])`,
      "giu",
    ),
    agentsByName: new Map(orderedAgents.map((agent) => [agent.name.toLocaleLowerCase(), agent])),
  };
  agentTagMatchers.set(agents, matcher);
  return matcher;
}

function taggedMessageParts(body: string, agents: AgentProfile[]) {
  if (!body.includes("@")) return [{ text: body, agent: undefined }];
  const matcher = agentTagMatcher(agents);
  if (!matcher) return [{ text: body, agent: undefined }];
  matcher.expression.lastIndex = 0;
  const parts: Array<{ text: string; agent: AgentProfile | undefined }> = [];
  let cursor = 0;
  for (const match of body.matchAll(matcher.expression)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ text: body.slice(cursor, index), agent: undefined });
    const name = match[1] ?? "";
    const agent = matcher.agentsByName.get(name.toLocaleLowerCase());
    parts.push({ text: match[0], agent });
    cursor = index + match[0].length;
  }
  if (cursor < body.length) parts.push({ text: body.slice(cursor), agent: undefined });
  return parts.length > 0 ? parts : [{ text: body, agent: undefined }];
}

function escapeExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
