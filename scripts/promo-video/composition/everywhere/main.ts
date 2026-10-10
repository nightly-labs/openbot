// The everywhere video: one conversation on the desktop app, then in a browser, then on an iPhone,
// with one task done on each screen. The page draws any frame on request, like ../main.ts;
// render.ts muxes the song. Open it with `?play` to watch it with the song, after one render has
// downloaded it.

import { createStage, drawGridPulse, moveCamera, registerPromo, splitColor } from "../stage";
import { beatPulse, clamp, decay, decaySum } from "../timeline";
import { BEAT, CUE, EVERYWHERE_DURATION, TASK_TICKS } from "./cues";
import { camera } from "./device";
import { EVERYWHERE_MUSIC } from "./music";
import { createApp } from "./scenes/app";
import { createCaptions } from "./scenes/captions";
import { createOutro } from "./scenes/outro";

const GRID_PULSES = [CUE.send, CUE.browser, CUE.phone, CUE.message, CUE.logo] as const;

async function build(): Promise<(t: number) => void> {
  const stage = await createStage((context) => [createApp(context), createCaptions(context), createOutro(context)]);
  const { grid, glow, flash } = stage;

  return (t) => {
    stage.draw(t);

    // The grid is further away than the device, so it moves less with the camera.
    const { zoom, rotate } = camera(t);
    const depth = 1 + (zoom - 1) * 0.3;
    grid.style.transform = `rotate(${rotate * 0.6}deg) scale(${depth})`;
    grid.style.backgroundPosition = `50% calc(50% + ${t * 48}px)`;
    drawGridPulse(stage, t, GRID_PULSES, depth);
    glow.style.opacity = "1";

    const shake =
      5 * decaySum(CUE.words, 0.15, t) +
      18 * decay(t, CUE.send, 0.3) +
      6 * decaySum(TASK_TICKS, 0.2, t) +
      22 * decay(t, CUE.browser, 0.35) +
      22 * decay(t, CUE.phone, 0.35) +
      16 * decay(t, CUE.message, 0.3) +
      26 * decay(t, CUE.logo, 0.35);
    moveCamera(stage, t, shake, 1 + 0.012 * beatPulse(t, CUE.reply, CUE.fly, 0.16, BEAT));

    splitColor(
      stage,
      10 * decay(t, CUE.send, 0.3) +
        4 * decaySum(TASK_TICKS, 0.15, t) +
        14 * decay(t, CUE.browser, 0.35) +
        14 * decay(t, CUE.phone, 0.35) +
        10 * decay(t, CUE.message, 0.3) +
        12 * decay(t, CUE.logo, 0.3),
    );

    flash.style.opacity = String(
      clamp(
        Math.max(
          0.25 * decay(t, CUE.browser, 0.14),
          0.25 * decay(t, CUE.phone, 0.14),
          0.3 * decay(t, CUE.message, 0.14),
          0.85 * decay(t, CUE.logo, 0.3),
        ),
      ),
    );
  };
}

registerPromo({
  duration: EVERYWHERE_DURATION,
  build,
  // render.ts serves the downloaded song from the music folder.
  soundtrack: async (audio) => {
    const response = await fetch(`/${EVERYWHERE_MUSIC.file}`);
    if (!response.ok) throw new Error(`Render the video one time first, to download ${EVERYWHERE_MUSIC.file}.`);
    return { buffer: await audio.decodeAudioData(await response.arrayBuffer()), offset: EVERYWHERE_MUSIC.start };
  },
});
