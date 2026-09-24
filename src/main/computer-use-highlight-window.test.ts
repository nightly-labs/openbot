import type { Rectangle } from "electron";
import { describe, expect, it, vi } from "vitest";
import { ComputerUseHighlightController, type HighlightDisplay } from "./computer-use-highlight-window";
import {
  type ComputerUseHighlightTarget,
  chooseTarget,
  coveredAreas,
  type DriverWindow,
  frontmostTarget,
  liveSession,
} from "./computer-use-target-window";
import type { ObservedAction } from "./cua-driver-action-tap";

const DESKTOP = [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }];

function fakeWindow() {
  let visible = false;
  return {
    setBounds: vi.fn(),
    showInactive: vi.fn(() => {
      visible = true;
    }),
    hide: vi.fn(() => {
      visible = false;
    }),
    destroy: vi.fn(),
    isDestroyed: () => false,
    isVisible: () => visible,
  };
}

function controllerWith(
  targets: Array<ComputerUseHighlightTarget | null>,
  displays: HighlightDisplay[] = DESKTOP,
  readPointer?: () => { x: number; y: number } | null,
) {
  const windows: ReturnType<typeof fakeWindow>[] = [];
  const loadWindow = vi.fn(async () => undefined);
  const place = vi.fn();
  let tick = 0;
  const controller = new ComputerUseHighlightController({
    createWindow: () => {
      const window = fakeWindow();
      windows.push(window);
      return window;
    },
    loadWindow,
    place,
    displays: () => displays,
    readPointer,
    readTarget: async () => targets[Math.min(tick++, targets.length - 1)] ?? null,
  });
  return { controller, windows, loadWindow, place };
}

const target = (
  windowId: number,
  title: string,
  bounds: Rectangle,
  covered: Rectangle[] = [],
): ComputerUseHighlightTarget => ({
  windowId,
  title,
  bounds,
  covered,
});

