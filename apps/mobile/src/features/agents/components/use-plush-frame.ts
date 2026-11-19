import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useAppActive } from "@/shared/lib/use-app-active";

interface Playback {
  frames: PlushFrame[];
  index: number;
  loopStart: number | null;
}

export function usePlushFrame(geometry: PlushGeometry, animate: boolean) {
  const still = useMemo(() => plushStillSequence(geometry), [geometry]);
  const playback = useSharedValue<Playback>({ frames: still.frames, index: 0, loopStart: null });
  const cursor = useSharedValue(0);
  const elapsed = useSharedValue(0);
  const shown = useRef<{ geometry: PlushGeometry; sequence: PlushSequence; loop: boolean }>({
    geometry,
    sequence: still,
    loop: false,
  });
  const onEnd = useRef<(() => void) | null>(null);
  const shownCount = useSharedValue(0);
  const [playing, setPlaying] = useState(false);
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

  const appActive = useAppActive();
  useEffect(() => {
    clock.setActive(playing && animate && appActive);
    return () => clock.setActive(false);
  }, [animate, appActive, clock, playing]);

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
      if (previous.geometry.key !== geometry.key) show(geometry, still, 0, false);
      loop(0);
    } else {
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
