import { rankAgentMentions } from "@openbot/contracts/agent-mention-rank";
import { attachmentReferenceIds, expandAttachmentReferences } from "@openbot/contracts/attachment-references";
import {
  EVERYONE_MENTION,
  expandChatTagReferences,
  serializeChatTagReference,
} from "@openbot/contracts/chat-tag-references";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { DraftAttachment } from "@openbot/contracts/ipc";
import { AppWindow, Badge, Blocks, Listbox, Puzzle, Split, UsersRound } from "@openbot/ui";
import { usesTouchLayout } from "@openbot/ui/utils";
import { Dynamic, type JSX, Portal } from "@solidjs/web";
import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  onCleanup,
  onSettled,
  Show,
  untrack,
} from "solid-js";
import { normalizedSearchText, snippetAround } from "../../components/global-search-text";
import type {
  ComposerAgent,
  ComposerBrowserTab,
  ComposerMcpServer,
  ComposerSkill,
  ComposerThread,
  ComposerThreadMessageMatch,
} from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { AnchoredTooltip } from "./AnchoredTooltip";
import { AttachmentReferenceVisual } from "./AttachmentReference";
import {
  automaticMentionSpaceAtCaretBoundary,
  type ComposerPasteResult,
  type ComposerSelection,
  editorText,
  editorTextOffset,
  insertLineBreak,
  insertPlainText,
  isEditCommandRunning,
  mentionTokenAtCaretBoundary,
  placeCaretAtChildOffset,
  placeCaretAtEnd,
  placeSerializedCaret,
  rangeFromTextOffsets,
  readEditorSelection,
  restoreEditorSelection,
  serializedEditorSelection,
  serializeEditor,
} from "./composer-dom";
import { shouldRestoreComposerFocus } from "./composer-focus";
import {
  measurePickerFrame,
  type PickerFrame,
  type PickerOption,
  type PickerSection,
  pickerOptionBadge,
  pickerOptionDescription,
  pickerOptionKey,
  pickerOptionName,
  pickerOptionText,
  referenceMatches,
  skillMatchRank,
} from "./composer-picker";
import {
  type AttachmentTokenActions,
  createAttachmentToken,
  createMcpToken,
  createMentionToken,
  createQuoteToken,
  createSkillToken,
  createTabToken,
  createThreadToken,
  type EditorTagSources,
  MENTION_PATTERN,
  renderEditorValue,
  syncAttachmentTokens,
  syncMcpTokens,
  syncReferenceTokens,
  syncSkillTokens,
  truncateComposerValue,
} from "./composer-tokens";
import {
  matchParts,
  trackEnteringPickerRows,
  trackPickerHighlight,
  trackPickerScrollFades,
} from "./mention-picker-motion";
import { isSendShortcutKey, type SendShortcut } from "./send-shortcut";

interface ComposerEditorProps {
  agentId: string | undefined;
  agents: ComposerAgent[];
  skills?: ComposerSkill[] | undefined;
  mcpServers?: ComposerMcpServer[] | undefined;
  attachments?: DraftAttachment[] | undefined;
  browserTabs?: ComposerBrowserTab[] | undefined;
  threads?: ComposerThread[] | undefined;
  onSearchThreads?: ((query: string) => Promise<ComposerThreadMessageMatch[]>) | undefined;
  onOpenTag?: ((kind: "tab" | "thread", id: string) => void) | undefined;
  value: string;
  placeholder: string;
  ariaLabel: string;
  disabled: boolean;
  size?: "default" | "compact";
  focusRequest?: number | undefined;
  skillPickerRequest?: number;
  quoteRequest?: QuoteRequest | undefined;
  onOpenQuote?: ((messageId: string, text: string) => void) | undefined;
  skillsLoadFailed?: boolean | undefined;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onSteer?: (() => void) | undefined;
  sendShortcut?: SendShortcut | undefined;
  onOpenAttachment?: ((attachment: DraftAttachment) => void) | undefined;
  onPasteFiles?:
    | ((
        files: File[],
        selection: ComposerSelection,
        text?: string,
      ) => undefined | Promise<ComposerPasteResult | undefined>)
    | undefined;
  onPasteAttachments?: (
    clipboard: DataTransfer,
    selection: ComposerSelection,
  ) => Promise<ComposerPasteResult | undefined> | undefined;
  onCopyAttachments?: (
    clipboard: DataTransfer,
    text: string,
    attachments: DraftAttachment[],
    remaining: string | undefined,
  ) => void;
  everyoneMention?: boolean | undefined;
  dictation?: { text: string; final: boolean };
}

export type { ComposerPasteResult, ComposerSelection } from "./composer-dom";

export interface QuoteRequest {
  id: number;
  messageId: string;
  text: string;
}

interface MentionContext {
  query: string;
  start: number;
  end: number;
  trigger: "@" | "$";
}

const DICTATION_INTERIM_WORDS = 2;
const EMPTY_TABS: ComposerBrowserTab[] = [];
const EMPTY_THREADS: ComposerThread[] = [];
const THREAD_SEARCH_MIN_QUERY = 3;
const THREAD_SEARCH_DELAY_MS = 150;
const THREAD_SEARCH_ROWS = 5;
const PASTED_TEXT_FILE_NAME = "pasted-text.txt";

const PICKER_EXIT_FALLBACK_MS = 300;

