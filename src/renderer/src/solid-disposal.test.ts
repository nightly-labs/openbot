import { createMemo, createRenderEffect, createRoot, createSignal, flush, mapArray, onCleanup } from "@solidjs/signals";
import { describe, expect, it } from "vitest";

// Guards patches/@solidjs%2Fsignals@2.0.0-rc.0.patch. Without it, a keyed row
// removed in the same flush in which its memo re-ran keeps the children of the
// memo's previous run: their cleanups never run and they stay queued, holding
// the removed message DOM for the life of the window.
describe("Solid disposal of a removed list row", () => {
  it("runs the cleanups of a memo run that the row's removal interrupted", () => {
    const [flag, setFlag] = createSignal(0);
    const [items, setItems] = createSignal([1, 2, 3]);
    let cleanups = 0;
    const dispose = createRoot((disposeRoot) => {
      // The list reaches the map through memos, so the map runs after the rows'
      // own memos in a flush, as a chat timeline does.
      const list = createMemo(() => items());
      const visibleList = createMemo(() => list());
      const rows = mapArray(visibleList, () =>
        createMemo(() => {
          onCleanup(() => {
            cleanups += 1;
          });
          return createMemo(() => flag() % 2 === 0, { sync: true })();
        }),
      );
      createRenderEffect(
        () => rows().map((row) => row()),
        () => undefined,
      );
      return disposeRoot;
    });
    flush();

    setFlag(1);
    setItems([2, 3, 4]);
    flush();

    // Rows 2 and 3 re-ran once. Row 1 re-ran and was then removed, so both of its runs end.
    expect(cleanups).toBe(4);
    dispose();
  });
});
