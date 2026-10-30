import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  Archive,
  ArrowRightToLine,
  CircleX,
  ContextMenu,
  Input,
  PanelRight,
  PencilLine,
  SlidingTabs,
  Trash2,
  X,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, For, flush, onSettled, Show } from "solid-js";
import { ThreadStatusText, ThreadTabIcon, threadAttention } from "./ThreadStatusMark";
import { ThreadTabGhost } from "./ThreadTabGhost";
import { setCarriedThreadTab, sidePanelTabRow, swallowNextClick } from "./thread-tab-drag";
import { MAIN_THREAD_ID, type ThreadHeaderProps, type ThreadItem, threadBusy } from "./thread-types";

/** The width of the soft edge where more tabs are out of view, as in the CSS. */
const FADE = 24;
/** A tab starts to move after the pointer moves this far, so a click stays a click. */
const DRAG_START = 4;
/** While a tab moves near an end of the tabs, the tabs scroll. */
const DRAG_EDGE = 40;
const DRAG_SCROLL_MAX = 12;
/** The actions with which Kobalte selects a tab. */
const CHOICE_EVENTS = ["pointerdown", "click", "keydown"];
/** For this time after the field opens, focus that leaves it comes back. */
const RENAME_FOCUS_GUARD = 400;
/** The steps of the model picker, from the full picker to its icon. Each step gives the tabs more room. */
const MODEL_FIT = ["full", "short", "icon"] as const;

/** A tab whose title the user edits, and where its field shows over the title of the tab. */
interface Rename {
  id: string;
  title: string;
  left: number;
  width: number;
}

/** A tab that the pointer holds. */
interface TabDrag {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  startScroll: number;
  /** The pointer now. */
  x: number;
  /** False until the pointer moves past `DRAG_START`. */
  moving: boolean;
  /** The pointer is over the side panel, so a drop opens the thread there. */
  away: boolean;
  /** The place of the tab when the pointer lets it go. */
  target: number;
  frame: number;
}

/** A side thread that the user can rename, when the host can rename threads. */
function renamable(props: ThreadHeaderProps, thread: ThreadItem | undefined): boolean {
  return thread?.kind === "side" && props.onRename !== undefined;
}

function ThreadTab(props: {
  thread: ThreadItem;
  /** The right-click menu of this tab is open. */
  menuOpen: boolean;
  onClose: () => void;
  onMove: (step: -1 | 1) => void;
  onRename: () => void;
  /** The user edits the title of this tab. */
  renaming: boolean;
}) {
  const { t } = useText();
  // The close control and dragging are for the pointer. A keyboard user closes the focused tab with
  // Delete, moves it with Alt+Shift+Left or Right, and renames it with F2, because a tab list can
  // hold only tabs. Shift+F10 opens the tab menu.
  const stop = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const menuMark = () => (props.menuOpen ? "" : undefined);
  const renameMark = () => (props.renaming ? "" : undefined);
  // The slot closes the tab only for a press that started on it outside a rename. A press that ends a
  // rename can end on the slot, because the slot takes the pointer again when the rename ends.
  let closePressed = false;
  const closeLabel = () => t("conversation.threads.closeTab");
  return (
    <SlidingTabs.Trigger
      value={props.thread.id}
      class="agent-threads-tab no-drag"
      data-thread-id={props.thread.id}
      data-attention={threadAttention(props.thread.status)}
      data-menu-open={menuMark()}
      data-renaming={renameMark()}
      title={props.thread.title}
      onDblClick={(event: MouseEvent) => {
        if (event.target instanceof Element && event.target.closest(".agent-threads-tab-close")) return;
        props.onRename();
      }}
      onAuxClick={(event: MouseEvent) => {
        if (event.button === 1) props.onClose();
      }}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          props.onClose();
        } else if (event.key === "F2") {
          event.preventDefault();
          props.onRename();
        } else if (event.altKey && event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
          // The tab list must not also move the selection.
          stop(event);
          props.onMove(event.key === "ArrowLeft" ? -1 : 1);
        }
      }}
    >
      {/* As in a side panel tab, the icon slot shows the thread's state and is also the close control. */}
      <span
        class="agent-threads-tab-close"
        aria-hidden="true"
        title={closeLabel()}
        onPointerDown={(event) => {
          stop(event);
          closePressed = !props.renaming;
        }}
        onMouseDown={stop}
        onClick={(event) => {
          stop(event);
          if (closePressed) props.onClose();
          closePressed = false;
        }}
      >
        <span class="agent-threads-tab-icon">
          <ThreadTabIcon status={props.thread.status} />
        </span>
        <X class="agent-threads-tab-x" />
      </span>
      <span class="agent-threads-tab-title">{props.thread.title}</span>
      <ThreadStatusText status={props.thread.status} />
    </SlidingTabs.Trigger>
  );
}