function leavePicker(picker: HTMLElement, parent: HTMLElement): void {
  if (!parent.isConnected || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const copy = picker.cloneNode(true);
  if (!(copy instanceof HTMLElement)) return;
  const scrollTop = picker.querySelector(".mention-picker-list")?.scrollTop ?? 0;
  copy.dataset.leaving = "";
  copy.inert = true;
  copy.setAttribute("aria-hidden", "true");
  for (const element of copy.querySelectorAll("[id]"))
    if (!(element instanceof SVGElement)) element.removeAttribute("id");
  parent.append(copy);
  const list = copy.querySelector(".mention-picker-list");
  if (list) list.scrollTop = scrollTop;
  const remove = () => copy.remove();
  copy.addEventListener("animationend", (event) => {
    if (event.target === copy) remove();
  });
  window.setTimeout(remove, PICKER_EXIT_FALLBACK_MS);
}

function PickerExit(props: { picker: () => HTMLElement | undefined }): JSX.Element {
  let parent: HTMLElement | null = null;
  queueMicrotask(() => {
    parent = props.picker()?.parentElement ?? null;
  });
  onCleanup(() => {
    const picker = props.picker();
    if (picker && parent) leavePicker(picker, parent);
  });
  return undefined;
}

function isSelectAllKey(event: KeyboardEvent): boolean {
  if (event.key.toLocaleLowerCase() !== "a" || event.altKey || event.shiftKey) return false;
  if (event.metaKey) return true;
  return event.ctrlKey && !navigator.platform.toLowerCase().includes("mac");
}

export function expandComposerMentions(value: string): string {
  return value.replace(MENTION_PATTERN, (match, name: string, target: string) => {
    if (target.includes(":")) return match;
    return serializeChatTagReference("agent", name, target);
  });
}

export function ComposerEditor(props: ComposerEditorProps) {
  const { t, format, sourceText } = useText();
  const [mention, setMention] = createSignal<MentionContext | null>(null);
  const [activeOption, setActiveOption] = createSignal(0);
  const [requestedMentionStart, setRequestedMentionStart] = createSignal<number | null>(null);
  const [attachmentTooltip, setAttachmentTooltip] = createSignal<{
    anchor: HTMLElement;
    content: string;
  } | null>(null);
  const attachmentTooltipId = `composer-file-tooltip-${createUniqueId()}`;
  const [pickerFrame, setPickerFrame] = createSignal<PickerFrame>(
    { mount: undefined, bottom: 0 },
    { equals: (previous, next) => previous.mount === next.mount && previous.bottom === next.bottom },
  );
  const matchingAgents = createMemo(() => {
    const others = props.agents.filter((agent) => agent.id !== props.agentId);
    return rankAgentMentions(others, mention()?.query ?? "");
  });
  const matchesEveryone = createMemo(() => {
    const query = mention()?.query.trim().toLocaleLowerCase() ?? "";
    if (!props.everyoneMention) return false;
    return (
      EVERYONE_MENTION.slice(1).startsWith(query) || t("composer.picker.everyone").toLocaleLowerCase().startsWith(query)
    );
  });
  const matchingAttachments = createMemo(() => {
    const query = mention()?.query.trim().toLocaleLowerCase() ?? "";
    const referencedIds = attachmentReferenceIds(props.value);
    return (props.attachments ?? []).filter(
      (attachment) =>
        !referencedIds.has(attachment.id) && (!query || attachment.name.toLocaleLowerCase().includes(query)),
    );
  });
  const usableSkills = createMemo(() =>
    (props.skills ?? []).filter(
      (skill) => skill.state !== "needs-repair" && skill.enabled !== false && skill.problem === undefined,
    ),
  );
  const skillProblems = createMemo(() => {
    const context = mention();
    if (context?.trigger !== "$") return [];
    const query = context.query.trim().toLocaleLowerCase();
    return (props.skills ?? []).flatMap(({ problem, ...skill }) =>
      problem !== undefined && skill.enabled !== false && skillMatchRank(skill, query) !== null
        ? [{ name: skill.name, problem }]
        : [],
    );
  });
  const matchingSkills = createMemo(() => {
    const query = mention()?.query.trim().toLocaleLowerCase() ?? "";
    const ranked = usableSkills().flatMap((skill) => {
      const rank = skillMatchRank(skill, query);
      return rank === null ? [] : [{ skill, rank }];
    });
    ranked.sort((left, right) => left.rank - right.rank);
    const nameCounts = new Map<string, number>();
    for (const { skill } of ranked) {
      const name = skill.name.toLocaleLowerCase();
      nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
    }
    return ranked.map(({ skill }) => ({
      skill,
      showSlug: (nameCounts.get(skill.name.toLocaleLowerCase()) ?? 0) > 1,
    }));
  });
  const matchingMcpServers = createMemo(() => {
    const query = mention()?.query.trim().toLocaleLowerCase() ?? "";
    return (props.mcpServers ?? []).filter(
      (server) => server.enabled && (!query || server.name.toLocaleLowerCase().includes(query)),
    );
  });
  const browserTabs = () => props.browserTabs ?? EMPTY_TABS;
  const threads = () => props.threads ?? EMPTY_THREADS;
  const matchingTabs = createMemo(() => {
    const query = mention()?.query.trim().toLocaleLowerCase() ?? "";
    return browserTabs().filter((tab) => referenceMatches({ tab }, query));
  });
  const matchingThreads = createMemo(() => {
    const query = mention()?.query.trim().toLocaleLowerCase() ?? "";
    return threads().filter((thread) => referenceMatches({ thread }, query));
  });
  const threadSearchQuery = createMemo(() => {
    const context = mention();
    const query = context?.trigger === "@" ? context.query.trim() : "";
    return query.length >= THREAD_SEARCH_MIN_QUERY ? query : "";
  });
  const [threadMessageMatches, setThreadMessageMatches] = createSignal<ComposerThreadMessageMatch[]>([]);
  let threadSearchRequest = 0;
  const hasListedThreads = createMemo(() => threads().length > 0);
  createEffect(
    () => ({ query: threadSearchQuery(), search: props.onSearchThreads, listed: hasListedThreads() }),
    ({ query, search, listed }) => {
      const request = ++threadSearchRequest;
      if (!query || !search || !listed) {
        setThreadMessageMatches([]);
        return;
      }
      const timer = setTimeout(() => {
        search(query).then(
          (matches) => {
            if (request === threadSearchRequest) setThreadMessageMatches(matches);
          },
          () => {
            if (request === threadSearchRequest) setThreadMessageMatches([]);
          },
        );
      }, THREAD_SEARCH_DELAY_MS);
      return () => clearTimeout(timer);
    },
  );
  const matchingThreadMessages = createMemo(() => {
    const query = threadSearchQuery();
    const needle = normalizedSearchText(query);
    if (!needle) return [];
    const titled = new Set(matchingThreads().map((thread) => thread.id));
    const listed = new Map(threads().map((thread) => [thread.id, thread]));
    const rows: { thread: ComposerThread; snippet: string }[] = [];
    for (const match of threadMessageMatches()) {
      if (rows.length === THREAD_SEARCH_ROWS) break;
      const thread = listed.get(match.threadId);
      if (!thread || titled.has(thread.id) || rows.some((row) => row.thread.id === thread.id)) continue;
      const text = threadMessagePreview(match.body);
      if (!normalizedSearchText(text).includes(needle)) continue;
      rows.push({ thread, snippet: snippetAround(text, query) });
    }
    return rows;
  });
  const pickerSections = createMemo<PickerSection[]>(() => {
    const trigger = mention()?.trigger;
    if (trigger === "$")
      return [
        {
          id: "skills",
          title: null,
          options: [
            ...matchingSkills().map((match) => ({ type: "skill" as const, ...match })),
            ...matchingMcpServers().map((server) => ({ type: "mcp" as const, server })),
          ],
        },
      ].filter((section) => section.options.length > 0);
    if (trigger !== "@") return [];
    const sections: PickerSection[] = [
      {
        id: "agents",
        title: "composer.picker.section.agents",
        options: [
          ...matchingAgents().map((agent) => ({ type: "agent" as const, agent })),
          ...(matchesEveryone() ? [{ type: "everyone" as const }] : []),
        ],
      },
      {
        id: "files",
        title: "composer.picker.section.files",
        options: matchingAttachments().map((attachment) => ({ type: "attachment" as const, attachment })),
      },
      {
        id: "tabs",
        title: "composer.picker.section.tabs",
        options: matchingTabs().map((tab) => ({ type: "tab" as const, tab })),
      },
      {
        id: "threads",
        title: "composer.picker.section.threads",
        options: matchingThreads().map((thread) => ({ type: "thread" as const, thread })),
      },
      {
        id: "messages",
        title: "composer.picker.section.messages",
        options: matchingThreadMessages().map((row) => ({ type: "thread" as const, ...row })),
      },
    ];
    return sections.filter((section) => section.options.length > 0);
  });
  const titledSections = () => (pickerSections().length > 1 ? pickerSections().length : 0);
  const matchingOptions = createMemo(() => pickerSections().flatMap((section) => section.options));
  const activePickerValue = createMemo(() => {
    const option = matchingOptions()[activeOption()];
    return option ? new Set([pickerOptionKey(option)]) : new Set<string>();
  });
  const pickerStatus = createMemo(() => {
    const context = mention();
    if (context?.trigger !== "$" || matchingOptions().length > 0 || skillProblems().length > 0) return null;
    if (requestedMentionStart() !== context.start && context.query.trim()) return null;
    if (usableSkills().length === 0)
      return t(props.skillsLoadFailed ? "composer.picker.skillsLoadFailed" : "composer.picker.noSkills");
    return t("composer.picker.noSkillMatch", { query: context.query.trim() });
  });
  const pickerOpen = createMemo(
    () => mention() !== null && (matchingOptions().length > 0 || pickerStatus() !== null || skillProblems().length > 0),
  );
  const pickerQuery = () => mention()?.query.trim() ?? "";
  const descriptionMatchQuery = (option: PickerOption) =>
    option.type === "tab" || (option.type === "thread" && option.snippet !== undefined) ? pickerQuery() : "";
  const pickerOptionElements = new Map<string, HTMLElement>();
  let keyMove = false;
  const takeKeyMove = () => {
    const moved = keyMove;
    keyMove = false;
    return moved;
  };
  let releasePickerList: (() => void) | undefined;
  const bindPickerList = (list: HTMLElement) => {
    releasePickerList?.();
    const stops = [
      trackPickerScrollFades(list),
      trackEnteringPickerRows(list),
      trackPickerHighlight(list, takeKeyMove),
    ];
    releasePickerList = () => {
      for (const stop of stops) stop();
    };
  };
  onCleanup(() => releasePickerList?.());
  let editor: HTMLDivElement | undefined;
  let pickerElement: HTMLDivElement | undefined;
  let lastAgentId: string | undefined;
  let lastAttachmentKey = "";
  let lastSkillKey = "";
  let lastMcpKey = "";
  let lastReferenceKey = "";
  let lastEmittedValue = "";
  let lastFocusRequest = 0;
  let lastSkillPickerRequest = 0;
  let lastQuoteRequest = untrack(() => props.quoteRequest?.id ?? 0);
  let savedCaret: number | null = null;
  let isComposing = false;
  const [compositionRevision, setCompositionRevision] = createSignal(0);
  const attachmentTokenActions: AttachmentTokenActions = {
    tooltipId: attachmentTooltipId,
    open: (attachment, keepTooltip = false) => {
      if (!keepTooltip) setAttachmentTooltip(null);
      props.onOpenAttachment?.(attachment);
    },
    showTooltip: (anchor, content) => {
      const label = anchor.querySelector<HTMLElement>(".inline-file-reference-name");
      if (!label || label.scrollWidth <= label.clientWidth + 1) {
        setAttachmentTooltip(null);
        return;
      }
      setAttachmentTooltip({ anchor, content });
    },
    hideTooltip: (anchor) => {
      if (attachmentTooltip()?.anchor === anchor) setAttachmentTooltip(null);
    },
    remove: (token) => {
      setAttachmentTooltip(null);
      token.remove();
      emitValue();
      editor?.focus();
    },
  };

  createEffect(
    () => ({
      compositionRevision: compositionRevision(),
      agentId: props.agentId,
      value: props.value,
      agents: props.agents,
      skills: props.skills ?? [],
      mcpServers: props.mcpServers ?? [],
      attachments: props.attachments ?? [],
      browserTabs: browserTabs(),
      threads: threads(),
      focusRequest: props.focusRequest ?? 0,
      skillPickerRequest: props.skillPickerRequest ?? 0,
      quoteRequest: props.quoteRequest,
      disabled: props.disabled,
    }),
    ({
      agentId,
      value,
      agents,
      skills,
      mcpServers,
      attachments,
      browserTabs,
      threads,
      focusRequest,
      skillPickerRequest,
      quoteRequest,
      disabled,
    }) => {
      if (focusRequest < lastFocusRequest) lastFocusRequest = focusRequest;
      if (!editor || (isComposing && agentId === lastAgentId)) return;
      const attachmentKey = attachments.map((attachment) => `${attachment.id}:${attachment.name}`).join("|");
      const skillKey = skills
        .map((skill) => `${skill.skillId}:${skill.name}:${skill.state}:${skill.enabled}:${skill.description ?? ""}`)
        .join("|");
      const mcpKey = mcpServers.map((server) => `${server.id}:${server.name}:${server.enabled}`).join("|");
      const referenceKey = `${browserTabs.map((tab) => tab.id).join("|")}/${threads.map((thread) => thread.id).join("|")}`;
      const draftChanged = agentId !== lastAgentId;
      const attachmentsChanged = attachmentKey !== lastAttachmentKey;
      const renderedAttachments = new Set(
        Array.from(
          editor.querySelectorAll<HTMLElement>("[data-attachment-reference-id]"),
          (token) => token.dataset.attachmentReferenceId,
        ),
      );
      const attachmentResolved =
        attachmentsChanged &&
        [...attachmentReferenceIds(value)].some(
          (id) => attachments.some((attachment) => attachment.id === id) && !renderedAttachments.has(id),
        );
      const contentChanged = draftChanged || value !== lastEmittedValue || attachmentResolved;
      const skillsChanged = skillKey !== lastSkillKey;
      const mcpChanged = mcpKey !== lastMcpKey;
      const referencesChanged = referenceKey !== lastReferenceKey;
      const tagsChange =
        (attachmentsChanged && renderedAttachments.size > 0) ||
        (skillsChanged && editor.querySelector("[data-skill-id]") !== null) ||
        (mcpChanged && editor.querySelector("[data-mcp-id]") !== null) ||
        (referencesChanged && editor.querySelector("[data-tab-id], [data-thread-id]") !== null);
      const editorChanges = contentChanged || tagsChange;
      const selection =
        editorChanges && !draftChanged && editor.ownerDocument.activeElement === editor
          ? readEditorSelection(editor)
          : null;
      const scrollTop = draftChanged ? 0 : editorChanges ? editor.scrollTop : null;
      const focusRequested = focusRequest > lastFocusRequest;
      if (draftChanged) savedCaret = null;
      if (contentChanged) {
        lastAgentId = agentId;
        lastEmittedValue = value;
        setAttachmentTooltip(null);
        renderEditorValue(
          editor,
          value,
          { agents, skills, mcpServers, attachments, browserTabs, threads },
          attachmentTokenActions,
        );
        setMention(null);
      } else {
        if (attachmentsChanged) syncAttachmentTokens(editor, attachments, attachmentTokenActions);
        if (skillsChanged) syncSkillTokens(editor, skills);
        if (mcpChanged) syncMcpTokens(editor, mcpServers);
        if (referencesChanged) syncReferenceTokens(editor, browserTabs, threads);
      }
      if (selection) {
        restoreEditorSelection(editor, selection);
        scheduleCaretScroll();
      }
      if (scrollTop !== null) editor.scrollTop = scrollTop;
      lastAttachmentKey = attachmentKey;
      lastSkillKey = skillKey;
      lastMcpKey = mcpKey;
      lastReferenceKey = referenceKey;
      if (focusRequested) {
        lastFocusRequest = focusRequest;
        const draftSelection = contentChanged ? null : readEditorSelection(editor);
        editor.focus({ preventScroll: true });
        if (!draftSelection || draftSelection.anchor === draftSelection.focus) placeCaretAtEnd(editor);
        scheduleCaretScroll();
      }
      if (skillPickerRequest > lastSkillPickerRequest) {
        lastSkillPickerRequest = skillPickerRequest;
        openSkillPicker();
      }
      if (quoteRequest && quoteRequest.id > lastQuoteRequest && !disabled) {
        lastQuoteRequest = quoteRequest.id;
        insertQuote(quoteRequest.messageId, quoteRequest.text);
      }
    },
  );

  const dictationWords = createMemo(() => props.dictation?.text.trim().split(/\s+/u).filter(Boolean) ?? []);
  const dictating = () => dictationWords().length > 0;
  let dictationView: HTMLDivElement | undefined;
  let dictationDraft: HTMLDivElement | undefined;
  createEffect(
    () => ({
      shown: dictating(),
      value: props.value,
      agents: props.agents,
      skills: props.skills ?? [],
      mcpServers: props.mcpServers ?? [],
      attachments: props.attachments ?? [],
      browserTabs: browserTabs(),
      threads: threads(),
    }),
    ({ shown, value, ...sources }) => {
      if (!shown || !dictationDraft) return;
      renderEditorValue(dictationDraft, value, sources, attachmentTokenActions);
      if (value.endsWith("\n")) dictationDraft.lastChild?.remove();
    },
  );
  createEffect(dictationWords, () => {
    if (dictationView) dictationView.scrollTop = dictationView.scrollHeight;
  });

  onSettled(() => {
    const view = editor?.ownerDocument.defaultView;
    if (!view) return;
    let focusInFrame = false;
    const noteFrameFocus = () => {
      focusInFrame = view.document.activeElement instanceof view.HTMLIFrameElement;
    };
    const restoreFocus = () => {
      if (focusInFrame || usesTouchLayout()) return;
      if (editor && shouldRestoreComposerFocus(editor)) {
        editor.focus({ preventScroll: true });
        scheduleCaretScroll();
      }
    };
    view.addEventListener("blur", noteFrameFocus);
    view.addEventListener("focus", restoreFocus);
    return () => {
      view.removeEventListener("blur", noteFrameFocus);
      view.removeEventListener("focus", restoreFocus);
    };
  });

  let caretFrame: number | undefined;
  function scheduleCaretScroll() {
    const view = editor?.ownerDocument.defaultView;
    if (!view || caretFrame !== undefined) return;
    caretFrame = view.requestAnimationFrame(() => {
      caretFrame = undefined;
      if (!editor || editor.ownerDocument.activeElement !== editor) return;
      const selection = readEditorSelection(editor);
      if (!selection) return;
      const range = rangeFromTextOffsets(editor, selection.focus, selection.focus);
      if (!range) return;
      const text = editorText(editor);
      const trailingLine =
        selection.focus === text.length && text.endsWith("\n") && editor.lastChild instanceof HTMLBRElement
          ? editor.lastChild
          : null;
      const rect = trailingLine?.getBoundingClientRect() ?? range.getClientRects?.()[0];
      if (!rect?.height || !editor.offsetHeight) return;
      const box = editor.getBoundingClientRect();
      const scale = box.height / editor.offsetHeight;
      if (rect.top < box.top) editor.scrollTop += Math.floor((rect.top - box.top) / scale);
      else if (rect.bottom > box.bottom) editor.scrollTop += Math.ceil((rect.bottom - box.bottom) / scale);
    });
  }

  onSettled(() => {
    if (!editor) return;
    const document = editor.ownerDocument;
    const view = document.defaultView;
    const selectionChanged = () => {
      if (editor && document.activeElement === editor) savedCaret = readEditorSelection(editor)?.focus ?? savedCaret;
      if (mention()) updateMention();
    };
    document.addEventListener("selectionchange", selectionChanged);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleCaretScroll);
    observer?.observe(editor);
    return () => {
      document.removeEventListener("selectionchange", selectionChanged);
      observer?.disconnect();
      if (caretFrame !== undefined) view?.cancelAnimationFrame(caretFrame);
    };
  });

  function tagSources(): EditorTagSources {
    return {
      agents: props.agents,
      skills: props.skills ?? [],
      mcpServers: props.mcpServers ?? [],
      attachments: props.attachments ?? [],
      browserTabs: browserTabs(),
      threads: threads(),
    };
  }

  function emitValue() {
    if (!editor) return;
    let value = serializeEditor(editor);
    if (value.length > INPUT_LIMITS.messageText) {
      value = truncateComposerValue(value, INPUT_LIMITS.messageText);
      setAttachmentTooltip(null);
      renderEditorValue(editor, value, tagSources(), attachmentTokenActions);
      placeCaretAtEnd(editor);
    }
    lastEmittedValue = value;
    props.onValueChange(value);
    scheduleCaretScroll();
  }

  function handleBeforeInput(event: InputEvent) {
    if (!editor || props.disabled || isComposing || event.isComposing || isEditCommandRunning()) return;
    const lineBreak = event.inputType === "insertLineBreak" || event.inputType === "insertParagraph";
    if (!lineBreak && (event.inputType !== "insertText" || !event.data)) return;
    event.preventDefault();
    if (lineBreak) insertLineBreak(editor);
    else if (event.data) insertPlainText(editor, event.data);
    emitValue();
    updateMention();
  }

  function mentionAtSelection(): MentionContext | null {
    if (!editor) return null;
    const selection = readEditorSelection(editor);
    if (!selection || selection.anchor !== selection.focus) return null;
    const beforeCaret = editorText(editor).slice(0, selection.focus);
    const match = beforeCaret.match(/(?:^|\s)([@$])([^@$\n\uFFFC]{0,60})$/u);
    if (!match) return null;
    const trigger = match[1] === "$" ? "$" : "@";
    const query = match[2] ?? "";
    return { query, start: beforeCaret.length - query.length - 1, end: beforeCaret.length, trigger };
  }

  function updateMention() {
    const next = mentionAtSelection();
    const current = mention();
    if (next && editor) setPickerFrame(measurePickerFrame(editor));
    if (
      current?.start === next?.start &&
      current?.end === next?.end &&
      current?.query === next?.query &&
      current?.trigger === next?.trigger
    )
      return;
    setMention(next);
    setActiveOption(0);
  }

  function openSkillPicker() {
    if (!editor || props.disabled) return;
    editor.focus();
    ensureEditorSelection();
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    if (!selection.isCollapsed) selection.collapseToEnd();
    const beforeCaret = editorText(editor).slice(
      0,
      editorTextOffset(editor, selection.anchorNode ?? editor, selection.anchorOffset),
    );
    const separator = beforeCaret && !/\s$/u.test(beforeCaret) ? " " : "";
    insertPlainText(editor, `${separator}$`);
    setRequestedMentionStart(beforeCaret.length + separator.length);
    emitValue();
    updateMention();
  }

  function insertOption(option: PickerOption) {
    const context = mention();
    if (!editor || !context) return;
    const range = rangeFromTextOffsets(editor, context.start, context.end);
    if (!range) return;
    range.deleteContents();
    const token =
      option.type === "agent"
        ? createMentionToken(option.agent)
        : option.type === "everyone"
          ? document.createTextNode(EVERYONE_MENTION)
          : option.type === "skill"
            ? createSkillToken(option.skill)
            : option.type === "mcp"
              ? createMcpToken(option.server)
              : option.type === "tab"
                ? createTabToken(option.tab)
                : option.type === "thread"
                  ? createThreadToken(option.thread)
                  : createAttachmentToken(option.attachment, attachmentTokenActions);
    const trailingSpace = document.createTextNode(" ");
    range.insertNode(trailingSpace);
    range.insertNode(token);
    const selection = window.getSelection();
    range.setStartAfter(trailingSpace);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    setMention(null);
    emitValue();
    editor.focus();
  }

  function insertQuote(messageId: string, text: string) {
    if (!editor || props.disabled) return;
    editor.focus({ preventScroll: true });
    const value = editorText(editor);
    const offset = savedCaret !== null && savedCaret <= value.length ? savedCaret : value.length;
    const range = rangeFromTextOffsets(editor, offset, offset);
    if (!range) return;
    const trailingSpace = document.createTextNode(" ");
    range.insertNode(trailingSpace);
    range.insertNode(createQuoteToken(messageId, text));
    const beforeCaret = value.slice(0, offset);
    if (beforeCaret && !/\s$/u.test(beforeCaret)) range.insertNode(document.createTextNode(" "));
    range.setStartAfter(trailingSpace);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    setMention(null);
    emitValue();
    scheduleCaretScroll();
  }

  function handleEditorClick(event: MouseEvent) {
    const target = event.target instanceof Element ? event.target : null;
    const reference = target?.closest<HTMLElement>(".reference-chip[data-tab-id], .reference-chip[data-thread-id]");
    const tabId = reference?.dataset.tabId;
    const threadId = reference?.dataset.threadId;
    if (reference && props.onOpenTag && (tabId || threadId)) {
      if (tabId) props.onOpenTag("tab", tabId);
      else if (threadId) props.onOpenTag("thread", threadId);
      return;
    }
    const quote = target?.closest<HTMLElement>("[data-quote-message-id]") ?? null;
    const messageId = quote?.dataset.quoteMessageId;
    if (messageId && props.onOpenQuote) {
      props.onOpenQuote(messageId, quote.dataset.quoteText ?? "");
      return;
    }
    updateMention();
  }

  function ensureEditorSelection() {
    if (!editor) return;
    if (!readEditorSelection(editor)) placeCaretAtEnd(editor);
  }

  function moveActiveOption(delta: number, optionCount: number) {
    keyMove = true;
    setActiveOption((current) => {
      const next = (current + delta + optionCount) % optionCount;
      const option = matchingOptions()[next];
      if (option) {
        queueMicrotask(() => pickerOptionElements.get(pickerOptionKey(option))?.scrollIntoView?.({ block: "nearest" }));
      }
      return next;
    });
  }

  function handleMentionPickerKeyDown(event: KeyboardEvent): boolean {
    const context = mention();
    if (!context) return false;
    const current = mentionAtSelection();
    if (!current || current.start !== context.start || current.end !== context.end || current.query !== context.query) {
      setMention(null);
      return false;
    }
    if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false;
    const options = matchingOptions();
    if (event.key === "Escape") {
      event.preventDefault();
      setMention(null);
      return true;
    }
    if (options.length === 0) return false;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActiveOption(1, options.length);
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActiveOption(-1, options.length);
      return true;
    }
    if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
      event.preventDefault();
      const option = options[activeOption()];
      if (option) insertOption(option);
      return true;
    }
    return false;
  }

  function removeAdjacentMention(key: "Backspace" | "Delete"): boolean {
    if (!editor) return false;
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!range?.collapsed || !editor.contains(range.commonAncestorContainer)) return false;
    const token = mentionTokenAtCaretBoundary(editor, range, key);
    if (!token) return false;

    const tokenParent = token.parentNode;
    if (!tokenParent) return false;
    const caretOffset = Array.from(tokenParent.childNodes).indexOf(token);
    token.remove();
    setMention(null);
    emitValue();
    editor.focus();
    placeCaretAtChildOffset(tokenParent, Math.min(caretOffset, tokenParent.childNodes.length));
    return true;
  }

  function removeAutomaticMentionSpace(): boolean {
    if (!editor) return false;
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!range?.collapsed || !editor.contains(range.commonAncestorContainer)) return false;
    const boundary = automaticMentionSpaceAtCaretBoundary(editor, range);
    if (!boundary) return false;

    boundary.text.deleteData(boundary.offset - 1, 1);
    if (!boundary.text.data) boundary.text.remove();
    const tokenParent = boundary.token.parentNode;
    if (!tokenParent) return false;
    const caretOffset = Array.from(tokenParent.childNodes).indexOf(boundary.token) + 1;
    setMention(null);
    emitValue();
    editor.focus();
    placeCaretAtChildOffset(tokenParent, caretOffset);
    return true;
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (props.disabled) return;
    const sendShortcut: SendShortcut = props.sendShortcut ?? "enter";
    if (isComposing || event.isComposing || event.keyCode === 229 || event.key === "Process") return;
    if (handleMentionPickerKeyDown(event)) return;
    if (event.key === "Tab" && props.onSteer && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      props.onSteer();
      return;
    }
    if (event.key === "Backspace" && removeAutomaticMentionSpace()) {
      event.preventDefault();
      return;
    }
    if ((event.key === "Backspace" || event.key === "Delete") && removeAdjacentMention(event.key)) {
      event.preventDefault();
      return;
    }
    ensureEditorSelection();

    if (event.key === "Backspace" && removeTrailingLineBreak()) {
      event.preventDefault();
      return;
    }

    if (isSelectAllKey(event)) {
      event.preventDefault();
      if (!editor) return;
      const range = document.createRange();
      range.selectNodeContents(editor);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }

    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      if (!editor) return;
      insertLineBreak(editor);
      emitValue();
      updateMention();
      return;
    }
    if (event.key === "Enter") {
      if (sendShortcut !== "enter" && !isSendShortcutKey(event, sendShortcut)) {
        event.preventDefault();
        if (!editor) return;
        insertLineBreak(editor);
        emitValue();
        updateMention();
        return;
      }
      event.preventDefault();
      props.onSubmit();
    }
  }

  function removeTrailingLineBreak(): boolean {
    if (!editor) return false;
    const value = editorText(editor);
    const selection = readEditorSelection(editor);
    if (!value.endsWith("\n") || !selection || selection.anchor !== value.length || selection.focus !== value.length)
      return false;
    const range = rangeFromTextOffsets(editor, value.length - 1, value.length);
    if (!range) return false;
    const nativeSelection = window.getSelection();
    nativeSelection?.removeAllRanges();
    nativeSelection?.addRange(range);
    insertPlainText(editor, "");
    emitValue();
    updateMention();
    return true;
  }

  function handlePaste(event: ClipboardEvent) {
    event.preventDefault();
    if (!editor || props.disabled) return;

    const clipboard = event.clipboardData;
    if (!clipboard) return;
    const selection = serializedEditorSelection(editor);
    const pasted = props.onPasteAttachments?.(clipboard, selection);
    if (pasted) {
      event.stopPropagation();
      finishPaste(pasted);
      return;
    }
    const files =
      clipboard.files.length > 0
        ? Array.from(clipboard.files)
        : Array.from(clipboard.items).flatMap((item) => {
            const file = item.kind === "file" ? item.getAsFile() : null;
            return file ? [file] : [];
          });
    if (files.length > 0) {
      if (props.onPasteFiles) {
        event.stopPropagation();
        finishPaste(props.onPasteFiles(files, selection));
      }
      return;
    }

    const pastedText = clipboard.getData("text/plain");
    const normalized = pastedText.replace(/\r\n?/g, "\n");
    const text = normalized.slice(0, INPUT_LIMITS.messageText);
    if (!text) return;
    if (normalized.length > INPUT_LIMITS.pastedText && props.onPasteFiles) {
      event.stopPropagation();
      const file = new File([pastedText], PASTED_TEXT_FILE_NAME, { type: "text/plain" });
      finishPaste(props.onPasteFiles([file], selection, text));
      return;
    }

    insertPlainText(editor, text);
    emitValue();
    updateMention();
  }

  function finishPaste(pasted: undefined | Promise<ComposerPasteResult | undefined>) {
    if (!pasted) return;
    const agentId = props.agentId;
    const surface = editor;
    void pasted.then((result) => {
      if (!result) return;
      onSettled(() => {
        if (!surface?.isConnected || editor !== surface || props.agentId !== agentId || props.value !== result.value)
          return;
        if (surface.ownerDocument.activeElement !== surface) return;
        placeSerializedCaret(surface, result.caret);
        scheduleCaretScroll();
      });
    });
  }

  function handleCopy(event: ClipboardEvent, cut = false) {
    if (!editor || !event.clipboardData || !props.onCopyAttachments) return;
    const selection = serializedEditorSelection(editor);
    if (selection.start === selection.end) return;
    const value = serializeEditor(editor);
    const text = value.slice(selection.start, selection.end);
    const ids = attachmentReferenceIds(text);
    const all = selection.start === 0 && selection.end === value.length;
    const attachments = (props.attachments ?? []).filter((attachment) => all || ids.has(attachment.id));
    if (!attachments.length) return;
    event.preventDefault();
    let remaining: string | undefined;
    if (cut && !props.disabled) {
      insertPlainText(editor, "");
      emitValue();
      updateMention();
      remaining = serializeEditor(editor);
    }
    props.onCopyAttachments(event.clipboardData, text, attachments, remaining);
  }

  return (
    <div class="composer-editor-root" data-size={props.size ?? "default"} data-dictating={dictating() ? "" : undefined}>
      <Show when={!props.value && !dictating()}>
        <span class="composer-editor-placeholder" aria-hidden="true">
          {props.placeholder}
        </span>
      </Show>
      {/* biome-ignore lint/a11y/useSemanticElements: contenteditable is required for inline agent chips. */}
      {/* biome-ignore lint/a11y/useFocusableInteractive: Solid 2 uses the lowercase tabindex DOM attribute. */}
      <div
        ref={(element) => (editor = element)}
        class="composer-editor-surface"
        contenteditable={props.disabled ? "false" : "true"}
        role="textbox"
        tabindex={props.disabled ? -1 : 0}
        aria-label={props.ariaLabel}
        aria-disabled={props.disabled ? "true" : "false"}
        aria-multiline="true"
        aria-keyshortcuts={props.onSteer ? "Tab" : undefined}
        spellcheck="true"
        data-cuelume-type=""
        onFocus={ensureEditorSelection}
        onInput={() => {
          emitValue();
          updateMention();
        }}
        onClick={handleEditorClick}
        onKeyDown={handleKeyDown}
        onBeforeInput={handleBeforeInput}
        onCompositionStart={() => {
          isComposing = true;
        }}
        onCompositionEnd={() => {
          isComposing = false;
          setCompositionRevision((revision) => revision + 1);
        }}
        onPaste={handlePaste}
        onCopy={(event) => handleCopy(event)}
        onCut={(event) => handleCopy(event, true)}
        onBlur={() => {
          isComposing = false;
          window.setTimeout(() => {
            const ownerDocument = editor?.ownerDocument;
            if (!ownerDocument?.hasFocus() || ownerDocument.activeElement !== editor) setMention(null);
          }, 100);
        }}
      />
      <Show when={dictating()}>
        <div
          ref={(element) => (dictationView = element)}
          class="composer-editor-surface composer-dictation"
          data-final={props.dictation?.final ? "" : undefined}
          onPointerDown={(event) => {
            event.preventDefault();
            if (!editor) return;
            editor.focus({ preventScroll: true });
            placeCaretAtEnd(editor);
          }}
        >
          <div
            ref={(element) => (dictationDraft = element)}
            class="composer-dictation-draft"
            aria-hidden="true"
            inert
          />
          <span aria-live="polite">
            {props.value && !/\s$/u.test(props.value) ? " " : ""}
            <For each={dictationWords()}>
              {(word, index) => (
                <span
                  class="composer-dictation-word"
                  data-interim={
                    !props.dictation?.final && index() >= dictationWords().length - DICTATION_INTERIM_WORDS
                      ? ""
                      : undefined
                  }
                >
                  {index() === 0 ? word : ` ${word}`}
                </span>
              )}
            </For>
          </span>
          <span class="composer-dictation-caret" aria-hidden="true" />
        </div>
      </Show>
      <Show when={pickerOpen()}>
        <Portal mount={pickerFrame().mount ?? document.body}>
          <div
            ref={(element) => {
              pickerElement = element;
            }}
            class="mention-picker"
            style={{
              "--mention-picker-bottom": `${pickerFrame().bottom}px`,
              "--mention-picker-rows": pickerStatus() === null ? matchingOptions().length : 1,
              "--mention-picker-sections": pickerStatus() === null ? titledSections() : 0,
            }}
          >
            <PickerExit picker={() => pickerElement} />
            <Show when={pickerStatus()}>
              {(status) => (
                <p class="mention-picker-status" role="status">
                  {status()}
                </p>
              )}
            </Show>
            <Show when={pickerStatus() === null && matchingOptions().length > 0}>
              <Listbox.Root<PickerOption, PickerSection>
                as="div"
                ref={bindPickerList}
                class="mention-picker-list"
                aria-label={t(
                  mention()?.trigger === "$" ? "composer.picker.skillLabel" : "composer.picker.mentionLabel",
                )}
                options={pickerSections()}
                optionGroupChildren="options"
                renderSection={(section) => (
                  <Show when={titledSections() > 0 ? section.rawValue.title : null}>
                    {(title) => (
                      <Listbox.Section class="mention-picker-section">
                        <span>{t(title())}</span>
                        <span class="mention-picker-section-count">{section.rawValue.options.length}</span>
                      </Listbox.Section>
                    )}
                  </Show>
                )}
                optionValue={pickerOptionKey}
                optionTextValue={(option) => pickerOptionText(option, t)}
                selectionMode="single"
                disallowEmptySelection={true}
                allowDuplicateSelectionEvents={true}
                shouldUseVirtualFocus={true}
                shouldFocusOnHover={true}
                shouldSelectOnPressUp={true}
                value={activePickerValue()}
                onChange={(keys) => {
                  const key = keys.values().next().value;
                  const option = matchingOptions().find((candidate) => pickerOptionKey(candidate) === key);
                  if (option) insertOption(option);
                }}
                renderItem={(item) => {
                  const option = item.rawValue;
                  const optionIndex = () =>
                    matchingOptions().findIndex((candidate) => pickerOptionKey(candidate) === item.key);
                  const badge = pickerOptionBadge(option, t);
                  return (
                    <Listbox.Item
                      ref={(element) => pickerOptionElements.set(pickerOptionKey(option), element)}
                      item={item}
                      data-option-key={pickerOptionKey(option)}
                      data-filtering={pickerQuery() ? "" : undefined}
                      aria-label={pickerOptionText(option, t)}
                      class={[
                        "mention-picker-option",
                        {
                          "mention-picker-file-option": option.type === "attachment",
                          "mention-picker-option-active": activeOption() === optionIndex(),
                        },
                      ]}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onMouseEnter={() => {
                        keyMove = false;
                        setActiveOption(optionIndex());
                      }}
                    >
                      {option.type === "agent" ? (
                        <AgentAvatar agent={option.agent} />
                      ) : option.type === "everyone" ? (
                        <span class="mention-picker-skill-icon" aria-hidden="true">
                          <UsersRound />
                        </span>
                      ) : option.type === "skill" ? (
                        <span class="mention-picker-skill-icon" aria-hidden="true">
                          <Puzzle />
                        </span>
                      ) : option.type === "mcp" ? (
                        <span class="mention-picker-skill-icon" aria-hidden="true">
                          <Blocks />
                        </span>
                      ) : option.type === "tab" ? (
                        <span class="mention-picker-skill-icon" aria-hidden="true">
                          <AppWindow />
                        </span>
                      ) : option.type === "thread" ? (
                        <span class="mention-picker-skill-icon" aria-hidden="true">
                          <Split />
                        </span>
                      ) : (
                        <AttachmentReferenceVisual name={option.attachment.name} />
                      )}
                      <strong>
                        <MatchedText text={pickerOptionName(option, t)} query={pickerQuery()} />
                      </strong>
                      <Show when={option.type === "skill" && option.showSlug ? option.skill.slug : undefined}>
                        {(slug) => <span class="mention-picker-slug">{slug()}</span>}
                      </Show>
                      <Show when={pickerOptionDescription(option, t, format)}>
                        {(description) => (
                          <span class="mention-picker-description">
                            <MatchedText text={description()} query={descriptionMatchQuery(option)} />
                          </span>
                        )}
                      </Show>
                      <Show when={badge}>
                        {(shown) => (
                          <Badge class="mention-picker-badge" variant="ghost">
                            <Show when={shown().icon}>
                              {(icon) => <Dynamic component={icon()} aria-hidden="true" />}
                            </Show>
                            {shown().label}
                          </Badge>
                        )}
                      </Show>
                    </Listbox.Item>
                  );
                }}
              />
            </Show>
            <Show when={skillProblems().length > 0}>
              <div class="mention-picker-problems" role="status">
                <For each={skillProblems()}>
                  {(skill) => (
                    <p class="mention-picker-skill-problem">
                      {t("composer.picker.skillProblem", {
                        name: skill.name,
                        problem: sourceText(skill.problem),
                      })}
                    </p>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Portal>
      </Show>
      <Show when={attachmentTooltip()}>
        {(activeTooltip) => (
          <AnchoredTooltip id={attachmentTooltipId} anchor={activeTooltip().anchor} content={activeTooltip().content} />
        )}
      </Show>
    </div>
  );
}

function threadMessagePreview(body: string): string {
  return expandAttachmentReferences(
    expandChatTagReferences(body, (reference) => (reference.kind === "quote" ? `“${reference.name}”` : undefined)),
  )
    .trim()
    .replace(/\s+/g, " ");
}

function MatchedText(props: { text: string; query: string }) {
  return (
    <For each={matchParts(props.text, props.query)}>
      {(part) => (part.match ? <mark class="mention-picker-match">{part.text}</mark> : part.text)}
    </For>
  );
}
