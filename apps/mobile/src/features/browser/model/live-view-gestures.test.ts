import { describe, expect, it } from "vitest";
import { NO_ZOOM, type Point, type Zoom } from "./live-view-geometry";
import { createLiveViewGestures, type LiveViewMode } from "./live-view-gestures";

// Failure modes:
// - a tap clicks somewhere other than under the finger, or a tap on the bars clicks the page edge;
// - a drag or a trackpad drag leaves the button down;
// - a press and hold left-clicks as well as right-clicks;
// - two fingers scroll the wrong way, or scroll a zoomed picture instead of panning it;
// - the trackpad pointer moves by a different distance than the finger, or a tap clicks under the
//   finger instead of at the pointer.

// A 400 x 800 stage shows a 1280 x 800 page as 400 x 250, from y = 275: 0.3125 points per pixel.
const STAGE = { width: 400, height: 800 };
const FRAME = { width: 1280, height: 800 };

function setup(mode: LiveViewMode) {
  const events: string[] = [];
  const timers: { at: number; run: () => void }[] = [];
  let now = 0;
  let zoom: Zoom = NO_ZOOM;
  let pointer: Point = { x: 0.5, y: 0.5 };
  const gestures = createLiveViewGestures(
    {
      layout: () => ({ stage: STAGE, frame: FRAME, zoom }),
      mode: () => mode,
      pointer: () => pointer,
      setPointer: (next) => {
        pointer = next;
      },
      press: (action, at, button, clickCount) =>
        events.push(`${action} ${button} ${clickCount} ${at.x.toFixed(2)},${at.y.toFixed(2)}`),
      wheel: (_at, deltaX, deltaY) => events.push(`wheel ${Math.round(deltaX)},${Math.round(deltaY)}`),
      setZoom: (next) => {
        zoom = next;
        events.push(`zoom ${next.scale.toFixed(1)}`);
      },
      feedback: (kind) => events.push(kind),
    },
    {
      later: (milliseconds, run) => {
        const timer = { at: now + milliseconds, run };
        timers.push(timer);
        return () => timers.splice(timers.indexOf(timer), 1);
      },
      frame: () => () => undefined,
    },
  );
  const advance = (milliseconds: number) => {
    now += milliseconds;
    for (const timer of timers.filter((candidate) => candidate.at <= now)) {
      timers.splice(timers.indexOf(timer), 1);
      timer.run();
    }
  };
  const touch = (id: number, x: number, y: number) => ({ id, x, y });
  return {
    events,
    pointer: () => pointer,
    zoom: () => zoom,
    advance,
    down: (...touches: ReturnType<typeof touch>[]) => gestures.down(touches, now),
    move: (...touches: ReturnType<typeof touch>[]) => gestures.move(touches, now),
    up: (...touches: ReturnType<typeof touch>[]) => gestures.up(touches, now),
    touch,
  };
}

describe("the live view gestures", () => {
  it("clicks under the finger, and nothing on the bars around the page", () => {
    const view = setup("direct");
    view.down(view.touch(1, 100, 337.5));
    view.advance(80);
    view.up(view.touch(1, 100, 337.5));
    expect(view.events).toEqual(["move left 0 0.25,0.25", "down left 1 0.25,0.25", "up left 1 0.25,0.25"]);
    view.events.length = 0;
    view.advance(1_000);
    view.down(view.touch(1, 200, 100));
    view.up(view.touch(1, 200, 100));
    expect(view.events).toEqual([]);
  });

  it("drags with the button held, and right-clicks on a press and hold", () => {
    const view = setup("direct");
    view.down(view.touch(1, 100, 337.5));
    view.move(view.touch(1, 300, 337.5));
    view.advance(600);
    view.up(view.touch(1, 300, 337.5));
    expect(view.events).toEqual([
      "move left 0 0.25,0.25",
      "down left 1 0.25,0.25",
      "move left 0 0.75,0.25",
      "up left 1 0.75,0.25",
    ]);
    view.events.length = 0;
    view.advance(1_000);
    view.down(view.touch(1, 100, 337.5));
    view.advance(500);
    view.up(view.touch(1, 100, 337.5));
    expect(view.events).toEqual([
      "move right 0 0.25,0.25",
      "down right 1 0.25,0.25",
      "up right 1 0.25,0.25",
      "secondary-click",
    ]);
  });

  it("scrolls with two fingers, and pans instead once the picture is zoomed", () => {
    const view = setup("direct");
    view.down(view.touch(1, 150, 400), view.touch(2, 250, 400));
    // Fingers up 100 points: the page moves up with them, so it scrolls down by 320 pixels.
    view.move(view.touch(1, 150, 390), view.touch(2, 250, 390));
    view.move(view.touch(1, 150, 290), view.touch(2, 250, 290));
    view.up(view.touch(1, 150, 290), view.touch(2, 250, 290));
    expect(view.events).toEqual(["wheel 0,320"]);
    view.events.length = 0;
    view.down(view.touch(1, 150, 400), view.touch(2, 250, 400));
    view.move(view.touch(1, 100, 400), view.touch(2, 300, 400));
    view.up(view.touch(1, 100, 400), view.touch(2, 300, 400));
    expect(view.zoom().scale).toBe(2);
    view.events.length = 0;
    view.down(view.touch(1, 150, 400), view.touch(2, 250, 400));
    view.move(view.touch(1, 150, 300), view.touch(2, 250, 300));
    expect(view.events).toEqual(["zoom 2.0"]);
  });

  it("moves the trackpad pointer by the finger's distance, and clicks and drags at the pointer", () => {
    const view = setup("trackpad");
    // Slow: 40 points in 200 ms moves the pointer 40 points of the 400-point page, a tenth.
    view.down(view.touch(1, 20, 600));
    view.advance(200);
    view.move(view.touch(1, 60, 600));
    view.up(view.touch(1, 60, 600));
    expect(view.pointer().x).toBeCloseTo(0.6);
    expect(view.events).toEqual(["move left 0 0.60,0.50"]);
    view.events.length = 0;
    view.advance(1_000);
    view.down(view.touch(1, 20, 700));
    view.up(view.touch(1, 20, 700));
    expect(view.events).toEqual(["down left 1 0.60,0.50", "up left 1 0.60,0.50"]);
    view.events.length = 0;
    // A tap, then a touch that holds, drags from the pointer until the finger lifts.
    view.advance(100);
    view.down(view.touch(1, 20, 700));
    view.advance(200);
    view.advance(100);
    view.move(view.touch(1, 60, 700));
    view.up(view.touch(1, 60, 700));
    expect(view.events).toEqual([
      "down left 1 0.60,0.50",
      "drag-start",
      "move left 0 0.70,0.50",
      "up left 1 0.70,0.50",
    ]);
  });
});
