import { createEffect, createSignal, onSettled } from "solid-js";

const WRAPPED_SURFACE_HEIGHT_PX = 39;

type ComposerResizeInput = {
  full: () => boolean;
  empty: () => boolean;
  conversationKey: () => string;
};

export function createComposerResize(input: ComposerResizeInput) {
  const [wrappedIn, setWrappedIn] = createSignal<ReadonlySet<string>>(new Set());
  let composer: HTMLElement | undefined;
  let paintedHeight = 0;
  let paintedWrapHeight = 0;

  const wrapped = () => wrappedIn().has(input.conversationKey());
  const expanded = () => input.full() || wrapped();

  let measureFrame: number | undefined;

  function finishResize(): void {
    if (measureFrame !== undefined) cancelAnimationFrame(measureFrame);
    measureFrame = undefined;
    if (!composer) return;
    composer.style.removeProperty("height");
    delete composer.dataset.resizing;
  }

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
    element.getBoundingClientRect();
    element.style.height = `${to}px`;
  }

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
      if (readWrap()) return;
      for (const entry of entries) {
        const height = entry.borderBoxSize[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
        if (entry.target === element) paintedHeight = height;
        else paintedWrapHeight = height;
      }
    });
    observer.observe(element);
    if (wrap) observer.observe(wrap);
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
