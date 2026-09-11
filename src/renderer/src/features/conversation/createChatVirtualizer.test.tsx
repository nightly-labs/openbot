import { render, screen, waitFor } from "@solidjs/testing-library";
import { createMemo, createSignal, For } from "solid-js";
import { describe, expect, it } from "vitest";
import { chatHistoryBoundaryReached, createChatVirtualizer } from "./createChatVirtualizer";

describe("chat virtualizer", () => {
  it("renders an appended row without entering a refresh loop", async () => {
    let appendMessage: (() => void) | undefined;

    function TestList() {
      const [messageIds, setMessageIds] = createSignal(["message-0"]);
      appendMessage = () => setMessageIds((current) => [...current, "message-1"]);
      const virtualizer = createChatVirtualizer<HTMLDivElement, HTMLDivElement>({
        count: () => messageIds().length,
        getScrollElement: () => null,
        estimateSize: () => 128,
        getItemKey: (index) => messageIds()[index] ?? index,
        keyVersion: () => messageIds().join(":"),
        scrollMargin: () => 0,
      });
      const rows = createMemo(() => virtualizer.getVirtualItems());

      return (
        <For each={rows()}>{(row) => <output aria-label={`dynamic row ${row.index}`}>{String(row.key)}</output>}</For>
      );
    }

    render(() => <TestList />);
    expect(screen.getByRole("status", { name: "dynamic row 0" })).toHaveTextContent("message-0");

    appendMessage?.();

    await waitFor(() => expect(screen.getByRole("status", { name: "dynamic row 1" })).toHaveTextContent("message-1"));
  });

  /*
   * The transcript of a running chat is short against its viewport, so the virtualizer renders row
   * 0 even when the reader sits at the newest message. The row index alone would then ask for the
   * next older page under a reply that is still arriving, and each page moves the transcript.
   */
  it("reports the history boundary only where the reader is at the top of the transcript", () => {
    const scrollElement = document.createElement("div");
    const scrollTo = (scrollTop: number) => {
      Object.defineProperty(scrollElement, "scrollTop", { configurable: true, value: scrollTop });
      return scrollElement;
    };

    expect(chatHistoryBoundaryReached(scrollTo(194), 0)).toBe(false);
    expect(chatHistoryBoundaryReached(scrollTo(0), 0)).toBe(true);
    expect(chatHistoryBoundaryReached(scrollTo(80), 5)).toBe(true);
    expect(chatHistoryBoundaryReached(scrollTo(0), 6)).toBe(false);
    expect(chatHistoryBoundaryReached(undefined, 0)).toBe(false);
  });
});
