import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { MessageSelectionActions } from "./SelectionActions";

function renderWithSelection() {
  render(() => (
    <>
      <p class="message-copy" data-selection-message-id="m1">
        Copy this text
      </p>
      <MessageSelectionActions contextKey="k" disabled={false} onSend={vi.fn(async () => true)} />
    </>
  ));
  const block = document.querySelector("[data-selection-message-id]");
  if (!block) throw new Error("The message text block is missing.");
  const range = document.createRange();
  range.selectNodeContents(block);
  const selection = window.getSelection();
  if (!selection) throw new Error("The document has no selection.");
  selection.removeAllRanges();
  selection.addRange(range);
}

describe("MessageSelectionActions pointer dismissal", () => {
  it("keeps the selection and its toolbar on right-click", async () => {
    renderWithSelection();
    await fireEvent.pointerUp(document.body);
    expect(await screen.findByRole("button", { name: "Explain" })).toBeInTheDocument();
    // The native context menu reads the live selection, so dismissing here would clear the text
    // before Copy ever sees it.
    await fireEvent.pointerDown(document.body, { button: 2 });
    expect(screen.getByRole("button", { name: "Explain" })).toBeInTheDocument();
    expect(window.getSelection()?.toString()).toContain("Copy this text");
  });

  it("dismisses the selection and its toolbar on primary click", async () => {
    renderWithSelection();
    await fireEvent.pointerUp(document.body);
    expect(await screen.findByRole("button", { name: "Explain" })).toBeInTheDocument();
    await fireEvent.pointerDown(document.body, { button: 0 });
    expect(screen.queryByRole("button", { name: "Explain" })).not.toBeInTheDocument();
  });
});
