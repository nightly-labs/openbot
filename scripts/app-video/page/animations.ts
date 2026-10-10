// Steps the CSS and Web Animations of one document by the video clock. Playwright's clock fakes
// timers and requestAnimationFrame, but the document timeline keeps real time. So each animation is
// paused when it appears and is moved forward one frame at a time from its own start.

export function createAnimationStepper(document: Document) {
  const local = new WeakMap<Animation, number>();

  return function step(seconds: number) {
    for (const animation of document.getAnimations()) {
      const known = local.get(animation);
      if (animation.playState === "paused" && known === undefined) {
        // The app paused it itself; a paused animation keeps its time.
        continue;
      }
      const time = known === undefined ? 0 : known + seconds * 1000 * animation.playbackRate;
      local.set(animation, time);
      const end = animation.effect?.getComputedTiming().endTime;
      const done = animation.playbackRate < 0 ? time <= 0 : typeof end === "number" && time >= end;
      if (done && Number.isFinite(end)) {
        // `finish()` fires `animationend`, `transitionend` and `finished` for the app.
        animation.finish();
        continue;
      }
      animation.pause();
      animation.currentTime = time;
    }
  };
}
