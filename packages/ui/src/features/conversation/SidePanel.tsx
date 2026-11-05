import type { AppTextKey } from "@openbot/i18n";
import {
  AudioLines,
  Button,
  buttonVariants,
  DropdownMenu,
  Folder,
  Maximize2,
  MessageCircleQuestionMark,
  Minimize2,
  PanelRight,
  Plus,
  Settings,
  Tabs,
  Workflow,
  X,
} from "@openbot/ui";
import {
  AttachmentReferenceVisual,
  attachmentReferenceTone,
} from "@openbot/ui/features/conversation/AttachmentReference";
import { ComputerIcon } from "@openbot/ui/features/conversation/ConversationIcons";
import type { ThreadItem } from "@openbot/ui/features/conversation/threads/thread-types";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { For, flush, onSettled, Show } from "solid-js";
import { ThreadStatusText, ThreadTabIcon, threadAttention } from "./threads/ThreadStatusMark";
import { ThreadTabGhost } from "./threads/ThreadTabGhost";
import { carriedThreadTab, setCarriedThreadTab, swallowNextClick } from "./threads/thread-tab-drag";

/** A tab starts to move after the pointer moves this far, so a click stays a click. */
const DRAG_START = 4;
/** The prefix of a thread tab's value, so a thread id cannot be taken for a pane. */
const THREAD_VALUE = "thread:";
/** The prefix of a file tab's value. */
const FILE_VALUE = "file:";

/**
 * The value of a file tab. Kobalte finds the selected tab with an unescaped `[data-key="…"]`
 * selector, and a path can hold a quote, so the key is encoded.
 */
function fileValue(key: string): string {
  return `${FILE_VALUE}${encodeURIComponent(key)}`;
}

/**
 * A pane of the side panel. Each open pane has a tab at the top of the panel. A side question opens
 * from the composer only, and a subagent from its row in the chat, so the launcher and Add do not
 * list them.
 */
export type SidePanelPane = "browser" | "files" | "settings" | "question" | "voice" | "subagent";

const PANE_LABELS: Record<SidePanelPane, AppTextKey> = {
  browser: "conversation.sidePanel.pane.browser",
  files: "conversation.sidePanel.pane.files",
  settings: "conversation.sidePanel.pane.settings",
  question: "conversation.sidePanel.pane.question",
  voice: "conversation.sidePanel.pane.voice",
  subagent: "conversation.sidePanel.pane.subagent",
};

/** The same glyphs as the rest of the app: the browser is the computer. */
function PaneIcon(props: { pane: SidePanelPane }): JSX.Element {
  switch (props.pane) {
    case "browser":
      return <ComputerIcon />;
    case "files":
      return <Folder aria-hidden="true" />;
    case "settings":
      return <Settings aria-hidden="true" />;
    case "question":
      return <MessageCircleQuestionMark aria-hidden="true" />;
    case "voice":
      return <AudioLines aria-hidden="true" />;
    case "subagent":
      return <Workflow aria-hidden="true" />;
  }
}

export interface SidePanelToggleProps {
  open: boolean;
  /** The name of the agent that controls the browser now. */
  actingAgentName?: string | undefined;
  onToggle: () => void;
}

/** The panel button at the end of the chat header. Its dot shows browser control. */
export function SidePanelToggle(props: SidePanelToggleProps) {
  const { t } = useText();
  const label = () => {
    if (props.actingAgentName !== undefined)
      return t("conversation.header.browserActing", { name: props.actingAgentName });
    if (props.open) return t("conversation.sidePanel.close");
    return t("conversation.sidePanel.open");
  };
  return (
    <Button
      variant="ghost"
      type="button"
      class={[
        "header-panel-toggle side-panel-toggle",
        { "computer-button-agent-active": props.actingAgentName !== undefined },
      ]}
      aria-label={label()}
      title={label()}
      aria-expanded={props.open ? "true" : "false"}
      onClick={() => props.onToggle()}
    >
      <PanelRight aria-hidden="true" class="size-[14px]" />
      <Show when={props.actingAgentName !== undefined}>
        <span class="computer-control-dot" aria-hidden="true" />
      </Show>
    </Button>
  );
}

