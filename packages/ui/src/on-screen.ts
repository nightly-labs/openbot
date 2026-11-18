// One observer for all elements: a sidebar can hold a hundred agents, each with an avatar and a badge.
const onScreenListeners = new WeakMap<Element, (onScreen: boolean) => void>();
let onScreenObserver: IntersectionObserver | undefined;

/**
 * Tells `onChange` when `element` enters or leaves the screen. A row scrolled out of its list is off
 * screen too: the observer counts the clip of each scrolling ancestor. Without an observer, the element
 * counts as on screen. Returns the function that stops the observation.
 */
export function observeOnScreen(element: Element, onChange: (onScreen: boolean) => void): () => void {
  if (typeof IntersectionObserver === "undefined") return () => {};
  onScreenObserver ??= new IntersectionObserver((entries) => {
    for (const entry of entries) onScreenListeners.get(entry.target)?.(entry.isIntersecting);
  });
  onScreenListeners.set(element, onChange);
  onScreenObserver.observe(element);
  return () => {
    onScreenObserver?.unobserve(element);
    onScreenListeners.delete(element);
  };
}