describe("ComputerUseHighlightController", () => {
  // The daemon may stop while a tick sits between the window load and the placement. `stop()` hides
  // the overlays and clears the timer, so a tick that went on to show one would leave the rim over a
  // desktop no agent works on, with no further tick left to take it down.
  it("shows no overlay when it is stopped while a window is loading", async () => {
    const windows: ReturnType<typeof fakeWindow>[] = [];
    let loaded: () => void = () => {};
    const loading = new Promise<void>((resolve) => {
      loaded = resolve;
    });
    const place = vi.fn();
    const controller = new ComputerUseHighlightController({
      createWindow: () => {
        const window = fakeWindow();
        windows.push(window);
        return window;
      },
      loadWindow: () => loading,
      place,
      displays: () => DESKTOP,
      readTarget: async () => target(7, "Notes", { x: 0, y: 0, width: 800, height: 600 }),
    });

    const tick = controller.refresh();
    await vi.waitFor(() => expect(windows).toHaveLength(1));
    controller.stop();
    loaded();
    await tick;

    expect(place).not.toHaveBeenCalled();
    expect(windows[0]?.showInactive).not.toHaveBeenCalled();
    expect(controller.visible).toBe(false);
  });

  it("follows the window the agent works in without moving the overlay", async () => {
    const first = { x: 100, y: 80, width: 900, height: 600 };
    const moved = { x: 140, y: 120, width: 900, height: 600 };
    const { controller, windows, loadWindow, place } = controllerWith([
      target(7, "Notes", first),
      target(7, "Notes", moved),
    ]);

    await controller.refresh();
    await controller.refresh();

    expect(windows).toHaveLength(1);
    expect(loadWindow).toHaveBeenCalledTimes(1);
    // The window a user drags is followed by the placement, which is a repaint, and not by a window
    // move on every frame. The overlay is set to its display once and left there.
    expect(windows[0]?.setBounds).not.toHaveBeenCalled();
    expect(place).toHaveBeenNthCalledWith(1, windows[0], {
      x: 100,
      y: 80,
      width: 900,
      height: 600,
      cornerRadius: 12,
      windowTitle: "Notes",
      cursor: null,
      covered: [],
    });
    expect(place).toHaveBeenNthCalledWith(2, windows[0], {
      x: 140,
      y: 120,
      width: 900,
      height: 600,
      cornerRadius: 12,
      windowTitle: "Notes",
      cursor: null,
      covered: [],
    });
    // Showing the overlay with focus would take the keyboard from the app the agent types into.
    expect(windows[0]?.showInactive).toHaveBeenCalledTimes(1);
    expect(controller.visible).toBe(true);
  });

  it("draws the rim where the target sits on a display left of the main one", async () => {
    const displays = [{ id: 2, bounds: { x: -1512, y: 0, width: 1512, height: 1080 } }];
    const { controller, place, windows } = controllerWith(
      [target(7, "Notes", { x: -1400, y: 60, width: 800, height: 600 })],
      displays,
    );

    await controller.refresh();

    // The placement is in that overlay's own pixels, so a display with a negative origin has to be
    // taken off the target's position rather than sent on as a negative left edge.
    expect(place).toHaveBeenCalledWith(windows[0], {
      x: 112,
      y: 60,
      width: 800,
      height: 600,
      cornerRadius: 12,
      windowTitle: "Notes",
      cursor: null,
      covered: [],
    });
  });

  it("draws the agent cursor where the agent aimed, in the overlay's own pixels", async () => {
    const displays = [{ id: 2, bounds: { x: -1512, y: -98, width: 1512, height: 1080 } }];
    const { controller, place, windows } = controllerWith(
      [target(7, "Notes", { x: -1400, y: 60, width: 800, height: 600 })],
      displays,
      () => ({ x: -1000, y: 200 }),
    );

    await controller.refresh();

    expect(place).toHaveBeenCalledWith(windows[0], expect.objectContaining({ cursor: { x: 512, y: 298 } }));
  });

  it("draws no cursor for a point off the desktop, which says the agent works nowhere on it", async () => {
    const { controller, place, windows } = controllerWith(
      [target(7, "Notes", { x: 0, y: 0, width: 800, height: 600 })],
      DESKTOP,
      () => ({ x: 4000, y: 200 }),
    );

    await controller.refresh();

    expect(place).toHaveBeenCalledWith(windows[0], expect.objectContaining({ cursor: null }));
  });

  it("sends the covered parts in the overlay's own pixels, so the rim gives way to the window in front", async () => {
    const displays = [{ id: 2, bounds: { x: 1512, y: -98, width: 2560, height: 1080 } }];
    const { controller, place, windows } = controllerWith(
      [target(7, "Notes", { x: 1600, y: 0, width: 800, height: 600 }, [{ x: 2000, y: 200, width: 400, height: 400 }])],
      displays,
    );

    await controller.refresh();

    expect(place).toHaveBeenCalledWith(
      windows[0],
      expect.objectContaining({ covered: [{ x: 488, y: 298, width: 400, height: 400 }] }),
    );
  });

  it("builds one overlay for each display, because macOS draws a window on one of them only", async () => {
    const displays = [
      { id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 } },
      { id: 2, bounds: { x: 1512, y: -98, width: 2560, height: 1080 } },
    ];
    // A window on the second display, and a point on the first: neither overlay can draw both.
    const { controller, place, windows } = controllerWith(
      [target(7, "Notes", { x: 1945, y: 213, width: 1228, height: 732 })],
      displays,
      () => ({ x: 600, y: 500 }),
    );

    await controller.refresh();

    expect(windows).toHaveLength(2);
    expect(place).toHaveBeenCalledWith(
      windows[0],
      expect.objectContaining({ x: 1945, y: 213, cursor: { x: 600, y: 500 } }),
    );
    expect(place).toHaveBeenCalledWith(windows[1], expect.objectContaining({ x: 433, y: 311, cursor: null }));
  });

  it("moves the agent cursor to a display connected while the controller runs", async () => {
    const displays = [{ id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 } }];
    let pointer = { x: 600, y: 500 };
    const { controller, windows, place } = controllerWith(
      [target(7, "Notes", { x: 100, y: 80, width: 900, height: 600 })],
      displays,
      () => pointer,
    );
    await controller.refresh();

    displays.push({ id: 2, bounds: { x: -1512, y: 0, width: 1512, height: 982 } });
    pointer = { x: -1000, y: 300 };
    place.mockClear();
    await controller.refresh();

    expect(place).toHaveBeenCalledWith(windows[0], expect.objectContaining({ cursor: null }));
    expect(place).toHaveBeenCalledWith(windows[1], expect.objectContaining({ cursor: { x: 512, y: 300 } }));

    displays.pop();
    pointer = { x: 600, y: 500 };
    place.mockClear();
    await controller.refresh();

    expect(windows[1]?.destroy).toHaveBeenCalledOnce();
    expect(place).toHaveBeenCalledWith(windows[0], expect.objectContaining({ cursor: { x: 600, y: 500 } }));
  });

  it("hides the rim when no agent holds the desktop", async () => {
    const { controller, windows } = controllerWith([target(7, "Notes", { x: 0, y: 0, width: 800, height: 600 }), null]);

    await controller.refresh();
    await controller.refresh();

    expect(windows[0]?.hide).toHaveBeenCalledTimes(1);
    expect(controller.visible).toBe(false);
  });

  it("keeps the rim off when the driver read fails", async () => {
    const controller = new ComputerUseHighlightController({
      createWindow: () => fakeWindow(),
      loadWindow: async () => undefined,
      place: vi.fn(),
      displays: () => DESKTOP,
      readTarget: async () => {
        throw new Error("the daemon did not answer");
      },
    });

    await expect(controller.refresh()).resolves.toBeUndefined();
    expect(controller.visible).toBe(false);
  });
});

