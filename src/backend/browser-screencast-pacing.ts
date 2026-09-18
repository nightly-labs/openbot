// How often a live view may send a picture.
//
// A page decides how often it draws: a still page draws nothing, and a page with a video or an
// animation draws as often as the screen can. The person watching from another computer gains
// nothing above about thirty pictures a second, so this keeps the extra ones off the link and out
// of the client's decoder. The newest picture always replaces a held one, and a held picture is
// still sent when the page goes quiet, so the view never keeps an old picture of a page that
// stopped changing.

/** Thirty pictures a second: below what a screen shows, above what an eye follows. */
export const SCREENCAST_MINIMUM_FRAME_INTERVAL_MS = 33;

export interface FramePacer<T> {
  /** Takes the newest picture. It is sent now, or held until the interval has passed. */
  offer: (frame: T) => void;
  /** Drops a held picture and its timer. */
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
