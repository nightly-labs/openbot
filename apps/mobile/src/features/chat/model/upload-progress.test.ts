import { expect, it } from "vitest";
import { uploadProgressAt } from "./upload-progress";

it("gives files before the current one full progress and files after it none", () => {
  expect([0, 1, 2, 3].map((index) => uploadProgressAt(index, 1, 0.4))).toEqual([1, 0.4, 0, 0]);
  expect(uploadProgressAt(0, 0, 1.3)).toBe(1);
});
