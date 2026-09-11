import type { BrowserFormState, BrowserFormSubmission } from "@openbot/contracts/ipc";
import { decodeBrowserFormState } from "@openbot/contracts/ipc";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { browserTakeoverPage, type TakeoverPageCommand } from "./browser-takeover-page";

function run(command: TakeoverPageCommand): BrowserFormState {
  return decodeBrowserFormState(browserTakeoverPage(command));
}
function read() {
  return run({ kind: "read", revision: "revision-1" });
}
function submission(state: BrowserFormState, values: BrowserFormSubmission["values"]): TakeoverPageCommand {
  return {
    kind: "submit",
    input: {
      requestId: "request",
      agentId: "agent",
      threadId: "thread",
      tabId: "tab",
      revision: state.revision,
      formId: state.forms[0].id,
      actionId: state.forms[0].actions[0].id,
      values,
    },
  };
}
beforeEach(() => {
  document.body.innerHTML = `<form aria-label="Login"><label>Email<input name="email" type="email" required></label><label>Password<input name="password" type="password" required></label><button>Sign in</button></form>`;
  delete window.__openbotTakeoverForm;
  // jsdom has no layout. All fixture controls are visible unless explicitly hidden.
  const rects = [new DOMRect(0, 0, 100, 20)];
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue(
    Object.assign(rects, { item: (index: number) => rects[index] ?? null }),
  );
});

describe("browser takeover page", () => {
  it("submits directly to the page without returning entered secrets", () => {
    const state = read();
    const submit = vi.fn((event: Event) => event.preventDefault());
    window.document.forms[0].addEventListener("submit", submit);
    run(
      submission(state, [
        { id: "field-0", value: "user@example.com" },
        { id: "field-1", value: "private-password" },
      ]),
    );
    expect(submit).toHaveBeenCalledOnce();
    expect(window.document.querySelector<HTMLInputElement>("input[type=password]")?.value).toBe("private-password");
    expect(JSON.stringify(read())).not.toContain("private-password");
  });
  it("rejects changed forms and consumed revisions before another submit", () => {
    const state = read();
    const command = submission(state, [
      { id: "field-0", value: "user@example.com" },
      { id: "field-1", value: "secret" },
    ]);
    window.document.forms[0].action = "https://other.example.com";
    expect(() => run(command)).toThrow("The browser form changed");
    const submit = vi.fn((event: Event) => event.preventDefault());
    window.document.forms[0].addEventListener("submit", submit);
    const fresh = read();
    const next = submission(fresh, [
      { id: "field-0", value: "user@example.com" },
      { id: "field-1", value: "secret" },
    ]);
    run(next);
    expect(() => run(next)).toThrow("The browser form changed");
    expect(submit).toHaveBeenCalledOnce();
  });
  it("keeps invalid fields and unsupported controls in takeover", () => {
    const state = read();
    expect(
      run(
        submission(state, [
          { id: "field-0", value: "invalid" },
          { id: "field-1", value: "" },
        ]),
      ).status,
    ).toBe("invalid");
    window.document.body.innerHTML =
      '<form><input type="file"><button>Upload</button></form><iframe title="Verification"></iframe>';
    expect(read()).toMatchObject({ forms: [], status: "manual" });
  });
  it("maps standard controls and refreshes the next step", () => {
    window.document.body.innerHTML =
      '<form><textarea name="note"></textarea><select name="country"><option>Poland</option><option>France</option></select><input type="checkbox" name="agree"><input type="radio" name="plan" value="a"><input type="radio" name="plan" value="b"><input type="date" name="date"><button>Continue</button></form>';
    const state = read();
    const form = window.document.forms[0];
    form.querySelector("input[type=checkbox]")?.addEventListener("click", () => {
      const note = form.querySelector("textarea");
      if (note) note.value = "Checkbox event";
    });
    const values = [
      { id: "field-0", value: "Note" },
      { id: "field-1", value: ["option-1"] },
      { id: "field-2", value: true },
      { id: "field-3", value: false },
      { id: "field-4", value: true },
      { id: "field-5", value: "2026-09-11" },
    ];
    form.addEventListener("submit", (event) => event.preventDefault());
    run(submission(state, values));
    expect([...new window.FormData(form)]).toEqual([
      ["note", "Checkbox event"],
      ["country", "France"],
      ["agree", "on"],
      ["plan", "b"],
      ["date", "2026-09-11"],
    ]);
    window.document.body.innerHTML = '<form><label>Code<input name="code"></label><button>Verify</button></form>';
    expect(read().forms[0].fields[0].label).toBe("Code");
  });
  it("rejects replaced controls and extra values without filling the page", () => {
    const state = read();
    const command = submission(state, [
      { id: "field-0", value: "user@example.com" },
      { id: "field-1", value: "secret" },
      { id: "extra", value: "secret" },
    ]);
    expect(() => run(command)).toThrow("Invalid browser form submission");
    const input = window.document.querySelector("input");
    input?.replaceWith(input.cloneNode(true));
    expect(() => run(command)).toThrow("The browser form changed");
    expect(window.document.querySelector<HTMLInputElement>("input")?.value).toBe("");
  });
});