export interface SidePanelHeaderProps {
  /** The open panes, in tab order. */
  panes: readonly SidePanelPane[];
  selected: SidePanelPane | null;
  /** The panes that this chat can open. */
  available: readonly SidePanelPane[];
  maximized: boolean;
  /** The name of the settings pane, when it holds other settings than an agent's. */
  settingsLabel?: string | undefined;
  onSelect: (pane: SidePanelPane) => void;
  onClose: (pane: SidePanelPane) => void;
  onToggleMaximized: () => void;
  onCollapse: () => void;
  /** Opens a new browser tab. While the Browser pane is open, Add lists it first. */
  onNewBrowserTab?: (() => void) | undefined;
  /** The threads of the agent that show beside the chat. Missing when the chat has no threads. */
  threads?: SidePanelThreads | undefined;
  /** The open files. Missing when the chat cannot open files. */
  files?: SidePanelFiles | undefined;
}

/** A file or folder with a tab in the side panel. */
export interface SidePanelFileTab {
  key: string;
  name: string;
  folder: boolean;
}

/** The file tabs of the side panel. They come after the thread tabs. */
export interface SidePanelFiles {
  items: readonly SidePanelFileTab[];
  /** The file that the panel shows, or null while a pane or thread shows. */
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  /** Puts the file at `index` of the file tabs. */
  onMove: (key: string, index: number) => void;
}

/** The thread tabs of the side panel. They come after the pane tabs. */
export interface SidePanelThreads {
  items: readonly ThreadItem[];
  /** The thread that the panel shows, or null while a pane shows. */
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  /** Puts the thread at `index` of the thread tabs. */
  onMove: (id: string, index: number) => void;
  /** Moves the thread to the tabs of the chat header and opens it there. */
  onToChat: (id: string) => void;
}

/**
 * A thread or file tab that the pointer holds. A tab moves only among the tabs of its own kind. Only a
 * thread tab has a place to go outside the panel, so `thread` is null for a file tab.
 */
interface TabHold {
  group: TabGroup;
  id: string;
  thread: ThreadItem | null;
  pointerId: number;
  startX: number;
  startY: number;
  /** False until the pointer moves past `DRAG_START`. */
  moving: boolean;
  /**
   * The pointer is over the chat. A drop there moves a thread to the chat header and leaves a file tab
   * in its place.
   */
  away: boolean;
  /** The place of the tab among the tabs of its kind when the pointer lets it go. */
  target: number;
  /**
   * The page reads right to left, so the chat is right of the panel. Read once, when the hold starts,
   * from the header: the tab strip keeps the left-to-right order in every language.
   */
  rightToLeft: boolean;
}

/** The kinds of tab that drag, with the class and the data attribute that find them. */
const TAB_GROUPS = {
  thread: { selector: ":scope > .side-panel-thread-tab", id: (tab: HTMLElement) => tab.dataset.threadId },
  file: { selector: ":scope > .side-panel-file-tab", id: (tab: HTMLElement) => tab.dataset.fileKey },
} as const;
type TabGroup = keyof typeof TAB_GROUPS;

/**
 * The top row of the side panel: a tab for each open pane, each thread that shows beside the chat and
 * each open file, then Add and Maximize. A file tab shows the file-type badge of a file link. The tab
 * icon is also the close button of the tab; hover or focus shows its X.
 * Add lists the panes that are not open. While the Browser pane is open, Add lists New tab first, so the
 * pane needs no row of its own. Add goes away when it has nothing to list.
 *
 * The tabs are one tab stop. The arrow keys, Home and End select a tab; Delete closes it. The close
 * button is for the pointer only, so the tab list holds only tabs. The panes are labeled regions of
 * their own, so no tab panel is registered.
 *
 * A thread tab drags to a new place among the thread tabs, and to the chat, which opens the thread in
 * the chat header. While the pointer takes a thread tab of the chat header over the panel, the panel
 * shows where the drop puts it. A file tab drags to a new place among the file tabs.
 */
