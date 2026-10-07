import { attachmentReferenceIds } from "@openbot/contracts/attachment-references";
import { serializeChatTagReference } from "@openbot/contracts/chat-tag-references";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { DraftAttachment, InstalledSkill, McpServerConfig } from "@openbot/contracts/ipc";
import { Badge, Blocks, Listbox, Puzzle } from "@openbot/ui";
import { usesTouchLayout } from "@openbot/ui/utils";
import { Dynamic, Portal } from "@solidjs/web";
import { createEffect, createMemo, createSignal, createUniqueId, onCleanup, onSettled, Show } from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { AnchoredTooltip } from "./AnchoredTooltip";
import { AttachmentReferenceVisual } from "./AttachmentReference";
import {
  automaticMentionSpaceAtCaretBoundary,
  insertLineBreak,
  insertPlainText,
  mentionTokenAtCaretBoundary,
  placeCaretAtChildOffset,
  placeCaretAtEnd,
  rangeFromTextOffsets,
  serializeEditor,
  syncTrailingLineSentinel,
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
  createSkillToken,
  MENTION_PATTERN,
  renderEditorValue,
  syncMcpTokens,
  syncSkillTokens,
  truncateComposerValue,
} from "./composer-tokens";
import { isSendShortcutKey, type SendShortcut } from "./send-shortcut";

interface ComposerEditorProps {
  agentId: string | undefined;
  agents: AgentProfile[];
  skills?: InstalledSkill[];
  /** The host's MCP servers, offered by the same `$` the skills answer. */
  mcpServers?: McpServerConfig[];
  attachments?: DraftAttachment[];
  value: string;
  placeholder: string;
  ariaLabel: string;
  disabled: boolean;
  focusRequest?: number;
  /** Raised by one to open the skill picker at the caret, as a typed `$` does. */
  skillPickerRequest?: number;
  /** The last skill list request failed, so an empty picker says so instead of "no skills". */
  skillsLoadFailed?: boolean;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  /**
   * Which chord sends the message. Enter keeps the current behavior; the platform modifier with
   * Enter sends and plain Enter adds a line. The renderer resolves the platform and passes it.
   */
  sendShortcut?: SendShortcut;
  onOpenAttachment?: (attachment: DraftAttachment) => void;
  /** Receives pasted files. Without it, a file paste does nothing here; the desktop preload imports it. */
  onPasteFiles?: (files: File[]) => void;
  /** Told when the mention picker opens or closes, so the queue panel can give up the same space. */
  onPickerOpenChange?: (open: boolean) => void;
}

