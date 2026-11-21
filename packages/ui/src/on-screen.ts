const onScreenListeners = new WeakMap<Element, (onScreen: boolean) => void>();
let onScreenObserver: IntersectionObserver | undefined;

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
