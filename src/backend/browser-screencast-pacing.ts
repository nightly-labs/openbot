const SCREENCAST_MINIMUM_FRAME_INTERVAL_MS = 33;

export interface FramePacer<T> {
  offer: (frame: T) => void;
  stop: () => void;
}

export function createFramePacer<T>(
  emit: (frame: T) => void,
  minimumIntervalMs: number = SCREENCAST_MINIMUM_FRAME_INTERVAL_MS,
): FramePacer<T> {
  let lastEmittedAt = Number.NEGATIVE_INFINITY;
  let held: T | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const release = (): void => {
    timer = undefined;
    const frame = held;
    held = undefined;
    if (frame === undefined) return;
    lastEmittedAt = Date.now();
    emit(frame);
  };

  return {
    offer(frame) {
      const wait = minimumIntervalMs - (Date.now() - lastEmittedAt);
      if (wait <= 0 && timer === undefined) {
        lastEmittedAt = Date.now();
        emit(frame);
        return;
      }
      held = frame;
      if (timer === undefined) timer = setTimeout(release, wait);
    },
    stop() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      held = undefined;
    },
  };
}
