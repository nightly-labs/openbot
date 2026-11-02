import { type AvatarMood, avatarMoodIsBusy } from "@openbot/brand/bloub-avatar-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useDerivedValue, useFrameCallback, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useAppDrawerShownOnUI } from "@/features/servers/components/app-drawer-activity";
import { useMotionPreference } from "@/shared/lib/motion";
import { isAndroid } from "@/shared/lib/platform";
import { useScreenFocusedWhile } from "@/shared/lib/use-screen-focused-while";

import {
  type BloubActivityFrame,
  bloubActivityGeometry,
  bloubMorphGeometry,
  bloubRestFrame,
  FPS,
  FRAME_COUNT,
  IDLE_FPS,
  prepareBloubActivityFrames,
  prepareBloubIdleFrames,
  prepareBloubMorphFrames,
  prepareBloubSettlingFrames,
} from "../model/bloub-activity";

/**
 * Android redraws a whole SVG in software for each changed frame, so it shows every second frame of
 * the 60 fps working and morph sequences: 30 fps, the rate of the desktop avatar.
 */
const FRAME_STEP = isAndroid ? 2 : 1;

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
  // Reduced motion, or the Settings switch for faces, holds the face at rest.
  const still = !useMotionPreference("agentFaces");
  const [playing, setPlaying] = useState(false);
  const busy = avatarMoodIsBusy(mood);
  const focused = useScreenFocusedWhile(!still && (busy || animateIdle));
  const geometry = useMemo(() => bloubActivityGeometry(seed, mood), [seed, mood]);
  const previousGeometry = useRef(geometry);
  const morph = useRef<{ from: typeof geometry; to: typeof geometry } | null>(null);
  const rest = useMemo(() => bloubRestFrame(geometry), [geometry]);
  const playback = useSharedValue<Playback>({ frames: [rest], index: 0, loopStart: null });
  const elapsed = useSharedValue(0);
  const idleFrames = useRef<BloubActivityFrame[] | null>(null);
  // Android: the drawer and its scrim cover the avatars of home, and each frame redraws the SVG in
  // software. The face holds its frame until the drawer has closed. The gate is on the UI thread, so
  // the drawer does not render every avatar again. iOS keeps the motion under its blur.
  const drawerShown = useAppDrawerShownOnUI();
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
    if (isAndroid && drawerShown.get()) return;
    const current = playback.get();
    if (current.loopStart === null && current.index >= current.frames.length - 1) return;
    const fps = current.idle ? IDLE_FPS : FPS;
    const step = current.idle ? 1 : FRAME_STEP;
    const accumulated = elapsed.get() + Math.min(timeSincePreviousFrame ?? 0, 64);
    const advance = Math.floor((accumulated * fps) / 1000 / step) * step;
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
    const update = () => clock.setActive(playing && focused && !still && AppState.currentState === "active");
    update();
    const subscription = AppState.addEventListener("change", update);
    return () => {
      subscription.remove();
      clock.setActive(false);
    };
  }, [clock, focused, playing, still]);

  useEffect(() => {
    const previous = previousGeometry.current;
    previousGeometry.current = geometry;
    if (still || !focused || (!busy && !animateIdle)) {
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
  }, [busy, focused, geometry, playback, still, rest, startIdle, animateIdle]);

  useEffect(() => {
    idleFrames.current = null;
    if (!animateIdle || busy || still || !focused) return;
    const cancel = prepareBloubIdleFrames(geometry, (frames) => {
      idleFrames.current = frames;
      const current = playback.get();
      if (current.loopStart === null && current.index >= current.frames.length - 1 && !current.preparing) startIdle();
    });
    return () => {
      cancel();
      idleFrames.current = null;
    };
  }, [animateIdle, busy, focused, geometry, playback, still, startIdle]);

  return useDerivedValue(() => {
    const current = playback.get();
    return current.frames[Math.floor(current.index)] ?? rest;
  });
}
