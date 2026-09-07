import { BotEngine } from "@norbert_bodziony/bloub";
import { describe, expect, it, vi } from "vitest";
import {
  type BloubActivityFrame,
  bloubActivityGeometry,
  FPS,
  FRAME_COUNT,
  prepareBloubActivityFrames,
  prepareBloubSettlingFrames,
  SETTLE,
} from "../apps/mobile/src/features/agents/model/bloub-activity";
import {
  type LoaderFrame,
  prepareLoaderFrames,
  prepareReturnToIdleFrames,
} from "../apps/mobile/src/shared/lib/bloub-loader-frames";

function idleQueue() {
  const callbacks = new Set<() => void>();
  return {
    schedule(callback: () => void) {
      callbacks.add(callback);
      return () => {
        callbacks.delete(callback);
      };
    },
    next() {
      const callback = callbacks.values().next().value;
      if (!callback) return false;
      callbacks.delete(callback);
      callback();
      return true;
    },
  };
}

describe("loader frame preparation", () => {
  it("leaves the first commit free of animation sampling and yields between bounded batches", () => {
    const idle = idleQueue();
    const sample = vi.spyOn(BotEngine.prototype, "sample");
    let ready: LoaderFrame[] | undefined;
    try {
      prepareLoaderFrames((frames) => {
        ready = frames;
      }, idle.schedule);
      expect(sample).not.toHaveBeenCalled();
      expect(ready).toBeUndefined();
      while (idle.next()) {
        expect(sample.mock.calls.length).toBeLessThanOrEqual(4);
        sample.mockClear();
      }
      expect(ready?.length).toBeGreaterThan(0);
      expect(ready?.length).toBeLessThanOrEqual(120);
    } finally {
      sample.mockRestore();
    }
  });

  it("stops preparing a loader that disappears before its sequence is ready", () => {
    const idle = idleQueue();
    const sample = vi.spyOn(BotEngine.prototype, "sample");
    const ready = vi.fn();
    try {
      const cancel = prepareLoaderFrames(ready, idle.schedule);
      idle.next();
      sample.mockClear();
      cancel();
      while (idle.next()) {
        /* Drain any erroneously retained work. */
      }
      expect(sample).not.toHaveBeenCalled();
      expect(ready).not.toHaveBeenCalled();
    } finally {
      sample.mockRestore();
    }
  });

  it("prepares an exit asynchronously from the displayed pose and can cancel a stale exit", () => {
    const idle = idleQueue();
    let cycle: LoaderFrame[] = [];
    prepareLoaderFrames((frames) => {
      cycle = frames;
    }, idle.schedule);
    while (idle.next()) {
      /* Finish the cycle before requesting an exit. */
    }
    const sample = vi.spyOn(BotEngine.prototype, "sample");
    const ready = vi.fn();
    try {
      prepareReturnToIdleFrames(60, ready, idle.schedule);
      expect(sample).not.toHaveBeenCalled();
      while (idle.next()) {
        /* Finish the idle morph. */
      }
      expect(ready).toHaveBeenCalledOnce();
      expect(ready.mock.calls[0][0][0]).toEqual(cycle[60]);
      ready.mockClear();
      const cancel = prepareReturnToIdleFrames(90, ready, idle.schedule);
      idle.next();
      cancel();
      sample.mockClear();
      while (idle.next()) {
        /* A cancelled exit must not resume later. */
      }
      expect(sample).not.toHaveBeenCalled();
      expect(ready).not.toHaveBeenCalled();
    } finally {
      sample.mockRestore();
    }
  });
});

function preparedActivity(geometry: ReturnType<typeof bloubActivityGeometry>) {
  const idle = idleQueue();
  let ready: BloubActivityFrame[] = [];
  prepareBloubActivityFrames(
    geometry,
    (frames) => {
      ready = frames;
    },
    idle.schedule,
  );
  while (idle.next()) {
    /* Finish preparation. */
  }
  return ready;
}

