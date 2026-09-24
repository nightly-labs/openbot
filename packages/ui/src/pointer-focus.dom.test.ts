import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPointerFocusGuard } from "./pointer-focus";

const nativeFocus = HTMLElement.prototype.focus;

describe("installPointerFocusGuard", () => {
  let focus: ReturnType<typeof vi.fn<HTMLElement["focus"]>>;
  let uninstall: () => void;

  beforeEach(() => {
    // Stands in for the browser focus, so the test reads the options the guard passes on.
    focus = vi.fn<HTMLElement["focus"]>();
    HTMLElement.prototype.focus = focus;
    uninstall = installPointerFocusGuard();
  });

  afterEach(() => {
    uninstall();
    HTMLElement.prototype.focus = nativeFocus;
    document.body.replaceChildren();
  });

  function button() {
    const element = document.createElement("button");
    document.body.append(element);
    return element;
  }

  it("asks for no focus ring when a script moves focus after a pointer press", () => {
    const trigger = button();
    document.dispatchEvent(new PointerEvent("pointerdown"));
    trigger.focus({ preventScroll: true });
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true, focusVisible: false });
  });

  it("keeps the browser default after a key press", () => {
    const trigger = button();
    document.dispatchEvent(new PointerEvent("pointerdown"));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    trigger.focus();
    expect(focus).toHaveBeenLastCalledWith(undefined);
  });

  it("keeps pointer mode through a modifier key and a shortcut", () => {
    const trigger = button();
    document.dispatchEvent(new PointerEvent("pointerdown"));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta", metaKey: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "c", metaKey: true }));
    trigger.focus();
    expect(focus).toHaveBeenLastCalledWith({ focusVisible: false });
  });

  it("keeps the ring in text fields and when the caller sets it", () => {
    const field = document.createElement("input");
    document.body.append(field);
    const trigger = button();
    document.dispatchEvent(new PointerEvent("pointerdown"));
    field.focus();
    expect(focus).toHaveBeenLastCalledWith(undefined);
    trigger.focus({ focusVisible: true });
    expect(focus).toHaveBeenLastCalledWith({ focusVisible: true });
  });

  it("installs once and restores the native focus when removed", () => {
    expect(installPointerFocusGuard()).toBe(uninstall);
    uninstall();
    expect(HTMLElement.prototype.focus).toBe(focus);
  });
});
