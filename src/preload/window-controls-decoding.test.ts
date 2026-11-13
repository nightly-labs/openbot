import { describe, expect, it } from "vitest";
import { decodeWindowControlsState } from "./window-controls-decoding";

const state = { maximized: true, fullScreen: false };
describe("window state from main", () => {
  it("accepts a window state and keeps only its fields", () => {
    expect(decodeWindowControlsState({ ...state, extra: "ignored" })).toEqual(state);
  });
  it.each([{ ...state, maximized: "true" }, { ...state, fullScreen: 1 }, { maximized: true }, null, []])(
    "rejects malformed state %j",
    (value) => {
      expect(() => decodeWindowControlsState(value)).toThrow();
    },
  );
});