export function SidePanelHeader(props: SidePanelHeaderProps) {
  const { t } = useText();
  let root: HTMLDivElement | undefined;
  let tabList: HTMLDivElement | undefined;
  const closedPanes = () => props.available.filter((pane) => !props.panes.includes(pane));
  const threads = () => props.threads?.items ?? [];
  const files = () => props.files?.items ?? [];
  const hasTabs = () => props.panes.length + threads().length + files().length > 0;
  const newBrowserTab = () =>
    props.panes.includes("browser") && props.available.includes("browser") ? props.onNewBrowserTab : undefined;
  const paneLabel = (pane: SidePanelPane) =>
    pane === "settings" && props.settingsLabel !== undefined ? props.settingsLabel : t(PANE_LABELS[pane]);
  const selectedValue = () => {
    const thread = props.threads?.selectedId;
    if (thread) return `${THREAD_VALUE}${thread}`;
    const file = props.files?.selectedKey;
    if (file) return fileValue(file);
    return props.selected ?? "__none";
  };
  /** The value of each tab, in tab order. */
  const tabValues = () => [
    ...props.panes,
    ...threads().map((thread) => `${THREAD_VALUE}${thread.id}`),
    ...files().map((file) => fileValue(file.key)),
  ];
  /** Delete closes the tab. The closed tab leaves the list, so focus moves to the tab that takes its place. */
  const onTabKeyDown = (event: KeyboardEvent, value: string, close: () => void) => {
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    event.preventDefault();
    const index = tabValues().indexOf(value);
    flush(close);
    const values = tabValues();
    const next = values[Math.min(index, values.length - 1)];
    if (next) tabList?.querySelector<HTMLElement>(`[data-key="${CSS.escape(next)}"]`)?.focus();
  };
  const carriedHere = () => carriedThreadTab()?.from === "chat";
  /**
   * Focus from the arrow keys selects the tab. Focus from a pointer waits for the click, so a drag does
   * not select the tab. Focus that comes back from another window has no related target and keeps the
   * selected tab.
   */
  const keyboardFocus = (event: FocusEvent) =>
    event.relatedTarget !== null &&
    event.currentTarget instanceof Element &&
    event.currentTarget.matches(":focus-visible");

  onSettled(() => {
    const element = tabList;
    if (!element) return;
    let hold: TabHold | null = null;
    const groupTabs = (group: TabGroup) => [...element.querySelectorAll<HTMLElement>(TAB_GROUPS[group].selector)];
    const tabOf = (current: TabHold) =>
      groupTabs(current.group).find((tab) => TAB_GROUPS[current.group].id(tab) === current.id);
    const clearShifts = (group: TabGroup) => {
      for (const tab of groupTabs(group)) tab.style.transform = "";
    };
    /**
     * The chat is at the inline start of the panel: left of it, or right of it right to left. A
     * maximized panel covers the chat, so it has no chat to drop on.
     */
    const overChat = (x: number, rightToLeft: boolean) => {
      if (props.maximized || root === undefined) return false;
      const bounds = root.getBoundingClientRect();
      return rightToLeft ? x > bounds.right : x < bounds.left;
    };
    /**
     * Moves the held tab with the pointer, and the other tabs of its kind make room. A tab can be much
     * narrower than the held one, so the leading edge of the held tab, not its center, finds its place.
     */
    const follow = (current: TabHold, x: number) => {
      const tabId = TAB_GROUPS[current.group].id;
      const items = groupTabs(current.group).map((tab) => ({ tab, left: tab.offsetLeft, width: tab.offsetWidth }));
      const index = items.findIndex((item) => tabId(item.tab) === current.id);
      const self = items[index];
      const first = items[0];
      const last = items.at(-1);
      if (!self || !first || !last) return;
      const offset = Math.min(
        Math.max(x - current.startX, first.left - self.left),
        last.left + last.width - self.left - self.width,
      );
      const edge = offset < 0 ? self.left + offset : self.left + self.width + offset;
      current.target = items.filter((item, i) => i !== index && item.left + item.width / 2 < edge).length;
      const room = self.width + Number.parseFloat(getComputedStyle(element).columnGap || "0");
      items.forEach((item, i) => {
        if (i === index) {
          item.tab.style.transform = `translateX(${offset}px)`;
          return;
        }
        const shift = i > index && i <= current.target ? -room : i < index && i >= current.target ? room : 0;
        item.tab.style.transform = shift === 0 ? "" : `translateX(${shift}px)`;
      });
    };
    /**
     * Puts the held tab in its new place. Each tab of its kind slides from where it shows now. The move
     * takes the focused tab out of the document for a moment, so the focus goes back to it.
     */
    const reorder = (current: TabHold, index: number) => {
      const focused = element.contains(document.activeElement) ? document.activeElement : null;
      const before = new Map(groupTabs(current.group).map((tab) => [tab, tab.getBoundingClientRect().left]));
      for (const tab of before.keys()) {
        tab.style.transition = "none";
        tab.style.transform = "";
      }
      if (current.group === "thread") props.threads?.onMove(current.id, index);
      else props.files?.onMove(current.id, index);
      flush();
      if (focused instanceof HTMLElement && focused !== document.activeElement) focused.focus({ preventScroll: true });
      for (const [tab, left] of before) {
        const offset = left - tab.getBoundingClientRect().left;
        if (Math.abs(offset) > 0.5) tab.style.transform = `translateX(${offset}px)`;
      }
      // Start the slide from the old places.
      element.getBoundingClientRect();
      for (const tab of before.keys()) {
        tab.style.transition = "";
        tab.style.transform = "";
      }
    };
    const onMove = (event: PointerEvent) => {
      const current = hold;
      if (!current || event.pointerId !== current.pointerId) return;
      if (!current.moving) {
        if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < DRAG_START) return;
        current.moving = true;
        element.setAttribute("data-dragging", "");
      }
      current.away = overChat(event.clientX, current.rightToLeft);
      // Over the chat, the tab goes back to its place. A thread tab fades, and a copy follows the pointer.
      tabOf(current)?.setAttribute("data-dragged", current.away ? "away" : "");
      if (current.away) {
        clearShifts(current.group);
        if (current.thread) {
          setCarriedThreadTab({ thread: current.thread, from: "side", x: event.clientX, y: event.clientY });
        }
      } else {
        if (current.thread) setCarriedThreadTab(null);
        follow(current, event.clientX);
      }
    };
    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
    const onEnd = (event: PointerEvent) => {
      const current = hold;
      if (!current || event.pointerId !== current.pointerId) return;
      hold = null;
      stop();
      if (!current.moving) return;
      element.removeAttribute("data-dragging");
      tabOf(current)?.removeAttribute("data-dragged");
      if (current.thread) setCarriedThreadTab(null);
      swallowNextClick();
      if (event.type === "pointercancel") {
        clearShifts(current.group);
      } else if (current.away) {
        clearShifts(current.group);
        if (current.thread) props.threads?.onToChat(current.id);
      } else {
        reorder(current, current.target);
      }
    };
    const onStart = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary || hold || !(event.target instanceof Element)) return;
      // The icon slot is the close button.
      if (event.target.closest(".side-panel-tab-close")) return;
      const threadId = event.target.closest<HTMLElement>(".side-panel-thread-tab")?.dataset.threadId;
      const fileKey = event.target.closest<HTMLElement>(".side-panel-file-tab")?.dataset.fileKey;
      const thread = threads().find((item) => item.id === threadId);
      const file = files().find((item) => item.key === fileKey);
      const held = thread
        ? { group: "thread" as const, id: thread.id, thread }
        : file
          ? { group: "file" as const, id: file.key, thread: null }
          : null;
      if (!held) return;
      hold = {
        ...held,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moving: false,
        away: false,
        target: 0,
        rightToLeft: root !== undefined && getComputedStyle(root).direction === "rtl",
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
    };
    element.addEventListener("pointerdown", onStart);
    return () => {
      element.removeEventListener("pointerdown", onStart);
      stop();
      if (hold?.moving && hold.thread) setCarriedThreadTab(null);
    };
  });

  return (
    <>
      <Tabs.Root ref={root} class="window-drag side-panel-header" value={selectedValue()} activationMode="automatic">
        <Tabs.List ref={tabList} class="side-panel-tabs" aria-label={t("conversation.sidePanel.label")}>
          <For each={props.panes}>
            {(pane) => {
              const label = () => paneLabel(pane);
              const selected = () =>
                props.threads?.selectedId == null && props.files?.selectedKey == null && props.selected === pane;
              return (
                <div role="presentation" class="side-panel-tab no-drag" data-selected={selected() ? "true" : undefined}>
                  <Button
                    variant="ghost"
                    type="button"
                    class="side-panel-tab-close"
                    tabindex={-1}
                    aria-hidden="true"
                    title={t("conversation.sidePanel.closePane", { name: label() })}
                    onClick={() => props.onClose(pane)}
                  >
                    <span class="side-panel-tab-icon">
                      <PaneIcon pane={pane} />
                    </span>
                    <X class="side-panel-tab-x" aria-hidden="true" />
                  </Button>
                  <Tabs.Trigger
                    as="button"
                    type="button"
                    value={pane}
                    class={buttonVariants({ variant: "ghost", class: "side-panel-tab-select" })}
                    aria-keyshortcuts="Delete"
                    title={label()}
                    // As in the browser panel, only the user selects a pane: while the tabs register,
                    // the controlled selection can be absent and suggest the first tab.
                    onClick={() => props.onSelect(pane)}
                    // The arrow keys, Home and End move the focus and select the pane.
                    onFocus={(event) => keyboardFocus(event) && !selected() && props.onSelect(pane)}
                    onKeyDown={(event) => onTabKeyDown(event, pane, () => props.onClose(pane))}
                  >
                    <span class="side-panel-tab-label">{label()}</span>
                  </Tabs.Trigger>
                </div>
              );
            }}
          </For>
          {/* Keyed by id, so a tab keeps its element and its drag when its title or state changes. */}
          <For each={threads()} keyed={(thread) => thread.id}>
            {(thread) => {
              const value = () => `${THREAD_VALUE}${thread().id}`;
              const selected = () => props.threads?.selectedId === thread().id;
              const select = () => props.threads?.onSelect(thread().id);
              const close = () => props.threads?.onClose(thread().id);
              return (
                <div
                  role="presentation"
                  class="side-panel-tab side-panel-thread-tab no-drag"
                  data-thread-id={thread().id}
                  data-attention={threadAttention(thread().status)}
                  data-selected={selected() ? "true" : undefined}
                >
                  <Button
                    variant="ghost"
                    type="button"
                    class="side-panel-tab-close"
                    tabindex={-1}
                    aria-hidden="true"
                    title={t("conversation.threads.closeTab")}
                    onClick={close}
                  >
                    <span class="side-panel-tab-icon">
                      <ThreadTabIcon status={thread().status} unread={thread().unread} />
                    </span>
                    <X class="side-panel-tab-x" aria-hidden="true" />
                  </Button>
                  <Tabs.Trigger
                    as="button"
                    type="button"
                    value={value()}
                    class={buttonVariants({ variant: "ghost", class: "side-panel-tab-select" })}
                    aria-keyshortcuts="Delete"
                    title={thread().title}
                    onClick={select}
                    onAuxClick={(event: MouseEvent) => {
                      if (event.button === 1) close();
                    }}
                    onFocus={(event) => keyboardFocus(event) && !selected() && select()}
                    onKeyDown={(event) => onTabKeyDown(event, value(), close)}
                  >
                    <span class="side-panel-tab-label">{thread().title}</span>
                    <ThreadStatusText status={thread().status} unread={thread().unread} />
                  </Tabs.Trigger>
                </div>
              );
            }}
          </For>
          <For each={files()} keyed={(file) => file.key}>
            {(file) => {
              const value = () => fileValue(file().key);
              const selected = () => props.files?.selectedKey === file().key;
              const select = () => props.files?.onSelect(file().key);
              const close = () => props.files?.onClose(file().key);
              return (
                <div
                  role="presentation"
                  class="side-panel-tab side-panel-file-tab no-drag"
                  data-file-key={file().key}
                  data-selected={selected() ? "true" : undefined}
                >
                  <Button
                    variant="ghost"
                    type="button"
                    class="side-panel-tab-close"
                    tabindex={-1}
                    aria-hidden="true"
                    title={t("conversation.sidePanel.closePane", { name: file().name })}
                    onClick={close}
                  >
                    <span class="side-panel-tab-icon">
                      <Show
                        when={file().folder}
                        fallback={
                          <span class="side-panel-file-badge" data-file-tone={attachmentReferenceTone(file().name)}>
                            <AttachmentReferenceVisual name={file().name} />
                          </span>
                        }
                      >
                        <Folder aria-hidden="true" />
                      </Show>
                    </span>
                    <X class="side-panel-tab-x" aria-hidden="true" />
                  </Button>
                  <Tabs.Trigger
                    as="button"
                    type="button"
                    value={value()}
                    class={buttonVariants({ variant: "ghost", class: "side-panel-tab-select" })}
                    aria-keyshortcuts="Delete"
                    title={file().name}
                    onClick={select}
                    onAuxClick={(event: MouseEvent) => {
                      if (event.button === 1) close();
                    }}
                    onFocus={(event) => keyboardFocus(event) && !selected() && select()}
                    onKeyDown={(event) => onTabKeyDown(event, value(), close)}
                  >
                    <span class="side-panel-tab-label">{file().name}</span>
                  </Tabs.Trigger>
                </div>
              );
            }}
          </For>
        </Tabs.List>
        <div class="side-panel-actions no-drag">
          <Show when={hasTabs() && (newBrowserTab() !== undefined || closedPanes().length > 0)}>
            <DropdownMenu.Root placement="bottom-end" gutter={4}>
              <DropdownMenu.Trigger
                class={buttonVariants({ variant: "ghost", size: "icon-sm" })}
                aria-label={t("conversation.sidePanel.add")}
                title={t("conversation.sidePanel.add")}
              >
                <Plus aria-hidden="true" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content>
                  <Show when={newBrowserTab() !== undefined}>
                    <DropdownMenu.Item class="side-panel-menu-item" onSelectAfterClose={() => newBrowserTab()?.()}>
                      <Plus aria-hidden="true" />
                      {t("browser.newTab")}
                    </DropdownMenu.Item>
                    <Show when={closedPanes().length > 0}>
                      <DropdownMenu.Separator />
                    </Show>
                  </Show>
                  <For each={closedPanes()}>
                    {(pane) => (
                      <DropdownMenu.Item class="side-panel-menu-item" onSelectAfterClose={() => props.onSelect(pane)}>
                        <PaneIcon pane={pane} />
                        {paneLabel(pane)}
                      </DropdownMenu.Item>
                    )}
                  </For>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </Show>
          <Show when={hasTabs()}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t(props.maximized ? "conversation.sidePanel.restore" : "conversation.sidePanel.maximize")}
              title={t(props.maximized ? "conversation.sidePanel.restore" : "conversation.sidePanel.maximize")}
              aria-pressed={props.maximized ? "true" : "false"}
              onClick={() => props.onToggleMaximized()}
            >
              <Show when={props.maximized} fallback={<Maximize2 aria-hidden="true" />}>
                <Minimize2 aria-hidden="true" />
              </Show>
            </Button>
          </Show>
          {/* A maximized panel covers the chat header and its panel button, so Collapse takes its place. */}
          <Show when={props.maximized}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("conversation.sidePanel.close")}
              title={t("conversation.sidePanel.close")}
              onClick={() => props.onCollapse()}
            >
              <PanelRight aria-hidden="true" />
            </Button>
          </Show>
        </div>
      </Tabs.Root>
      <Show when={carriedHere()}>
        <div class="side-panel-drop" aria-hidden="true">
          <span>{t("conversation.threads.toSide")}</span>
        </div>
      </Show>
      <ThreadTabGhost from="side" />
    </>
  );
}

/**
 * With no open pane, the side panel lists the panes it can open. When the last tab closes, the focus
 * goes with it, so the first pane button takes the focus.
 */
export function SidePanelLauncher(props: {
  available: readonly SidePanelPane[];
  /** As in `SidePanelHeader`. */
  settingsLabel?: string | undefined;
  onOpen: (pane: SidePanelPane) => void;
}) {
  const { t } = useText();
  let launcher: HTMLElement | undefined;
  onSettled(() => {
    if (document.activeElement === null || document.activeElement === document.body)
      launcher?.querySelector<HTMLElement>("button")?.focus();
  });
  return (
    <nav ref={launcher} class="side-panel-launcher" aria-label={t("conversation.sidePanel.launcher")}>
      <For each={props.available}>
        {(pane) => (
          <Button variant="secondary" class="side-panel-launch" onClick={() => props.onOpen(pane)}>
            <PaneIcon pane={pane} />
            {t("conversation.sidePanel.openPane", {
              name:
                pane === "settings" && props.settingsLabel !== undefined ? props.settingsLabel : t(PANE_LABELS[pane]),
            })}
          </Button>
        )}
      </For>
    </nav>
  );
}