/** One entry as the driver publishes it, in its own snake-case shape. */
interface WindowPayload {
  window_id: number;
  pid: number;
  app_name: string;
  title: string;
  bounds: Rectangle;
  z_index: number | null;
  is_on_screen: boolean;
  on_current_space: boolean;
}

const window = (over: Partial<WindowPayload>): WindowPayload => ({
  window_id: 1,
  pid: 4242,
  app_name: "Notes",
  title: "Quarterly review",
  bounds: { x: 10, y: 20, width: 800, height: 600 },
  z_index: 5,
  is_on_screen: true,
  on_current_space: true,
  ...over,
});

describe("frontmostTarget", () => {
  it("takes the front window and leaves out OpenBot's own and the driver's overlay", () => {
    // The driver counts back to front, so the largest z index is the window in front.
    const payload = {
      windows: [
        window({ window_id: 1, z_index: 5 }),
        window({ window_id: 2, z_index: 1, pid: 99, app_name: "OpenBot" }),
        window({ window_id: 3, z_index: 2, app_name: "cua-driver", title: "" }),
        window({ window_id: 4, z_index: 9, app_name: "Terminal", title: "zsh" }),
      ],
    };

    expect(frontmostTarget(payload, 99)).toEqual({
      windowId: 4,
      title: "zsh",
      bounds: { x: 10, y: 20, width: 800, height: 600 },
      covered: [],
    });
  });

  it("ignores windows that are off screen, on another Space, or too small to work in", () => {
    const payload = {
      windows: [
        window({ window_id: 1, z_index: 1, is_on_screen: false }),
        window({ window_id: 2, z_index: 2, on_current_space: false }),
        window({ window_id: 3, z_index: 3, bounds: { x: 0, y: 0, width: 64, height: 64 } }),
        window({ window_id: 4, z_index: 9 }),
      ],
    };

    expect(frontmostTarget(payload, 99)?.windowId).toBe(4);
  });

  it("reports nothing rather than a guess when the payload carries no usable window", () => {
    expect(frontmostTarget({ windows: [] }, 99)).toBeNull();
    expect(frontmostTarget({}, 99)).toBeNull();
    expect(frontmostTarget(null, 99)).toBeNull();
  });
});

describe("coveredAreas", () => {
  const driverWindow = (windowId: number, zIndex: number, bounds: Rectangle): DriverWindow => ({
    windowId,
    pid: 4242,
    appName: "Notes",
    title: "Quarterly review",
    bounds,
    zIndex,
    onScreen: true,
    onCurrentSpace: true,
  });
  const marked = driverWindow(1, 5, { x: 0, y: 0, width: 400, height: 400 });

  it("cuts the rim only where a window in front covers it", () => {
    const behind = driverWindow(2, 1, { x: 0, y: 0, width: 400, height: 400 });
    const beside = driverWindow(3, 9, { x: 500, y: 0, width: 200, height: 200 });
    const front = driverWindow(4, 9, { x: 300, y: 350, width: 400, height: 400 });

    expect(coveredAreas(marked, [marked, behind, beside, front])).toEqual([{ x: 300, y: 350, width: 100, height: 50 }]);
  });

  it("gives two windows that overlap each other as areas that do not, which one cut needs", () => {
    const left = driverWindow(2, 7, { x: 100, y: 100, width: 200, height: 200 });
    const right = driverWindow(3, 9, { x: 200, y: 150, width: 200, height: 200 });

    const areas = coveredAreas(marked, [marked, left, right]);

    // The same area as the two windows together: 200x200 twice, less the 100x150 they share.
    expect(areas.reduce((total, area) => total + area.width * area.height, 0)).toBe(65_000);
    for (const [index, area] of areas.entries()) {
      for (const other of areas.slice(index + 1)) {
        const overlaps =
          area.x < other.x + other.width &&
          other.x < area.x + area.width &&
          area.y < other.y + other.height &&
          other.y < area.y + area.height;
        expect(overlaps).toBe(false);
      }
    }
  });
});

