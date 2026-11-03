import { describe, expect, it } from "vitest";
import { agentSwitchIndex } from "./agent-switch-shortcut";

type Event = Parameters<typeof agentSwitchIndex>[0];

function event(init: Partial<Event> = {}, altGraph = false): Event {
  return {
    code: "Digit3",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    repeat: false,
    getModifierState: (name: string) => altGraph && name === "AltGraph",
    ...init,
  };
}

describe("agentSwitchIndex", () => {
  it("reads Cmd+Option+digit on macOS from event.code", () => {
    expect(agentSwitchIndex(event({ metaKey: true, altKey: true, code: "Digit1" }), true)).toBe(0);
    expect(agentSwitchIndex(event({ metaKey: true, altKey: true, code: "Digit9" }), true)).toBe(8);
  });

  it("reads Ctrl+Alt+digit elsewhere", () => {
    expect(agentSwitchIndex(event({ ctrlKey: true, altKey: true }), false)).toBe(2);
  });

  it("does not take the other platform's modifier", () => {
    expect(agentSwitchIndex(event({ ctrlKey: true, altKey: true }), true)).toBeNull();
    expect(agentSwitchIndex(event({ metaKey: true, altKey: true }), false)).toBeNull();
  });

  it("leaves Cmd+digit and Ctrl+digit to the server switch", () => {
    expect(agentSwitchIndex(event({ metaKey: true }), true)).toBeNull();
    expect(agentSwitchIndex(event({ ctrlKey: true }), false)).toBeNull();
  });

  it("ignores Shift, other codes, composing and repeat", () => {
    const chord = { ctrlKey: true, altKey: true };
    expect(agentSwitchIndex(event({ ...chord, shiftKey: true }), false)).toBeNull();
    expect(agentSwitchIndex(event({ ...chord, code: "Digit0" }), false)).toBeNull();
    expect(agentSwitchIndex(event({ ...chord, code: "Numpad3" }), false)).toBeNull();
    expect(agentSwitchIndex(event({ ...chord, isComposing: true }), false)).toBeNull();
    expect(agentSwitchIndex(event({ ...chord, repeat: true }), false)).toBeNull();
  });

  it("ignores Windows AltGr, which reports Ctrl+Alt", () => {
    expect(agentSwitchIndex(event({ ctrlKey: true, altKey: true }, true), false)).toBeNull();
  });
});
