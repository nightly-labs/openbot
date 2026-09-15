import type { Page } from "playwright-core";
import { describe, expect, it } from "vitest";
import { clickByRole, typeByRole } from "./tools";

function fakePage(calls: unknown[]): Page {
  return {
    getByRole: (role: string, options: { name: string; exact?: boolean }) => {
      calls.push([role, options]);
      return {
        click: async () => undefined,
        fill: async () => undefined,
        press: async () => undefined,
      };
    },
    // biome-ignore lint/nursery/noUnsafeTypeAssertion: fake implements only the locator surface under test.
  } as unknown as Page;
}

describe("exact role matching", () => {
  it("forwards --exact to the role locator on click", async () => {
    const calls: unknown[] = [];
    await clickByRole(fakePage(calls), "button", "Settings", 1000, true);
    expect(calls).toEqual([["button", { name: "Settings", exact: true }]]);
  });

  it("keeps substring matching unless --exact passes", async () => {
    const calls: unknown[] = [];
    await clickByRole(fakePage(calls), "button", "Settings", 1000);
    await typeByRole(fakePage(calls), "textbox", "Message", "hi", 1000, false);
    expect(calls).toEqual([
      ["button", { name: "Settings", exact: false }],
      ["textbox", { name: "Message", exact: false }],
    ]);
  });
});