interface MentionContext {
  query: string;
  start: number;
  end: number;
  trigger: "@" | "$";
}

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
    const query = mention()?.query.trim().toLocaleLowerCase() ?? "";
    return props.agents.filter(
      (agent) =>
        agent.id !== props.agentId &&
        (!query || `${agent.name} ${agent.title} ${agent.description}`.toLocaleLowerCase().includes(query)),
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
  let isComposing = false;
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
      agentId: props.agentId,
      value: props.value,
      agents: props.agents,
      skills: props.skills ?? [],
      mcpServers: props.mcpServers ?? [],
      attachments: props.attachments ?? [],
      focusRequest: props.focusRequest ?? 0,
      skillPickerRequest: props.skillPickerRequest ?? 0,
    }),
    ({ agentId, value, agents, skills, mcpServers, attachments, focusRequest, skillPickerRequest }) => {
      if (!editor) return;
      const attachmentKey = attachments.map((attachment) => `${attachment.id}:${attachment.name}`).join("|");
      const skillKey = skills
        .map((skill) => `${skill.skillId}:${skill.name}:${skill.state}:${skill.description ?? ""}`)
        .join("|");
      const mcpKey = mcpServers.map((server) => `${server.id}:${server.name}:${server.enabled}`).join("|");
      const contentChanged =
        agentId !== lastAgentId || value !== lastEmittedValue || attachmentKey !== lastAttachmentKey;
      const skillsChanged = skillKey !== lastSkillKey;
      const mcpChanged = mcpKey !== lastMcpKey;
      const focusRequested = focusRequest > lastFocusRequest;
      if (contentChanged) {
        lastAgentId = agentId;
        lastAttachmentKey = attachmentKey;
        lastEmittedValue = value;
        setAttachmentTooltip(null);
        renderEditorValue(editor, value, agents, skills, mcpServers, attachments, attachmentTokenActions);
        syncTrailingLineSentinel(editor, value);
        setMention(null);
      } else {
        if (skillsChanged) syncSkillTokens(editor, skills);
        if (mcpChanged) syncMcpTokens(editor, mcpServers);
      }
      lastSkillKey = skillKey;
      lastMcpKey = mcpKey;
      if (focusRequested) {
        lastFocusRequest = focusRequest;
        editor.focus();
        placeCaretAtEnd(editor);
      }
      if (skillPickerRequest > lastSkillPickerRequest) {
        lastSkillPickerRequest = skillPickerRequest;
        openSkillPicker();
      }
    },
  );

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
      if (editor && shouldRestoreComposerFocus(editor)) editor.focus();
    };
    view.addEventListener("blur", noteFrameFocus);
    view.addEventListener("focus", restoreFocus);
    return () => {
      view.removeEventListener("blur", noteFrameFocus);
      view.removeEventListener("focus", restoreFocus);
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
    syncTrailingLineSentinel(editor, value);
    lastEmittedValue = value;
    props.onValueChange(value);
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
    if (event.inputType !== "insertText" || !event.data) return;
    event.preventDefault();
    insertPlainText(editor, event.data);
    emitValue();
    updateMention();
    scrollToEndIfCaretAtEnd();
  }

  function scrollToEndIfCaretAtEnd() {
    if (!editor) return;
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!range?.collapsed || !editor.contains(range.commonAncestorContainer)) return;
    const afterCaret = range.cloneRange();
    afterCaret.selectNodeContents(editor);
    afterCaret.setStart(range.endContainer, range.endOffset);
    // Keep earlier edits in view; only follow the bottom when appending to the draft.
    if (!afterCaret.toString()) editor.scrollTop = editor.scrollHeight;
  }

  function updateMention() {
    if (!editor) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount || !editor.contains(selection.anchorNode)) {
      setMention(null);
      return;
    }
    const range = selection.getRangeAt(0).cloneRange();
    range.selectNodeContents(editor);
    range.setEnd(selection.anchorNode ?? editor, selection.anchorOffset);
    const beforeCaret = range.toString();
    const match = beforeCaret.match(/(?:^|\s)([@$])([^@$\n]{0,60})$/u);
    if (!match) {
      setMention(null);
      return;
    }
    const trigger = match[1] === "$" ? "$" : "@";
    const query = match[2] ?? "";
    setPickerFrame(measurePickerFrame(editor));
    setMention({ query, start: beforeCaret.length - query.length - 1, end: beforeCaret.length, trigger });
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
    const range = selection.getRangeAt(0).cloneRange();
    range.selectNodeContents(editor);
    range.setEnd(selection.anchorNode ?? editor, selection.anchorOffset);
    const beforeCaret = range.toString();
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

  function ensureEditorSelection(normalize = false) {
    if (!editor) return;
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !editor.contains(range.commonAncestorContainer)) {
      if (normalize) editor.normalize();
      placeCaretAtEnd(editor);
      return;
    }
    if (!normalize) return;
    const startPrefix = range.cloneRange();
    startPrefix.selectNodeContents(editor);
    startPrefix.setEnd(range.startContainer, range.startOffset);
    const endPrefix = range.cloneRange();
    endPrefix.selectNodeContents(editor);
    endPrefix.setEnd(range.endContainer, range.endOffset);
    const start = startPrefix.toString().length;
    const end = endPrefix.toString().length;
    editor.normalize();
    const normalizedRange = rangeFromTextOffsets(editor, start, end);
    if (!normalizedRange) return;
    selection?.removeAllRanges();
    selection?.addRange(normalizedRange);
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

  function handleMentionPickerKeyDown(event: KeyboardEvent, sendShortcut: SendShortcut): boolean {
    if (!mention()) return false;
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
    // The modifier send chord submits instead of picking a suggestion. In the Enter mode the
    // chord is plain Enter, which keeps selecting the suggestion as before.
    if (sendShortcut !== "enter" && isSendShortcutKey(event, sendShortcut)) return false;
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
    if (handleMentionPickerKeyDown(event, sendShortcut)) return;
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
      scrollToEndIfCaretAtEnd();
      return;
    }
    if (event.key === "Enter") {
      if (sendShortcut !== "enter" && !isSendShortcutKey(event, sendShortcut)) {
        event.preventDefault();
        if (!editor) return;
        insertLineBreak(editor);
        emitValue();
        updateMention();
        scrollToEndIfCaretAtEnd();
        return;
      }
      event.preventDefault();
      props.onSubmit();
    }
  }

  function removeTrailingLineBreak(): boolean {
    if (!editor) return false;
    const value = serializeEditor(editor);
    if (!value.endsWith("\n")) return false;
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!range?.collapsed || !editor.contains(range.commonAncestorContainer)) return false;
    const afterCaret = range.cloneRange();
    afterCaret.setEndAfter(editor.lastChild ?? editor);
    if (afterCaret.toString()) return false;

    const nextValue = value.slice(0, -1);
    renderEditorValue(
      editor,
      nextValue,
      props.agents,
      props.skills ?? [],
      props.mcpServers ?? [],
      props.attachments ?? [],
      attachmentTokenActions,
    );
    syncTrailingLineSentinel(editor, nextValue);
    placeCaretAtEnd(editor);
    emitValue();
    updateMention();
    return true;
  }

  function handlePaste(event: ClipboardEvent) {
    event.preventDefault();
    if (!editor || props.disabled) return;

    const clipboard = event.clipboardData;
    if (!clipboard) return;
    const files =
      clipboard.files.length > 0
        ? Array.from(clipboard.files)
        : Array.from(clipboard.items).flatMap((item) => {
            const file = item.kind === "file" ? item.getAsFile() : null;
            return file ? [file] : [];
          });
    if (files.length > 0) {
      props.onPasteFiles?.(files);
      return;
    }

    const text = clipboard.getData("text/plain").replace(/\r\n?/g, "\n").slice(0, INPUT_LIMITS.messageText);
    if (!text) return;

    insertPlainText(editor, text);
    emitValue();
    updateMention();
  }

  return (
    <div class="composer-editor-root">
      <Show when={!props.value}>
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
        spellcheck="true"
        data-cuelume-type=""
        onFocus={() => ensureEditorSelection(true)}
        onInput={() => {
          emitValue();
          updateMention();
        }}
        onClick={updateMention}
        onKeyDown={handleKeyDown}
        onBeforeInput={handleBeforeInput}
        onCompositionStart={() => {
          isComposing = true;
        }}
        onCompositionEnd={() => {
          isComposing = false;
        }}
        onPaste={handlePaste}
        onBlur={() => {
          isComposing = false;
          // A menu can return the focus to the editor within this delay; keep the picker it opened.
          window.setTimeout(() => {
            const ownerDocument = editor?.ownerDocument;
            if (!ownerDocument?.hasFocus() || ownerDocument.activeElement !== editor) setMention(null);
          }, 100);
        }}
      />
      <Show when={pickerOpen()}>
        <Portal mount={pickerFrame().mount}>
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
                      <strong>{pickerOptionName(option)}</strong>
                      <Show when={option.type === "skill" && option.showSlug ? option.skill.slug : undefined}>
                        {(slug) => <span class="mention-picker-slug">{slug()}</span>}
                      </Show>
                      <Show when={pickerOptionDescription(option, format)}>
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
