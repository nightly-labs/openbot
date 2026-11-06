// Checks the ⌘⌥1-9 / Ctrl+Alt+1-9 agent shortcuts of #4398 at the level the app can test without a
// window: the pure modules the renderer handler calls. The handler itself is three lines over
// these, and the E2E policy of the repository permits no Vitest file for it.
// Run: `bun scripts/agent-number-shortcuts-e2e.ts`.
// Writes .openbot-build/agent-number-shortcuts-e2e/report.json.

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ChatVisualKey } from "@openbot/contracts/chat-visual";
import type { SidebarLayoutSnapshot } from "@openbot/contracts/ipc";
import {
  type AgentNumberShortcutKey,
  agentNumberFromShortcut,
  isAgentNumberShortcutKey,
  numberedSidebarAgents,
  numberedSidebarAgentTarget,
  type SidebarAgentNumberingView,
} from "@openbot/ui/features/sidebar/agent-number-shortcut";
import { sidebarAgentOrder } from "@openbot/ui/features/sidebar/sidebar-agent-order";
import { isChatVisualAppShortcut } from "../src/renderer/src/features/conversation/chat-visual-shortcuts";

const OUT = resolve(import.meta.dirname, "../.openbot-build/agent-number-shortcuts-e2e");

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: { passed: boolean; unverified: string[]; steps: Step[] } = {
  passed: false,
  unverified: [
    "The window keydown handler itself. This check tests the pure modules it calls; it does not render the sidebar or dispatch a key event in a window.",
    "The server rail's own ⌘1-9 / Ctrl+1-9 handler. Its code is unchanged by #4398; this check only proves the agent chord does not answer a chord without Alt and that the visual page still forwards the server chord.",
  ],
  steps: [],
};

