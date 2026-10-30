import { rankAgentMentions } from "@openbot/contracts/agent-mention-rank";
import { attachmentReferenceIds } from "@openbot/contracts/attachment-references";
import { EVERYONE_MENTION, serializeChatTagReference } from "@openbot/contracts/chat-tag-references";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { DraftAttachment } from "@openbot/contracts/ipc";
import { Badge, Blocks, Listbox, Puzzle, UsersRound } from "@openbot/ui";
import { usesTouchLayout } from "@openbot/ui/utils";
import { Dynamic, Portal } from "@solidjs/web";
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
import { createScrollFades } from "../../components/createScrollFades";
import type { ComposerAgent, ComposerMcpServer, ComposerSkill } from "../../data";
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
  pickerOptionBadge,
  pickerOptionDescription,
  pickerOptionKey,
  pickerOptionName,
  pickerOptionText,
  skillMatchRank,
} from "./composer-picker";
import {
  type AttachmentTokenActions,
  createAttachmentToken,
  createMcpToken,
  createMentionToken,
  createQuoteToken,
  createSkillToken,
  MENTION_PATTERN,
  renderEditorValue,
  syncAttachmentTokens,
  syncMcpTokens,
  syncSkillTokens,
  truncateComposerValue,
} from "./composer-tokens";
import { isSendShortcutKey, type SendShortcut } from "./send-shortcut";

