/*
 * Chromium shows the keyboard focus ring when a script moves focus away from an element that had
 * the ring, and it counts the first script focus on a page as keyboard focus. Kobalte moves focus
 * from script when a select, menu, popover or dialog opens and closes, so a mouse click can end
 * with the ring on the button the person clicked. After a pointer press, a script focus call that
 * does not set `focusVisible` asks for no ring. The next key press brings the default back, so a
 * menu closed with Escape or Enter still returns the ring to its trigger.
 */

const MODIFIER_KEYS = new Set(["Alt", "AltGraph", "Control", "Meta", "Shift"]);
// Chromium always shows the ring in a text field, and the caret needs it. Script focus there keeps it.
const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

const installed = new WeakMap<object, () => void>();

function takesText(element: HTMLElement): boolean {
  if (element instanceof HTMLTextAreaElement || element.isContentEditable) return true;
  return element instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(element.type);
}

/** Installs the guard once per window and returns the function that removes it. */
export function installPointerFocusGuard(doc: Document = document): () => void {
  const view = doc.defaultView;
  if (!view) return () => {};
  const prototype = view.HTMLElement.prototype;
  const existing = installed.get(prototype);
  if (existing) return existing;

  let pointer = false;
  const onPointerDown = () => {
    pointer = true;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || MODIFIER_KEYS.has(event.key)) return;
    pointer = false;
  };

  // Test tools such as Storybook's can own `focus` as a getter, so the guard replaces the property.
  const nativeDescriptor = Object.getOwnPropertyDescriptor(prototype, "focus");
  const nativeFocus = prototype.focus;
  function focus(this: HTMLElement, options?: FocusOptions) {
    if (!pointer || options?.focusVisible !== undefined || takesText(this)) {
      nativeFocus.call(this, options);
      return;
    }
    nativeFocus.call(this, { ...options, focusVisible: false });
  }

  Object.defineProperty(prototype, "focus", { configurable: true, writable: true, value: focus });
  doc.addEventListener("pointerdown", onPointerDown, true);
  doc.addEventListener("keydown", onKeyDown, true);

  const uninstall = () => {
    if (prototype.focus === focus && nativeDescriptor) Object.defineProperty(prototype, "focus", nativeDescriptor);
    doc.removeEventListener("pointerdown", onPointerDown, true);
    doc.removeEventListener("keydown", onKeyDown, true);
    installed.delete(prototype);
  };
  installed.set(prototype, uninstall);
  return uninstall;
}