describe("liveSession", () => {
  interface SessionPayload {
    client_kind: string;
    owner_short_id: string;
    state: string;
    idle_seconds: number;
  }

  const session = (over: Partial<SessionPayload>): SessionPayload => ({
    client_kind: "mcp",
    owner_short_id: "provider",
    state: "active",
    idle_seconds: 1,
    ...over,
  });

  it("reports the busiest lease while a provider is acting", () => {
    expect(liveSession({ count: 2, sessions: [session({ idle_seconds: 9 }), session({ idle_seconds: 1 })] })).toEqual({
      idleSeconds: 1,
    });
    expect(liveSession({ count: 0, sessions: [] })).toBeNull();
    expect(liveSession("No live sessions.")).toBeNull();
  });

  it("does not count OpenBot's own read, which takes a lease of its own", () => {
    // The name is what the daemon keeps: it reports every client of its socket as `direct`, so a
    // rim that went by the kind alone would read its own read as an agent and stay up for ever.
    expect(
      liveSession({ count: 1, sessions: [session({ client_kind: "direct", owner_short_id: "ighlight" })] }),
    ).toBeNull();
    expect(liveSession({ count: 1, sessions: [session({ client_kind: "cli" })] })).toBeNull();
  });

  it("lets go of a lease the agent stopped using, which the daemon keeps for minutes", () => {
    expect(liveSession({ sessions: [session({ idle_seconds: 120 })] })).toBeNull();
    expect(liveSession({ sessions: [session({ state: "expired" })] })).toBeNull();
  });
});

describe("chooseTarget", () => {
  const desktop = {
    windows: [
      window({ window_id: 4, z_index: 7, app_name: "Terminal", title: "zsh" }),
      window({ window_id: 5, z_index: 3, app_name: "Discord", title: "Synthetify Labs" }),
    ],
  };
  const held = {
    windowId: 5,
    title: "Synthetify Labs",
    bounds: { x: 10, y: 20, width: 800, height: 600 },
    covered: [],
  };

  it("marks nothing while no agent holds the desktop", () => {
    expect(chooseTarget({ windows: desktop, action: null, session: null, ownPid: 99, previous: held })).toBeNull();
  });

  it("keeps the rim on the window it marks when the user brings another one forward", () => {
    // The agent has not acted for seconds, so the window now in front is the user's own click.
    const choice = chooseTarget({
      windows: desktop,
      action: null,
      session: { idleSeconds: 6 },
      ownPid: 99,
      previous: held,
    });

    expect(choice?.windowId).toBe(5);
  });

  it("moves to the window the agent raised, which it does between two of its own actions", () => {
    const choice = chooseTarget({
      windows: desktop,
      action: null,
      session: { idleSeconds: 0 },
      ownPid: 99,
      previous: held,
    });

    expect(choice?.windowId).toBe(4);
  });

  it("takes the front window when the one it marked is closed", () => {
    const gone = { windows: [window({ window_id: 4, z_index: 7, app_name: "Terminal", title: "zsh" })] };

    expect(
      chooseTarget({ windows: gone, action: null, session: { idleSeconds: 30 }, ownPid: 99, previous: held })?.windowId,
    ).toBe(4);
  });
});

describe("chooseTarget from the agent's own request", () => {
  const acting = { idleSeconds: 0 };
  const desktop = {
    windows: [
      window({ window_id: 4, pid: 11, z_index: 9, app_name: "Terminal", title: "zsh" }),
      window({ window_id: 5, pid: 22, z_index: 7, app_name: "Discord", title: "Synthetify Labs" }),
      window({ window_id: 6, pid: 22, z_index: 3, app_name: "Discord", title: "Discord updater" }),
    ],
  };
  const action = (over: Partial<ObservedAction>): ObservedAction => ({
    tool: "click",
    pid: 22,
    windowId: null,
    at: 0,
    ...over,
  });

  it("marks the exact window the request named, however far back it sits", () => {
    const choice = chooseTarget({
      windows: desktop,
      session: acting,
      action: action({ windowId: 6 }),
      ownPid: 99,
      previous: null,
    });

    expect(choice?.windowId).toBe(6);
  });

  it("marks the front window of the application a request without a window named", () => {
    const choice = chooseTarget({ windows: desktop, session: acting, action: action({}), ownPid: 99, previous: null });

    expect(choice?.windowId).toBe(5);
  });

  it("falls back to the front window when the request named neither, as a browser tool does", () => {
    const choice = chooseTarget({
      windows: desktop,
      session: acting,
      action: action({ pid: null, tool: "browser_click" }),
      ownPid: 99,
      previous: null,
    });

    expect(choice?.windowId).toBe(4);
  });

  it("falls back when the window the request named is gone, rather than hiding the rim", () => {
    const choice = chooseTarget({
      windows: desktop,
      session: acting,
      action: action({ pid: 77, windowId: 4242 }),
      ownPid: 99,
      previous: null,
    });

    expect(choice?.windowId).toBe(4);
  });
});