it("shares pending avatar preparation without blocking activity startup or any idle batch", () => {
  const geometry = bloubActivityGeometry("agent-test");
  const idle = idleQueue();
  const sample = vi.spyOn(BotEngine.prototype, "sample");
  let header: BloubActivityFrame[] | undefined;
  let activity: BloubActivityFrame[] | undefined;
  try {
    prepareBloubActivityFrames(
      geometry,
      (frames) => {
        header = frames;
      },
      idle.schedule,
    );
    prepareBloubActivityFrames(
      geometry,
      (frames) => {
        activity = frames;
      },
      idle.schedule,
    );
    expect(sample).not.toHaveBeenCalled();
    expect(header).toBeUndefined();
    let sampled = 0;
    while (idle.next()) {
      expect(sample.mock.calls.length).toBeLessThanOrEqual(4);
      sampled += sample.mock.calls.length;
      sample.mockClear();
    }
    expect(sampled).toBe(FRAME_COUNT * 2);
    expect(header).toHaveLength(FRAME_COUNT * 2);
    expect(activity).toBe(header);
    expect(preparedActivity(geometry)).toBe(header);
    expect(sample).not.toHaveBeenCalled();
  } finally {
    sample.mockRestore();
  }
});

it("cancels abandoned avatar work while keeping preparation for remaining players", () => {
  const geometry = bloubActivityGeometry("cancel-activity");
  const idle = idleQueue();
  const header = vi.fn();
  const activity = vi.fn();
  const cancelHeader = prepareBloubActivityFrames(geometry, header, idle.schedule);
  const cancelActivity = prepareBloubActivityFrames(geometry, activity, idle.schedule);
  idle.next();
  cancelHeader();
  expect(idle.next()).toBe(true);
  cancelActivity();
  expect(idle.next()).toBe(false);
  expect(header).not.toHaveBeenCalled();
  expect(activity).not.toHaveBeenCalled();

  const cancelStale = prepareBloubActivityFrames(geometry, header, idle.schedule);
  prepareBloubActivityFrames(geometry, activity, idle.schedule);
  cancelStale();
  while (idle.next()) {
    /* The remaining player still needs its sequence. */
  }
  expect(header).not.toHaveBeenCalled();
  expect(activity).toHaveBeenCalledOnce();
  expect(activity.mock.calls[0][0]).toHaveLength(FRAME_COUNT * 2);
});

describe("activity sequence eviction", () => {
  it("keeps an existing player's frames valid when unused cached geometry is evicted", () => {
    const geometry = bloubActivityGeometry("eviction-test");
    const mounted = preparedActivity(geometry);
    const firstPath = mounted[0].body.d;
    const geometries = new Map([[geometry.key, geometry]]);
    for (let index = 0; geometries.size < 10; index += 1) {
      const next = bloubActivityGeometry(`geometry-${index}`);
      if (geometries.has(next.key)) continue;
      geometries.set(next.key, next);
      preparedActivity(next);
    }
    const remounted = preparedActivity(geometry);
    expect(remounted).not.toBe(mounted);
    expect(mounted[0].body.d).toBe(firstPath);
    expect(remounted).toEqual(mounted);
  });
});

it.each([30, 120, 190, FRAME_COUNT + 30, FRAME_COUNT + 120, FRAME_COUNT + 190])(
  "settles from displayed activity frame %i in cancellable bounded batches",
  (sourceIndex) => {
    const geometry = bloubActivityGeometry("settling-avatar");
    const cycle = preparedActivity(geometry);
    const idle = idleQueue();
    const sample = vi.spyOn(BotEngine.prototype, "sample");
    const ready = vi.fn();
    try {
      prepareBloubSettlingFrames(geometry, sourceIndex, cycle[sourceIndex], ready, idle.schedule);
      expect(sample).not.toHaveBeenCalled();
      while (idle.next()) {
        expect(sample.mock.calls.length).toBeLessThanOrEqual(4);
        sample.mockClear();
      }
      expect(ready).toHaveBeenCalledOnce();
      expect(ready.mock.calls[0][0]).toHaveLength(Math.ceil(SETTLE * FPS) + 1);
      expect(ready.mock.calls[0][0][0]).toEqual(cycle[sourceIndex]);
      ready.mockClear();
      const cancel = prepareBloubSettlingFrames(geometry, sourceIndex, cycle[sourceIndex], ready, idle.schedule);
      idle.next();
      sample.mockClear();
      cancel();
      while (idle.next()) {
        /* Drain any incorrectly retained preparation. */
      }
      expect(sample).not.toHaveBeenCalled();
      expect(ready).not.toHaveBeenCalled();
    } finally {
      sample.mockRestore();
    }
  },
);
