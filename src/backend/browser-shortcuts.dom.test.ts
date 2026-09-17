// The script under test runs inside an embedded page, so it is exercised against a real DOM rather
// than a stub: closed shadow roots, `isContentEditable` and `activeElement` are the parts of the
// platform it depends on, and a stub would only restate the code.
import { afterEach, describe, expect, it } from "vitest";
import { EDITABLE_FOCUS_SCRIPT } from "./browser-shortcuts";

/**
 * Run the injected script the way the embedded page does, and answer the question the host asks of
 * it: does Escape leave the page and collapse the expanded browser? The host reads the result the
 * same way, and treats anything but a definite "not editable" as a reason to leave the key alone.
 */
const escapeCollapsesBrowser = (): boolean => new Function(`return ${EDITABLE_FOCUS_SCRIPT}`)() === false;

const mount = <T extends HTMLElement>(element: T): T => {
  document.body.append(element);
  return element;
};

describe("EDITABLE_FOCUS_SCRIPT", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("releases Escape when nothing editable has focus", () => {
    expect(escapeCollapsesBrowser()).toBe(true);
    const button = mount(document.createElement("button"));
    button.focus();
    expect(escapeCollapsesBrowser()).toBe(true);
  });

  it("keeps Escape in a text field or an editable region", () => {
    const field = mount(document.createElement("input"));
    field.focus();
    expect(escapeCollapsesBrowser()).toBe(false);

    const region = mount(document.createElement("div"));
    region.contentEditable = "true";
    region.focus();
    expect(escapeCollapsesBrowser()).toBe(false);
  });

  it("keeps Escape in a field inside an open shadow root", () => {
    const host = mount(document.createElement("my-editor"));
    const root = host.attachShadow({ mode: "open" });
    const field = document.createElement("input");
    root.append(field);
    field.focus();
    expect(escapeCollapsesBrowser()).toBe(false);
  });

  it("keeps Escape when a closed shadow root hides what has focus", () => {
    const host = mount(document.createElement("my-editor"));
    host.attachShadow({ mode: "closed" }).append(document.createElement("input"));
    host.tabIndex = 0;
    host.focus();
    // The page reports the host, and `host.shadowRoot` is null from outside, so the editor cannot be
    // seen. Unknown counts as editing: the user keeps the key they are typing with.
    expect(escapeCollapsesBrowser()).toBe(false);
  });

  it("releases Escape from a plain custom element with an open root", () => {
    const host = mount(document.createElement("my-card"));
    host.attachShadow({ mode: "open" }).append(document.createElement("p"));
    host.tabIndex = 0;
    host.focus();
    expect(escapeCollapsesBrowser()).toBe(true);
  });
});