async function step<T>(name: string, run: () => T): Promise<T> {
  process.stdout.write(`- ${name}\n`);
  try {
    const value = run();
    report.steps.push({ name, passed: true, detail: value });
    return value;
  } catch (error) {
    report.steps.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/** A key press with the fields the matcher reads, so a test can name only what it changes. */
function key(overrides: Partial<AgentNumberShortcutKey> = {}): AgentNumberShortcutKey {
  return { code: "Digit1", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...overrides };
}

/** The same press as a visual reply's page reports it: it also carries `key`. */
function visualKey(overrides: Partial<ChatVisualKey> = {}): ChatVisualKey {
  return { key: "1", code: "Digit1", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...overrides };
}

/** The four agents of the layout, named by the section they sit in. */
const agents = [
  { id: "agent-cosmo", name: "Cosmo" },
  { id: "agent-vanda", name: "Vanda" },
  { id: "agent-piko", name: "Piko" },
  { id: "agent-lumo", name: "Lumo" },
];

/**
 * Two sections, alpha above beta, each holding two agents. The layout names Piko before Cosmo in
 * `agentOrder`, so the numbers follow the rows the sidebar draws and not the roster order the agents
 * arrive in.
 */
const layout: SidebarLayoutSnapshot = {
  revision: 1,
  sections: [
    { id: "section-alpha", name: "Alpha" },
    { id: "section-beta", name: "Beta" },
  ],
  order: ["section-alpha", "section-beta", "unassigned"],
  agentAssignments: {
    "agent-piko": "section-alpha",
    "agent-vanda": "section-alpha",
    "agent-cosmo": "section-beta",
    "agent-lumo": "section-beta",
  },
  agentOrder: ["agent-piko", "agent-cosmo"],
};

/** The sidebar as the numbering sees it: the layout above, no pins, and the hidden agents named. */
function numberingView(hiddenAgentIds: ReadonlySet<string> = new Set()): SidebarAgentNumberingView {
  return { layout, pinnedItems: [], hiddenAgentIds };
}

try {
  await step("the numbers follow the sidebar rows, across sections", () => {
    // Piko and Vanda sit in the upper section, Cosmo and Lumo in the lower one, so the numbers
    // follow the rows the sidebar draws and not the roster order the agents arrive in.
    assert.deepEqual(
      sidebarAgentOrder(agents, numberingView()).map((agent) => agent.id),
      ["agent-piko", "agent-vanda", "agent-cosmo", "agent-lumo"],
    );
    return numberedSidebarAgents(agents, numberingView()).map((agent) => agent.id);
  });

  await step("a pinned agent keeps the top number", () => {
    // The pinned strip is the first thing the sidebar draws, so a pinned agent takes number 1 and
    // the sections follow it.
    const view: SidebarAgentNumberingView = {
      ...numberingView(),
      pinnedItems: [{ kind: "agent", id: "agent-lumo" }],
    };
    assert.deepEqual(
      numberedSidebarAgents(agents, view).map((agent) => agent.id),
      ["agent-lumo", "agent-piko", "agent-vanda", "agent-cosmo"],
    );
    return "agent-lumo is pinned, so it is number 1";
  });

  await step("hidden agents do not count, so the other numbers do not move", () => {
    const hidden = new Set(["agent-piko"]);
    assert.deepEqual(
      numberedSidebarAgents(agents, numberingView(hidden)).map((agent) => agent.id),
      ["agent-vanda", "agent-cosmo", "agent-lumo"],
    );
    assert.equal(numberedSidebarAgentTarget(agents, numberingView(hidden), 1, null)?.id, "agent-vanda");
    return "agent-vanda is number 1 once agent-piko is hidden";
  });

  await step("a collapsed group keeps its agent's number", () => {
    // The numbering never reads the collapse state, so an agent in a collapsed section is still
    // numbered. Here Vanda's section is collapsed, and she keeps the number her row gives her.
    const collapsed = new Set(["section-alpha"]);
    assert.ok(collapsed.has("section-alpha"));
    assert.deepEqual(
      numberedSidebarAgents(agents, numberingView()).map((agent) => agent.id),
      ["agent-piko", "agent-vanda", "agent-cosmo", "agent-lumo"],
    );
    return "the collapse set is not an input; agent-vanda is number 2";
  });

  await step("an empty slot is a no-op", () => {
    assert.equal(numberedSidebarAgentTarget(agents, numberingView(), 5, null), null);
    assert.equal(numberedSidebarAgentTarget(agents, numberingView(), 9, null), null);
    return "slots 5 and 9 are empty with four numbered agents";
  });

  await step("the already-selected agent is a no-op", () => {
    assert.equal(numberedSidebarAgentTarget(agents, numberingView(), 1, "agent-piko"), null);
    assert.equal(numberedSidebarAgentTarget(agents, numberingView(), 3, "agent-vanda")?.id, "agent-cosmo");
    return "number 1 names the selected agent-piko and changes nothing";
  });

  await step("macOS answers ⌘⌥1-9 by event.code, not event.key", () => {
    for (let number = 1; number <= 9; number += 1) {
      const code = `Digit${number}`;
      // Option changes event.key on macOS (⌥1 types ¡), so the key is wrong on purpose.
      assert.equal(agentNumberFromShortcut(key({ code, metaKey: true, altKey: true }), "darwin"), number);
      assert.equal(agentNumberFromShortcut(key({ code, ctrlKey: true, altKey: true }), "darwin"), null);
    }
    assert.equal(agentNumberFromShortcut(key({ code: "Digit1", metaKey: true, altKey: true }), "win32"), null);
    assert.equal(agentNumberFromShortcut(key({ code: "Digit1", metaKey: true, altKey: true }), "linux"), null);
    return "⌘⌥1-9 answer 1-9; the Ctrl+Alt form does not";
  });

  await step("Windows and Linux answer Ctrl+Alt+1-9 by event.code", () => {
    for (const platform of ["win32", "linux"] as const) {
      for (let number = 1; number <= 9; number += 1) {
        const code = `Digit${number}`;
        assert.equal(agentNumberFromShortcut(key({ code, ctrlKey: true, altKey: true }), platform), number);
        assert.equal(agentNumberFromShortcut(key({ code, metaKey: true, altKey: true }), platform), null);
      }
    }
    return "Ctrl+Alt+1-9 answer 1-9; the ⌘⌥ form does not";
  });

  await step("AltGr is ignored, so AltGr+7/8/9 still type { [ ]", () => {
    for (const code of ["Digit7", "Digit8", "Digit9"]) {
      assert.equal(agentNumberFromShortcut(key({ code, ctrlKey: true, altKey: true, altGraph: true }), "win32"), null);
      assert.equal(agentNumberFromShortcut(key({ code, metaKey: true, altKey: true, altGraph: true }), "darwin"), null);
    }
    assert.equal(isAgentNumberShortcutKey(key({ code: "Digit7", ctrlKey: true, altKey: true, altGraph: true })), false);
    return "altGraph: true answers null for both platform forms";
  });

  await step("an IME composition and a held key are ignored", () => {
    assert.equal(agentNumberFromShortcut(key({ metaKey: true, altKey: true, isComposing: true }), "darwin"), null);
    assert.equal(agentNumberFromShortcut(key({ metaKey: true, altKey: true, repeat: true }), "darwin"), null);
    assert.equal(agentNumberFromShortcut(key({ ctrlKey: true, altKey: true, isComposing: true }), "win32"), null);
    assert.equal(agentNumberFromShortcut(key({ ctrlKey: true, altKey: true, repeat: true }), "win32"), null);
    return "isComposing and repeat answer null";
  });

  await step("Shift and a code that is not a digit row are not the chord", () => {
    assert.equal(agentNumberFromShortcut(key({ metaKey: true, altKey: true, shiftKey: true }), "darwin"), null);
    assert.equal(agentNumberFromShortcut(key({ code: "Numpad1", metaKey: true, altKey: true }), "darwin"), null);
    assert.equal(agentNumberFromShortcut(key({ code: "KeyA", metaKey: true, altKey: true }), "darwin"), null);
    return "Shift, Numpad1 and KeyA answer null";
  });

  await step("⌘1-9 / Ctrl+1-9 stay the server chord", () => {
    // No Alt: the agent matcher must not answer, and the visual page must still forward it.
    assert.equal(agentNumberFromShortcut(key({ metaKey: true }), "darwin"), null);
    assert.equal(agentNumberFromShortcut(key({ ctrlKey: true }), "win32"), null);
    assert.equal(isChatVisualAppShortcut(visualKey({ metaKey: true })), true);
    assert.equal(isChatVisualAppShortcut(visualKey({ ctrlKey: true })), true);
    return "the plain chord is not the agent chord and is still forwarded";
  });

  await step("a visual reply's page forwards the agent chord in both platform forms", () => {
    // The page cannot report the platform or AltGr, so both forms are forwarded and the app checks
    // the platform. `key` is wrong on purpose: Option changes it on macOS.
    assert.equal(isChatVisualAppShortcut(visualKey({ code: "Digit1", key: "¡", metaKey: true, altKey: true })), true);
    assert.equal(isChatVisualAppShortcut(visualKey({ code: "Digit9", ctrlKey: true, altKey: true })), true);
    assert.equal(isChatVisualAppShortcut(visualKey({ code: "Digit1", altKey: true })), false);
    assert.equal(
      isChatVisualAppShortcut(visualKey({ code: "Digit1", metaKey: true, altKey: true, shiftKey: true })),
      false,
    );
    return "both forms forward; Alt alone and Shift do not";
  });

  report.passed = true;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
}
