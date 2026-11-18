import { createEffect, createSignal, onSettled } from "solid-js";

/**
 * The one-line composer text wraps when the editor surface is taller than this: one 20px line and its
 * 8px padding are 28px, two lines are 48px. Grok Bot opens its composer at the same point (39px).
 */
const WRAPPED_SURFACE_HEIGHT_PX = 39;

type ComposerResizeInput = {
  /** A new line or an attachment opens the full composer. */
  full: () => boolean;
  empty: () => boolean;
  /** A different chat shows its own draft at once, with no animation. */
  conversationKey: () => string;
};

/**
 * The composer opens from one line to its full layout when the text wraps, and stays open until the
 * draft is empty, as Grok Bot's does. Between the two layouts its height moves on Grok Bot's 300ms
 * curve. A line added in the full layout changes the height at once, so typing never waits for it.
 */
export function createComposerResize(input: ComposerResizeInput) {
  /** The chats whose draft wrapped. A wrap belongs to one draft, so a chat keeps its own layout. */
  const [wrappedIn, setWrappedIn] = createSignal<ReadonlySet<string>>(new Set());
  let composer: HTMLElement | undefined;
  /** The border-box heights of the last frame. A change of layout starts from them. */
  let paintedHeight = 0;
  let paintedWrapHeight = 0;

  const wrapped = () => wrappedIn().has(input.conversationKey());
  const expanded = () => input.full() || wrapped();

  /** The frame that reads the end height of a resize. */
  let measureFrame: number | undefined;

  function finishResize(): void {
    if (measureFrame !== undefined) cancelAnimationFrame(measureFrame);
    measureFrame = undefined;
    if (!composer) return;
    composer.style.removeProperty("height");
    delete composer.dataset.resizing;
  }

  /**
   * The composer keeps its painted height now, and reads its end height before the next paint. A send
   * empties the draft before the editor removes its text, so a height read now would include the sent
   * lines, and the composer would stop at that height and then fall to one line in one frame.
   */
  function resize(): void {
    const element = composer;
    if (!element?.isConnected || paintedHeight <= 0) return;
    const from = paintedHeight;
    element.style.height = `${from}px`;
    element.dataset.resizing = "";
    if (measureFrame !== undefined) cancelAnimationFrame(measureFrame);
    measureFrame = requestAnimationFrame(() => {
      measureFrame = undefined;
      animateTo(element, from);
    });
  }

  /**
   * An edit that removes text can make the composer shorter. The browser lays out the edit before the
   * draft changes, and a chat that becomes taller for that moment loses its place at the bottom for
   * good. The composer keeps its painted height until the next frame, or until the change of layout
   * starts a resize.
   */
  function holdHeight(event: InputEvent): void {
    const element = composer;
    if (!element || paintedHeight <= 0 || measureFrame !== undefined || element.dataset.resizing !== undefined) return;
    const removes = !event.inputType.startsWith("insert") || !element.ownerDocument.getSelection()?.isCollapsed;
    if (!removes) return;
    element.style.height = `${paintedHeight}px`;
    measureFrame = requestAnimationFrame(() => {
      measureFrame = undefined;
      finishResize();
    });
  }

  function animateTo(element: HTMLElement, from: number): void {
    if (!element.isConnected) return;
    // The wrap keeps its painted height while the end height is read. A shorter wrap for one layout
    // would make the chat taller, and the browser would lower the chat's scroll position for good.
    const wrap = element.closest<HTMLElement>(".composer-wrap");
    if (wrap && paintedWrapHeight > 0) wrap.style.height = `${paintedWrapHeight}px`;
    element.style.removeProperty("height");
    const to = element.getBoundingClientRect().height;
    element.style.height = `${from}px`;
    wrap?.style.removeProperty("height");
    if (Math.abs(to - from) < 1) {
      finishResize();
      return;
    }
    // The start height must be in the layout before the end height, or nothing moves.
    element.getBoundingClientRect();
    element.style.height = `${to}px`;
  }

  /** A wrap in the one-line layout opens the composer before the browser paints the taller line. */
  function readWrap(): boolean {
    if (!composer || expanded() || input.empty()) return false;
    const surface = composer.querySelector(".composer-editor-surface");
    if (!surface || surface.scrollHeight < WRAPPED_SURFACE_HEIGHT_PX) return false;
    const key = input.conversationKey();
    setWrappedIn((keys) => new Set(keys).add(key));
    return true;
  }

  createEffect(
    () => ({ empty: input.empty(), conversation: input.conversationKey() }),
    ({ empty, conversation }) => {
      if (!empty || !wrappedIn().has(conversation)) return;
      setWrappedIn((keys) => {
        const next = new Set(keys);
        next.delete(conversation);
        return next;
      });
    },
  );

  let shownConversation: string | undefined;
  let shownExpanded: boolean | undefined;
  createEffect(
    () => ({ open: expanded(), conversation: input.conversationKey() }),
    ({ open, conversation }) => {
      const sameConversation = shownConversation === conversation;
      const changed = shownExpanded !== undefined && shownExpanded !== open;
      shownConversation = conversation;
      shownExpanded = open;
      if (!changed) return;
      if (sameConversation) resize();
      else finishResize();
    },
  );

  onSettled(() => {
    const element = composer;
    if (!element) return;
    const wrap = element.closest<HTMLElement>(".composer-wrap");
    const observer = new ResizeObserver((entries) => {
      // The wrapped one-line layout is never painted: the full layout replaces it in this frame.
      if (readWrap()) return;
      for (const entry of entries) {
        const height = entry.borderBoxSize[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
        if (entry.target === element) paintedHeight = height;
        else paintedWrapHeight = height;
      }
    });
    observer.observe(element);
    if (wrap) observer.observe(wrap);
    // A transition that a hidden pane cancels also ends the resize, or the fixed height clips new lines.
    const transitionEnd = (event: TransitionEvent) => {
      if (event.target === element && event.propertyName === "height") finishResize();
    };
    element.addEventListener("transitionend", transitionEnd);
    element.addEventListener("transitioncancel", transitionEnd);
    element.addEventListener("beforeinput", holdHeight, true);
    return () => {
      if (measureFrame !== undefined) cancelAnimationFrame(measureFrame);
      observer.disconnect();
      element.removeEventListener("beforeinput", holdHeight, true);
      element.removeEventListener("transitionend", transitionEnd);
      element.removeEventListener("transitioncancel", transitionEnd);
    };
  });

  return {
    expanded,
    ref(element: HTMLElement) {
      composer = element;
    },
  };
}
