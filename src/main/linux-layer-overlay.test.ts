import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentDockPresentation, DynamicIslandPresentation } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it } from "vitest";
import {
  dockPresentationAtEdge,
  layerOverlayLocation,
  parseLayerOverlayInput,
  shouldPeek,
} from "./linux-layer-overlay";

const directories: string[] = [];
function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "openbot-layer-"));
  directories.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function resourcesWithShell(): string {
  const resources = tempDirectory();
  mkdirSync(join(resources, "linux-layer-overlay"));
  writeFileSync(join(resources, "linux-layer-overlay", "shell.qml"), "");
  return resources;
}
function binWith(name: string): string {
  const bin = tempDirectory();
  writeFileSync(join(bin, name), "#!/bin/sh\n", { mode: 0o755 });
  return bin;
}

describe("layerOverlayLocation", () => {
  const hyprland = { HYPRLAND_INSTANCE_SIGNATURE: "sig", WAYLAND_DISPLAY: "wayland-1" };

  it.runIf(process.platform === "linux")("finds Quickshell and the shell on Hyprland", () => {
    const resources = resourcesWithShell();
    const bin = binWith("qs");
    expect(layerOverlayLocation({ ...hyprland, PATH: bin }, resources, false)).toEqual({
      quickshell: join(bin, "qs"),
      shellQml: join(resources, "linux-layer-overlay", "shell.qml"),
    });
  });

  it("keeps the windows elsewhere, on a server, when switched off, or without Quickshell", () => {
    const resources = resourcesWithShell();
    const bin = binWith("quickshell");
    expect(layerOverlayLocation({ WAYLAND_DISPLAY: "wayland-1", PATH: bin }, resources, false)).toBeNull();
    expect(layerOverlayLocation({ ...hyprland, PATH: bin }, resources, true)).toBeNull();
    expect(layerOverlayLocation({ ...hyprland, PATH: bin, OPENBOT_LAYER_OVERLAY: "0" }, resources, false)).toBeNull();
    expect(
      layerOverlayLocation({ ...hyprland, PATH: tempDirectory(), USER: "", HOME: "" }, resources, false),
    ).toBeNull();
    expect(layerOverlayLocation({ ...hyprland, PATH: bin }, tempDirectory(), false)).toBeNull();
  });
});

describe("parseLayerOverlayInput", () => {
  const line = (value: unknown) => JSON.stringify(value);

  it("rebuilds pointer and key events from their checked fields", () => {
    expect(
      parseLayerOverlayInput(
        line({
          type: "input",
          surface: "island",
          event: { type: "mouseDown", x: 10.4, y: 3, button: "right", clickCount: 9, extra: 1 },
        }),
      ),
    ).toEqual({
      type: "input",
      surface: "island",
      event: { type: "mouseDown", x: 10, y: 3, modifiers: [], button: "right", clickCount: 3 },
      screenY: null,
    });
    expect(
      parseLayerOverlayInput(
        line({ type: "input", surface: "dock", event: { type: "char", keyCode: "a", modifiers: ["shift", "nope"] } }),
      ),
    ).toEqual({
      type: "input",
      surface: "dock",
      event: { type: "char", keyCode: "a", modifiers: ["shift"] },
      screenY: null,
    });
  });

  it("keeps a held button and the pointer's height for the dock's drag", () => {
    expect(
      parseLayerOverlayInput(
        line({
          type: "input",
          surface: "dock",
          event: { type: "mouseMove", x: 5, y: 7, modifiers: ["leftButtonDown"] },
          screenY: 412.6,
        }),
      ),
    ).toEqual({
      type: "input",
      surface: "dock",
      event: { type: "mouseMove", x: 5, y: 7, modifiers: ["leftButtonDown"] },
      screenY: 413,
    });
  });

  it("drops anything else", () => {
    expect(parseLayerOverlayInput("not json")).toBeNull();
    expect(
      parseLayerOverlayInput(line({ type: "input", surface: "main", event: { type: "mouseMove", x: 1, y: 1 } })),
    ).toBeNull();
    expect(
      parseLayerOverlayInput(line({ type: "input", surface: "island", event: { type: "drag", x: 1, y: 1 } })),
    ).toBeNull();
    expect(
      parseLayerOverlayInput(line({ type: "input", surface: "island", event: { type: "mouseMove", x: "1", y: 1 } })),
    ).toBeNull();
    expect(
      parseLayerOverlayInput(line({ type: "input", surface: "island", event: { type: "keyDown", keyCode: "" } })),
    ).toBeNull();
  });

  it("reads the placement", () => {
    expect(parseLayerOverlayInput(line({ type: "placement", movedAway: true, dockEdge: "left" }))).toEqual({
      type: "placement",
      movedAway: true,
      dockEdge: "left",
    });
    expect(parseLayerOverlayInput(line({ type: "placement", dockEdge: "up" }))).toEqual({
      type: "placement",
      movedAway: false,
      dockEdge: null,
    });
  });
});

describe("shouldPeek", () => {
  const nyx = { id: "nyx", name: "Nyx", avatarSeed: "nyx", avatarHue: null, avatarUrl: null };
  const idle: DynamicIslandPresentation = { serverId: "local", mode: "idle" };
  const working = (task: string): DynamicIslandPresentation => ({
    serverId: "local",
    mode: "working",
    working: [{ agent: nyx, task, turnId: "t" }],
  });
  const message = (messageId: string): DynamicIslandPresentation => ({
    serverId: "local",
    mode: "message",
    unreadCount: 1,
    message: { agent: nyx, messageId, text: "Done", createdAt: "2026-11-11T22:00:00.000Z" },
  });

  it("opens for a new task and for a new reply", () => {
    expect(shouldPeek(idle, working("Fix it"))).toBe(true);
    expect(shouldPeek(working("Fix it"), working("Test it"))).toBe(true);
    expect(shouldPeek(working("Fix it"), message("m1"))).toBe(true);
    expect(shouldPeek(message("m1"), message("m2"))).toBe(true);
  });

  it("stays closed for the same item and for idle", () => {
    expect(shouldPeek(working("Fix it"), working("Fix it"))).toBe(false);
    expect(shouldPeek(message("m1"), message("m1"))).toBe(false);
    expect(shouldPeek(message("m1"), idle)).toBe(false);
  });
});

describe("dockPresentationAtEdge", () => {
  const dock: AgentDockPresentation = {
    serverId: "local",
    display: { kind: "display", id: 1 },
    edge: "right",
    autoHide: false,
    edgeStrip: false,
    sizePercent: 100,
    offsets: [],
    seats: [],
    available: [],
    availableChannels: [],
    agents: [],
    chats: [],
    results: [],
  };

  it("gives the dock the edge of the output where the layer is", () => {
    expect(dockPresentationAtEdge(dock, "left")).toEqual({ ...dock, edge: "left" });
  });

  it("keeps the user's edge on the primary output", () => {
    expect(dockPresentationAtEdge(dock, null)).toBe(dock);
    expect(dockPresentationAtEdge(dock, "right")).toBe(dock);
  });
});
