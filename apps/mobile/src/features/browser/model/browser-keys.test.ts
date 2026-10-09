import { describe, expect, it } from "vitest";
import { textChangeInputs } from "./browser-keys";

// Failure mode: a deleted flag or joined emoji sends one Backspace for each code point, and the page
// deletes the characters before it too, which the user kept.

function backspaces(before: string, after: string): number {
  return textChangeInputs(before, after).filter((input) => input.type === "key" && input.action === "down").length;
}

describe("the phone keyboard on a page", () => {
  it("sends one Backspace for each character a reader sees", () => {
    expect(backspaces("ab🇵🇱", "ab")).toBe(1);
    expect(backspaces("a👩‍👩‍👧", "a")).toBe(1);
    expect(backspaces("abc", "a")).toBe(2);
  });
});