interface ComposerEditorProps {
  agentId: string | undefined;
  agents: ComposerAgent[];
  skills?: ComposerSkill[] | undefined;
  /** The host's MCP servers, offered by the same `$` the skills answer. */
  mcpServers?: ComposerMcpServer[] | undefined;
  attachments?: DraftAttachment[] | undefined;
  value: string;
  placeholder: string;
  ariaLabel: string;
  disabled: boolean;
  /** `compact` is one short line, as in the floating composer over a browser page. */
  size?: "default" | "compact";
  focusRequest?: number | undefined;
  /** Raised by one to open the skill picker at the caret, as a typed `$` does. */
  skillPickerRequest?: number;
  /** A new id puts a quote chip for the text at the caret, or at the end when the caret is unknown. */
  quoteRequest?: QuoteRequest | undefined;
  /** Opens the passage that a quote chip in the draft points to. */
  onOpenQuote?: ((messageId: string, text: string) => void) | undefined;
  /** The last skill list request failed, so an empty picker says so instead of "no skills". */
  skillsLoadFailed?: boolean | undefined;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  /** Tab sends the message into the agent's running turn. Absent, Tab moves the focus as usual. */
  onSteer?: (() => void) | undefined;
  /**
   * Which chord sends the message. Enter keeps the current behavior; the platform modifier with
   * Enter sends and plain Enter adds a line. The renderer resolves the platform and passes it.
   */
  sendShortcut?: SendShortcut | undefined;
  onOpenAttachment?: ((attachment: DraftAttachment) => void) | undefined;
  /** Receives pasted files. Without it, a file paste does nothing here; the desktop preload imports it. */
  onPasteFiles?:
    | ((files: File[], selection: ComposerSelection) => undefined | Promise<ComposerPasteResult | undefined>)
    | undefined;
  onPasteAttachments?: (
    clipboard: DataTransfer,
    selection: ComposerSelection,
  ) => Promise<ComposerPasteResult | undefined> | undefined;
  /**
   * Writes a copy or cut that includes attachments. Other selections use the native copy. After a cut
   * removed the selection, `remaining` is the value that stays, so the draft can let go of the files
   * that the cut moved.
   */
  onCopyAttachments?: (
    clipboard: DataTransfer,
    text: string,
    attachments: DraftAttachment[],
    remaining: string | undefined,
  ) => void;
  /** Offers `@everyone` in the mention picker, which a channel reads as a message to each member. */
  everyoneMention?: boolean | undefined;
  /** Told when the mention picker opens or closes, so the queue panel can give up the same space. */
  onPickerOpenChange?: (open: boolean) => void;
  /**
   * The words heard so far while the user dictates. `final` is set while the recording turns into
   * the final text. See `dictationWords` for how they show.
   */
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

export function expandComposerMentions(value: string): string {
  return value.replace(MENTION_PATTERN, (match, name: string, target: string) => {
    if (target.includes(":")) return match;
    return serializeChatTagReference("agent", name, target);
  });
}

export function ComposerEditor(props: ComposerEditorProps) {
  const { t, format } = useText();
  const [mention, setMention] = createSignal<MentionContext | null>(null);
  const [activeOption, setActiveOption] = createSignal(0);
  /* Where the `$` that the add menu wrote starts, so that picker can say why it is empty. */
  const [requestedMentionStart, setRequestedMentionStart] = createSignal<number | null>(null);
  const [attachmentTooltip, setAttachmentTooltip] = createSignal<{
    anchor: HTMLElement;
    content: string;
  } | null>(null);
  const attachmentTooltipId = `composer-file-tooltip-${createUniqueId()}`;
  /*
   * Measured again on every keystroke, and almost always the same two values. Without this
   * comparison each measurement is a new object, which moves the picker to a new portal and
   * replays its entrance animation: the panel appears to jump for each character typed.
   */
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
    (props.skills ?? []).filter((skill) => skill.state !== "needs-repair" && skill.enabled !== false),
  );
  const matchingSkills = createMemo(() => {
    const query = mention()?.query.trim().toLocaleLowerCase() ?? "";
    const ranked = usableSkills().flatMap((skill) => {
      const rank = skillMatchRank(skill, query);
      return rank === null ? [] : [{ skill, rank }];
    });
    // Array sort is stable, so skills of one rank keep the host's order.
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
  const matchingOptions = createMemo<PickerOption[]>(() => {
    const trigger = mention()?.trigger;
    /* Skills first: a skill is what the user writes with, and a server is what one of them reaches. */
    if (trigger === "$")
      return [
        ...matchingSkills().map((match) => ({ type: "skill" as const, ...match })),
        ...matchingMcpServers().map((server) => ({ type: "mcp" as const, server })),
      ];
    if (trigger !== "@") return [];
    return [
      ...matchingAgents().map((agent) => ({ type: "agent" as const, agent })),
      ...(matchesEveryone() ? [{ type: "everyone" as const }] : []),
      ...matchingAttachments().map((attachment) => ({
        type: "attachment" as const,
        attachment,
      })),
    ];
  });
  const activePickerValue = createMemo(() => {
    const option = matchingOptions()[activeOption()];
    return option ? new Set([pickerOptionKey(option)]) : new Set<string>();
  });
  /*
   * A `$` with no match says why only when the user asked for skills: after the add menu, or a
   * bare `$`. A price such as "$5" in a sentence keeps the picker closed.
   */
  const pickerStatus = createMemo(() => {
    const context = mention();
    if (context?.trigger !== "$" || matchingOptions().length > 0) return null;
    if (requestedMentionStart() !== context.start && context.query.trim()) return null;
    if (usableSkills().length === 0)
      return t(props.skillsLoadFailed ? "composer.picker.skillsLoadFailed" : "composer.picker.noSkills");
    return t("composer.picker.noSkillMatch", { query: context.query.trim() });
  });
  const pickerOpen = createMemo(() => mention() !== null && (matchingOptions().length > 0 || pickerStatus() !== null));
  createEffect(
    () => pickerOpen(),
    (open) => {
      props.onPickerOpenChange?.(open);
    },
  );
  const pickerOptionElements = new Map<string, HTMLElement>();
  const pickerFades = createScrollFades();
  onCleanup(pickerFades.stop);
  // The list has no scrollbar, so the fade is the only sign that more options wait below it.
  createEffect(
    () => matchingOptions().length,
    () => pickerFades.remeasure(),
  );
  let editor: HTMLDivElement | undefined;
  let lastAgentId: string | undefined;
  let lastAttachmentKey = "";
  let lastSkillKey = "";
  let lastMcpKey = "";
  let lastEmittedValue = "";
  let lastFocusRequest = 0;
  let lastSkillPickerRequest = 0;
  // A request made before this editor existed belongs to an earlier one, which inserted it.
  let lastQuoteRequest = untrack(() => props.quoteRequest?.id ?? 0);
  /* Where the caret was when the editor last had it. A selection in a message takes the caret away. */
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
      focusRequest,
      skillPickerRequest,
      quoteRequest,
      disabled,
    }) => {
      // An owner can set its counter back to 0 after this editor read it, for example when the chat that it
      // leaves closes after the next one opens. The next request after that must focus this editor.
      if (focusRequest < lastFocusRequest) lastFocusRequest = focusRequest;
      if (!editor || (isComposing && agentId === lastAgentId)) return;
      const attachmentKey = attachments.map((attachment) => `${attachment.id}:${attachment.name}`).join("|");
      const skillKey = skills
        .map((skill) => `${skill.skillId}:${skill.name}:${skill.state}:${skill.enabled}:${skill.description ?? ""}`)
        .join("|");
      const mcpKey = mcpServers.map((server) => `${server.id}:${server.name}:${server.enabled}`).join("|");
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
      const selection =
        !draftChanged && editor.ownerDocument.activeElement === editor ? readEditorSelection(editor) : null;
      const scrollTop = draftChanged ? 0 : editor.scrollTop;
      const skillsChanged = skillKey !== lastSkillKey;
      const mcpChanged = mcpKey !== lastMcpKey;
      const focusRequested = focusRequest > lastFocusRequest;
      if (draftChanged) savedCaret = null;
      if (contentChanged) {
        lastAgentId = agentId;
        lastEmittedValue = value;
        setAttachmentTooltip(null);
        renderEditorValue(editor, value, agents, skills, mcpServers, attachments, attachmentTokenActions);
        setMention(null);
      } else {
        if (attachmentsChanged) syncAttachmentTokens(editor, attachments, attachmentTokenActions);
        if (skillsChanged) syncSkillTokens(editor, skills);
        if (mcpChanged) syncMcpTokens(editor, mcpServers);
      }
      if (selection && (contentChanged || attachmentsChanged || skillsChanged || mcpChanged)) {
        restoreEditorSelection(editor, selection);
        scheduleCaretScroll();
      }
      editor.scrollTop = scrollTop;
      lastAttachmentKey = attachmentKey;
      lastSkillKey = skillKey;
      lastMcpKey = mcpKey;
      if (focusRequested) {
        lastFocusRequest = focusRequest;
        // Text that the user selected in the draft stays selected, for example when they click Reply on a message.
        const draftSelection = contentChanged ? null : readEditorSelection(editor);
        editor.focus({ preventScroll: true });
        if (!draftSelection || draftSelection.anchor === draftSelection.focus) placeCaretAtEnd(editor);
        scheduleCaretScroll();
      }
      if (skillPickerRequest > lastSkillPickerRequest) {
        lastSkillPickerRequest = skillPickerRequest;
        openSkillPicker();
      }
      // A locked composer keeps the quote until it opens again.
      if (quoteRequest && quoteRequest.id > lastQuoteRequest && !disabled) {
        lastQuoteRequest = quoteRequest.id;
        insertQuote(quoteRequest.messageId, quoteRequest.text);
      }
    },
  );

  /*
   * Live dictation continues the draft's last line, where the final text lands, so nothing moves
   * when the recording finishes. The editor's text offsets and serializer must never see these
   * words, so a read-only copy of the draft takes the editor's place while they show.
   */
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
    }),
    ({ shown, value, agents, skills, mcpServers, attachments }) => {
      if (!shown || !dictationDraft) return;
      renderEditorValue(dictationDraft, value, agents, skills, mcpServers, attachments, attachmentTokenActions);
      // The editor needs a closing <br> to show an empty last line; inline, it would push the words a line down.
      if (value.endsWith("\n")) dictationDraft.lastChild?.remove();
    },
  );
  createEffect(dictationWords, () => {
    if (dictationView) dictationView.scrollTop = dictationView.scrollHeight;
  });

  // Coming back to the window puts the caret back here, so the first keys are not lost. A touch
  // device would open its keyboard instead, and focus leaving an embedded frame (an HTML preview)
  // also fires `focus` here without the window having been away.
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
      // A dismissed picker stays closed until the user types or clicks again.
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

  function emitValue() {
    if (!editor) return;
    let value = serializeEditor(editor);
    if (value.length > INPUT_LIMITS.messageText) {
      value = truncateComposerValue(value, INPUT_LIMITS.messageText);
      setAttachmentTooltip(null);
      renderEditorValue(
        editor,
        value,
        props.agents,
        props.skills ?? [],
        props.mcpServers ?? [],
        props.attachments ?? [],
        attachmentTokenActions,
      );
      placeCaretAtEnd(editor);
    }
    lastEmittedValue = value;
    props.onValueChange(value);
    scheduleCaretScroll();
  }

  /*
   * Every plain character takes the same road: this handler cancels the native insert and asks the
   * browser to insert the text. Letting the default action write some characters and the editor
   * write the rest raced, and a native insert that landed a task late, or one reported with a
   * composition input type, was read as "no native input" and the character went in twice.
   * The text comes from the input event, not from the key: an input method that picks a phrase
   * with Shift+1 sends the "!" key, and Chromium delivers the phrase as that key's text.
   */
  function handleBeforeInput(event: InputEvent) {
    if (!editor || props.disabled || isComposing || event.isComposing) return;
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

  /* Writes a `$` at the caret, as if typed, so the picker and its query work as for a typed one. */
  function openSkillPicker() {
    if (!editor || props.disabled) return;
    editor.focus();
    ensureEditorSelection();
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    // Keep selected text: put the `$` after it.
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
    const quote = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-quote-message-id]") : null;
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
    /*
     * The browser owns the IME composition buffer. The key that starts a composition comes before
     * `compositionstart` and without `isComposing`; Chromium marks it with keyCode 229 ("Process").
     */
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

    if (event.key.toLocaleLowerCase() === "a" && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
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

    const text = clipboard.getData("text/plain").replace(/\r\n?/g, "\n").slice(0, INPUT_LIMITS.messageText);
    if (!text) return;

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
    // Without an attachment, the native copy keeps its rich text.
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
          // A menu can return the focus to the editor within this delay; keep the picker it opened.
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
          // The editor under this copy takes the keys, so a click here gives it the focus.
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
                  // The last words are the ones the next live pass is most likely to change.
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
            class="mention-picker"
            style={{
              "--mention-picker-bottom": `${pickerFrame().bottom}px`,
              "--mention-picker-rows": pickerStatus() === null ? matchingOptions().length : 1,
            }}
          >
            <Show when={pickerStatus()}>
              {(status) => (
                <p class="mention-picker-status" role="status">
                  {status()}
                </p>
              )}
            </Show>
            <Show when={pickerStatus() === null}>
              <Listbox.Root<PickerOption>
                as="div"
                ref={pickerFades.bind}
                class={["mention-picker-list", pickerFades.classes()]}
                onScroll={pickerFades.measure}
                aria-label={t(
                  mention()?.trigger === "$" ? "composer.picker.skillLabel" : "composer.picker.mentionLabel",
                )}
                options={matchingOptions()}
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
                        // The composer focuses its editor on any pointerdown that is not a control.
                        event.stopPropagation();
                      }}
                      onMouseEnter={() => setActiveOption(optionIndex())}
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
                      ) : (
                        <AttachmentReferenceVisual name={option.attachment.name} />
                      )}
                      <strong>{pickerOptionName(option, t)}</strong>
                      <Show when={option.type === "skill" && option.showSlug ? option.skill.slug : undefined}>
                        {(slug) => <span class="mention-picker-slug">{slug()}</span>}
                      </Show>
                      <Show when={pickerOptionDescription(option, t, format)}>
                        {(description) => <span class="mention-picker-description">{description()}</span>}
                      </Show>
                      <Badge class="mention-picker-badge" variant="ghost">
                        <Dynamic component={badge.icon} aria-hidden="true" />
                        {badge.label}
                      </Badge>
                    </Listbox.Item>
                  );
                }}
              />
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