/**
 * The open threads as tabs. The selection fill is measured here, not by Kobalte: Kobalte measures it
 * only when the selected tab changes, so a tab that opens, closes or gets its title moves the tabs
 * under a fill that stays in place.
 */
export function ThreadTabs(props: ThreadHeaderProps) {
  const { t } = useText();
  let list: HTMLDivElement | undefined;
  let area: HTMLDivElement | undefined;
  /** The tab of the last right-click. It stays after the menu closes, for the action that closed it. */
  const [menuTarget, setMenuTarget] = createSignal<string | null>(null);
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [renaming, setRenaming] = createSignal<Rename | null>(null);
  /** When the field opened. The app can move focus to the composer just after a tab opens. */
  let renameAt = Number.NEGATIVE_INFINITY;
  const [fill, setFill] = createSignal({ x: 0, width: 0 });
  const [ready, setReady] = createSignal(false);
  /** The tab that the pointer moves, and how far it is from its place. */
  const [dragged, setDragged] = createSignal<{ id: string; x: number } | null>(null);
  /** The fill moves with the selected tab while the pointer moves it. */
  const fillX = () => {
    const drag = dragged();
    return drag?.id === props.activeId ? fill().x + drag.x : fill().x;
  };
  const fillStyle = () => `transform: translateX(${fillX()}px); width: ${fill().width}px;`;
  let move: (id: string, step: -1 | 1) => void = () => {};
  /**
   * Kobalte selects the first tab while the open tab is not in its list yet, which is the case for a
   * tab that opens as it is added. So only a pointer or key action on the tabs opens another tab.
   */
  let choosing = false;
  const initializing = () => (ready() ? undefined : "");

  onSettled(() => {
    const element = list;
    if (!element) return;
    let drag: TabDrag | null = null;
    const edges = () => {
      const max = element.scrollWidth - element.clientWidth;
      element.toggleAttribute("data-more-before", element.scrollLeft > 1);
      element.toggleAttribute("data-more-after", element.scrollLeft < max - 1);
    };
    const header = element.closest<HTMLElement>(".conversation-header");
    // When the tabs do not fit, the model picker in the header gets smaller first: without the effort,
    // then as its icon. It gets larger again when the tabs still fit after the change. Each step is
    // measured at its end size with the transitions off. Then the picker slides to the new step.
    let step = 0;
    let sliding = false;
    let disposed = false;
    // Tabs that are narrower than their full width also need room, so the picker gets smaller before them.
    const overflows = () => {
      if (element.scrollWidth - element.clientWidth > 1) return true;
      const tab = element.querySelector<HTMLElement>(".agent-threads-tab");
      return (
        tab !== null && tab.getBoundingClientRect().width < Number.parseFloat(getComputedStyle(tab).maxWidth) - 0.5
      );
    };
    const show = (next: number) => {
      step = next;
      if (!header) return;
      if (next === 0) delete header.dataset.modelFit;
      else header.dataset.modelFit = MODEL_FIT[next];
    };
    const fitting = () => {
      while (step < MODEL_FIT.length - 1 && overflows()) show(step + 1);
      if (overflows()) return step;
      while (step > 0) {
        const current = step;
        show(current - 1);
        if (!overflows()) continue;
        show(current);
        break;
      }
      return step;
    };
    const fitPicker = () => {
      // While the picker slides, its width is not final. The tabs measure again after the slide.
      if (!header || sliding) return;
      const from = step;
      header.toggleAttribute("data-model-measure", true);
      const to = fitting();
      show(from);
      header.getBoundingClientRect();
      header.removeAttribute("data-model-measure");
      if (to === from) return;
      header.getBoundingClientRect();
      show(to);
      header.getBoundingClientRect();
      sliding = true;
      const slides = header.querySelector(".provider-model-trigger")?.getAnimations({ subtree: true }) ?? [];
      void Promise.allSettled(slides.map((slide) => slide.finished)).then(() => {
        sliding = false;
        if (!disposed) measure();
      });
    };
    const measure = () => {
      fitPicker();
      const tab = element.querySelector<HTMLElement>('.agent-threads-tab[aria-selected="true"]');
      // The agent's own chat has no tab: while it is open, no tab is selected and the fill hides.
      if (!tab) {
        setFill((current) => ({ x: current.x, width: 0 }));
        return;
      }
      setFill({ x: tab.offsetLeft, width: tab.offsetWidth });
      // While a tab moves, the pointer scrolls the tabs.
      if (drag?.moving) return;
      // Only the tabs scroll. `scrollIntoView` also scrolls the app panels.
      // The margin is as wide as the soft edge, so the selected tab stays clear of it.
      const start = tab.offsetLeft - FADE;
      const end = tab.offsetLeft + tab.offsetWidth + FADE - element.clientWidth;
      if (start < element.scrollLeft) element.scrollLeft = start;
      else if (end > element.scrollLeft) element.scrollLeft = end;
      edges();
    };
    let keyAt = Number.NEGATIVE_INFINITY;
    const focusSelected = () => element.querySelector<HTMLElement>('.agent-threads-tab[aria-selected="true"]')?.focus();
    const resize = new ResizeObserver(measure);
    resize.observe(element);
    if (header) resize.observe(header);
    const observeTabs = () => {
      for (const tab of element.querySelectorAll(".agent-threads-tab")) resize.observe(tab);
    };
    const changes = new MutationObserver(() => {
      observeTabs();
      measure();
      // Delete removes the focused tab. Focus goes to the tab that opens in its place.
      if (document.activeElement === document.body && performance.now() - keyAt < 500) focusSelected();
    });
    changes.observe(element, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-selected"] });
    observeTabs();
    measure();
    const frame = requestAnimationFrame(() => setReady(true));

    // The app moves focus to the composer when the chat changes. After an arrow key or Delete on the
    // tabs, focus stays on the tabs, so the next key also works.
    const onKey = (event: KeyboardEvent) => {
      keyAt = event.key === "Tab" ? Number.NEGATIVE_INFINITY : performance.now();
    };
    const keepFocus = (event: FocusEvent) => {
      if (performance.now() - keyAt > 500) return;
      if (event.target instanceof Node && element.contains(event.target)) return;
      if (event.target instanceof Element && event.target.closest(".agent-threads-rename")) return;
      focusSelected();
    };
    const onPointer = () => {
      keyAt = Number.NEGATIVE_INFINITY;
    };
    const tabElements = () => [...element.querySelectorAll<HTMLElement>(".agent-threads-tab")];

    /** Puts a tab in a new place. Each tab slides from where it shows now to its new place. */
    const reorder = (id: string, index: number) => {
      const focused = document.activeElement;
      const before = new Map(tabElements().map((tab) => [tab, tab.getBoundingClientRect().left]));
      for (const tab of before.keys()) {
        tab.style.transition = "none";
        tab.style.transform = "";
      }
      setDragged(null);
      props.onMove(id, index);
      flush();
      measure();
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
      if (focused instanceof HTMLElement && focused !== document.activeElement) focused.focus();
    };
    move = (id, step) => {
      const ids = tabElements().map((tab) => tab.dataset.threadId);
      const index = ids.indexOf(id) + step;
      if (index >= 0 && index < ids.length) reorder(id, index);
    };

    /** Moves the dragged tab with the pointer. The other tabs make room where it will go. */
    const follow = (current: TabDrag) => {
      const items = tabElements().map((tab) => ({ tab, left: tab.offsetLeft, width: tab.offsetWidth }));
      const index = items.findIndex((item) => item.tab.dataset.threadId === current.id);
      const self = items[index];
      const first = items[0];
      const last = items.at(-1);
      if (!self || !first || !last) return;
      const offset = Math.min(
        Math.max(current.x - current.startX + element.scrollLeft - current.startScroll, first.left - self.left),
        last.left + last.width - self.left - self.width,
      );
      const center = self.left + self.width / 2 + offset;
      // At the end of the row the center of the dragged tab can only reach the center of the last tab,
      // so a tab after it is passed at the same center too.
      current.target = items.filter((item, i) => {
        const itemCenter = item.left + item.width / 2;
        return i < index ? itemCenter < center : i > index && itemCenter <= center;
      }).length;
      const room = self.width + Number.parseFloat(getComputedStyle(element).columnGap || "0");
      items.forEach((item, i) => {
        if (i === index) {
          item.tab.style.transform = `translateX(${offset}px)`;
          return;
        }
        const shift = i > index && i <= current.target ? -room : i < index && i >= current.target ? room : 0;
        item.tab.style.transform = shift === 0 ? "" : `translateX(${shift}px)`;
      });
      setDragged({ id: current.id, x: offset });
    };
    /** Over the side panel, the tab leaves the tabs. A copy of it follows the pointer there. */
    const carryAway = (current: TabDrag, y: number) => {
      const thread = props.tabs.find((item) => item.id === current.id);
      const row = sidePanelTabRow(element);
      const away =
        thread?.kind === "side" &&
        props.onMoveToSide !== undefined &&
        row !== null &&
        current.x >= row.getBoundingClientRect().left;
      if (away !== current.away) {
        current.away = away;
        const tab = element.querySelector<HTMLElement>(`[data-thread-id="${CSS.escape(current.id)}"]`);
        tab?.setAttribute("data-dragged", away ? "away" : "");
        if (away) {
          for (const item of tabElements()) item.style.transform = "";
          setDragged(null);
        }
      }
      setCarriedThreadTab(away && thread ? { thread, from: "chat", x: current.x, y } : null);
      return away;
    };
    const autoScroll = () => {
      const current = drag;
      if (!current?.moving) return;
      if (current.away) {
        current.frame = requestAnimationFrame(autoScroll);
        return;
      }
      const box = element.getBoundingClientRect();
      const speed =
        current.x < box.left + DRAG_EDGE
          ? -(box.left + DRAG_EDGE - current.x) / 3
          : current.x > box.right - DRAG_EDGE
            ? (current.x - box.right + DRAG_EDGE) / 3
            : 0;
      if (speed !== 0) {
        element.scrollLeft += Math.max(-DRAG_SCROLL_MAX, Math.min(DRAG_SCROLL_MAX, speed));
        follow(current);
      }
      current.frame = requestAnimationFrame(autoScroll);
    };
    const onDragMove = (event: PointerEvent) => {
      const current = drag;
      if (!current || event.pointerId !== current.pointerId) return;
      current.x = event.clientX;
      if (!current.moving) {
        if (Math.hypot(current.x - current.startX, event.clientY - current.startY) < DRAG_START) return;
        current.moving = true;
        element.setAttribute("data-dragging", "");
        element.querySelector(`[data-thread-id="${CSS.escape(current.id)}"]`)?.setAttribute("data-dragged", "");
        current.frame = requestAnimationFrame(autoScroll);
      }
      if (!carryAway(current, event.clientY)) follow(current);
    };
    const onDragEnd = (event: PointerEvent) => {
      const current = drag;
      if (!current || event.pointerId !== current.pointerId) return;
      drag = null;
      window.removeEventListener("pointermove", onDragMove);
      window.removeEventListener("pointerup", onDragEnd);
      window.removeEventListener("pointercancel", onDragEnd);
      if (!current.moving) return;
      cancelAnimationFrame(current.frame);
      element.removeAttribute("data-dragging");
      element.querySelector("[data-dragged]")?.removeAttribute("data-dragged");
      setCarriedThreadTab(null);
      swallowNextClick();
      if (current.away && event.type !== "pointercancel") {
        setDragged(null);
        props.onMoveToSide?.(current.id);
        return;
      }
      reorder(
        current.id,
        event.type === "pointercancel"
          ? tabElements().findIndex((tab) => tab.dataset.threadId === current.id)
          : current.target,
      );
    };
    const onDragStart = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary || drag) return;
      if (!(event.target instanceof Element) || event.target.closest(".agent-threads-tab-close")) return;
      const id = event.target.closest<HTMLElement>(".agent-threads-tab")?.dataset.threadId;
      // One tab can still move to the side panel.
      if (!id || (tabElements().length < 2 && !props.onMoveToSide)) return;
      drag = {
        id,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startScroll: element.scrollLeft,
        x: event.clientX,
        moving: false,
        away: false,
        target: 0,
        frame: 0,
      };
      window.addEventListener("pointermove", onDragMove);
      window.addEventListener("pointerup", onDragEnd);
      window.addEventListener("pointercancel", onDragEnd);
    };

    /** A mouse wheel scrolls the tabs sideways. A trackpad already scrolls them. */
    const onWheel = (event: WheelEvent) => {
      if (element.scrollWidth <= element.clientWidth) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      element.scrollLeft += event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;
    };

    // Kobalte answers the action at the document, so the action ends at the window.
    const endChoice = () => {
      choosing = false;
    };
    // A tab control that stops the event, such as close or move, keeps it from the window: the
    // timer ends the action after the event in that case.
    const choose = (event: Event) => {
      choosing = true;
      window.addEventListener(event.type, endChoice, { once: true });
      setTimeout(endChoice);
    };
    for (const type of CHOICE_EVENTS) element.addEventListener(type, choose, { capture: true });
    element.addEventListener("keydown", onKey);
    element.addEventListener("scroll", edges, { passive: true });
    element.addEventListener("pointerdown", onDragStart);
    element.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("focusin", keepFocus);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      changes.disconnect();
      for (const type of CHOICE_EVENTS) {
        element.removeEventListener(type, choose, { capture: true });
        window.removeEventListener(type, endChoice);
      }
      element.removeEventListener("keydown", onKey);
      element.removeEventListener("scroll", edges);
      element.removeEventListener("pointerdown", onDragStart);
      element.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointermove", onDragMove);
      window.removeEventListener("pointerup", onDragEnd);
      window.removeEventListener("pointercancel", onDragEnd);
      if (drag) cancelAnimationFrame(drag.frame);
      if (drag?.away) setCarriedThreadTab(null);
      disposed = true;
      show(0);
      document.removeEventListener("focusin", keepFocus);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  });

  const tabOf = (id: string) =>
    list?.querySelector<HTMLElement>(`.agent-threads-tab[data-thread-id="${CSS.escape(id)}"]`);
  const threadOf = (id: string | null) => props.tabs.find((thread) => thread.id === id);

  /**
   * Edits the title in the tab: a text field without a frame takes the place of the title, from its
   * start to the end of the tab, so the icon stays and the tab keeps its size. A tab that is partly out
   * of view scrolls into view first.
   */
  const startRename = (id: string) => {
    const tab = tabOf(id);
    const thread = threadOf(id);
    const title = tab?.querySelector(".agent-threads-tab-title");
    if (!tab || !title || !area || !thread || !renamable(props, thread)) return;
    tab.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    const box = tab.getBoundingClientRect();
    const start = title.getBoundingClientRect().left;
    const end = box.right - (Number.parseFloat(getComputedStyle(tab).paddingRight) || 0);
    renameAt = performance.now();
    setRenaming({ id, title: thread.title, width: end - start, left: start - area.getBoundingClientRect().left });
  };
  /** Keeps a title that is not empty. Enter and Escape put focus back on the tab. */
  const finishRename = (value: string | null, refocus: boolean) => {
    const edit = renaming();
    if (!edit) return;
    setRenaming(null);
    const title = value?.trim();
    if (title && title !== edit.title) props.onRename?.(edit.id, title);
    if (refocus) requestAnimationFrame(() => tabOf(edit.id)?.focus());
  };
  const isRenaming = (id: string) => renaming()?.id === id;
  const renameStyle = (edit: Rename) => `left: ${edit.left}px; width: ${edit.width}px;`;

  /** A right-click outside a tab opens no menu. */
  const pickTarget = (event: MouseEvent) => {
    const id =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(".agent-threads-tab")?.dataset.threadId
        : undefined;
    if (!id) {
      event.preventDefault();
      return;
    }
    setMenuTarget(id);
  };
  /** A long press opens the menu on touch screens. */
  const pickTouchTarget = (event: PointerEvent) => {
    if (event.pointerType === "mouse" || !(event.target instanceof Element)) return;
    const id = event.target.closest<HTMLElement>(".agent-threads-tab")?.dataset.threadId;
    if (id) setMenuTarget(id);
  };
  const target = () => threadOf(menuTarget()) ?? threadOf(props.activeId);
  const targetId = () => target()?.id ?? props.activeId;
  const targetIndex = () => props.tabs.findIndex((thread) => thread.id === targetId());
  const hasOthers = () => props.tabs.some((thread) => thread.id !== targetId());
  const hasTabsToTheRight = () => targetIndex() < props.tabs.length - 1;
  const isSide = () => target()?.kind === "side";
  const targetBusy = () => {
    const thread = target();
    return thread ? threadBusy(thread.status) : false;
  };
  const canRename = () => renamable(props, target());
  const canDelete = () => isSide() && props.onDelete !== undefined;
  const canMoveToSide = () => isSide() && props.onMoveToSide !== undefined;
  const isMenuTarget = (id: string) => menuOpen() && menuTarget() === id;
  const openChosen = (id: string) => {
    if (choosing) props.onOpen(id);
  };
  /** The last tab leaves with the tab list. Focus then goes to the agent's name, which opens the agent's chat. */
  const closeTab = (id: string) => {
    const heading = area?.closest(".conversation-heading-group");
    props.onClose(id);
    requestAnimationFrame(() => {
      if (area?.isConnected || document.activeElement !== document.body) return;
      heading?.querySelector<HTMLElement>(".conversation-title")?.focus();
    });
  };

  return (
    <div ref={area} class="agent-threads-tabs-area">
      <ContextMenu.Root onOpenChange={setMenuOpen}>
        <ContextMenu.Trigger
          class="agent-threads-tabs-trigger"
          onContextMenu={pickTarget}
          onPointerDown={pickTouchTarget}
        >
          <SlidingTabs.Root class="agent-threads-tabs-root" value={props.activeId} onChange={openChosen}>
            <SlidingTabs.List ref={list} class="agent-threads-tabs" aria-label={t("conversation.threads.open")}>
              <span
                class="ui-sliding-tabs-pill agent-threads-fill"
                aria-hidden="true"
                data-initializing={initializing()}
                style={fillStyle()}
              />
              {/*
                The agent's own chat has no tab, but Kobalte selects the first tab while the selected value
                is not one of its triggers. This trigger never shows, so the agent's chat stays selected.
              */}
              <SlidingTabs.Trigger
                value={MAIN_THREAD_ID}
                class="agent-threads-main-key"
                disabled
                tabindex={-1}
                aria-hidden="true"
              />
              {/* Keyed by id, so a tab keeps its element, focus and drag when its title or state changes. */}
              <For each={props.tabs} keyed={(thread) => thread.id}>
                {(thread) => (
                  <ThreadTab
                    thread={thread()}
                    menuOpen={isMenuTarget(thread().id)}
                    onClose={() => closeTab(thread().id)}
                    onMove={(step) => move(thread().id, step)}
                    onRename={() => startRename(thread().id)}
                    renaming={isRenaming(thread().id)}
                  />
                )}
              </For>
            </SlidingTabs.List>
          </SlidingTabs.Root>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content class="agent-threads-tab-menu" aria-label={t("conversation.threads.actions")}>
            <Show when={canRename()}>
              <ContextMenu.Item onSelectAfterClose={() => startRename(targetId())}>
                <PencilLine class="agent-context-icon size-4" aria-hidden="true" />
                <span>{t("common.rename")}</span>
              </ContextMenu.Item>
              <ContextMenu.Separator />
            </Show>
            <Show when={canMoveToSide()}>
              <ContextMenu.Item onSelect={() => props.onMoveToSide?.(targetId())}>
                <PanelRight class="agent-context-icon size-4" aria-hidden="true" />
                <span>{t("conversation.threads.toSide")}</span>
              </ContextMenu.Item>
              <ContextMenu.Separator />
            </Show>
            <ContextMenu.Item onSelect={() => props.onClose(targetId())}>
              <X class="agent-context-icon size-4" aria-hidden="true" />
              <span>{t("conversation.threads.closeTab")}</span>
            </ContextMenu.Item>
            <ContextMenu.Item disabled={!hasOthers()} onSelect={() => props.onCloseOthers(targetId())}>
              <CircleX class="agent-context-icon size-4" aria-hidden="true" />
              <span>{t("conversation.threads.closeOthers")}</span>
            </ContextMenu.Item>
            <ContextMenu.Item disabled={!hasTabsToTheRight()} onSelect={() => props.onCloseToTheRight(targetId())}>
              <ArrowRightToLine class="agent-context-icon size-4" aria-hidden="true" />
              <span>{t("conversation.threads.closeRight")}</span>
            </ContextMenu.Item>
            {/*
              The agent's own chat and a new thread have no archive or delete. A running thread stops first.
              The archive of a delete cancels the queued messages, and Undo cannot bring them back, so a
              queued thread has no delete.
            */}
            <Show when={isSide()}>
              <ContextMenu.Separator />
              <ContextMenu.Item disabled={targetBusy()} onSelect={() => props.onArchive(targetId())}>
                <Archive class="agent-context-icon size-4" aria-hidden="true" />
                <span>{t("conversation.threads.archive")}</span>
              </ContextMenu.Item>
              <Show when={canDelete()}>
                <ContextMenu.Item
                  class="ui-action-menu-danger"
                  disabled={targetBusy() || target()?.status.kind === "queued"}
                  onSelect={() => props.onDelete?.(targetId())}
                >
                  <Trash2 class="agent-context-icon size-4" aria-hidden="true" />
                  <span>{t("common.delete")}</span>
                </ContextMenu.Item>
              </Show>
            </Show>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      <ThreadTabGhost from="chat" />
      <Show when={renaming()}>
        {(edit) => (
          <Input
            ref={(field: HTMLInputElement) =>
              requestAnimationFrame(() => {
                field.focus();
                field.select();
              })
            }
            class="agent-threads-rename"
            size="sm"
            aria-label={t("conversation.threads.name")}
            maxlength={INPUT_LIMITS.agentTaskTitle}
            defaultValue={edit().title}
            style={renameStyle(edit())}
            onKeyDown={(event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
              if (event.key === "Enter") {
                event.preventDefault();
                finishRename(event.currentTarget.value, true);
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                finishRename(null, true);
              }
            }}
            onBlur={(event: FocusEvent & { currentTarget: HTMLInputElement }) => {
              const field = event.currentTarget;
              if (performance.now() - renameAt < RENAME_FOCUS_GUARD) {
                requestAnimationFrame(() => field.focus());
                return;
              }
              finishRename(field.value, false);
            }}
          />
        )}
      </Show>
    </div>
  );
}
