import type { AppTextKey } from "@openbot/i18n";
import {
  Badge,
  Button,
  buttonVariants,
  ChevronDown,
  ContextMenu,
  DropdownMenu,
  Folder,
  Maximize2,
  MessageCircleQuestionMark,
  MessageSquare,
  MessagesSquare,
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
import { TabShape } from "@openbot/ui/features/conversation/TabShape";
import type { ThreadItem } from "@openbot/ui/features/conversation/threads/thread-types";
import { type TextValue, useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createSignal, For, flush, onSettled, Show, untrack } from "solid-js";
import { createTabRow } from "../../components/createTabRow";
import { ThreadStatusText, ThreadTabIcon, threadAttention } from "./threads/ThreadStatusMark";
import { ThreadTabGhost } from "./threads/ThreadTabGhost";
import { carriedThreadTab, setCarriedThreadTab, swallowNextClick } from "./threads/thread-tab-drag";

const DRAG_START = 4;
const THREAD_VALUE = "thread:";
const FILE_VALUE = "file:";

function fileValue(key: string): string {
  return `${FILE_VALUE}${encodeURIComponent(key)}`;
}

const SIDE_PANEL_PANES = {
  browser: { label: "conversation.sidePanel.pane.browser", icon: () => <ComputerIcon /> },
  files: { label: "conversation.sidePanel.pane.files", icon: () => <Folder aria-hidden="true" /> },
  threads: { label: "conversation.sidePanel.pane.threads", icon: () => <MessagesSquare aria-hidden="true" /> },
  settings: { label: "conversation.sidePanel.pane.settings", icon: () => <Settings aria-hidden="true" /> },
  question: {
    label: "conversation.sidePanel.pane.question",
    icon: () => <MessageCircleQuestionMark aria-hidden="true" />,
  },
  subagent: { label: "conversation.sidePanel.pane.subagent", icon: () => <Workflow aria-hidden="true" /> },
} as const satisfies Record<string, { label: AppTextKey; icon: () => JSX.Element }>;

export type SidePanelPane = keyof typeof SIDE_PANEL_PANES;

export function isSidePanelPane(value: string): value is SidePanelPane {
  return Object.hasOwn(SIDE_PANEL_PANES, value);
}

function inPaneOrder(available: readonly SidePanelPane[]): SidePanelPane[] {
  return Object.keys(SIDE_PANEL_PANES)
    .filter(isSidePanelPane)
    .filter((pane) => available.includes(pane));
}

function PaneIcon(props: { pane: SidePanelPane }): JSX.Element {
  return SIDE_PANEL_PANES[props.pane].icon();
}

function PaneBadge(props: { badge: SidePanelPaneBadge | undefined }) {
  return (
    <Show when={props.badge}>
      {(badge) => (
        <>
          <Badge variant="warning-light" class="side-panel-tab-count" aria-hidden="true">
            {badge().count}
          </Badge>
          <span class="sr-only">{badge().label}</span>
        </>
      )}
    </Show>
  );
}

function FileTabIcon(props: { file: SidePanelFileTab }): JSX.Element {
  return (
    <Show
      when={props.file.folder}
      fallback={
        <span class="side-panel-file-badge" data-file-tone={attachmentReferenceTone(props.file.name)}>
          <AttachmentReferenceVisual name={props.file.name} />
        </span>
      }
    >
      <Folder aria-hidden="true" />
    </Show>
  );
}

function paneLabel(t: TextValue["t"], pane: SidePanelPane, settingsLabel: string | undefined): string {
  return pane === "settings" && settingsLabel !== undefined ? settingsLabel : t(SIDE_PANEL_PANES[pane].label);
}

export interface SidePanelToggleProps {
  open: boolean;
  actingAgentName?: string | undefined;
  onToggle: () => void;
}

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

export interface SidePanelPaneBadge {
  count: number;
  label: string;
}

export interface SidePanelHeaderProps {
  panes: readonly SidePanelPane[];
  selected: SidePanelPane | null;
  available: readonly SidePanelPane[];
  badges?: Partial<Record<SidePanelPane, SidePanelPaneBadge>> | undefined;
  maximized: boolean;
  settingsLabel?: string | undefined;
  onSelect: (pane: SidePanelPane) => void;
  onClose: (pane: SidePanelPane) => void;
  onToggleMaximized: () => void;
  onCollapse: () => void;
  onNewBrowserTab?: (() => void) | undefined;
  threads?: SidePanelThreads | undefined;
  files?: SidePanelFiles | undefined;
}

export interface SidePanelFileTab {
  key: string;
  name: string;
  folder: boolean;
  unavailable?: boolean | undefined;
}

export interface SidePanelFiles {
  items: readonly SidePanelFileTab[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  onMove: (key: string, index: number) => void;
}

export interface SidePanelThreads {
  items: readonly ThreadItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onMove: (id: string, index: number) => void;
  onToChat: (id: string) => void;
}

interface TabHold {
  group: TabGroup;
  id: string;
  thread: ThreadItem | null;
  pointerId: number;
  startX: number;
  startY: number;
  startScroll: number;
  x: number;
  frame: number;
  moving: boolean;
  away: boolean;
  target: number;
  rightToLeft: boolean;
}

const TAB_GROUPS = {
  thread: { selector: ":scope > .side-panel-thread-tab", id: (tab: HTMLElement) => tab.dataset.threadId },
  file: { selector: ":scope > .side-panel-file-tab", id: (tab: HTMLElement) => tab.dataset.fileKey },
} as const;
type TabGroup = keyof typeof TAB_GROUPS;

interface TabEntry {
  value: string;
  label: string;
  icon: () => JSX.Element;
  select: () => void;
}

type MenuTab = { pane: SidePanelPane } | { thread: string } | { file: string };

function tabAt(target: EventTarget | null): MenuTab | null {
  const tab = target instanceof Element ? target.closest<HTMLElement>(".side-panel-tab") : null;
  const pane = tab?.dataset.value;
  if (pane && isSidePanelPane(pane)) return { pane };
  if (tab?.dataset.threadId) return { thread: tab.dataset.threadId };
  if (tab?.dataset.fileKey) return { file: tab.dataset.fileKey };
  return null;
}

export function SidePanelHeader(props: SidePanelHeaderProps) {
  const { t } = useText();
  const [menuTab, setMenuTab] = createSignal<MenuTab | null>(null);
  let menuReturn: { focus: Element | null; header: Element | null } | undefined;
  const pick = (event: Event) => {
    const tab = tabAt(event.target);
    setMenuTab(tab);
    menuReturn = {
      focus: document.activeElement,
      header: event.target instanceof Element ? event.target.closest(".side-panel-header") : null,
    };
    return tab;
  };
  const pickMenuTab = (event: MouseEvent) => {
    if (!pick(event)) event.preventDefault();
  };
  const pickTouchMenuTab = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") pick(event);
  };
  const liveMenuTab = () => {
    const tab = menuTab();
    if (!tab) return null;
    if ("pane" in tab) return props.panes.includes(tab.pane) ? tab : null;
    if ("thread" in tab) return props.threads?.items.some((item) => item.id === tab.thread) ? tab : null;
    return props.files?.items.some((item) => item.key === tab.file) ? tab : null;
  };
  const menuThread = () => {
    const tab = liveMenuTab();
    return tab && "thread" in tab ? tab.thread : undefined;
  };
  const closeMenuTab = () => {
    const tab = liveMenuTab();
    if (!tab) return;
    if ("pane" in tab) props.onClose(tab.pane);
    else if ("thread" in tab) props.threads?.onClose(tab.thread);
    else props.files?.onClose(tab.file);
  };
  const returnFocus = (event: Event) => {
    const back = menuReturn?.focus?.isConnected
      ? menuReturn.focus
      : menuReturn?.header?.querySelector(".side-panel-tab[data-selected] .side-panel-tab-select");
    if (!(back instanceof HTMLElement)) return;
    event.preventDefault();
    back.focus();
  };
  return (
    <ContextMenu.Root>
      <SidePanelTabRow {...props} onTabMenu={pickMenuTab} onTabMenuPress={pickTouchMenuTab} />
      <ContextMenu.Portal>
        <ContextMenu.Content aria-label={t("conversation.sidePanel.tabActions")} onCloseAutoFocus={returnFocus}>
          <Show when={menuThread()}>
            {(thread) => (
              <>
                <ContextMenu.Item class="side-panel-menu-item" onSelect={() => props.threads?.onToChat(thread())}>
                  <MessageSquare aria-hidden="true" />
                  {t("conversation.threads.toChat")}
                </ContextMenu.Item>
                <ContextMenu.Separator />
              </>
            )}
          </Show>
          <Show when={liveMenuTab()}>
            <ContextMenu.Item class="side-panel-menu-item" onSelect={closeMenuTab}>
              <X aria-hidden="true" />
              {t("conversation.threads.closeTab")}
            </ContextMenu.Item>
          </Show>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function SidePanelTabRow(
  props: SidePanelHeaderProps & {
    onTabMenu: (event: MouseEvent) => void;
    onTabMenuPress: (event: PointerEvent) => void;
  },
) {
  const { t } = useText();
  let root: HTMLDivElement | undefined;
  let tabList: HTMLDivElement | undefined;
  const closedPanes = () => inPaneOrder(props.available).filter((pane) => !props.panes.includes(pane));
  const threads = () => props.threads?.items ?? [];
  const files = () => props.files?.items ?? [];
  const hasTabs = () => props.panes.length + threads().length + files().length > 0;
  const newBrowserTab = () =>
    props.panes.includes("browser") && props.available.includes("browser") ? props.onNewBrowserTab : undefined;
  const labelOf = (pane: SidePanelPane) => paneLabel(t, pane, props.settingsLabel);
  const selectedValue = () => {
    const thread = props.threads?.selectedId;
    if (thread) return `${THREAD_VALUE}${thread}`;
    const file = props.files?.selectedKey;
    if (file) return fileValue(file);
    return props.selected ?? "__none";
  };
  const tabValues = () => [
    ...props.panes,
    ...threads().map((thread) => `${THREAD_VALUE}${thread.id}`),
    ...files().map((file) => fileValue(file.key)),
  ];
  const onTabKeyDown = (event: KeyboardEvent, value: string, close: () => void) => {
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    event.preventDefault();
    const index = tabValues().indexOf(value);
    flush(close);
    const values = tabValues();
    const next = values[Math.min(index, values.length - 1)];
    if (next) tabList?.querySelector<HTMLElement>(`[data-key="${CSS.escape(next)}"]`)?.focus();
  };
  const tabRow = createTabRow({
    list: () => tabList,
    tabs: (list) => [...list.querySelectorAll<HTMLElement>(":scope > .side-panel-tab")],
    key: (tab) => tab.dataset.value ?? "",
  });
  const row = tabRow.row;
  createEffect(createMemo(selectedValue), (value) => tabRow.reveal(value));
  createEffect(
    createMemo(() => row.hidden.length > 0),
    () => tabRow.reveal(untrack(selectedValue)),
  );
  createEffect(
    () => tabValues().join(),
    () => tabRow.measure(),
  );
  const keepFocus = (event: MouseEvent) => event.preventDefault();
  const closeWithPointer = (value: string, close: () => void) => {
    tabRow.freeze(value);
    close();
  };
  const entries = (): TabEntry[] => [
    ...props.panes.map((pane) => ({
      value: pane,
      label: labelOf(pane),
      icon: () => <PaneIcon pane={pane} />,
      select: () => props.onSelect(pane),
    })),
    ...threads().map((thread) => ({
      value: `${THREAD_VALUE}${thread.id}`,
      label: thread.title,
      icon: () => <ThreadTabIcon status={thread.status} unread={thread.unread} />,
      select: () => props.threads?.onSelect(thread.id),
    })),
    ...files().map((file) => ({
      value: fileValue(file.key),
      label: file.name,
      icon: () => <FileTabIcon file={file} />,
      select: () => props.files?.onSelect(file.key),
    })),
  ];
  const hiddenEntries = () => entries().filter((entry) => row.hidden.includes(entry.value));
  const carriedHere = () => carriedThreadTab()?.from === "chat";
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
    const overChat = (x: number, rightToLeft: boolean) => {
      if (props.maximized || root === undefined) return false;
      const bounds = root.getBoundingClientRect();
      return rightToLeft ? x > bounds.right : x < bounds.left;
    };
    const follow = (current: TabHold) => {
      const tabId = TAB_GROUPS[current.group].id;
      const items = groupTabs(current.group).map((tab) => ({ tab, left: tab.offsetLeft, width: tab.offsetWidth }));
      const index = items.findIndex((item) => tabId(item.tab) === current.id);
      const self = items[index];
      const first = items[0];
      const last = items.at(-1);
      if (!self || !first || !last) return;
      const offset = Math.min(
        Math.max(current.x - current.startX + element.scrollLeft - current.startScroll, first.left - self.left),
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
      element.getBoundingClientRect();
      for (const tab of before.keys()) {
        tab.style.transition = "";
        tab.style.transform = "";
      }
    };
    const edgeScroll = () => {
      const current = hold;
      if (!current?.moving) return;
      if (!current.away) {
        tabRow.scrollAtEdge(current.x);
        follow(current);
      }
      current.frame = requestAnimationFrame(edgeScroll);
    };
    const onMove = (event: PointerEvent) => {
      const current = hold;
      if (!current || event.pointerId !== current.pointerId) return;
      current.x = event.clientX;
      if (!current.moving) {
        if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < DRAG_START) return;
        current.moving = true;
        element.setAttribute("data-dragging", "");
        current.frame = requestAnimationFrame(edgeScroll);
      }
      current.away = overChat(event.clientX, current.rightToLeft);
      tabOf(current)?.setAttribute("data-dragged", current.away ? "away" : "");
      if (current.away) {
        clearShifts(current.group);
        if (current.thread) {
          setCarriedThreadTab({ thread: current.thread, from: "side", x: event.clientX, y: event.clientY });
        }
      } else {
        if (current.thread) setCarriedThreadTab(null);
        follow(current);
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
      cancelAnimationFrame(current.frame);
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
        startScroll: element.scrollLeft,
        x: event.clientX,
        frame: 0,
        moving: false,
        away: false,
        target: 0,
        rightToLeft: root !== undefined && getComputedStyle(root).direction === "rtl",
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
    };
    const unbind = tabRow.bind(element);
    element.addEventListener("pointerdown", onStart);
    return () => {
      unbind();
      element.removeEventListener("pointerdown", onStart);
      stop();
      if (hold) cancelAnimationFrame(hold.frame);
      if (hold?.moving && hold.thread) setCarriedThreadTab(null);
    };
  });

  return (
    <>
      <Tabs.Root
        as={ContextMenu.Trigger}
        ref={root}
        class="window-drag side-panel-header"
        value={selectedValue()}
        activationMode="automatic"
        onContextMenu={props.onTabMenu}
        onPointerDown={props.onTabMenuPress}
      >
        <Tabs.List
          ref={tabList}
          class="side-panel-tabs"
          aria-label={t("conversation.sidePanel.label")}
          data-frozen={row.frozen ? "" : undefined}
          data-fade-start={row.fadeStart ? "" : undefined}
          data-fade-end={row.fadeEnd ? "" : undefined}
          style={row.frozen ? { "--side-panel-tab-frozen": `${row.frozen}px` } : undefined}
          onPointerLeave={tabRow.unfreeze}
        >
          <For each={props.panes}>
            {(pane) => {
              const label = () => labelOf(pane);
              const selected = () =>
                props.threads?.selectedId == null && props.files?.selectedKey == null && props.selected === pane;
              const close = () => props.onClose(pane);
              return (
                <div
                  role="presentation"
                  class="side-panel-tab no-drag"
                  data-value={pane}
                  data-selected={selected() ? "true" : undefined}
                >
                  <Tabs.Trigger
                    as="button"
                    type="button"
                    value={pane}
                    class={buttonVariants({ variant: "ghost", class: "side-panel-tab-select" })}
                    aria-keyshortcuts="Delete"
                    title={label()}
                    onClick={() => props.onSelect(pane)}
                    onAuxClick={(event: MouseEvent) => {
                      if (event.button === 1) closeWithPointer(pane, close);
                    }}
                    onFocus={(event) => keyboardFocus(event) && !selected() && props.onSelect(pane)}
                    onKeyDown={(event) => onTabKeyDown(event, pane, close)}
                  >
                    <span class="side-panel-tab-label">{label()}</span>
                    <PaneBadge badge={props.badges?.[pane]} />
                  </Tabs.Trigger>
                  <Button
                    variant="ghost"
                    type="button"
                    class="side-panel-tab-close"
                    tabindex={-1}
                    aria-hidden="true"
                    onMouseDown={keepFocus}
                    title={t("conversation.sidePanel.closePane", { name: label() })}
                    onClick={() => closeWithPointer(pane, close)}
                  >
                    <span class="side-panel-tab-icon">
                      <PaneIcon pane={pane} />
                    </span>
                    <X class="side-panel-tab-x" aria-hidden="true" />
                  </Button>
                </div>
              );
            }}
          </For>
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
                  data-value={value()}
                  data-thread-id={thread().id}
                  data-attention={threadAttention(thread().status)}
                  data-selected={selected() ? "true" : undefined}
                >
                  <Tabs.Trigger
                    as="button"
                    type="button"
                    value={value()}
                    class={buttonVariants({ variant: "ghost", class: "side-panel-tab-select" })}
                    aria-keyshortcuts="Delete"
                    title={thread().title}
                    onClick={select}
                    onAuxClick={(event: MouseEvent) => {
                      if (event.button === 1) closeWithPointer(value(), close);
                    }}
                    onFocus={(event) => keyboardFocus(event) && !selected() && select()}
                    onKeyDown={(event) => onTabKeyDown(event, value(), close)}
                  >
                    <span class="side-panel-tab-label">{thread().title}</span>
                    <ThreadStatusText status={thread().status} unread={thread().unread} />
                  </Tabs.Trigger>
                  <Button
                    variant="ghost"
                    type="button"
                    class="side-panel-tab-close"
                    tabindex={-1}
                    aria-hidden="true"
                    onMouseDown={keepFocus}
                    title={t("conversation.threads.closeTab")}
                    onClick={() => closeWithPointer(value(), close)}
                  >
                    <span class="side-panel-tab-icon">
                      <ThreadTabIcon status={thread().status} unread={thread().unread} />
                    </span>
                    <X class="side-panel-tab-x" aria-hidden="true" />
                  </Button>
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
                  data-value={value()}
                  data-file-key={file().key}
                  data-selected={selected() ? "true" : undefined}
                  data-unavailable={file().unavailable ? "true" : undefined}
                >
                  <Tabs.Trigger
                    as="button"
                    type="button"
                    value={value()}
                    class={buttonVariants({ variant: "ghost", class: "side-panel-tab-select" })}
                    aria-keyshortcuts="Delete"
                    title={file().name}
                    onClick={select}
                    onAuxClick={(event: MouseEvent) => {
                      if (event.button === 1) closeWithPointer(value(), close);
                    }}
                    onFocus={(event) => keyboardFocus(event) && !selected() && select()}
                    onKeyDown={(event) => onTabKeyDown(event, value(), close)}
                  >
                    <span class="side-panel-tab-label">{file().name}</span>
                  </Tabs.Trigger>
                  <Button
                    variant="ghost"
                    type="button"
                    class="side-panel-tab-close"
                    tabindex={-1}
                    aria-hidden="true"
                    onMouseDown={keepFocus}
                    title={t("conversation.sidePanel.closePane", { name: file().name })}
                    onClick={() => closeWithPointer(value(), close)}
                  >
                    <span class="side-panel-tab-icon">
                      <FileTabIcon file={file()} />
                    </span>
                    <X class="side-panel-tab-x" aria-hidden="true" />
                  </Button>
                </div>
              );
            }}
          </For>
        </Tabs.List>
        <div class="side-panel-actions no-drag">
          <Show when={row.hidden.length > 0}>
            <DropdownMenu.Root modal={false} placement="bottom-end" gutter={4}>
              <DropdownMenu.Trigger
                class={buttonVariants({ variant: "ghost", size: "icon-sm" })}
                aria-label={t("browser.tabs.more", { count: row.hidden.length })}
                title={t("browser.tabs.showHidden")}
              >
                <ChevronDown aria-hidden="true" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content class="side-panel-hidden-tabs">
                  <For each={hiddenEntries()} keyed={(entry) => entry.value}>
                    {(entry) => (
                      <DropdownMenu.Item
                        class="side-panel-menu-item"
                        aria-current={selectedValue() === entry().value ? "true" : undefined}
                        onSelect={() => {
                          entry().select();
                          tabRow.reveal(entry().value);
                        }}
                      >
                        <span class="side-panel-hidden-tab-icon">{entry().icon()}</span>
                        <span>{entry().label}</span>
                      </DropdownMenu.Item>
                    )}
                  </For>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </Show>
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
                        {labelOf(pane)}
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
        <Show when={hasTabs()}>
          <TabShape
            selected=".side-panel-tab[data-selected]"
            sized=".side-panel-tabs, .side-panel-tab"
            scroller=".side-panel-tabs"
          />
        </Show>
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

export function SidePanelLauncher(props: {
  available: readonly SidePanelPane[];
  badges?: Partial<Record<SidePanelPane, SidePanelPaneBadge>> | undefined;
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
      <For each={inPaneOrder(props.available)}>
        {(pane) => (
          <Button variant="secondary" class="side-panel-launch" onClick={() => props.onOpen(pane)}>
            <PaneIcon pane={pane} />
            {t("conversation.sidePanel.openPane", { name: paneLabel(t, pane, props.settingsLabel) })}
            <PaneBadge badge={props.badges?.[pane]} />
          </Button>
        )}
      </For>
    </nav>
  );
}
