import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useDerivedValue, useFrameCallback, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import {
  PLUSH_FPS,
  type PlushFrame,
  type PlushGeometry,
  type PlushSequence,
  plushLoopEntry,
  plushStillSequence,
  preparePlushLoop,
  preparePlushTransition,
} from "@/features/agents/model/plush/plush-frames";
import { useAppDrawerShownOnUI } from "@/features/servers/components/app-drawer-activity";
import { isAndroid } from "@/shared/lib/platform";

interface Playback {
  frames: PlushFrame[];
  index: number;
  /** The frame a loop goes back to, or `null` for a sequence that holds its last frame. */
  loopStart: number | null;
}

/**
 * The frames of a moving plush. `animate` is false while the face must hold still: reduced motion, a
 * screen out of focus, a disconnected agent, or a resting mood on a surface that rests.
 *
 * A mood loops: the eyes drift and blink, and the felt decor of the state moves. A new mood on the
 * same body glides from the frame on screen, and its loop goes on from where the glide ends.
 */
export function usePlushFrame(geometry: PlushGeometry, animate: boolean) {
  const still = useMemo(() => plushStillSequence(geometry), [geometry]);
  const playback = useSharedValue<Playback>({ frames: still.frames, index: 0, loopStart: null });
  /** The frame index for the JS thread, which must not copy the frames back from the UI thread. */
  const cursor = useSharedValue(0);
  const elapsed = useSharedValue(0);
  const shown = useRef<{ geometry: PlushGeometry; sequence: PlushSequence; loop: boolean }>({
    geometry,
    sequence: still,
    loop: false,
  });
  const onEnd = useRef<(() => void) | null>(null);
  /** Each shown sequence has a number, so the end of an older one cannot end the next. */
  const shownCount = useSharedValue(0);
  const [playing, setPlaying] = useState(false);
  // Android: the drawer and its scrim cover the avatars of home. The face holds its frame until the
  // drawer has closed. The gate is on the UI thread, so the drawer does not render every avatar again.
  const drawerShown = useAppDrawerShownOnUI();

  const show = useCallback(
    (shownGeometry: PlushGeometry, sequence: PlushSequence, start: number, loop: boolean) => {
      shown.current = { geometry: shownGeometry, sequence, loop };
      shownCount.set(shownCount.get() + 1);
      elapsed.set(0);
      cursor.set(start);
      playback.set({ frames: sequence.frames, index: start, loopStart: loop ? 0 : null });
      setPlaying(sequence.frames.length > 1);
    },
    [cursor, elapsed, playback, shownCount],
  );
  const ended = useCallback(
    (count: number) => {
      if (count !== shownCount.get()) return;
      const next = onEnd.current;
      onEnd.current = null;
      next?.();
    },
    [shownCount],
  );

  const clock = useFrameCallback(({ timeSincePreviousFrame }) => {
    if (isAndroid && drawerShown.get()) return;
    const current = playback.get();
    const last = current.frames.length - 1;
    if (current.loopStart === null && current.index >= last) return;
    const accumulated = elapsed.get() + Math.min(timeSincePreviousFrame ?? 0, 64);
    const advance = Math.floor((accumulated * PLUSH_FPS) / 1000);
    elapsed.set(accumulated - (advance * 1000) / PLUSH_FPS);
    if (advance === 0) return;
    let index = current.index + advance;
    if (current.loopStart !== null && index > last) {
      index = current.loopStart + ((index - current.loopStart) % (current.frames.length - current.loopStart));
    } else if (current.loopStart === null) index = Math.min(index, last);
    playback.modify((value) => {
      value.index = index;
      return value;
    });
    cursor.set(index);
    if (current.loopStart === null && index >= last) scheduleOnRN(ended, shownCount.get());
  }, false);

  useEffect(() => {
    const update = () => clock.setActive(playing && animate && AppState.currentState === "active");
    update();
    const subscription = AppState.addEventListener("change", update);
    return () => {
      subscription.remove();
      clock.setActive(false);
    };
  }, [animate, clock, playing]);

  useEffect(() => {
    onEnd.current = null;
    if (!animate) {
      show(geometry, still, 0, false);
      return;
    }
    const previous = shown.current;
    if (previous.loop && previous.geometry.key === geometry.key) return;
    let cancel = () => {};
    const loop = (entry: number) => {
      cancel = preparePlushLoop(geometry, (sequence) => show(geometry, sequence, entry % sequence.frames.length, true));
    };
    if (previous.geometry.key === geometry.key || previous.geometry.shape !== geometry.shape) {
      // A new body, or the first motion of this face: the loop starts from its first frame, which is
      // the still face, and the still face shows while the loop is prepared.
      if (previous.geometry.key !== geometry.key) show(geometry, still, 0, false);
      loop(0);
    } else {
      // The face holds the frame on screen while the glide is prepared.
      const index = Math.min(Math.floor(cursor.get()), previous.sequence.frames.length - 1);
      const frame = previous.sequence.frames[index];
      const source = previous.sequence.sources[index];
      if (frame && source) show(previous.geometry, { frames: [frame], sources: [source] }, 0, false);
      cancel = preparePlushTransition(previous.geometry, geometry, previous.sequence, index, (transition) => {
        onEnd.current = () => loop(plushLoopEntry(transition.sources.at(-1), geometry));
        show(geometry, transition, 0, false);
      });
    }
    return () => {
      onEnd.current = null;
      cancel();
    };
  }, [animate, cursor, geometry, show, still]);

  return useDerivedValue(() => {
    const current = playback.get();
    return current.frames[Math.floor(current.index)] ?? current.frames[0];
  });
}
