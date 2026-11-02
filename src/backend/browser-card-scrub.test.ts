// @vitest-environment node

import type { BrowserElement, BrowserSnapshot } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { CardValueScrub } from "./browser-cdp-snapshot";

// A test card number. It is not a real account.
const NUMBER = "4242424242424242";
const SECURITY_CODE = "737";

function element(ref: string, name: string, value: string | null): BrowserElement {
  return {
    ref,
    role: "textbox",
    name,
    description: "",
    tag: "input",
    value,
    states: [],
    disabled: false,
    bounds: null,
    frame: { id: "frame-1", url: "https://payments.example.test/card" },
  };
}

function snapshot(text: string, elements: BrowserElement[]): BrowserSnapshot {
  return {
    tabId: "tab-1",
    revision: 737,
    title: "Checkout",
    url: "https://shop.example.test/checkout",
    loading: false,
    viewport: { mode: "fill", width: 1280, height: 800, deviceScaleFactor: 1, preset: "desktop" },
    text,
    elements,
    truncated: false,
    focus: null,
    diagnostics: [],
    actions: [],
  };
}

function filled(): CardValueScrub {
  const scrub = new CardValueScrub();
  scrub.add(NUMBER, SECURITY_CODE);
  return scrub;
}

describe("CardValueScrub", () => {
  it("hides the raw and grouped card number and keeps the last four digits", () => {
    const scrub = filled();
    for (const shown of [NUMBER, "4242 4242 4242 4242", "4242-4242-4242-4242", "4242.4242.4242.4242"])
      expect(scrub.text(`Card ${shown} saved`)).toBe("Card •••• 4242 saved");
  });

  it("hides the security code only as a whole number", () => {
    const scrub = filled();
    expect(scrub.text("CVC 737")).toBe("CVC •••");
    expect(scrub.text("Order 17370, port 7370, code 1737")).toBe("Order 17370, port 7370, code 1737");
  });

  it("keeps the number hidden and lets the security code go when the document is replaced", () => {
    const scrub = filled();
    scrub.endDocument();
    expect(scrub.text(`${NUMBER} 737`)).toBe("•••• 4242 737");
  });

  it("reports a value that names a filled card value", () => {
    const scrub = new CardValueScrub();
    expect(scrub.reveals(NUMBER)).toBe(false);
    scrub.add(NUMBER, SECURITY_CODE);
    expect(scrub.reveals("4242 4242 4242 4242")).toBe(true);
    expect(scrub.reveals("737")).toBe(true);
    expect(scrub.reveals("Pay now")).toBe(false);
  });

  it("hides card values in every snapshot string and keeps numbers", () => {
    const raw = snapshot(`Card number ${NUMBER} Security code ${SECURITY_CODE}`, [
      element("e1", "Card number", "4242 4242 4242 4242"),
      element("e2", `Security code ${SECURITY_CODE}`, SECURITY_CODE),
    ]);
    const scrubbed = filled().snapshot(raw);
    const serialized = JSON.stringify(scrubbed);
    expect(serialized).not.toMatch(/4242[\s.-]*4242[\s.-]*4242/u);
    expect(serialized).not.toContain('"737"');
    expect(scrubbed.text).toBe("Card number •••• 4242 Security code •••");
    expect(scrubbed.elements.map((entry) => entry.value)).toEqual(["•••• 4242", "•••"]);
    expect(scrubbed.revision).toBe(737);
    expect(raw.elements[0]?.value).toBe("4242 4242 4242 4242");
  });

  it("returns the snapshot unchanged before a card is filled", () => {
    const raw = snapshot(NUMBER, []);
    expect(new CardValueScrub().snapshot(raw)).toBe(raw);
  });
});
