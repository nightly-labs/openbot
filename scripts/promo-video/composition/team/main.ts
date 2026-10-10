// The team video: one request, four agents, one handoff per two beats of the song. The page draws
// any frame on request, like ../main.ts; render.ts muxes the song. Open it with `?play` to watch
// it with the song, after one render has downloaded it.

import { createStage, drawGridPulse, moveCamera, registerPromo, splitColor } from "../stage";
import { beatPulse, clamp, decay, decaySum } from "../timeline";
import { BEAT, CUE, TEAM_DURATION, TURNS } from "./cues";
import { MUSIC } from "./music";
import { createChannel } from "./scenes/channel";
import { createHook } from "./scenes/hook";
import { createOutro } from "./scenes/outro";
import { camera } from "./shot";

const GRID_PULSES = [CUE.mention, CUE.shipped, CUE.logo] as const;
const MESSAGES = TURNS.map((turn) => turn.message);

async function build(): Promise<(t: number) => void> {
  const stage = await createStage((context) => [createHook(context), createChannel(context), createOutro(context)]);
  const { grid, glow, flash } = stage;

  return (t) => {
    stage.draw(t);

    // The grid is further away than the panel, so it moves less with the camera.
    const { zoom, rotate } = camera(t);
    const depth = 1 + (zoom - 1) * 0.3;
    grid.style.transform = `rotate(${rotate * 0.6}deg) scale(${depth})`;
    grid.style.backgroundPosition = `50% calc(50% + ${t * 48}px)`;
    drawGridPulse(stage, t, GRID_PULSES, depth);
    glow.style.opacity = "1";

    const shake =
      26 * decay(t, CUE.line, 0.4) +
      10 * decay(t, CUE.line2, 0.2) +
      26 * decay(t, CUE.mention, 0.35) +
      5 * decaySum(MESSAGES, 0.15, t) +
      22 * decay(t, CUE.shipped, 0.3) +
      26 * decay(t, CUE.logo, 0.35);
    moveCamera(stage, t, shake, 1 + 0.012 * beatPulse(t, TURNS[0]?.typing ?? 0, CUE.fold, 0.16, BEAT));

    splitColor(
      stage,
      14 * decay(t, CUE.line, 0.45) +
        8 * decay(t, CUE.line2, 0.2) +
        14 * decay(t, CUE.mention, 0.35) +
        10 * decay(t, CUE.pull, 0.3) +
        4 * decaySum(MESSAGES, 0.12, t) +
        10 * decay(t, CUE.shipped, 0.3) +
        12 * decay(t, CUE.logo, 0.3),
    );

    flash.style.opacity = String(
      clamp(
        Math.max(0.3 * decay(t, CUE.mention, 0.14), 0.25 * decay(t, CUE.shipped, 0.14), 0.85 * decay(t, CUE.logo, 0.3)),
      ),
    );
  };
}

registerPromo({
  duration: TEAM_DURATION,
  build,
  // render.ts serves the downloaded song from the music folder.
  soundtrack: async (audio) => {
    const response = await fetch(`/${MUSIC.file}`);
    if (!response.ok) throw new Error(`Render the video one time first, to download ${MUSIC.file}.`);
    return { buffer: await audio.decodeAudioData(await response.arrayBuffer()), offset: MUSIC.start };
  },
});
