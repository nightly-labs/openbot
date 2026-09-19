import { BotEngine } from "@norbert_bodziony/bloub";
import { type AvatarMood, avatarMoodIsBusy } from "@openbot/brand/bloub-avatar-motion";
import { useIsFocused } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useDerivedValue, useFrameCallback, useReducedMotion, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import {
  type BloubActivityFrame,
  bloubActivityGeometry,
  bloubMorphGeometry,
  FPS,
  FRAME_COUNT,
  IDLE_FPS,
  nativeFrame,
  prepareBloubActivityFrames,
  prepareBloubIdleFrames,
  prepareBloubMorphFrames,
  prepareBloubSettlingFrames,
} from "../model/bloub-activity";

interface Playback {
  frames: BloubActivityFrame[];
  index: number;
  loopStart: number | null;
  idle?: boolean;
  preparing?: boolean;
}

/**
 * The frames to draw for an agent's avatar.
 *
 * The mood picks the face, which reaches the player through the geometry, so a change of mood
 * takes the same morph path as a change of appearance and the face glides into place. Only a busy
 * mood runs the working loop; the rest settle and hold. Mobile draws no orbit rings, so `working`
 * here is the working face and the wide-eyed beat rather than the rings the desktop turns.
 */
export function useBloubActivityFrame(seed: string, mood: AvatarMood, animateIdle = true) {
  const focused = useIsFocused();
  const reducedMotion = useReducedMotion();
  const [playing, setPlaying] = useState(false);
  const busy = avatarMoodIsBusy(mood);
  const geometry = useMemo(() => bloubActivityGeometry(seed, mood), [seed, mood]);
  const previousGeometry = useRef(geometry);
  const morph = useRef<{ from: typeof geometry; to: typeof geometry } | null>(null);
  const rest = useMemo(
    () => nativeFrame(new BotEngine(100, "idle", geometry.radii, geometry.expression).sample(0)),
    [geometry],
  );
  const playback = useSharedValue<Playback>({ frames: [rest], index: 0, loopStart: null });
  const elapsed = useSharedValue(0);
  const idleFrames = useRef<BloubActivityFrame[] | null>(null);
  const startIdle = useCallback(() => {
    const frames = idleFrames.current;
    if (!frames) return false;
    morph.current = null;
    playback.set({ frames, index: 0, loopStart: 0, idle: true });
    setPlaying(true);
    return true;
  }, [playback]);
  const stopPlayback = useCallback(() => {
    const current = playback.get();
    if (current.loopStart === null && current.index >= current.frames.length - 1) {
      morph.current = null;
      if (!startIdle()) setPlaying(false);
    }
  }, [playback, startIdle]);
  const clock = useFrameCallback(({ timeSincePreviousFrame }) => {
    const current = playback.get();
    if (current.loopStart === null && current.index >= current.frames.length - 1) return;
    const fps = current.idle ? IDLE_FPS : FPS;
    const accumulated = elapsed.get() + Math.min(timeSincePreviousFrame ?? 0, 64);
    const advance = Math.floor((accumulated * fps) / 1000);
    elapsed.set(accumulated - (advance * 1000) / fps);
    if (advance === 0) return;
    let index = current.index + advance;
    if (current.loopStart !== null && index >= current.frames.length) {
      index = current.loopStart + ((index - current.loopStart) % (current.frames.length - current.loopStart));
    } else if (current.loopStart === null) index = Math.min(index, current.frames.length - 1);
    if (index !== current.index)
      playback.modify((value) => {
        value.index = index;
        return value;
      });
    if (current.loopStart === null && index >= current.frames.length - 1) scheduleOnRN(stopPlayback);
  }, false);

  useEffect(() => {
    const update = () => clock.setActive(playing && focused && !reducedMotion && AppState.currentState === "active");
    update();
    const subscription = AppState.addEventListener("change", update);
    return () => {
      subscription.remove();
      clock.setActive(false);
    };
  }, [clock, focused, playing, reducedMotion]);

  useEffect(() => {
    const previous = previousGeometry.current;
    previousGeometry.current = geometry;
    if (reducedMotion || !focused || (!busy && !animateIdle)) {
      morph.current = null;
      setPlaying(false);
      playback.set({ frames: [rest], index: 0, loopStart: null });
    } else if (!busy && previous.key !== geometry.key) {
      const current = playback.get();
      const from = morph.current
        ? bloubMorphGeometry(morph.current.from, morph.current.to, Math.floor(current.index) / FPS)
        : previous;
      const sourceFrame = current.frames[Math.floor(current.index)] ?? rest;
      morph.current = { from, to: geometry };
      setPlaying(false);
      playback.set({ frames: [sourceFrame], index: 0, loopStart: null, preparing: true });
      return prepareBloubMorphFrames(from, geometry, sourceFrame, (frames) => {
        playback.set({ frames, index: 0, loopStart: null });
        setPlaying(true);
      });
    } else if (busy) {
      morph.current = null;
      // Reuse sampled paths across the header, activity row, and later working turns.
      setPlaying(false);
      playback.set({ frames: [rest], index: 0, loopStart: null });
      return prepareBloubActivityFrames(geometry, (frames) => {
        playback.set({ frames, index: 0, loopStart: FRAME_COUNT });
        setPlaying(true);
      });
    } else {
      morph.current = null;
      const current = playback.get();
      if (current.loopStart === null || current.idle) {
        setPlaying(false);
        playback.set({ frames: [rest], index: 0, loopStart: null });
        startIdle();
        return;
      }
      // Hold the displayed pose while preparing the return to idle.
      setPlaying(false);
      const sourceFrame = current.frames[Math.floor(current.index)] ?? rest;
      playback.set({ frames: [sourceFrame], index: 0, loopStart: null, preparing: true });
      return prepareBloubSettlingFrames(geometry, current.index, sourceFrame, (frames) => {
        playback.set({ frames, index: 0, loopStart: null });
        setPlaying(true);
      });
    }
  }, [busy, focused, geometry, playback, reducedMotion, rest, startIdle, animateIdle]);

  useEffect(() => {
    idleFrames.current = null;
    if (!animateIdle || busy || reducedMotion || !focused) return;
    const cancel = prepareBloubIdleFrames(geometry, (frames) => {
      idleFrames.current = frames;
      const current = playback.get();
      if (current.loopStart === null && current.index >= current.frames.length - 1 && !current.preparing) startIdle();
    });
    return () => {
      cancel();
      idleFrames.current = null;
    };
  }, [animateIdle, busy, focused, geometry, playback, reducedMotion, startIdle]);

  return useDerivedValue(() => {
    const current = playback.get();
    return current.frames[Math.floor(current.index)] ?? rest;
  });
}
